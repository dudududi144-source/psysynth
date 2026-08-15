# PSY Synth Device - Implementation Plan

Seven phases. Each phase ends green: its tests pass before the next phase starts. No phase modifies the shim.

> **VERIFIED STATUS (this repo, real run):** headless proof suite is GREEN — `115 pass · 3 skip · 0 fail · 118 tests across 14 files`. The 3 skips are browser-CI render tests that self-skip without `OfflineAudioContext`. Bundle builds clean: `public/psysynth.js` = **20.5 KB** minified ESM (`createSynthDevice` / `SynthDevice` / `SYNTH_ROLES` exports verified by import). Bundle is a build artifact, deliberately git-ignored.

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

STATUS: DONE + VERIFIED. `bun run bundle` exits 0 and emits public/psysynth.js at 20.5 KB (< 60 KB budget), ESM, es2020, no globals; exports confirmed by importing the built file. Demo host (src/app/page.tsx) present. Bundle is git-ignored by design (build artifact).

Files: scripts/build-bundle.ts, src/app/page.tsx (standalone demo), public/psysynth.js
Acceptance:
- Bundle < 60KB minified, ESM, no globals, es2020.
- Demo page: keyboard UI, patch selector, MIDI panel, diagnostics strip, works from cold start in one click.
- INTEGRATION-GUIDE.md verified against the demo wiring (guide matches reality).


## Browser-CI render proof (wired, runs in GitHub Actions)

STATUS: INFRASTRUCTURE COMPLETE + PUSHED. The real-sample render proof now has a full browser path:
- browser/render-harness.ts + render-harness.html run renderOffline() in a REAL OfflineAudioContext and expose window.__RESULT.
- scripts/build-harness.ts emits browser/render-harness.js (verified: builds clean, runRender registered, manifest inlined).
- e2e/render.spec.ts (Playwright, chromium headless) asserts audible + bit-identical output.
- ci.yml `browser` job: bun install -> playwright install chromium -> build:harness -> test:browser.
Headless `bun test tests/` stays green (115/3/0); the browser spec is isolated in e2e/ so it never runs headless.

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

## Phase 7 - PolyBLEP / hard-sync / PWM (the v2 oscillator polish)

STATUS: PURE DSP CORE + WORKLET SOURCE IMPLEMENTED (this repo).
- src/psy-synth/dsp/polyblep.ts        - pure, headless-testable PolyBLEP math (saw/pulse/PWM, hard-sync reset, Goertzel alias analysis).
- tests/psy-synth/polyblep.test.ts     - alias-reduction proof (Goertzel at folded freq), PWM mean, hard-sync, bounds.
- src/psy-synth/worklet/polyblep-worklet.ts - self-contained AudioWorklet processor (hard-sync + PWM) + createPolyBlepNode() registration helper.

Done (headless): PolyBLEP residual + generators, alias proxy vs naive, PWM duty mean, hard-sync phase reset, oscillator phase advance.
Done (headless, this pass): engine router - OscEngine type + optional SynthPatch.oscEngine (schema-validated), src/psy-synth/dsp/engine-router.ts (patchNeedsPolyBlep / selectOscEngine / engineCensus), tests/psy-synth/engine-router.test.ts (census over the shipped bank flags exactly lead-hitech-sync + pluck-forest as polyblep). Default stays 'periodic' so the audio hot path and all existing tests are untouched.
Done (headless, verified 121/0): SynthVoice now consults engine-router at trigger time and records the resolved engine (voice.engine) - see tests/psy-synth/voice-engine.test.ts (6 assertions: sync/ring-mod -> polyblep, explicit overrides win, re-evaluated per trigger).
Remaining (browser CI): register the worklet and route a polyblep-resolved voice through the AudioWorkletNode, then render-proof with real samples.

## Definition of Done (repo-level)

- All tests green: bun test (unit + contract + stress + render-proof).
- shim-sync green against pinned foundation commit.
- Bundle builds via `bun run bundle` (public/psysynth.js, ~20 KB); it is a build artifact and intentionally NOT committed (see .gitignore).
- No secrets anywhere (secret-scan step in CI script).
- README + 4 architecture docs consistent with shipped code.
