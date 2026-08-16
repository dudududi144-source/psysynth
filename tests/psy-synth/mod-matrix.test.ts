// Tests for the mod matrix (Phase 5).
// Verifies matrix construction, validation, and determinism.
import { describe, expect, it } from 'bun:test'
import { buildModMatrix, validateModMatrix } from '../../src/psy-synth/dsp/mod-matrix'
import { StubAudioHost } from '../helpers/stub-audio'

describe('mod matrix validation', () => {
  it('accepts a valid entry', () => {
    const r = validateModMatrix([{ source: 'lfo1', destination: 'filterCutoff', amount: 0.6 }])
    expect(r.ok).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
  it('rejects invalid source', () => {
    const r = validateModMatrix([{ source: 'bogus', destination: 'filterCutoff', amount: 0.5 }])
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
  })
  it('rejects invalid destination', () => {
    const r = validateModMatrix([{ source: 'lfo1', destination: 'bogus', amount: 0.5 }])
    expect(r.ok).toBe(false)
  })
  it('rejects out-of-range amount', () => {
    const r = validateModMatrix([{ source: 'lfo1', destination: 'filterCutoff', amount: 1.5 }])
    expect(r.ok).toBe(false)
  })
  it('accepts negative amount (invert)', () => {
    const r = validateModMatrix([{ source: 'velocity', destination: 'filterCutoff', amount: -0.5 }])
    expect(r.ok).toBe(true)
  })
  it('rejects non-array', () => {
    const r = validateModMatrix({} as unknown)
    expect(r.ok).toBe(false)
  })
})

describe('mod matrix construction', () => {
  it('builds a matrix from resolvable entries', () => {
    const host = new StubAudioHost()
    const srcNode = host.createGain()
    const destParam = host.createGain().gain
    const built = buildModMatrix(host as unknown as BaseAudioContext,
      [{ source: 'lfo1', destination: 'filterCutoff', amount: 0.6 }],
      { lfo1: srcNode as unknown as AudioNode },
      { filterCutoff: destParam as unknown as AudioParam })
    expect(built.sourceGains).toHaveLength(1)
    built.disconnect()
  })
  it('skips unresolvable entries gracefully', () => {
    const host = new StubAudioHost()
    const destParam = host.createGain().gain
    const built = buildModMatrix(host as unknown as BaseAudioContext,
      [{ source: 'lfo1', destination: 'filterCutoff', amount: 0.6 }],
      {}, // no sources provided
      { filterCutoff: destParam as unknown as AudioParam })
    expect(built.sourceGains).toHaveLength(0)
  })
  it('skips zero-amount entries', () => {
    const host = new StubAudioHost()
    const srcNode = host.createGain()
    const destParam = host.createGain().gain
    const built = buildModMatrix(host as unknown as BaseAudioContext,
      [{ source: 'lfo1', destination: 'filterCutoff', amount: 0 }],
      { lfo1: srcNode as unknown as AudioNode },
      { filterCutoff: destParam as unknown as AudioParam })
    expect(built.sourceGains).toHaveLength(0)
  })
})
