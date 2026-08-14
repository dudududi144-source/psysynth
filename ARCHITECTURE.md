# PSY Synth Device - Architecture

Version 1.0 (architecture phase). Companion documents: ARCHITECTURE-STYLE.md (style/patch spec), PSY-SYNTH-IMPLEMENTATION-PLAN.md (build plan), INTEGRATION-GUIDE.md (host wiring).

## 1. Position in the Family

The psy-foundation audit (PSY-FAMILY-ARCHITECTURE-CHALLENGE.md, section N) defines three realization devices: Sampler (exists), Synth (future), Drums (future). This repo is the Synth box.

```
 FOUNDATION (canonical, headless, never imported at runtime)
   Protocol: MusicalEvent / NoteEvent / MusicalTransport / MusicalContext
   Device contract: PsyDevice / DeviceHost / DeviceCapabilities
        |
        v
 DEVICES (pure HOW)
   psy-sampler (exists)  |  psysynth (THIS)  |  drums (future)
        |
        v
 FAMILY RUNTIME (host): shared AudioContext, shared engine bus,
   one DeviceHost, one transport per host (PSY4 / PSY6 / demo page)
```

Hard rules inherited from the family:
1. Devices are pure HOW. No composition, no scheduling policy, no transport ownership.
2. Foundation is never imported at runtime. Contracts arrive as a VERBATIM SHIM pinned to a foundation commit, guarded by a byte-equivalence sync test (same mechanism as psy-sampler, pinned to foundation commit 4ae95d3).
3. One AudioContext per host. The device receives it at creation. It never calls new AudioContext().
4. The device outputs ONLY to the injected outputNode. It never touches ctx.destination.
5. Devices report upstream only via capabilities() and reportLatencyMs(). No other side channel.

## 2. Module Map

```
src/psy-foundation-shim/        VERBATIM, sync-tested, do not edit
  protocol.ts                   MusicalEvent union, NoteEvent, DeviceCapabilities, MusicalContext
  transport.ts                  MusicalTransport (v0 contract, canonical for onTransport)
  device.ts                     PsyDevice interface
  host.ts                       DeviceHost + InMemoryChannel
src/psy-synth/
  index.ts                      createSynthDevice(opts) factory -> { device, load, dispose }
  types.ts                      SynthPatch, SynthRole, SynthConfig, VoiceState
  device.ts                     SynthDevice implements PsyDevice
  note-router.ts                NoteEvent -> voice on/off/hold decisions
  voice.ts                      SynthVoice DSP chain
  voice-pool.ts                 pooled voices + deterministic steal
  patch-library.ts              manifest load, validation, provenance, hot-swap
  variance-rules.ts             seeded micro-variance (deterministic)
  midi-map.ts                   CC <-> parameter table, MIDI-learn state
  latency.ts                    measured latency (baseLatency + lookahead)
  counters.ts                   event/voice/steal counters (observability, no logging in audio path)
public/patches/manifest.json    patch bank with provenance
tests/psy-synth/                contract / shim-sync / unit / stress / render-proof / integration
```

## 3. Contract Layer (event handling)

### 3.1 NoteEvent shape (canonical)

```ts
export interface NoteEvent {
  type: 'note'
  note: number          // MIDI pitch 0..127
  velocity: number      // 0..1 ; 0 means NOTE-OFF (family convention)
  duration: number      // seconds ; -1 means HOLD until matching note-off
  channel: string       // role name: 'bass' | 'lead' | 'arp' | 'pad' | 'stab' | 'pluck' | 'keys'
  at: number            // AudioContext time
}
```

### 3.2 Routing rules (note-router.ts)

| Input | Rule |
|---|---|
| velocity > 0, duration > 0 | voice.on(at, freq, vel); voice auto-releases at at + duration |
| velocity > 0, duration == -1 | voice.on(...); sustain until note-off for same (channel, note) |
| velocity == 0 | find active voice for (channel, note) -> voice.off(at) |
| channel unknown | DROP + increment unknownChannel counter. Never coerce, never guess (audit B1 lesson: no midi ?? 60 fallbacks) |
| at < ctx.currentTime - 50ms | DROP as stale + increment staleDrop counter (matches family stale-drop policy) |
| pitch out of 0..127 | DROP + increment invalidEvent counter |

