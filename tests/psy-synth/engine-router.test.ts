import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { patchNeedsPolyBlep, selectOscEngine, engineCensus } from '../../src/psy-synth/dsp/engine-router'
import { validatePatch } from '../../src/psy-synth/patch-library'
import type { SynthPatch } from '../../src/psy-synth/types'

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/manifest.json'), 'utf8'),
)

const prov = { author: 'test', license: 'original', created: '2026-08-14' }
function basePatch(over: Partial<SynthPatch> = {}): SynthPatch {
  return {
    id: 'p', role: 'lead', provenance: prov,
    osc: { a: { wave: 'saw', gain: 0.6 } },
    glideMs: 0,
    filter: { type: 'lp', cutoff: 2000, res: 0.4, envDepth: 0.5, envAttackMs: 1, envDecayMs: 200, velTrack: 0.1 },
    amp: { attackMs: 1, decayMs: 200, sustain: 0.7, releaseMs: 100 },
    driveDb: 2, sends: { delay: 0.3, reverb: 0.1 }, humanize: false,
    ...over,
  } as SynthPatch
}

describe('patchNeedsPolyBlep', () => {
  it('plain static patch does NOT need polyblep', () => {
    expect(patchNeedsPolyBlep(basePatch())).toBe(false)
  })
  it('hard-sync on osc B needs polyblep', () => {
    expect(patchNeedsPolyBlep(basePatch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } }))).toBe(true)
  })
  it('ring-mod on osc B needs polyblep', () => {
    expect(patchNeedsPolyBlep(basePatch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'sine', gain: 0.2, ringMod: 0.35 } } }))).toBe(true)
  })
  it('ringMod of 0 does NOT need polyblep', () => {
    expect(patchNeedsPolyBlep(basePatch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'sine', gain: 0.2, ringMod: 0 } } }))).toBe(false)
  })
})

describe('selectOscEngine', () => {
  it('defaults to periodic for static patches (hot path unchanged)', () => {
    expect(selectOscEngine(basePatch())).toBe('periodic')
  })
  it('auto-selects polyblep when the patch needs it', () => {
    expect(selectOscEngine(basePatch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } }))).toBe('polyblep')
  })
  it('explicit periodic wins even over a sync patch (authoritative opt-down)', () => {
    expect(selectOscEngine(basePatch({ oscEngine: 'periodic', osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } }))).toBe('periodic')
  })
  it('explicit polyblep wins for a static patch (authoritative opt-in)', () => {
    expect(selectOscEngine(basePatch({ oscEngine: 'polyblep' }))).toBe('polyblep')
  })
})

describe('engineCensus over the shipped psytrance bank', () => {
  it('flags exactly the sync/ring-mod patches as polyblep', () => {
    const census = engineCensus(MANIFEST.patches as SynthPatch[])
    expect(census.total).toBe(20)
    expect(census.polyblep).toBe(2)
    expect(census.periodic).toBe(18)
    expect([...census.polyblepIds].sort()).toEqual(['lead-hitech-sync', 'pluck-forest'])
  })
})

describe('oscEngine schema validation', () => {
  it('accepts a valid oscEngine value', () => {
    expect(validatePatch({ ...basePatch(), oscEngine: 'polyblep' }, 0).ok).toBe(true)
    expect(validatePatch({ ...basePatch(), oscEngine: 'periodic' }, 0).ok).toBe(true)
  })
  it('accepts an omitted oscEngine (auto)', () => {
    expect(validatePatch(basePatch(), 0).ok).toBe(true)
  })
  it('rejects an invalid oscEngine value', () => {
    const bad = { ...basePatch(), oscEngine: 'wavetable' }
    const v = validatePatch(bad, 0)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toContain('.oscEngine')
  })
})
