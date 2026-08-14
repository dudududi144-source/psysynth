// SynthVoice - the DSP chain of one pooled voice.
//
// Chain: oscA + oscB + sub -> preDrive(shaper) -> filter(2x biquad + saturation)
//          -> vca(ADSR) -> role bus (injected)
//
// Design notes:
// - Oscillators use bandlimited PeriodicWaves (harmonic truncation), so static
//   waveforms are alias-free by construction. Full PolyBLEP/sync via AudioWorklet
//   is a later polish phase; ring-mod is approximated as AM (documented).
// - "Moog ladder" character is approximated with two cascaded biquads plus soft
//   saturation. Self-oscillation is guarded (res capped at 0.95).
// - All trigger work is AudioParam scheduling only: ZERO node creation and ZERO
//   heap allocation in the hot path (voices are pre-created and reused).

import type { SynthPatch, WaveKind } from './types'

export interface VoiceAudioHost {
  readonly currentTime: number
  readonly sampleRate: number
  createGain(): GainNode
  createOscillator(): OscillatorNode
  createBiquadFilter(): BiquadFilterNode
  createWaveShaper(): WaveShaperNode
  createPeriodicWave(real: Float32Array | number[], imag: Float32Array | number[]): PeriodicWave
}

export interface VoiceTriggerParams {
  note: number
  velocity: number
  at: number
  patch: SynthPatch
  /** glide source frequency (Hz) when portamento applies; null otherwise */
  glideFromHz: number | null
  /** seeded detune drift in cents for this trigger */
  detuneDriftCents: number
  /** seeded cutoff multiplier for this trigger */
  cutoffMult: number
  /** when set, auto-release scheduled at this time */
  autoReleaseAt: number | null
}

export const midiToFreq = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)

const MIN_CUTOFF = 40
const MAX_CUTOFF = 18000
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/** Bandlimited periodic wave cache per WaveKind (harmonic truncation). */
const waveCache = new WeakMap<VoiceAudioHost, Map<WaveKind, PeriodicWave>>()

export function waveFor(host: VoiceAudioHost, kind: WaveKind): PeriodicWave {
  let cache = waveCache.get(host)
  if (!cache) {
    cache = new Map<WaveKind, PeriodicWave>()
    waveCache.set(host, cache)
  }
  const hit = cache.get(kind)
  if (hit) return hit
  const N = 64
  const real = new Float32Array(N)
  const imag = new Float32Array(N)
  for (let n = 1; n < N; n++) {
    switch (kind) {
      case 'sine':
        imag[n] = n === 1 ? 1 : 0
        break
      case 'triangle':
        // odd harmonics, 1/n^2, alternating sign
        imag[n] = n % 2 === 1 ? ((n % 4 === 1 ? 1 : -1) * 1) / (n * n) : 0
        break
      case 'square':
        // odd harmonics, 1/n
        imag[n] = n % 2 === 1 ? 1 / n : 0
        break
      case 'saw':
        // all harmonics, 1/n
        imag[n] = 1 / n
        break
    }
  }
  const wave = host.createPeriodicWave(real, imag)
  cache.set(kind, wave)
  return wave
}

function makeSaturationCurve(): Float32Array {
  const n = 512
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(1.8 * x)
  }
  return curve
}

export class SynthVoice {
  readonly index: number
  private readonly host: VoiceAudioHost
  private readonly out: GainNode
  private readonly oscA: OscillatorNode
  private readonly oscB: OscillatorNode
  private readonly sub: OscillatorNode
  private readonly gainA: GainNode
  private readonly gainB: GainNode
  private readonly gainSub: GainNode
  private readonly ring: GainNode
  private readonly preDrive: WaveShaperNode
  private readonly preDriveGain: GainNode
  private readonly f1: BiquadFilterNode
  private readonly f2: BiquadFilterNode
  private const fSat: WaveShaperNode
  private readonly vca: GainNode

  active = false
  channel = ''
  note = -1
  private lastFreqHz = 0
  private startedAt = 0
  private releaseScheduledAt: number | null = null

