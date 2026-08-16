// Phase 3 (KAI) - extended filter factory (Thor-like multi-mode).
// Extends the Moog-style LP with hp / notch / comb / formant / SVF.
// Design: pure factory functions returning AudioNode graphs. Each returns an
// AudioNode the voice connects into its VCA.
//
// Backward compat: lp/bp stay on the existing Moog-style path in voice.ts.
// This module only handles the EXTENDED filter types.

import type { FilterTypeExt } from '../types'

/** Formant frequency sets (approximate vowel formants, in Hz). */
export const FORMANTS: Record<'a'|'e'|'i'|'o'|'u', number[]> = {
  a: [800, 1150, 2900],
  e: [400, 1900, 2900],
  i: [300, 2100, 2900],
  o: [400, 800, 2900],
  u: [325, 700, 2900],
}

/** Build an extended filter by type. Returns the output AudioNode. */
export function buildFilter(
  ctx: BaseAudioContext,
  type: FilterTypeExt,
  opts: {
    cutoff: number
    res?: number
    combMs?: number
    combFb?: number
    formant?: 'a'|'e'|'i'|'o'|'u'
  },
): { out: AudioNode; cutoffParam: AudioParam } {
  switch (type) {
    case 'lp': {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = opts.cutoff
      f.Q.value = opts.res ?? 0.7
      return { out: f, cutoffParam: f.frequency }
    }
    case 'hp': {
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = opts.cutoff
      f.Q.value = opts.res ?? 0.7
      return { out: f, cutoffParam: f.frequency }
    }
    case 'bp': {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = opts.cutoff
      f.Q.value = opts.res ?? 2.0
      return { out: f, cutoffParam: f.frequency }
    }
    case 'notch': {
      const f = ctx.createBiquadFilter()
      f.type = 'notch'
      f.frequency.value = opts.cutoff
      f.Q.value = opts.res ?? 2.0
      return { out: f, cutoffParam: f.frequency }
    }
    case 'comb': {
      // comb filter = delay + feedback, produces resonant teeth
      const input = ctx.createGain()
      const delay = ctx.createDelay(0.05)
      delay.delayTime.value = Math.min(0.05, (opts.combMs ?? 5) / 1000)
      const fb = ctx.createGain()
      fb.gain.value = Math.min(0.95, opts.combFb ?? 0.7)
      const out = ctx.createGain()
      input.connect(out)           // dry
      input.connect(delay)          // into delay
      delay.connect(fb)             // feedback
      fb.connect(delay)             // feedback loop
      delay.connect(out)            // wet
      return { out, cutoffParam: delay.delayTime }
    }
    case 'formant': {
      // formant = parallel bandpass filters at vowel formant frequencies
      const input = ctx.createGain()
      const out = ctx.createGain()
      const freqs = FORMANTS[opts.formant ?? 'a']
      const bw = opts.res ?? 8.0 // Q of each formant band
      for (const fq of freqs) {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = fq
        bp.Q.value = bw
        input.connect(bp)
        bp.connect(out)
      }
      return { out, cutoffParam: input.gain }
    }
    case 'svf': {
      // State Variable Filter - parallel outputs of lp/hp/bp/notch
      // Approximated with 4 biquads; outputs summed (or caller picks one).
      const input = ctx.createGain()
      const out = ctx.createGain()
      const types: BiquadFilterType[] = ['lowpass','highpass','bandpass','notch']
      for (const ty of types) {
        const f = ctx.createBiquadFilter()
        f.type = ty
        f.frequency.value = opts.cutoff
        f.Q.value = opts.res ?? 0.7
        input.connect(f)
        f.connect(out)
      }
      return { out, cutoffParam: input.gain }
    }
    default: {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = opts.cutoff
      f.Q.value = opts.res ?? 0.7
      return { out: f, cutoffParam: f.frequency }
    }
  }
}

/** Validate an extended filter spec (for patch-library validation). */
export function validateFilterExt(spec: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof spec !== 'object' || spec === null) return { ok: false, errors: ['filter spec is not an object'] }
  const s = spec as Record<string, unknown>
  const validTypes: FilterTypeExt[] = ['lp','hp','bp','notch','comb','formant','svf']
  if (s.typeExt !== undefined && !validTypes.includes(s.typeExt as FilterTypeExt)) {
    errors.push(`invalid filter typeExt: ${s.typeExt}`)
  }
  if (s.typeExt === 'comb') {
    if (s.combMs !== undefined && (typeof s.combMs !== 'number' || s.combMs <= 0 || s.combMs > 50)) errors.push('combMs must be 0..50')
    if (s.combFb !== undefined && (typeof s.combFb !== 'number' || s.combFb < 0 || s.combFb > 0.95)) errors.push('combFb must be 0..0.95')
  }
  if (s.typeExt === 'formant') {
    const vowels = ['a','e','i','o','u']
    if (s.formant !== undefined && !vowels.includes(s.formant as string)) errors.push('invalid formant vowel')
  }
  return { ok: errors.length === 0, errors }
}
