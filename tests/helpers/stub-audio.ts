// Headless audio stub for logic tests. NO real AudioContext here; render-proof
// tests (browser CI) cover actual audio. This stub records parameter scheduling
// so tests can assert on it without sound hardware.

import type { VoiceAudioHost } from '../../src/psy-synth/voice'

export interface ScheduledCall {
  method: string
  args: number[]
}

export class StubParam {
  value = 0
  readonly calls: ScheduledCall[] = []
  setValueAtTime(v: number, t: number): void {
    this.value = v
    this.calls.push({ method: 'setValueAtTime', args: [v, t] })
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'linearRampToValueAtTime', args: [v, t] })
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    this.calls.push({ method: 'exponentialRampToValueAtTime', args: [v, t] })
  }
  setTargetAtTime(v: number, t: number, tc: number): void {
    this.calls.push({ method: 'setTargetAtTime', args: [v, t, tc] })
  }
  cancelScheduledValues(t: number): void {
    this.calls.push({ method: 'cancelScheduledValues', args: [t] })
  }
}

class StubNodeBase {
  readonly gain = new StubParam()
  readonly frequency = new StubParam()
  readonly Q = new StubParam()
  readonly detune = new StubParam()
  type = 'lowpass'
  curve: Float32Array | null = null
  value = 0
  connections: unknown[] = []
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

export class StubAudioHost implements VoiceAudioHost {
  currentTime = 0
  readonly sampleRate = 44100
  createdNodes = 0
  createGain(): GainNode {
    this.createdNodes += 1
    return new StubNodeBase() as unknown as GainNode
  }
  createOscillator(): OscillatorNode {
    this.createdNodes += 1
    return new StubNodeBase() as unknown as OscillatorNode
  }
  createBiquadFilter(): BiquadFilterNode {
    this.createdNodes += 1
    return new StubNodeBase() as unknown as BiquadFilterNode
  }
  createWaveShaper(): WaveShaperNode {
    this.createdNodes += 1
    return new StubNodeBase() as unknown as WaveShaperNode
  }
  createPeriodicWave(_real: Float32Array | number[], _imag: Float32Array | number[]): PeriodicWave {
    return {} as PeriodicWave
  }
  advance(sec: number): void {
    this.currentTime += sec
  }
}

export function stubDest(): AudioNode {
  return new StubNodeBase() as unknown as AudioNode
}