  constructor(index: number, host: VoiceAudioHost, destination: AudioNode) {
    this.index = index
    this.host = host
    this.out = host.createGain()
    this.out.gain.value = 1
    this.out.connect(destination)

    this.oscA = host.createOscillator()
    this.oscB = host.createOscillator()
    this.sub = host.createOscillator()
    this.gainA = host.createGain()
    this.gainB = host.createGain()
    this.gainSub = host.createGain()
    this.ring = host.createGain()

    this.preDriveGain = host.createGain()
    this.preDrive = host.createWaveShaper()
    this.preDrive.curve = makeSaturationCurve()

    this.f1 = host.createBiquadFilter()
    this.f1.type = 'lowpass'
    this.f2 = host.createBiquadFilter()
    this.f2.type = 'lowpass'
    this.fSat = host.createWaveShaper()
    this.fSat.curve = makeSaturationCurve()

    this.vca = host.createGain()
    this.vca.gain.value = 0

    // Static wiring (never touched in the hot path):
    this.oscA.connect(this.gainA)
    this.oscB.connect(this.gainB)
    this.oscB.connect(this.ring.gain)      // AM approximation of ring-mod
    this.ring.connect(this.gainA.gain)
    this.sub.connect(this.gainSub)
    this.gainA.connect(this.preDriveGain)
    this.gainB.connect(this.preDriveGain)
    this.gainSub.connect(this.preDriveGain)
    this.preDriveGain.connect(this.preDrive)
    this.preDrive.connect(this.f1)
    this.f1.connect(this.f2)
    this.f2.connect(this.fSat)
    this.fSat.connect(this.vca)
    this.vca.connect(this.out)

    this.oscA.start(0)
    this.oscB.start(0)
    this.sub.start(0)
  }

  trigger(p: VoiceTriggerParams): void {
    const t = p.at
    const patch = p.patch
    const freq = midiToFreq(p.note)
    const vel = clamp(p.velocity, 0, 1)

    // Osc tuning
    const a = patch.osc.a
    const b = patch.osc.b
    const sub = patch.osc.sub
    this.oscA.setPeriodicWave(waveFor(this.host, a.wave))
    this.oscB.setPeriodicWave(waveFor(this.host, b?.wave ?? a.wave))
    this.sub.setPeriodicWave(waveFor(this.host, 'sine'))

    const detuneA = (a.detuneCents ?? 0) + p.detuneDriftCents
    const detuneB = (b?.detuneCents ?? 0) - p.detuneDriftCents
    this.oscA.detune.setValueAtTime(detuneA, t)
    this.oscB.detune.setValueAtTime(detuneB, t)
    this.gainA.gain.setValueAtTime(a.gain, t)
    this.gainB.gain.setValueAtTime(b?.gain ?? 0, t)
    this.gainSub.gain.setValueAtTime(sub?.gain ?? 0, t)
    this.ring.gain.value = b?.ringMod ?? 0

    const freqA = freq * Math.pow(2, (a.semitones ?? 0) / 12)
    const freqB = freq * Math.pow(2, (b?.semitones ?? 0) / 12)
    const freqS = freq * Math.pow(2, ((sub?.semitones ?? -12)) / 12)
    this.applyFreqWithGlide(this.oscA, freqA, p.glideFromHz, patch.glideMs, t)
    this.applyFreqWithGlide(this.oscB, freqB, p.glideFromHz !== null ? p.glideFromHz * Math.pow(2, (b?.semitones ?? 0) / 12) / Math.pow(2, (a.semitones ?? 0) / 12) : null, patch.glideMs, t)
    this.sub.frequency.setValueAtTime(freqS, t)

    // Pre-drive
    this.preDriveGain.gain.setValueAtTime(Math.pow(10, patch.driveDb / 20), t)

    // Filter + filter envelope
    const f = patch.filter
    this.f1.type = f.type === 'bp' ? 'bandpass' : 'lowpass'
    this.f2.type = this.f1.type
    const res = clamp(f.res, 0, 0.95) * 20 // biquad Q mapping (guarded)
    this.f1.Q.setValueAtTime(res, t)
    this.f2.Q.setValueAtTime(Math.max(0.5, res * 0.5), t)

    const base = clamp(f.cutoff * p.cutoffMult + f.velTrack * vel * f.cutoff, MIN_CUTOFF, MAX_CUTOFF)
    const peak = clamp(base + f.envDepth * (MAX_CUTOFF - base), MIN_CUTOFF, MAX_CUTOFF)
    const atk = Math.max(0.001, f.envAttackMs / 1000)
    const dec = Math.max(0.005, f.envDecayMs / 1000)
    this.f1.frequency.cancelScheduledValues(t)
    this.f2.frequency.cancelScheduledValues(t)
    this.f1.frequency.setValueAtTime(base, t)
    this.f2.frequency.setValueAtTime(base, t)
    this.f1.frequency.linearRampToValueAtTime(peak, t + atk)
    this.f2.frequency.linearRampToValueAtTime(Math.sqrt(base * peak), t + atk)
    this.f1.frequency.setTargetAtTime(base, t + atk, dec / 3)
    this.f2.frequency.setTargetAtTime(base, t + atk, dec / 3)
    if (f.lfoHz && f.lfoHz > 0 && f.lfoDepth && f.lfoDepth > 0) {
      // LFO via oscillator is node creation - forbidden in hot path.
      // v1 expresses slow movement with a second setTarget sweep (deterministic).
      const depthHz = clamp(f.lfoDepth * base, 1, MAX_CUTOFF - base)
      const period = 1 / f.lfoHz
      this.f1.frequency.setTargetAtTime(base + depthHz, t + atk + dec, period / 4)
    }

    // Amp envelope
    const amp = patch.amp
    const atkA = Math.max(0.0005, amp.attackMs / 1000)
    const decA = Math.max(0.005, amp.decayMs / 1000)
    const peakV = clamp(0.15 + 0.55 * vel, 0, 0.8) // headroom against bus mastering
    this.vca.gain.cancelScheduledValues(t)
    this.vca.gain.setValueAtTime(0, t)
    this.vca.gain.linearRampToValueAtTime(peakV, t + atkA)
    this.vca.gain.setTargetAtTime(peakV * clamp(amp.sustain, 0, 1), t + atkA, decA / 3)

    // Auto-release for fixed-duration notes (duration respected - audit B2).
    this.releaseScheduledAt = null
    if (p.autoReleaseAt !== null && p.autoReleaseAt > t) {
      this.scheduleRelease(p.autoReleaseAt, patch.amp.releaseMs)
    }

    this.active = true
    this.channel = ''
    this.note = p.note
    this.lastFreqHz = freq
    this.startedAt = t
  }

