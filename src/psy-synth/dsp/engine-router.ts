// Engine router - the pure decision layer for the PolyBLEP opt-in (Phase 7).
//
// The v1 voice renders with fixed PeriodicWaves: alias-free for STATIC tones,
// zero-cost, and what all existing tests verify. PolyBLEP (per-sample) is only
// NEEDED when a patch requires dynamic waveform behavior PeriodicWave cannot
// express: hard sync, ring-mod, or PWM. This router makes that decision pure,
// headless, and testable - a voice integration consults it at trigger time.
//
// Default stays 'periodic' -> the audio hot path and every existing test are
// UNTOUCHED until a host explicitly routes a voice through the worklet.

import type { OscEngine, SynthPatch } from '../types'

/**
 * True when the patch needs per-sample dynamic waveforms (cannot be rendered
 * correctly by a static PeriodicWave).
 */
export function patchNeedsPolyBlep(patch: SynthPatch): boolean {
  const b = patch.osc.b
  if (b?.sync === true) return true            // hard sync = dynamic phase reset
  if (typeof b?.ringMod === 'number' && b.ringMod > 0) return true // AM/ring = dynamic
  // Future: per-step PWM duty modulation would also require polyblep.
  return false
}

/**
 * Resolve the oscillator engine for a patch.
 * - Explicit 'periodic'/'polyblep' on the patch is authoritative.
 * - Omitted => auto: polyblep only when the patch actually needs it.
 */
export function selectOscEngine(patch: SynthPatch): OscEngine {
  const requested = patch.oscEngine
  if (requested === 'periodic') return 'periodic'
  if (requested === 'polyblep') return 'polyblep'
  return patchNeedsPolyBlep(patch) ? 'polyblep' : 'periodic'
}

/** Aggregate diagnostics across a patch bank (which patches need polyblep). */
export function engineCensus(patches: ReadonlyArray<SynthPatch>): {
  total: number
  periodic: number
  polyblep: number
  polyblepIds: string[]
} {
  let periodic = 0
  let polyblep = 0
  const polyblepIds: string[] = []
  for (const p of patches) {
    if (selectOscEngine(p) === 'polyblep') {
      polyblep += 1
      polyblepIds.push(p.id)
    } else {
      periodic += 1
    }
  }
  return { total: patches.length, periodic, polyblep, polyblepIds }
}
