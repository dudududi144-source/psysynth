# PSY Synth Device

The canonical subtractive-synth realization device in the PSY family. Consumes MusicalEvents from a DeviceHost and renders them as real-time synthesized audio. Sibling of psy-sampler: same contract, opposite sound source - no samples, pure synthesis. First family member with capabilities.midi = true.

```
                 Host (PSY4 / PSY6 / future)
                          |
                    Composition Engine
                          |
              NoteEvent { type:'note', note, velocity, duration, channel, at }
                          |
                   SynthBridge (adapter, lives in the host)
                          |
               DeviceHost + InMemoryChannel   (psy-foundation contract)
                          |
              +-----------+------------+
              |      SynthDevice        |   <- THIS REPO (HOW only)
              |  NoteRouter -> VoicePool|
              |  SynthVoice:            |
              |   2x PolyBLEP osc       |
              |   -> Moog LPF           |
              |   -> ADSR VCA           |
              +-----------+------------+
                          |
                   outputNode (shared engine bus - never ctx.destination)
```

## What This Is

The PSY Synth is a realization device - it receives NoteEvents from a host and renders them as audio using subtractive synthesis. It does NOT compose, schedule, or own transport. It is a pure HOW layer.

| Property | Value |
|---|---|
| Family role | Realization device (HOW), the "Synth" box in the foundation target architecture |
| Host | Any NoteEvent producer: PSY4 (radio-following), PSY6 (performance), standalone demo page |
| Audio | Shared AudioContext + shared engine bus injected by the host - zero duplicate graphs |
| Transport | Consumed via onTransport (sync only: LFO phase, arpeggiator clock) - never owned |
| Sound source | 100% synthesized: PolyBLEP oscillators, Moog ladder LPF, ADSR. No samples |
| MIDI | First midi:true device: MIDI-in note/CC, MIDI-learn, note-off via velocity:0 |
| Determinism | Seeded variance only (single mulberry32 lineage); same seed => same audio decisions |

## Architecture

| Layer | Owner | What |
|---|---|---|
| WHAT (composition) | Host composer | Decides which notes, when, with which role |
| Contract | PsyDevice interface | onTransport, onContext, onEvent, capabilities, reportLatencyMs |
| Routing | DeviceHost + InMemoryChannel | Fan-out of events to registered devices |
| HOW (realization) | SynthDevice | Note routing, voice allocation, patch application, DSP rendering |
| Audio | Shared AudioContext | One context per host, injected into the device at creation |

## Contract Conformance (PsyDevice)

```ts
// VERBATIM from psy-foundation/device-sdk (pinned via shim + sync test)
export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
```

| Event | SynthDevice response |
|---|---|
| note (velocity > 0) | Allocate pooled voice for channel role, patch lookup, trigger at event.at |
| note (velocity == 0) | NOTE-OFF: release matching voice (family convention, no contract change) |
| note (duration == -1) | HOLD mode: voice sustains until matching note-off (MIDI keyboard play) |
| pattern | (optional) hot-swap patch bank for the announced roles |
| energy / drop | Macro modulation: drive, unison spread, filter opening |
| section | Patch-bank context switch (break => pads/keys; drop => bass/lead/arp) |
| beat | Phase re-sync for tempo-locked LFO/arpeggiator |

## Style Requirements (Psytrance-grade)

The synth must cover the canonical psytrance voice palette - every role is a data-driven patch, not code:

| Role | Character | Core requirements |
|---|---|---|
| bass | 303-style acid / rolling offbeat | Glide (portamento), hard filter env, velocity tracking, sub layer, sidechain-ready gate |
| lead | Squelch full-on lead | Dual detuned osc, resonant sweep, optional glide, delay-send heavy |
| arp | Hi-tech 16th arpeggios | Pluck env, tight decay, per-step cutoff variation, deterministic octave patterns |
| pad | Atmospheric break pads | Slow attack/release, wide detune, reverb-send heavy, low voice cost |
| stab | Goa stabs/chords | Chord trigger from single note, short decay, band-pass option |
| pluck | Organic/forest plucks | Sync/ring-mod option, fast decay |
| keys | Break melody keys | Soft triangle/sine mix, gentle chorus via detune |

Full per-subgenre specs (FULL-ON / DARK-PSY / PROGRESSIVE / GOA / HI-TECH / FOREST) live in ARCHITECTURE-STYLE.md.

## Integration (5 lines from any host)

```ts
const synthModule = await import('/psysynth.js')
const bundle = synthModule.createSynthDevice({
  audioContext: host.audioContext,     // SHARED
  outputNode: host.engineBusInput,     // SHARED master bus
  patchManifestUrl: '/patches/manifest.json',
})
bridge.register(bundle.device)          // DeviceHost wiring
await bundle.load()
```

See INTEGRATION-GUIDE.md for the full bridge contract, NoteEvent mapping, and MIDI wiring.

## Repository Map (planned)

```
src/psy-foundation-shim/   verbatim contracts (pinned, sync-tested)
src/psy-synth/             device core (device/voice/pool/router/patches/midi)
src/app/                   Next.js standalone demo host
public/psysynth.js         ESM bundle (build artifact)
public/patches/            patch manifest + presets (with provenance)
tests/psy-synth/           contract / shim-sync / unit / stress / render-proof
```

## Non-Goals (by design)

- No composition, no pattern generation, no transport ownership
- No internal 25ms scheduler clock - scheduling is purely event.at on the shared context
- No connection to ctx.destination - output only via injected outputNode
- No runtime import of psy-foundation - verbatim shim only (until canonical workspace exists)

## Documents

- ARCHITECTURE.md - full technical architecture
- ARCHITECTURE-STYLE.md - psytrance style spec, roles, subgenre presets, patch schema
- PSY-SYNTH-IMPLEMENTATION-PLAN.md - phased build plan with acceptance criteria
- INTEGRATION-GUIDE.md - host wiring guide (PSY4/PSY6/future)
- CONTRIBUTING.md - rules of the repo (shim purity, test gates)

---

Status: PHASES 0-5 IMPLEMENTED - full device core (voice/pool/router/patches/MIDI), 20-patch psytrance bank, 8 test files, demo host. Remaining: render-proof CI in browser + PolyBLEP/sync AudioWorklet polish (Phase 6 gates).
