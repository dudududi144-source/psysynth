import { describe, expect, it } from 'bun:test'
import {
  wrapPhase,
  polyblep,
  polyblepSaw,
  polyblepSquare,
  polyblepPulse,
  naiveSaw,
  naiveSquare,
  createPolyOsc,
  syncReset,
  stepOsc,
  renderOsc,
  goertzelPower,
  totalEnergy,
} from '../../src/psy-synth/dsp/polyblep'

describe('wrapPhase', () => {
  it('wraps into [0,1)', () => {
    expect(wrapPhase(1.3)).toBeCloseTo(0.3, 10)
    expect(wrapPhase(-0.2)).toBeCloseTo(0.8, 10)
    expect(wrapPhase(0)).toBe(0)
    expect(wrapPhase(2.0)).toBeCloseTo(0, 10)
  })
})

describe('polyblep residual', () => {
  it('is zero away from discontinuities', () => {
    expect(polyblep(0.5, 0.01)).toBe(0)
    expect(polyblep(0.25, 0.005)).toBe(0)
  })
  it('is non-zero near the wrap edges', () => {
    expect(polyblep(0.002, 0.01)).not.toBe(0)
    expect(polyblep(0.998, 0.01)).not.toBe(0)
  })
})

describe('band-limited range', () => {
  it('saw stays bounded (small PolyBLEP overshoot)', () => {
    const sr = 1000
    const freq = 380 // near Nyquist
    const x = renderOsc('saw', freq, sr, 2000)
    let peak = 0
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i] ?? 0))
    expect(peak).toBeLessThan(1.2)
  })
  it('square stays bounded', () => {
    const x = renderOsc('square', 390, 1000, 2000)
    let peak = 0
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i] ?? 0))
    expect(peak).toBeLessThan(1.2)
  })
})

describe('aliasing reduction (Goertzel at the folded frequency)', () => {
  // Fundamental at 0.4 (near Nyquist 0.5). The naive waveform aliases its 2nd
  // harmonic (0.8) back to 0.2. PolyBLEP suppresses that spurious component.
  const sr = 1000
  const f = 400 // 0.4 normalized
  const spurious = 200 // 0.2 normalized (folded 2nd harmonic)
  const n = 500 // 0.4*500=200, 0.2*500=100 -> exact bins, no leakage

  it('polyblep saw has far less spurious power at the folded freq than naive', () => {
    const poly = renderOsc('saw', f, sr, n)
    const naive = new Float32Array(n)
    for (let i = 0; i < n; i++) naive[i] = naiveSaw((f / sr) * i)
    const polySpur = goertzelPower(poly, spurious / sr)
    const naiveSpur = goertzelPower(naive, spurious / sr)
    expect(naiveSpur).toBeGreaterThan(0)
    expect(polySpur).toBeLessThan(naiveSpur * 0.5)
  })

  it('polyblep saw concentrates energy at the fundamental near Nyquist', () => {
    // A band-limited saw at 0.4 has ONLY the fundamental below Nyquist, so
    // nearly all of its energy must sit at the fundamental bin. Comparing to
    // the naive fundamental is misleading near Nyquist (naive is inflated by
    // aliasing); concentration is the correct, sign-error-catching invariant.
    const poly = renderOsc('saw', f, sr, n)
    const total = totalEnergy(poly)
    const fund = goertzelPower(poly, f / sr)
    expect(total).toBeGreaterThan(0)
    expect(fund / ((n / 2) * total)).toBeGreaterThan(0.9)
  })

  it('polyblep square reduces aliasing vs naive square', () => {
    const poly = renderOsc('square', f, sr, n)
    const naive = new Float32Array(n)
    for (let i = 0; i < n; i++) naive[i] = naiveSquare((f / sr) * i)
    const polySpur = goertzelPower(poly, spurious / sr)
    const naiveSpur = goertzelPower(naive, spurious / sr)
    expect(naiveSpur).toBeGreaterThan(0)
    expect(polySpur).toBeLessThan(naiveSpur)
  })
})

describe('PWM duty', () => {
  it('pulse mean follows 2*duty - 1 over whole periods', () => {
    const sr = 10000
    const freq = 100 // 0.01 normalized, many samples per period
    const periods = 10
    const n = Math.round((sr / freq) * periods)
    for (const duty of [0.25, 0.5, 0.75]) {
      const x = renderOsc('pulse', freq, sr, n, duty)
      let sum = 0
      for (let i = 0; i < n; i++) sum += x[i] ?? 0
      const mean = sum / n
      expect(Math.abs(mean - (2 * duty - 1))).toBeLessThan(0.05)
    }
  })
})

describe('stateful oscillator + hard sync', () => {
  it('advances phase by dt per sample', () => {
    const sr = 1000
    const state = createPolyOsc()
    const freq = 100 // dt = 0.1
    for (let i = 0; i < 5; i++) stepOsc(state, 'saw', freq, sr)
    expect(state.phase).toBeCloseTo(0.5, 6)
  })
  it('hard sync resets phase to 0', () => {
    const state = createPolyOsc(0.7)
    expect(state.phase).toBeCloseTo(0.7, 10)
    syncReset(state)
    expect(state.phase).toBe(0)
  })
  it('renderOsc length is exact', () => {
    const x = renderOsc('saw', 440, 44100, 128)
    expect(x.length).toBe(128)
  })
})

describe('energy helpers', () => {
  it('totalEnergy sums squares', () => {
    expect(totalEnergy([1, 2, 3])).toBe(14)
  })
  it('goertzelPower is positive for a tone at its own frequency', () => {
    const sr = 1000
    const n = 200
    const f = 100 // 0.1 normalized, 0.1*200=20 exact bin
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * (f / sr) * i)
    expect(goertzelPower(x, f / sr)).toBeGreaterThan(0)
  })
})
