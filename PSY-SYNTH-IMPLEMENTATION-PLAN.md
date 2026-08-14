# PSY Synth Device - Implementation Plan

Seven phases. Each phase ends green: its tests pass before the next phase starts. No phase modifies the shim.

## Phase 0 - Scaffold and Contract Purity

Tasks:
1. bun + Next.js workspace (mirror psy-sampler structure), eslint, tsconfig strict.
2. Copy verbatim shim files from psy-foundation commit 4ae95d3: protocol.ts, transport.ts, device.ts, host.ts.
3. Write tests/psy-synth/shim-sync.test.ts - byte-equivalence against pinned source (same mechanism as psy-sampler's sync test).
4. Write tests/psy-synth/contract.test.ts skeleton: SynthDevice must satisfy PsyDevice structurally.

Done when: bun test green with 0 device code; shim-sync fails loudly if anyone edits a shim file.

## Phase 1 - Voice and Pool (the DSP core)

Files: types.ts, voice.ts, voice-pool.ts, counters.ts
Tests: voice.test.ts (envelope math, filter stability, no NaN at res 0.95), voice-pool.test.ts (alloc/steal determinism, budget caps, zero zombie voices).

Acceptance:
- 16 voices, deterministic steal order verified across 10k random sequences.
- PolyBLEP spectrum check: aliasing below -60dB at 8kHz fundamental (offline analysis test).
- Zero allocations in on/off path (allocation counter test).

## Phase 2 - SynthDevice and NoteRouter

Files: device.ts, note-router.ts, latency.ts, index.ts (factory)
Tests: contract.test.ts (full), note-router.test.ts (all routing rules table), integration.test.ts with DemoHost (InMemoryChannel).

Acceptance:
- Every routing rule from ARCHITECTURE.md 3.2 covered by a test, including malformed events (drop+count, never throw).
- onEvent never throws: property test with 1k fuzzed events.
- reportLatencyMs equals measured value (no hardcoding).

## Phase 3 - Patch System + Psytrance Bank

Files: patch-library.ts, variance-rules.ts, public/patches/manifest.json (+ per-bank files)
Tests: patch-library.test.ts (schema validation, provenance enforcement, hot-swap), variance.test.ts (seed determinism).

Acceptance:
- Full bank per ARCHITECTURE-STYLE.md section 2: 7 roles, >= 20 patches, 6 subgenre banks.
- Same seed => identical parameter decisions (property test, 5k events).
- Invalid manifests rejected at load with counters; runtime never sees a bad patch.

## Phase 4 - MIDI Layer

Files: midi-map.ts (+ host-side WebMIDI in demo app)
Tests: midi-map.test.ts (CC mapping, learn flow state machine).

Acceptance:
- Hardware keyboard path: WebMIDI -> NoteEvent(velocity, duration:-1) -> hold -> note-off -> pool empty (assertion).
- Default CC table: 74/71/5/12 mapped; learn claims next CC; mapping persists via host storage only.
- No WebMIDI calls inside the device bundle (static analysis test).

## Phase 5 - Bundle and Demo Host

Files: scripts/build-bundle.ts, src/app/page.tsx (standalone demo), public/psysynth.js
Acceptance:
- Bundle < 60KB minified, ESM, no globals, es2020.
- Demo page: keyboard UI, patch selector, MIDI panel, diagnostics strip, works from cold start in one click.
- INTEGRATION-GUIDE.md verified against the demo wiring (guide matches reality).

## Phase 6 - Proof Suite (the psytrance-grade gate)

STATUS: HEADLESS PROOF SUITE IMPLEMENTED (this repo).
- tests/psy-synth/stress.test.ts        - 5-min 145 BPM bass: zero node churn (GC-dropout proxy), zero bass steals, zero drops; tight-budget arp steal determinism.
- tests/psy-synth/render-proof.test.ts  - bit-identical AudioParam scheduling fingerprint across runs (seed), via stub render log.
- tests/psy-synth/style-acceptance.test.ts - manifest integrity, 7-role coverage, sidechain contract, 6 subgenre banks, per-role behavior.
- src/psy-synth/render.ts               - OfflineAudioContext renderer + peak/RMS for the browser-CI real-sample counterpart.

Browser CI run (real samples) + PolyBLEP/sync AudioWorklet remain as polish; the headless gates below run on every commit without audio hardware.

Tests: stress.test.ts, render-proof.test.ts, style-acceptance.test.ts (automated parts of ARCHITECTURE-STYLE.md section 7).

Acceptance (all from STYLE doc section 7 that are automatable):
- 5-minute 16th-bass loop at 145 BPM: zero GC dropouts (frame-time histogram), zero steal on bass budget.
- 32-step arp at 175 BPM: zero artifacts; render bit-identical across two runs (seed).
- OfflineAudioContext render of the full style suite; peak/RMS/spectrum assertions saved as artifacts.
- All Phase 0-5 tests still green.

## Definition of Done (repo-level)

- All tests green: bun test (unit + contract + stress + render-proof).
- shim-sync green against pinned foundation commit.
- Bundle built and committed to public/psysynth.js only via build script.
- No secrets anywhere (secret-scan step in CI script).
- README + 4 architecture docs consistent with shipped code.
