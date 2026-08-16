// Phase 5 (KAI) - Modulation Matrix. The heart of a Thor-like synth.
// Routes modulation sources (LFOs, envelopes, velocity, key, MIDI, S&H, step-seq)
// to destinations (pitch, cutoff, pan, etc.). Deterministic and testable.
//
// A ModMatrixInstance is built per voice at trigger time from a ModMatrixEntry[].
// Each entry produces an AudioParam connection scaled by `amount`.

import type { ModSource, ModDest, ModMatrixEntry } from '../types'

/** A resolved modulation source: a node (LFO/envelope/etc.) whose output is
 * scaled by `amount` and added to a destination AudioParam. */
export interface ModSourceNode {
  /** the AudioNode whose output is the modulation signal */
  node: AudioNode
  /** gain node used to scale by amount (reused per destination) */
  gain: GainNode
}

/** Map of destination -> the AudioParam it modulates. Built per voice. */
export type DestParamMap = Partial<Record<ModDest, AudioParam>>

/** A built mod matrix: for each destination, the list of source gains feeding it. */
export interface BuiltModMatrix {
  /** disconnect all modulation connections (voice release) */
  disconnect: () => void
  /** all source gain nodes (for cleanup) */
  sourceGains: GainNode[]
}

/** Build the mod matrix for one voice. `sources` provides the AudioNode for each
 * ModSource present in the entries. `dests` maps destinations to AudioParams. */
export function buildModMatrix(
  ctx: BaseAudioContext,
  entries: ModMatrixEntry[],
  sources: Partial<Record<ModSource, AudioNode>>,
  dests: DestParamMap,
): BuiltModMatrix {
  const sourceGains: GainNode[] = []
  const connections: Array<[AudioNode, AudioParam]> = []
  for (const entry of entries) {
    const src = sources[entry.source]
    const destParam = dests[entry.destination]
    if (!src || !destParam) continue // skip unresolvable entries (forward compat)
    const amt = Math.max(-1, Math.min(1, entry.amount))
    if (amt === 0) continue
    const g = ctx.createGain()
    g.gain.value = amt
    src.connect(g)
    g.connect(destParam)
    sourceGains.push(g)
    connections.push([src, destParam])
  }
  return {
    sourceGains,
    disconnect: () => {
      for (const [src, destParam] of connections) {
        try { src.disconnect() } catch { /* already disconnected */ }
      }
      for (const g of sourceGains) {
        try { g.disconnect() } catch { /* already disconnected */ }
      }
    },
  }
}

/** Validate a mod matrix entry list (for patch-library validation). */
export function validateModMatrix(entries: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(entries)) return { ok: false, errors: ['modMatrix is not an array'] }
  const validSources: ModSource[] = ['lfo1','lfo2','lfo3','env1','env2','env3','env4','velocity','key','modWheel','aftertouch','sampleHold','stepSeq','random']
  const validDests: ModDest[] = ['oscPitch','oscDetune','oscGain','filterCutoff','filterRes','pan','vca','lfoRate','pulseWidth','fmAmount','wavetablePos']
  entries.forEach((e: ModMatrixEntry, idx: number) => {
    if (!validSources.includes(e.source)) errors.push(`entry[${idx}].source invalid: ${e.source}`)
    if (!validDests.includes(e.destination)) errors.push(`entry[${idx}].destination invalid: ${e.destination}`)
    if (typeof e.amount !== 'number' || e.amount < -1 || e.amount > 1) errors.push(`entry[${idx}].amount must be -1..1`)
  })
  return { ok: errors.length === 0, errors }
}