Voice matching for note-off uses an active-voice index keyed by (channel, note) with LRU order for the rare duplicate case. Matching is O(1).

### 3.3 onTransport

Stores the snapshot. Used ONLY for: (a) phase-sync of tempo-locked LFOs, (b) arpeggiator clock derivation in patches that declare arp behavior, (c) reportLatencyMs context. Never used to schedule events.

### 3.4 onContext

Stores key/rootPc/scale/energy/style/section. Used for: patch-bank selection by style, global transposition policy for unpitched-safe behavior, energy macro mapping. NEVER used to change timing. (Unlike the sampler where onContext is dead - audit J finding - here it is live and tested.)

## 4. Audio Engine

### 4.1 SynthVoice chain

```
 OSC A (PolyBLEP: saw/square/triangle/sine) --+
 OSC B (PolyBLEP, detune, optional sync/ring) --+--> MIX --> Moog LPF (ladder) --> VCA (ADSR) --> role bus
 SUB OSC (sine, -1 or -2 oct, bass patches) ---+          ^
                                                     FILTER ENV (ADSR->cutoff)
                                                     LFO (sine/square, tempo-sync optional)
```

- Oscillators: PolyBLEP antialiased (foundation dsp lineage). No naive wavetable reads.
- Filter: 4-pole ladder approximation with soft saturation, cutoff 40Hz..18kHz, resonance 0..1 (self-osc guarded).
- Envelopes: ADSR with linear/exponential segment choice. All envelope rendering via precomputed curve tables + per-sample interpolation - zero allocation on trigger.
- Per-role bus gain + per-patch send levels (delaySend, reverbSend) wired into host-provided send nodes when present, else to outputNode only.

### 4.2 VoicePool

- Fixed 16 voices preallocated at onStart. Configurable per host (capabilities().voices).
- Allocation: free voice first; else deterministic steal policy: oldest-released -> lowest-current-gain -> oldest-on. Steal increments counter.
- Hot path (on/off/steal) performs ZERO heap allocations. Voices are reset in place.
- Per-role budget caps (config): bass 4, lead 4, arp 4, pad 6, stab 4, pluck 6, keys 4 (sum may exceed pool; pool is global).

### 4.3 Audio graph rules

- device subgraph -> role buses -> deviceOut gain -> injected outputNode.
- No device-internal mastering, no limiter, no compressor. Mastering belongs to the host bus (audit lesson: single master chain).
- Suspend safety: on onStop, all voices fast-released (10ms), timers/LFO clocks cleared, nodes disconnected from outputNode.

## 5. Timing Model

- NO internal scheduler clock (audit B8 lesson: never run a second 25ms loop). All rendering is scheduled directly at event.at using Web Audio param scheduling.
- Glide/portamento is voice-internal (frequency ramp from previous voice pitch), triggered by patch.glide > 0 and note adjacency per channel.
- Tempo-locked LFOs: phase computed from MusicalTransport.beatTime; re-anchored on onTransport with confidence >= 0.8 only.
- Latency: reportLatencyMs() = round(ctx.baseLatency*1000) + voiceTriggerOverhead (measured once at onStart, not hardcoded - audit B9 lesson).

## 6. Determinism and Variance

Single seeded RNG (mulberry32, foundation lineage) per device instance. Seed = patch manifest seed XOR host-provided seed (createSynthDevice opts.seed, default 1).

| Allowed to vary (seeded) | Never varies |
|---|---|
| osc detune drift +-3 cents | pitch, note timing |
| filter cutoff wobble +-2% (slow LFO phase offset) | patch selection |
| velocity micro-humanize +-3% when patch.humanize=true | role routing |
| arp octave ornament choice when patch.arpOrnament=true | event drop policy |

