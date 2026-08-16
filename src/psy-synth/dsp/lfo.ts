// Phase 4 (KAI) - modulation sources: LFO + step sequencer + sample-and-hold.
// These are the "sources" that feed the mod matrix (Phase 5).
// Design: pure factory functions returning AudioNodes (modulation signals).

import type { LfoSpec, LfoWave, StepSeqSpec } from '../types'

/** Map LfoWave to an OscillatorType where possible. */
function lfoOscType(wave: LfoWave): OscillatorType | 'random' {
  switch (wave) {
    case 'sine': return 'sine'
    case 'triangle': return 'triangle'
    case 'square': return 'square'
    case 'saw': return 'sawtooth'
    case 'random': return 'random'
  }
}

/** Build an LFO. Returns the output AudioNode (oscillator) whose output is the
 * modulation signal, and a setter for rate. When `sync` is set, rate is a
 * transport division (handled by caller setting rateHz appropriately). */
export function buildLfo(ctx: BaseAudioContext, spec: LfoSpec): {
  out: AudioNode
  setRate: (hz: number) => void
} {
  const wave = lfoOscType(spec.wave)
  if (wave === 'random') {
    // random LFO: sample-and-hold of noise at the LFO rate.
    // Minimal impl: use a noise buffer looped through a lowpass to smooth.
    const len = Math.floor(ctx.sampleRate * 1)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.playbackRate.value = spec.rateHz
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = spec.rateHz * 2
    src.connect(lp)
    src.start()
    return { out: lp, setRate: (hz: number) => { src.playbackRate.value = hz; lp.frequency.value = hz * 2 } }
  }
  const osc = ctx.createOscillator()
  osc.type = wave
  osc.frequency.value = spec.rateHz
  osc.start()
  return { out: osc, setRate: (hz: number) => { osc.frequency.value = hz } }
}

/** Compute a transport-synced LFO rate in Hz from a division. */
export function syncedLfoRate(bpm: number, division: '1-4'|'1-8'|'1-16'): number {
  const beatsPerSec = bpm / 60
  switch (division) {
    case '1-4': return beatsPerSec / 4
    case '1-8': return beatsPerSec / 8
    case '1-16': return beatsPerSec / 16
  }
}

/** Build a step sequencer modulation source. Uses an LFO (sample-and-hold of a
 * step buffer) to output stepped values. Returns the output AudioNode. */
export function buildStepSeq(ctx: BaseAudioContext, spec: StepSeqSpec, bpm: number): {
  out: AudioNode
} {
  // Build a buffer containing the step values, one sample per step, then play
  // it back at the step rate. The sample-and-hold effect comes from the
  // zero-order-hold of playback.
  const steps = spec.steps.length
  const samplesPerStep = Math.max(1, Math.floor(ctx.sampleRate * (60 / bpm / stepsPerBeat(spec.rate) / steps)))
  const len = steps * samplesPerStep
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let s = 0; s < steps; s++) {
    const val = Math.max(-1, Math.min(1, spec.steps[s] ?? 0))
    for (let j = 0; j < samplesPerStep; j++) {
      data[s * samplesPerStep + j] = val
    }
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = spec.loop !== false
  src.start()
  return { out: src }
}

function stepsPerBeat(rate: '1-4'|'1-8'|'1-16'|'1-32'): number {
  switch (rate) {
    case '1-4': return 4
    case '1-8': return 8
    case '1-16': return 16
    case '1-32': return 32
  }
}

/** Validate an LFO spec. */
export function validateLfoSpec(spec: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof spec !== 'object' || spec === null) return { ok: false, errors: ['LFO spec is not an object'] }
  const s = spec as Record<string, unknown>
  if (typeof s.rateHz !== 'number' || s.rateHz <= 0) errors.push('rateHz must be > 0')
  const validWaves: LfoWave[] = ['sine','triangle','square','saw','random']
  if (s.wave !== undefined && !validWaves.includes(s.wave as LfoWave)) errors.push(`invalid LFO wave: ${s.wave}`)
  if (s.sync !== undefined && !['off','1-4','1-8','1-16'].includes(s.sync as string)) errors.push(`invalid LFO sync: ${s.sync}`)
  return { ok: errors.length === 0, errors }
}

/** Validate a step-sequencer spec. */
export function validateStepSeqSpec(spec: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof spec !== 'object' || spec === null) return { ok: false, errors: ['stepSeq spec is not an object'] }
  const s = spec as Record<string, unknown>
  if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push('steps must be a non-empty array')
  else if (s.steps.some((v: unknown) => typeof v !== 'number' || (v as number) < -1 || (v as number) > 1)) errors.push('steps values must be -1..1')
  if (s.rate !== undefined && !['1-4','1-8','1-16','1-32'].includes(s.rate as string)) errors.push(`invalid stepSeq rate: ${s.rate}`)
  return { ok: errors.length === 0, errors }
}
