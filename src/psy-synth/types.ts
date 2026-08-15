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
