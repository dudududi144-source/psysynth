// Pure, headless-testable PolyBLEP DSP core (the Phase-6 audio polish).
//
// Why: the v1 voice uses fixed PeriodicWaves (alias-free for STATIC tones, but
// cannot express hard-sync or PWM, which psy leads need). True PolyBLEP corrects
// discontinuities per-sample, enabling dynamic waveforms without aliasing.
//
// This module is PURE math - no AudioContext, no DOM - so it is unit-tested in
// bun headlessly (tests/psy-synth/polyblep.test.ts). The AudioWorklet processor
// (worklet/polyblep-oscillator.ts) re-uses these exact functions for real audio.

export type PolyWave = 'saw' | 'square' | 'pulse'

/** Wrap any real value into phase space [0, 1). */
export function wrapPhase(x: number): number {
  return x - Math.floor(x)
}

/**
 * PolyBLEP residual - the band-limiting correction near a discontinuity.
 * `t` is phase in [0,1); `dt` is the per-sample phase increment (freq/sampleRate).
 * Returns the correction to ADD at a rising edge, SUBTRACT at a falling edge.
 */
export function polyblep(t: number, dt: number): number {
  if (dt <= 0) return 0
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

// ── Naive references (for alias comparison in tests) ─────────────────────────

export function naiveSaw(phase: number): number {
  return 2 * wrapPhase(phase) - 1
}

export function naiveSquare(phase: number): number {
  return wrapPhase(phase) < 0.5 ? 1 : -1
}

// ── Band-limited generators (all return ~[-1, 1]) ────────────────────────────

/** Band-limited rising sawtooth. */
export function polyblepSaw(phase: number, dt: number): number {
  const t = wrapPhase(phase)
  return 2 * t - 1 - polyblep(t, dt)
}

/** Band-limited 50% square wave. */
export function polyblepSquare(phase: number, dt: number): number {
  return polyblepPulse(phase, 0.5, dt)
}

/**
 * Band-limited pulse with variable duty (PWM). Rising edge at phase 0,
 * falling edge at phase `duty`.
 */
export function polyblepPulse(phase: number, duty: number, dt: number): number {
  const t = wrapPhase(phase)
  const d = duty < 0.01 ? 0.01 : duty > 0.99 ? 0.99 : duty
  const naive = t < d ? 1 : -1
  // Correct rising edge at phase 0 (add), falling edge at phase duty (subtract).
  return naive + polyblep(t, dt) - polyblep(wrapPhase(t + (1 - d)), dt)
}

/** Stateful oscillator used by the AudioWorklet + tests. */
export interface PolyOscState {
  phase: number
}

export function createPolyOsc(initialPhase = 0): PolyOscState {
  return { phase: wrapPhase(initialPhase) }
}

/** Hard-sync reset (slave phase returns to 0). */
export function syncReset(state: PolyOscState): void {
  state.phase = 0
}

/**
 * Advance the oscillator by one sample and return the band-limited sample.
 * `freqHz` / `sampleRate` define the per-sample phase increment `dt`.
 */
export function stepOsc(
  state: PolyOscState,
  wave: PolyWave,
  freqHz: number,
  sampleRate: number,
  duty = 0.5,
): number {
  const dt = freqHz / sampleRate
  const sample =
    wave === 'saw'
      ? polyblepSaw(state.phase, dt)
      : polyblepPulse(state.phase, duty, dt)
  state.phase = wrapPhase(state.phase + dt)
  return sample
}

/** Render N samples (convenience for tests + offline worklet priming). */
export function renderOsc(
  wave: PolyWave,
  freqHz: number,
  sampleRate: number,
  n: number,
  duty = 0.5,
): Float32Array {
  const out = new Float32Array(n)
  const state = createPolyOsc()
  for (let i = 0; i < n; i++) out[i] = stepOsc(state, wave, freqHz, sampleRate, duty)
  return out
}

/** Goertzel power at normalized frequency f (cycles/sample) over samples x. */
export function goertzelPower(x: ArrayLike<number>, f: number): number {
  const n = x.length
  const omega = 2 * Math.PI * f
  const coeff = 2 * Math.cos(omega)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const s0 = (x[i] ?? 0) + coeff * s1 - s2
    s2 = s1
    s1 = s0
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2
}

/** Total energy (sum of squares). */
export function totalEnergy(x: ArrayLike<number>): number {
  let e = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0
    e += v * v
  }
  return e
}
