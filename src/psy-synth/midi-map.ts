// MIDI CC <-> parameter mapping + MIDI-learn state machine.
// Device holds the table only; storage is host-owned (no I/O in device).

export type SynthParameterId =
  | 'cutoff'
  | 'resonance'
  | 'glide'
  | 'energyMacro'
  | 'delaySend'
  | 'reverbSend'

export const DEFAULT_CC_MAP: Readonly<Record<number, SynthParameterId>> = Object.freeze({
  74: 'cutoff',       // filter cutoff (standard)
  71: 'resonance',    // filter resonance (standard)
  5: 'glide',         // portamento time
  12: 'energyMacro',  // device macro
  14: 'delaySend',
  15: 'reverbSend',
})

export interface MidiLearnState {
  learning: boolean
  target: SynthParameterId | null
}

export class MidiMap {
  private ccToParam: Map<number, SynthParameterId>
  private readonly state: MidiLearnState = { learning: false, target: null }
  private changeListeners = new Set<(map: ReadonlyMap<number, SynthParameterId>) => void>()

  constructor(initial: Readonly<Record<number, SynthParameterId>> = DEFAULT_CC_MAP) {
    this.ccToParam = new Map(Object.entries(initial).map(([cc, p]) => [Number(cc), p]))
  }

  /** Resolve a CC to a parameter; undefined when unmapped. */
  parameterFor(cc: number): SynthParameterId | undefined {
    if (this.state.learning && this.state.target !== null) {
      // Learn consumes the next CC regardless of existing mapping.
      const target = this.state.target
      this.ccToParam.set(cc, target)
      this.state.learning = false
      this.state.target = null
      this.emit()
      return target
    }
    return this.ccToParam.get(cc)
  }

  /** Begin learn: next incoming CC claims `target`. */
  startLearn(target: SynthParameterId): void {
    this.state.learning = true
    this.state.target = target
  }

  cancelLearn(): void {
    this.state.learning = false
    this.state.target = null
  }

  isLearning(): boolean {
    return this.state.learning
  }

  /** Serialize for host-side persistence (host owns storage). */
  toJSON(): Record<string, SynthParameterId> {
    const out: Record<string, SynthParameterId> = {}
    for (const [cc, p] of this.ccToParam.entries()) out[String(cc)] = p
    return out
  }

  /** Restore from host storage. Unknown parameter ids are rejected. */
  fromJSON(data: Record<string, unknown>): number {
    const valid = new Set<SynthParameterId>([
      'cutoff', 'resonance', 'glide', 'energyMacro', 'delaySend', 'reverbSend',
    ])
    let accepted = 0
    for (const [cc, p] of Object.entries(data)) {
      const ccNum = Number(cc)
      if (!Number.isInteger(ccNum) || ccNum < 0 || ccNum > 127) continue
      if (typeof p !== 'string' || !valid.has(p as SynthParameterId)) continue
      this.ccToParam.set(ccNum, p as SynthParameterId)
      accepted += 1
    }
    if (accepted > 0) this.emit()
    return accepted
  }

  onChange(listener: (map: ReadonlyMap<number, SynthParameterId>) => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  get mapping(): ReadonlyMap<number, SynthParameterId> {
    return this.ccToParam
  }

  private emit(): void {
    for (const l of Array.from(this.changeListeners)) l(this.ccToParam)
  }
}
