# PSY Synth Device

> The canonical **subtractive-synth realization device** of the PSY family. A pure HOW layer: it consumes `MusicalEvent`s from a `DeviceHost` and renders them as real-time synthesized audio. Sibling of `psy-sampler` — same contract, opposite sound source: **no samples, pure synthesis**. First family member with `capabilities.midi = true`.

[![ci](https://github.com/dudududi144-source/psysynth/actions/workflows/ci.yml/badge.svg)](https://github.com/dudududi144-source/psysynth/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/tests-115_pass_%C2%B7_0_fail-brightgreen)
![runtime](https://img.shields.io/badge/runtime-bun-blue)
![lang](https://img.shields.io/badge/TypeScript-strict-3178c6)
![license](https://img.shields.io/badge/license-MIT-green)

---

## What This Is

A **realization device**. It receives `NoteEvent`s from a host and renders them with subtractive synthesis. It does **not** compose, schedule, or own transport — it is a pure HOW layer.

| Property | Value |
|---|---|
| **Family role** | Realization device (HOW) — the "Synth" box in the foundation target architecture |
| **Host** | Any `NoteEvent` producer: PSY4 (radio-following), PSY6 (performance), standalone demo |
| **Audio** | Shared `AudioContext` + shared engine bus injected by the host — zero duplicate graphs |
| **Transport** | Consumed via `onTransport` (sync only) — never owned |
| **Sound source** | 100% synthesized: PolyBLEP oscillators, Moog-style LPF, ADSR. No samples |
| **MIDI** | First `midi:true` device — note/CC in, MIDI-learn, note-off via `velocity:0` |
| **Determinism** | Seeded variance only (single mulberry32 lineage); same seed ⇒ same decisions |

## Quickstart

```bash
git clone https://github.com/dudududi144-source/psysynth
cd psysynth
bun install
bun test tests/        # full headless proof suite
bun run secret-scan    # credential gate
```

## Architecture

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

| Layer | Owner | What |
|---|---|---|
| **WHAT** (composition) | Host composer | Decides which notes, when, with which role |
| **Contract** | `PsyDevice` interface | `onTransport` / `onContext` / `onEvent` / `capabilities` / `reportLatencyMs` |
| **Routing** | `DeviceHost` + `InMemoryChannel` | Fan-out of events to registered devices |
| **HOW** (realization) | `SynthDevice` | Note routing, voice allocation, patch application, DSP rendering |
| **Audio** | Shared `AudioContext` | One context per host, injected at creation |

## Contract Conformance (`PsyDevice`)

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
| `note` (velocity > 0) | Allocate pooled voice for channel role, patch lookup, trigger at `event.at` |
| `note` (velocity == 0) | **NOTE-OFF**: release matching voice (family convention, no contract change) |
| `note` (duration == -1) | **HOLD** mode: voice sustains until matching note-off (MIDI keyboard play) |
| `pattern` | (optional) hot-swap patch bank for the announced roles |
| `energy` / `drop` | Macro modulation: drive, unison spread, filter opening |
| `section` | Patch-bank context switch (break ⇒ pads/keys; drop ⇒ bass/lead/arp) |
| `beat` | Phase re-sync for tempo-locked LFO/arpeggiator |

## Style Requirements (Psytrance-grade)

Every role is a **data-driven patch**, not code:

| Role | Character | Core requirements |
|---|---|---|
| `bass` | 303-style acid / rolling offbeat | Glide, hard filter env, velocity tracking, sub layer, sidechain-ready gate |
| `lead` | Squelch full-on lead | Dual detuned osc, resonant sweep, optional glide, delay-send heavy |
| `arp` | Hi-tech 16th arpeggios | Pluck env, tight decay, per-step cutoff variation, deterministic octave patterns |
| `pad` | Atmospheric break pads | Slow attack/release, wide detune, reverb-send heavy, low voice cost |
| `stab` | Goa stabs/chords | Chord trigger from single note, short decay, band-pass option |
| `pluck` | Organic/forest plucks | Sync/ring-mod option, fast decay |
| `keys` | Break melody keys | Soft triangle/sine mix, gentle chorus via detune |

Full per-subgenre specs (FULL-ON / DARK-PSY / PROGRESSIVE / GOA / HI-TECH / FOREST) live in [`ARCHITECTURE-STYLE.md`](./ARCHITECTURE-STYLE.md).

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

See [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md) for the full bridge contract, `NoteEvent` mapping, and MIDI wiring.

## Testing

The proof suite runs fully headless (no audio hardware) via `bun test`:

```
115 pass · 3 skip · 0 fail · 118 tests across 14 files · ~150ms
```

| Suite | Proves |
|---|---|
| `contract.test.ts` | `PsyDevice` conformance + 1k-event fuzz (never throws) |
| `shim-sync.test.ts` | Verbatim-shim purity (pinned foundation contracts) |
| `stress.test.ts` | 5-min 145 BPM bass: zero node churn, zero steals on budget; tight-budget arp steal determinism |
| `render-proof.test.ts` | Bit-identical AudioParam scheduling fingerprint per seed |
| `polyblep.test.ts` | Alias reduction (Goertzel), PWM, hard-sync, bounds |
| `style-acceptance.test.ts` | Manifest integrity, 7-role coverage, sidechain contract, subgenre banks |
| `render-offline.browser.test.ts` | Real-sample render proof (self-skips headless; runs in browser CI) |

> The 3 skipped tests are browser-CI render tests that intentionally self-skip when `OfflineAudioContext` is unavailable.

## Repository Map

```
src/psy-foundation-shim/   verbatim contracts (pinned, sync-tested)
src/psy-synth/             device core (device/voice/pool/router/patches/midi)
src/psy-synth/dsp/         pure PolyBLEP DSP + engine router (headless-testable)
src/psy-synth/worklet/     PolyBLEP AudioWorklet processor (hard-sync + PWM)
src/psy-synth/render.ts    offline renderer (browser-CI real-sample proof)
src/app/                   Next.js standalone demo host
public/patches/            patch manifest + presets (with provenance)
tests/psy-synth/           contract / shim-sync / unit / stress / render-proof / polyblep
tests/helpers/             headless audio stub (render-fingerprint recorder)
scripts/                   build-bundle.ts, secret-scan.ts
.github/workflows/ci.yml   headless proof CI (bun test + secret-scan)
```

## Non-Goals (by design)

- No composition, no pattern generation, no transport ownership
- No internal 25ms scheduler clock — scheduling is purely `event.at` on the shared context
- No connection to `ctx.destination` — output only via injected `outputNode`
- No runtime import of `psy-foundation` — verbatim shim only (until canonical workspace exists)

## Documents

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — full technical architecture
- [`ARCHITECTURE-STYLE.md`](./ARCHITECTURE-STYLE.md) — psytrance style spec, roles, subgenre presets, patch schema
- [`PSY-SYNTH-IMPLEMENTATION-PLAN.md`](./PSY-SYNTH-IMPLEMENTATION-PLAN.md) — phased build plan with acceptance criteria
- [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md) — host wiring guide (PSY4/PSY6/future)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — rules of the repo (shim purity, test gates)

---

**Status:** Phases 0–6 headless **complete & test-verified green** + PolyBLEP DSP core + engine-router opt-in (schema-validated, headless-routed). Remaining: browser-CI real-sample render run + wiring engine-router into the voice audio path.
