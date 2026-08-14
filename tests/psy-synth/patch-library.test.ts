import { describe, expect, it } from 'bun:test'
import { PatchLibrary, validatePatch } from '../../src/psy-synth/patch-library'
import { Counters } from '../../src/psy-synth/counters'

const prov = { author: 'test', license: 'original', created: '2026-08-14' }

function bassPatch(id = 'bass-test') {
  return {
    id,
    role: 'bass',
    provenance: prov,
    osc: { a: { wave: 'saw', gain: 0.7 }, sub: { semitones: -12, gain: 0.5 } },
    glideMs: 40,
    filter: { type: 'lp', cutoff: 1400, res: 0.35, envDepth: 0.7, envAttackMs: 1, envDecayMs: 180, velTrack: 0.15 },
    amp: { attackMs: 1, decayMs: 220, sustain: 0.55, releaseMs: 60 },
    driveDb: 3,
    sends: { delay: 0.1, reverb: 0.0 },
    humanize: false,
  }
}

describe('validatePatch - schema gates', () => {
  it('accepts a canonical bass patch', () => {
    expect(validatePatch(bassPatch(), 0).ok).toBe(true)
  })
  it('rejects missing provenance (unified asset provenance rule)', () => {
    const p = { ...bassPatch() } as Record<string, unknown>
    delete p.provenance
    expect(validatePatch(p, 0).ok).toBe(false)
  })
  it('rejects cutoff outside 40..18000', () => {
    const p = bassPatch()
    p.filter = { ...p.filter, cutoff: 20 }
    expect(validatePatch(p, 0).ok).toBe(false)
    p.filter = { ...p.filter, cutoff: 20000 }
    expect(validatePatch(p, 0).ok).toBe(false)
  })
  it('rejects res above 0.95 (self-osc guard at schema level)', () => {
    const p = bassPatch()
    p.filter = { ...p.filter, res: 0.99 }
    expect(validatePatch(p, 0).ok).toBe(false)
  })
  it('rejects envelopes below 0.5ms', () => {
    const p = bassPatch()
    p.amp = { ...p.amp, attackMs: 0.1 }
    expect(validatePatch(p, 0).ok).toBe(false)
  })
  it('rejects sends outside 0..1 and driveDb above 12', () => {
    const p = bassPatch()
    p.sends = { delay: 1.5, reverb: 0 }
    expect(validatePatch(p, 0).ok).toBe(false)
    const q = bassPatch()
    q.driveDb = 13
    expect(validatePatch(q, 0).ok).toBe(false)
  })
  it('rejects unknown role (canonical enum only)', () => {
    const p = { ...bassPatch(), role: 'kick' }
    expect(validatePatch(p, 0).ok).toBe(false)
  })
})

describe('PatchLibrary - load/resolve/banks', () => {
  it('loads valid manifest and counts accepted patches', () => {
    const lib = new PatchLibrary(new Counters())
    const accepted = lib.load({ manifestVersion: 1, seed: 3, patches: [bassPatch(), { ...bassPatch(), id: 'bass-2' }] })
    expect(accepted).toBe(2)
    expect(lib.count()).toBe(2)
    expect(lib.manifestSeed).toBe(3)
  })
  it('rejects duplicate ids (counted, not thrown)', () => {
    const counters = new Counters()
    const lib = new PatchLibrary(counters)
    const accepted = lib.load({ manifestVersion: 1, seed: 1, patches: [bassPatch(), bassPatch()] })
    expect(accepted).toBe(1)
    expect(counters.patchLoadErrors).toBe(1)
  })
  it('invalid patches rejected at load, never reaching resolve', () => {
    const counters = new Counters()
    const lib = new PatchLibrary(counters)
    const bad = { ...bassPatch() } as Record<string, unknown>
    bad.filter = { type: 'lp', cutoff: 5, res: 2, envDepth: 0, envAttackMs: 0, envDecayMs: 0, velTrack: 0 }
    const accepted = lib.load({ manifestVersion: 1, seed: 1, patches: [bad] })
    expect(accepted).toBe(0)
    expect(counters.patchLoadErrors).toBeGreaterThan(0)
    expect(lib.resolve('bass')).toBeNull()
  })
  it('resolve: first patch of role by default', () => {
    const lib = new PatchLibrary(new Counters())
    lib.load({ manifestVersion: 1, seed: 1, patches: [bassPatch('b1'), { ...bassPatch(), id: 'b2' }] })
    expect(lib.resolve('bass')?.id).toBe('b1')
    expect(lib.resolve('lead')).toBeNull()
  })
  it('style bank override wins when patch+role match', () => {
    const lib = new PatchLibrary(new Counters())
    lib.load({ manifestVersion: 1, seed: 1, patches: [bassPatch('b1'), { ...bassPatch(), id: 'b2' }] })
    lib.registerBank({ style: 'DARK-PSY', patchOverrides: { bass: 'b2' }, macro: { cutoffBias: 0.9, resBias: 1, glideBias: 1, energyToCutoff: 0 } })
    lib.setStyle('dark-psy') // case-insensitive
    expect(lib.resolve('bass')?.id).toBe('b2')
    lib.setStyle('FULL-ON')
    expect(lib.resolve('bass')?.id).toBe('b1')
  })
  it('macro defaults when no bank', () => {
    const lib = new PatchLibrary(new Counters())
    const m = lib.macro()
    expect(m.cutoffBias).toBe(1)
    expect(m.resBias).toBe(1)
    expect(m.glideBias).toBe(1)
    expect(m.energyToCutoff).toBe(0)
  })
  it('rolesCovered reports only populated roles', () => {
    const lib = new PatchLibrary(new Counters())
    lib.load({ manifestVersion: 1, seed: 1, patches: [bassPatch()] })
    expect(lib.rolesCovered()).toEqual(['bass'])
  })
  it('malformed manifest bodies counted, not thrown', () => {
    const counters = new Counters()
    const lib = new PatchLibrary(counters)
    expect(lib.load(null)).toBe(0)
    expect(lib.load({ patches: 'nope' })).toBe(0)
    expect(counters.patchLoadErrors).toBe(2)
  })
})
