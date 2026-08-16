
// Phase 7 (KAI) - example SynthPatchExt patches that use the extended DSP.
// These are NOT in the main manifest.json yet (they need voice-ext wiring in
// the device first). They document the target patch format for Thor-like sounds.
//
// To activate: add to public/patches/manifest.json once the device routes
// SynthPatchExt (with modMatrix) through dsp/voice-ext.ts.

export const EXAMPLE_FM_BASS = {
  id: "fm-bass-glass",
  role: "bass",
  provenance: { author: "KAI", license: "original", created: "2026-08-16" },
  osc: {
    a: { wave: "sine", gain: 0.7, waveExt: "fm", fmRatio: 2.0, fmAmount: 0.6 },
  },
  glideMs: 0,
  filter: { type: "lp", typeExt: "lp", cutoff: 1200, res: 0.3, envDepth: 0.5, envAttackMs: 1, envDecayMs: 180, velTrack: 0.15 },
  amp: { attackMs: 1, decayMs: 200, sustain: 0.5, releaseMs: 60 },
  driveDb: 2,
  sends: { delay: 0.1, reverb: 0.0 },
  humanize: false,
  modMatrix: [
    { source: "velocity", destination: "fmAmount", amount: 0.4 },
  ],
}

export const EXAMPLE_FORMANT_PAD = {
  id: "formant-choir-pad",
  role: "pad",
  provenance: { author: "KAI", license: "original", created: "2026-08-16" },
  osc: {
    a: { wave: "saw", gain: 0.5 },
  },
  glideMs: 0,
  filter: { type: "lp", typeExt: "formant", cutoff: 800, res: 8.0, envDepth: 0.3, envAttackMs: 400, envDecayMs: 800, velTrack: 0.1, formant: "a" },
  amp: { attackMs: 800, decayMs: 1200, sustain: 0.7, releaseMs: 1500 },
  driveDb: 0,
  sends: { delay: 0.15, reverb: 0.5 },
  humanize: true,
  modMatrix: [],
}
