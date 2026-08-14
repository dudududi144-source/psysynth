// Seeded micro-variance. The ONLY place randomness may exist in the device.
// Uses the shim Rng (mulberry32, foundation lineage). Same seed => same
// decisions across runs and platforms (render-proof requirement).

import { Rng } from '../psy-foundation-shim/voice-pool'

export interface VarianceSettings {
  /** osc detune drift in cents, applied +- */
  detuneCents: number
  /** filter cutoff wobble as fraction, applied +- */
  cutoffWobble: number
  /** velocity humanize fraction, applied +- when patch.humanize */
  velocityHumanize: number
  /** arp per-step cutoff variance fraction, applied +- */
  stepCutoff: number
}

export const DEFAULT_VARIANCE: VarianceSettings = {
  detuneCents: 3,
  cutoffWobble: 0.02,
  velocityHumanize: 0.03,
  stepCutoff: 0.08,
}

export class VarianceRules {
  private rng: Rng
  private readonly settings: VarianceSettings

  constructor(seed: number, settings: VarianceSettings = DEFAULT_VARIANCE) {
    this.rng = new Rng(seed >>> 0)
    this.settings = settings
  }

  /** Reset the stream (new phrase boundary / manifest reload). */
  reseed(seed: number): void {
    this.rng = new Rng(seed >>> 0)
  }

  detuneDriftCents(): number {
    return this.rng.range(-this.settings.detuneCents, this.settings.detuneCents)
  }

  cutoffMultiplier(): number {
    return 1 + this.rng.range(-this.settings.cutoffWobble, this.settings.cutoffWobble)
  }

  humanizedVelocity(v: number, enabled: boolean): number {
    if (!enabled) return v
    const f = 1 + this.rng.range(-this.settings.velocityHumanize, this.settings.velocityHumanize)
    return clamp01(v * f)
  }

  stepCutoffMultiplier(): number {
    return 1 + this.rng.range(-this.settings.stepCutoff, this.settings.stepCutoff)
  }

  /** Ornament decision for arp (+12 on every 4th step when enabled). */
  arpOrnament(stepIndex: number, enabled: boolean): number {
    if (!enabled) return 0
    return stepIndex % 4 === 3 ? 12 : 0
  }

  /** Deterministic pick among candidates (patch ornaments, future use). */
  pickIndex(count: number): number {
    return this.rng.int(0, count - 1)
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