Same (seed, patch manifest version, event stream, AudioContext sampleRate) => identical parameter decisions. Audio render is reproducible in OfflineAudioContext (render-proof test).

## 7. MIDI Architecture (capabilities.midi = true)

### 7.1 MIDI-IN (host-owned, device-consumed)

The device itself does not call WebMIDI (that would make it a transport owner). The host bridge converts WebMIDI into NoteEvents:

| WebMIDI | Bridge output |
|---|---|
| Note On (vel>0) | NoteEvent { velocity: v/127, duration: -1 } (hold mode) |
| Note Off / Note On vel=0 | NoteEvent { velocity: 0 } |
| CC (mapped) | host applies to device via setParameter(cc mapping) |
| Pitch bend | NoteEvent extension later; v1: ignore + counter |
| MIDI Clock/Start/Stop | host transport only; device never syncs to MIDI directly |

### 7.2 MIDI-learn

midi-map.ts holds CC <-> parameter table (default: 74=cutoff, 71=resonance, 5=glide, 12=energy-macro). Learn flow: host puts device in learn mode, next CC claims the targeted parameter, table persists via host storage. Device state only - no storage I/O inside the device.

### 7.3 MIDI-OUT (optional, v2)

Patch-change and energy notifications as CC out. Not in v1 scope.

## 8. Performance Budget

| Metric | Target | Enforcement |
|---|---|---|
| Heap allocations in onEvent path | 0 | stress test with allocation counter (perf hooks) |
| Voice trigger cost | < 0.15ms | benchmark test |
| 16 voices full load CPU | < 15% (M1-equivalent) | stress + render-proof |
| GC dropouts during 5min 16th-bass loop | 0 | stress test (psy5 lineage bar) |
| Event-to-sound added latency | < 5ms over baseLatency | latency test |

## 9. Error Handling and Safety

- onEvent NEVER throws. Malformed events: drop + counter.
- Patch load failure: device stays silent for affected role + status surfaced via capabilities metadata; host decides fallback.
- outputNode disconnect detected (host teardown): fast-release all voices, no dangling graph.
- No eval, no dynamic code, no network inside the device bundle. Manifest fetch happens in the factory (load step), not in audio path.
- No secrets in code or artifacts. Manifest provenance is about audio assets, not credentials.

## 10. Audit-Lesson Compliance (B1-B12)

| Audit finding | psysynth design response |
|---|---|
| B1 midi??60 coercion | unknown/unpitched handling is explicit per role; no pitch fallbacks |
| B2 duration ignored | duration drives gate/release; -1 hold convention |
| B3 NoteEvent in 2 places | single verbatim shim; sync test fails on drift |
| B4 step dropped | not needed in HOW layer; documented as WHAT-layer concern |
| B5 unsafe role cast | channel validated against canonical SynthRole enum; unknown => drop+count |
| B6 musical constants in HOW | zero composition constants; phrase logic stays in host |
| B7 duplicate plan caches | n/a (stateless regarding plans) |
| B8 dual schedulers | no device clock at all |
| B9 latency mismatch | measured latency; capabilities() reads same source as reportLatencyMs() |
| B10 role taxonomy mismatch | canonical SynthRole enum in types.ts; capabilities advertises exactly it |
| B11 duplicated at | single at in NoteEvent; no opts duplication |
| B12 transport cached twice | device holds ONE transport snapshot; host owns its own |

## 11. Observability (no logs in audio path)

counters.ts exposes: eventsReceived, eventsDropped{reason}, voicesOn, voicesStolen, unknownChannel, staleDrop, patchLoadErrors. Readable via device.getDiagnostics() (main thread only). The standalone demo renders these as a status strip; hosts may ignore.

## 12. Build and Bundle

- bun workspace like psy-sampler. Build: bun run scripts/build-bundle.ts -> public/psysynth.js (ESM, single file, no external runtime deps, target es2020).
- Bundle exports: createSynthDevice, SynthDevice, types. No globals.
- Size budget: < 60KB minified (sampler precedent: 37KB).