  /** Note-off (or auto-release) with release envelope. */
  release(at: number, releaseMs: number): void {
    if (!this.active) return
    if (this.releaseScheduledAt !== null && this.releaseScheduledAt <= at) return
    this.scheduleRelease(at, releaseMs)
  }

  private scheduleRelease(at: number, releaseMs: number): void {
    const rel = Math.max(0.005, releaseMs / 1000)
    this.vca.gain.setTargetAtTime(0, at, rel / 4)
    this.releaseScheduledAt = at
    // Voice becomes free a little after the tail; pool checks activeUntil.
  }

  /** Immediate stop (steal / panic). 10ms fast-release avoids clicks. */
  panic(): void {
    const t = this.host.currentTime
    this.vca.gain.cancelScheduledValues(t)
    this.vca.gain.setTargetAtTime(0, t, 0.0025)
    this.active = false
    this.releaseScheduledAt = null
  }

  /** Pool bookkeeping: mark voice free after full release tail. */
  markInactiveIfDone(now: number): void {
    if (!this.active) return
    if (this.releaseScheduledAt !== null && now > this.releaseScheduledAt + 0.35) {
      this.active = false
    }
  }

  get ageSec(): number {
    return this.host.currentTime - this.startedAt
  }

  get freqHz(): number {
    return this.lastFreqHz
  }

  private applyFreqWithGlide(
    osc: OscillatorNode,
    targetHz: number,
    fromHz: number | null,
    glideMs: number,
    at: number,
  ): void {
    if (fromHz !== null && glideMs > 0) {
      osc.frequency.cancelScheduledValues(at)
      osc.frequency.setValueAtTime(Math.max(20, fromHz), at)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, targetHz), at + glideMs / 1000)
    } else {
      osc.frequency.cancelScheduledValues(at)
      osc.frequency.setValueAtTime(Math.max(20, targetHz), at)
    }
  }
}
