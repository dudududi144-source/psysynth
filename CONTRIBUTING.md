# Contributing to psysynth

Rules of the repo. Short, strict, family-aligned.

## The Iron Rules

1. SHIM PURITY: files under src/psy-foundation-shim are VERBATIM copies of psy-foundation. Never edit them. To change a contract, change the foundation first, bump the pin, re-sync, and let shim-sync.test.ts prove byte-equivalence.
2. HOW ONLY: no composition logic, no pattern generation, no transport ownership, no scheduling clocks. If a PR adds a setInterval to device code, it is rejected.
3. NO ctx.destination: audio exits only through the injected outputNode. Static analysis test enforces this.
4. NO SECRETS: tokens, keys, credentials never appear in code, docs, manifests, commit messages, or CI config. Examples use placeholders. A secret-scan step runs before every build.
5. DETERMINISM: any new variance must go through variance-rules.ts with the single seeded RNG. Math.random() is banned in src/psy-synth (lint rule).
6. ZERO ALLOCATION HOT PATH: onEvent/on/off paths allocate nothing. Tests count allocations.

## Test Gates (all green before merge)

- shim-sync: byte-equivalence with pinned foundation commit
- contract: PsyDevice structural conformance + event routing table
- unit: voice math, pool determinism, patch validation, midi-map
- fuzz: 1k malformed events => zero throws
- stress: 5-minute 16th-bass loop, zero GC dropouts, zero bass steals
- render-proof: OfflineAudioContext renders, seed-reproducible (bit-compare)
- secret-scan: no credentials anywhere

## Commit Style

- docs: / feat: / fix: / test: / chore: prefixes
- one concern per commit; no mixed commits
- never include generated artifacts except public/psysynth.js via the build script

## PR Checklist

- [ ] bun test green (all gates)
- [ ] shim untouched (or re-synced with pin bump)
- [ ] no new runtime dependency without justification
- [ ] docs updated if behavior changed
- [ ] bundle size still < 60KB
- [ ] secret-scan clean

## Family Coordination

- Contract changes go through psy-foundation first. This repo consumes; it never invents protocol.
- If psy-foundation releases a new canonical version: bump the pin in ONE commit, run shim-sync, fix fallout.
- Sibling devices (psy-sampler, future drums) are references, not dependencies. No cross-device imports.
