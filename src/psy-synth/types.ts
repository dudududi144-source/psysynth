// psysynth canonical types.
// NOTE: SynthRole is the single canonical role enum (audit B10 lesson).
// capabilities().roles must expose EXACTLY this set - no free-form strings.

export const SYNTH_ROLES = ['bass', 'lead', 'arp', 'pad', 'stab', 'pluck', 'keys'] as const
export type SynthRole = (typeof SYNTH_ROLES)[number]

export function isSynthRole(x: string): x is SynthRole {
  return (SYNTH_ROLES as readonly string[]).includes(x)
}

export type WaveKind = 'saw' | 'square' | 'triangle' | 'sine'

/** Oscillator engine. 'periodic' = fixed PeriodicWave (static band-limited);
 * 'polyblep' = per-sample PolyBLEP (dynamic: hard-sync / PWM). */
export type OscEngine = 'periodic' | 'polyblep'

export interface OscSpec {
  wave: WaveKind
  /** semitones relative to note (e.g. -12 for sub/weight layers) */
  semitones?: number
  /** cents, positive or negative (detune layers) */
  detuneCents?: number
  gain: number
  /** hard-sync osc A (lead/hitech variants) */
  sync?: boolean
  /** ring-mod with osc A at this depth 0..1 (pluck variants) */
  ringMod?: number
}

export interface SubSpec {
  /** semitones below note, typically -12 */
  semitones: number
  gain: number
}

export interface FilterSpec {
  type: 'lp' | 'bp'
  cutoff: number          // Hz, 40..18000
  res: number             // 0..0.95 (self-osc guarded internally)
  envDepth: number        // 0..1
  envAttackMs: number
  envDecayMs: number
  velTrack: number        // 0..0.3 : velocity raises cutoff
  lfoHz?: number          // optional LFO rate
  lfoDepth?: number       // 0..1 of cutoff
  lfoSync?: 'off' | '1-4' | '1-8' | '1-16'
}

export interface AmpSpec {
  attackMs: number
  decayMs: number
  sustain: number         // 0..1
  releaseMs: number
}

export interface SendSpec {
  delay: number           // 0..1
  reverb: number          // 0..1
}

export interface PatchProvenance {
  author: string
  license: string
  created: string         // ISO date
  source?: string
}

export interface SynthPatch {
  id: string
  role: SynthRole
  provenance: PatchProvenance
  osc: { a: OscSpec; b?: OscSpec; sub?: SubSpec }
  /** portamento in ms; 0 = off. Legato-only (retriggers on held channel notes). */
  glideMs: number
  filter: FilterSpec
  amp: AmpSpec
  /** pre-filter drive, 0..12 dB */
  driveDb: number
  sends: SendSpec
  /** seeded velocity micro-humanize +-3% */
  humanize: boolean
  /** chord intervals triggered from a single note (stab role) */
  chordIntervals?: number[]
  /** seeded octave ornament for arp (e.g. +12 every 4th step) */
  arpOrnament?: boolean
  /** Oscillator engine; omitted = auto (periodic unless the patch needs polyblep) */
  oscEngine?: OscEngine
  /** per-step seeded cutoff variance +-8% (arp role) */
  stepVariance?: boolean
}

export interface PatchManifest {
  manifestVersion: number
  seed: number
  patches: SynthPatch[]
}

/** Per-style bank: patch-id overrides + macro tuning. Selected via onContext(style). */
export interface StyleBank {
  style: string
  patchOverrides: Partial<Record<SynthRole, string>>
  macro: {
    cutoffBias: number      // multiplier on patch cutoff
    resBias: number         // multiplier on patch res
    glideBias: number       // multiplier on glideMs
    energyToCutoff: number  // extra cutoff opening per energy point
  }
}

export interface SynthConfig {
  deviceId: string
  maxVoices: number
  seed: number
  /** steal policy is deterministic; config only caps per-role budgets */
  roleBudgets: Partial<Record<SynthRole, number>>
}

export interface VoiceNoteTarget {
  note: number
  velocity: number
  at: number               // AudioContext time
  holdUntilNoteOff: boolean
  releaseAt: number | null // null when holding
}

export interface SynthDiagnostics {
  eventsReceived: number
  eventsDropped: number
  dropReasons: Record<string, number>
  voicesOn: number
  voicesStolen: number
  unknownChannel: number
  staleDrop: number
  patchLoadErrors: number
}


