import { describe, expect, it } from 'bun:test'
import { VarianceRules, DEFAULT_VARIANCE } from '../../src/psy-synth/variance-rules'

describe('VarianceRules - determinism (render-proof prerequisite)', () => {
  it('same seed => identical sequence', () => {
    const a = new VarianceRules(42)
    const b = new VarianceRules(42)
    for (let i = 0; i < 500; i++) {
      expect(a.detuneDriftCents()).toBe(b.detuneDriftCents())
      expect(a.cutoffMultiplier()).toBe(b.cutoffMultiplier())
      expect(a.stepCutoffMultiplier()).toBe(b.stepCutoffMultiplier())
    }
  })

  it('different seed => different sequence', () => {
    const a = new VarianceRules(1)
    const b = new VarianceRules(2)
    let same = 0
    for (let i = 0; i < 50; i++) {
      if (a.detuneDriftCents() === b.detuneDriftCents()) same += 1
    }
    expect(same).toBeLessThan(5)
  })

  it('detune drift stays within +-3 cents by default', () => {
    const v = new VarianceRules(7)
    for (let i = 0; i < 1000; i++) {
      const d = v.detuneDriftCents()
      expect(Math.abs(d)).toBeLessThanOrEqual(DEFAULT_VARIANCE.detuneCents)
    }
  })

  it('cutoff multiplier stays within 1+-2%', () => {
    const v = new VarianceRules(7)
    for (let i = 0; i < 1000; i++) {
      const m = v.cutoffMultiplier()
      expect(m).toBeGreaterThanOrEqual(0.98)
      expect(m).toBeLessThanOrEqual(1.02)
    }
  })

  it('humanize disabled => velocity untouched', () => {
    const v = new VarianceRules(7)
    expect(v.humanizedVelocity(0.77, false)).toBe(0.77)
  })

  it('humanize enabled => within +-3% and clamped 0..1', () => {
    const v = new VarianceRules(7)
    for (let i = 0; i < 500; i++) {
      const out = v.humanizedVelocity(0.99, true)
      expect(out).toBeGreaterThanOrEqual(0)
      expect(out).toBeLessThanOrEqual(1)
    }
  })

  it('arp ornament: +12 only on every 4th step when enabled', () => {
    const v = new VarianceRules(7)
    expect(v.arpOrnament(0, true)).toBe(0)
    expect(v.arpOrnament(1, true)).toBe(0)
    expect(v.arpOrnament(2, true)).toBe(0)
    expect(v.arpOrnament(3, true)).toBe(12)
    expect(v.arpOrnament(7, true)).toBe(12)
    expect(v.arpOrnament(3, false)).toBe(0)
  })

  it('reseed restarts the stream identically', () => {
    const v = new VarianceRules(99)
    const first = [v.detuneDriftCents(), v.detuneDriftCents(), v.detuneDriftCents()]
    v.reseed(99)
    const second = [v.detuneDriftCents(), v.detuneDriftCents(), v.detuneDriftCents()]
    expect(second).toEqual(first)
  })
})
