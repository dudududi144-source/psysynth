// Headless audio stub for logic + proof tests. NO real AudioContext here; the
// browser-CI render-proof (src/psy-synth/render.ts) covers actual samples.
//
// This stub records EVERY AudioParam scheduling call into a host-level log,
// tagged by deterministic node-creation index. Because node creation order is
// identical across runs for identical construction, two runs with the same
// seed + event stream produce BIT-IDENTICAL logs -> headless render-proof.

import type { VoiceAudioHost } from '../../src/psy-synth/voice'

export interface ScheduledCall {
  method: string
  args: number[]
}

/** One entry in the host-level render log: [nodeIndex, paramKind, method, args]. */
export type LogEntry = [number, string, string, number[]]

export class StubParam {
  value = 0
  readonly calls: ScheduledCall[] = []
  private readonly log?: LogEntry[]
  private readonly nodeIndex: number
  private readonly kind: string
  constructor(log: LogEntry[] | undefined, nodeIndex: number, kind: string) {
    this.log = log
    this.nodeIndex = nodeIndex
    this.kind = kind
  }
  private rec(method: string, args: number[]): void {
    this.calls.push({ method, args })
    this.log?.push([this.nodeIndex, this.kind, method, args])
  }
  setValueAtTime(v: number, t: number): void {
    this.value = v
    this.rec('setValueAtTime', [v, t])
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.rec('linearRampToValueAtTime', [v, t])
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.rec('exponentialRampToValueAtTime', [v, t])
  }
  setTargetAtTime(v: number, t: number, tc: number): void {
    this.rec('setTargetAtTime', [v, t, tc])
  }
  cancelScheduledValues(t: number): void {
    this.rec('cancelScheduledValues', [t])
  }
}

export class StubAudioHost implements VoiceAudioHost {
  currentTime = 0
  readonly sampleRate = 44100
  createdNodes = 0
  /** Full, ordered render log for bit-comparison across runs. */
  readonly scheduleLog: LogEntry[] = []

  private makeNode(): StubNode {
    this.createdNodes += 1
    return new StubNode(this.scheduleLog, this.createdNodes)
  }
  createGain(): GainNode {
    return this.makeNode() as unknown as GainNode
  }
  createOscillator(): OscillatorNode {
    return this.makeNode() as unknown as OscillatorNode
  }
  createBiquadFilter(): BiquadFilterNode {
    return this.makeNode() as unknown as BiquadFilterNode
  }
  createWaveShaper(): WaveShaperNode {
    return this.makeNode() as unknown as WaveShaperNode
  }
  createPeriodicWave(_real: Float32Array | number[], _imag: Float32Array | number[]): PeriodicWave {
    // Deterministic token; not logged (no AudioParam scheduling involved).
    return {} as PeriodicWave
  }
  advance(sec: number): void {
    this.currentTime += sec
  }
  /** Serialize the render log for bit-comparison. */
  renderFingerprint(): string {
    return this.scheduleLog
      .map((e) => e[0] + '|' + e[1] + '|' + e[2] + '|' + e[3].map((n) => round6(n)).join(','))
      .join(';')
  }
}

class StubNode {
  readonly gain: StubParam
  readonly frequency: StubParam
  readonly Q: StubParam
  readonly detune: StubParam
  type = 'lowpass'
  curve: Float32Array | null = null
  value = 0
  connections: unknown[] = []
  private readonly log: LogEntry[]
  private readonly idx: number
  constructor(log: LogEntry[], idx: number) {
    this.log = log
    this.idx = idx
    this.gain = new StubParam(log, idx, 'gain')
    this.frequency = new StubParam(log, idx, 'frequency')
    this.Q = new StubParam(log, idx, 'Q')
    this.detune = new StubParam(log, idx, 'detune')
  }
  connect(target: unknown): void {
    this.connections.push(target)
  }
  disconnect(): void {
    this.connections.length = 0
  }
  start(): void {}
  stop(): void {}
  setPeriodicWave(_wave: unknown): void {}
}

export function stubDest(): AudioNode {
  // Destination stub is not part of a host log (device output target).
  return new StubNode(undefined as unknown as LogEntry[], -1) as unknown as AudioNode
}

function round6(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}