// ============================================================
// PSYSYNTH PRO / KAI Phase 1 - extended synthesis types.
// All additions are OPTIONAL / backward compatible. Existing patches
// (Subtractor-style) keep working unchanged.
// ============================================================

/** Extended oscillator waveforms beyond the basic 4 (Thor-like). */
export type OscWaveExt = WaveKind | 'fm' | 'phase' | 'wavetable' | 'noise' | 'sampleHold'

/** Filter types beyond lp/bp (Thor-like multi-mode). */
export type FilterTypeExt = 'lp' | 'hp' | 'bp' | 'notch' | 'comb' | 'formant' | 'svf'

/** A modulation source in the mod matrix. */
export type ModSource =
  | 'lfo1' | 'lfo2' | 'lfo3'
  | 'env1' | 'env2' | 'env3' | 'env4'
  | 'velocity' | 'key' | 'modWheel' | 'aftertouch' | 'sampleHold' | 'stepSeq' | 'random'

/** A modulation destination in the mod matrix. */
export type ModDest =
  | 'oscPitch' | 'oscDetune' | 'oscGain'
  | 'filterCutoff' | 'filterRes'
  | 'pan' | 'vca'
  | 'lfoRate' | 'pulseWidth' | 'fmAmount' | 'wavetablePos'

/** One mod-matrix entry: source -> destination, signed amount. */
export interface ModMatrixEntry {
  source: ModSource
  destination: ModDest
  /** signed; negative inverts the modulation */
  amount: number
}

/** LFO waveform choices. */
export type LfoWave = 'sine' | 'triangle' | 'square' | 'saw' | 'random'

/** One LFO. Up to 3 per patch (lfo1..lfo3). */
export interface LfoSpec {
  /** Hz, or a sync rate when sync is set */
  rateHz: number
  wave: LfoWave
  /** sync to transport instead of free-running */
  sync?: 'off' | '1-4' | '1-8' | '1-16'
  /** 0..1 fade-in over time (seconds) */
  fadeSec?: number
  /** optional fixed phase offset 0..1 */
  phase?: number
}

/** An extra modulation envelope (ADSR), usable as a mod source. */
export interface ModEnvelopeSpec {
  attackMs: number
  decayMs: number
  sustain: number
  releaseMs: number
  /** invert the envelope output */
  invert?: boolean
}

/** Step sequencer as a modulation source. */
export interface StepSeqSpec {
  /** values -1..1 per step */
  steps: number[]
  /** step rate relative to transport */
  rate: '1-4' | '1-8' | '1-16' | '1-32'
  /** loop or one-shot */
  loop?: boolean
}

/** Extended oscillator spec (Phase 1). Backward compatible with OscSpec. */
export interface OscSpecExt extends OscSpec {
  /** extended waveform; when set, overrides `wave` semantics */
  waveExt?: OscWaveExt
  /** FM: modulator ratio relative to carrier (e.g. 2.0) */
  fmRatio?: number
  /** FM: modulation amount 0..1 */
  fmAmount?: number
  /** wavetable: list of table names to scan between */
  wavetables?: string[]
  /** wavetable: default scan position 0..1 */
  wavetablePos?: number
}

/** Extended filter spec (Phase 1). Backward compatible with FilterSpec. */
export interface FilterSpecExt extends FilterSpec {
  typeExt?: FilterTypeExt
  /** comb: delay time in ms */
  combMs?: number
  /** comb: feedback 0..0.95 */
  combFb?: number
  /** formant: which vowel-ish formant set */
  formant?: 'a' | 'e' | 'i' | 'o' | 'u'
}

/** Extended patch (Phase 1). Backward compatible with SynthPatch. */
export interface SynthPatchExt extends SynthPatch {
  /** modulation matrix; empty/omitted = classic (no matrix) */
  modMatrix?: ModMatrixEntry[]
  /** up to 3 LFOs, addressed as lfo1..lfo3 */
  lfos?: LfoSpec[]
  /** extra mod envelopes, addressed as env2..env4 (env1 = amp) */
  modEnvelopes?: ModEnvelopeSpec[]
  /** step sequencer as a mod source */
  stepSeq?: StepSeqSpec
}
