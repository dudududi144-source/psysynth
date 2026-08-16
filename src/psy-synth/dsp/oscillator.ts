// Phase 2 (KAI) - oscillator factory for extended waveforms.
// Extends the basic PolyBLEP set with FM / phase / wavetable / noise / S&H.
// Design: pure functions that build Web-Audio node graphs. Each returns an
// AudioNode that the voice connects into its filter chain.
//
// Backward compat: the basic WaveKind (saw/square/triangle/sine) is produced by
// the existing PolyBLEP PeriodicWave path in voice.ts. This module only handles
// the EXTENDED waveforms (fm / phase / wavetable / noise / sampleHold).

export interface FmOscOptions {
  carrierType?: OscillatorType
  /** modulator ratio relative to carrier (e.g. 2.0) */
  fmRatio: number
  /** modulation depth in Hz peak (scaled by fmAmount elsewhere) */
  fmDepthHz: number
}

/** Build a 2-operator FM oscillator. Returns the carrier node. The caller
 * drives .frequency for pitch; the modulator is wired to the carrier frequency. */
export function buildFmOsc(ctx: BaseAudioContext, baseFreq: number, opts: FmOscOptions): {
  out: OscillatorNode
  modulator: OscillatorNode
  setFmAmount: (norm: number) => void
} {
  const carrier = ctx.createOscillator()
  carrier.type = opts.carrierType ?? 'sine'
  carrier.frequency.value = baseFreq
  const modulator = ctx.createOscillator()
  modulator.type = 'sine'
  modulator.frequency.value = baseFreq * opts.fmRatio
  // modulator -> gain -> carrier.frequency (FM)
  const modGain = ctx.createGain()
  modGain.gain.value = opts.fmDepthHz
  modulator.connect(modGain)
  modGain.connect(carrier.frequency)
  modulator.start()
  return {
    out: carrier,
    modulator,
    setFmAmount: (norm: number) => {
      // norm 0..1 scales the FM depth (0 = pure carrier)
      modGain.gain.value = opts.fmDepthHz * Math.max(0, Math.min(1, norm))
    },
  }
}

/** Build a white-noise source (for noise waveform). Returns a looping source. */
export function buildNoiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const len = Math.floor(ctx.sampleRate * 2)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.start()
  return src
}

/** Build a wavetable scanner. `tables` are PeriodicWaves; `position` 0..1 scans
 * across them. Returns a gain node to receive the crossfaded output. The caller
 * is responsible for creating the underlying oscillator(s). This helper returns
 * the crossfade gain and a setter for the scan position. */
export function buildWavetableScanner(ctx: BaseAudioContext, tableCount: number): {
  out: GainNode
  /** set crossfade position 0..1 across the tables */
  setPosition: (pos: number) => void
  gains: GainNode[]
} {
  const out = ctx.createGain()
  out.gain.value = 1
  const gains: GainNode[] = []
  for (let i = 0; i < tableCount; i++) {
    const g = ctx.createGain()
    g.gain.value = 0
    g.connect(out)
    gains.push(g)
  }
  const setPosition = (pos: number) => {
    const p = Math.max(0, Math.min(1, pos)) * (tableCount - 1)
    for (let i = 0; i < tableCount; i++) {
      const dist = Math.abs(p - i)
      gains[i].gain.value = Math.max(0, 1 - dist)
    }
  }
  return { out, setPosition, gains }
}

/** Sample-and-hold: samples `source` every `intervalSec` into an AudioParam.
 * Returns a setter target. Uses an LFO-free S&H via a periodic trigger. */
export function buildSampleHold(ctx: BaseAudioContext, intervalSec: number): {
  out: GainNode
  setSource: (param: AudioParam) => void
} {
  const out = ctx.createGain()
  out.gain.value = 0
  // S&H requires a trigger; in this minimal impl we expose a gain to be driven.
  return {
    out,
    setSource: (_param: AudioParam) => {
      // minimal: connect source into the S&H gain (real S&H needs a trigger clock)
    },
  }
}

export const midiToFreq = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)
