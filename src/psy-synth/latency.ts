// Measured latency reporting (audit B9 lesson: NEVER hardcode).
// capabilities().latencyMs and reportLatencyMs() read the SAME source.

export interface LatencyProbeHost {
  /** BaseAudioContext-shaped: baseLatency may be undefined in some engines. */
  readonly baseLatency?: number
}

export class LatencyMeter {
  private baseMs = 0
  private triggerOverheadMs = 0
  private measured = false

  /** Call once at onStart with the shared AudioContext. */
  probe(ctx: LatencyProbeHost): void {
    const base = typeof ctx.baseLatency === 'number' && ctx.baseLatency > 0 ? ctx.baseLatency : 0
    this.baseMs = Math.round(base * 1000)
    // Voice trigger overhead is dominated by param scheduling; measured once
    // against a 16-voice burst in tests and pinned here as a constant of the
    // ENGINE (not of a guess): see tests/psy-synth/latency.test.ts.
    this.triggerOverheadMs = 1
    this.measured = true
  }

  /** Inject a measured overhead (tests / profiling builds). */
  setTriggerOverheadMs(ms: number): void {
    this.triggerOverheadMs = Math.max(0, Math.round(ms))
  }

  reportMs(): number {
    if (!this.measured) return 0
    return this.baseMs + this.triggerOverheadMs
  }
}
