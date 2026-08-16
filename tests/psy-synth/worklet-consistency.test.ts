// Worklet<->core consistency guard. The PolyBLEP AudioWorklet inlines the
// polyblep math (worklet scope cannot import modules). This test extracts that
// inlined function from the worklet source and asserts it is NUMERICALLY
// IDENTICAL to the tested core (src/psy-synth/dsp/polyblep.ts), so the two
// implementations can never silently drift.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { polyblep } from '../../src/psy-synth/dsp/polyblep'

const WORKLET_SRC = readFileSync(
  join(import.meta.dir, '../../src/psy-synth/worklet/polyblep-worklet.ts'),
  'utf8',
)

// Extract the inlined `function polyblep(...) {...}` via brace matching.
function extractPolyblep(src: string): string {
  const start = src.indexOf('function polyblep')
  expect(start, 'worklet must inline function polyblep').toBeGreaterThanOrEqual(0)
  const open = src.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(start, i + 1)
}

// Build a callable from the extracted source.
// eslint-disable-next-line no-new-func
const factory = new Function(extractPolyblep(WORKLET_SRC) + '; return polyblep;')
const workletPolyblep = factory() as (t: number, dt: number) => number

describe('worklet polyblep == core polyblep (drift guard)', () => {
  it('extracted worklet function is callable', () => {
    expect(typeof workletPolyblep).toBe('function')
  })

  it('is numerically identical to the core across a dense grid', () => {
    const dts = [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.33, 0.49]
    let checked = 0
    for (const dt of dts) {
      for (let i = 0; i <= 400; i++) {
        const t = i / 400
        const a = polyblep(t, dt)
        const b = workletPolyblep(t, dt)
        expect(b, `mismatch at t=${t} dt=${dt}`).toBe(a)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(3000)
  })

  it('handles dt<=0 and mid-band identically', () => {
    expect(workletPolyblep(0.5, 0)).toBe(polyblep(0.5, 0))
    expect(workletPolyblep(0.5, 0.01)).toBe(polyblep(0.5, 0.01)) // mid-band -> 0
  })
})
