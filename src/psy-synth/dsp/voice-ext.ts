// Phase 6 (KAI) - extended voice that wires the mod matrix + extended DSP.
// This is the voice that actually PLAYS the Thor-like features (FM, wavetable,
// formant, mod-matrix). It is SEPARATE from the classic Subtractor voice
// (voice.ts) to keep the existing synth backward compatible and green.
//
// A SynthPatchExt with modMatrix/lfos/stepSeq is routed through this voice.
// A classic SynthPatch (no modMatrix) stays on voice.ts.

import type { SynthPatchExt, ModSource, ModDest } from '../types'
import { buildFmOsc, buildNoiseSource, buildWavetableScanner, midiToFreq } from './oscillator'
import { buildFilter } from './filter'
import { buildLfo, buildStepSeq, syncedLfoRate } from './lfo'
import { buildModMatrix, type DestParamMap, type BuiltModMatrix } from './mod-matrix'

export interface ExtVoiceHandle {
  /** start the voice at time `t` for the given note */
  trigger: (t: number, note: number, velocity: number) => void
  /** release the voice at time `t` */
  release: (t: number) => void
  /** fully disconnect (cleanup) */
  dispose: () => void
}

/** Build one extended voice for a SynthPatchExt. Returns a handle. The voice is
 * wired at build time; trigger/release only schedule envelopes. */
export function buildExtVoice(
  ctx: BaseAudioContext,
  patch: SynthPatchExt,
  output: AudioNode,
  opts: { bpm?: number } = {},
): ExtVoiceHandle {
  const bpm = opts.bpm ?? 145

  // --- VCA (amp envelope) ---
  const vca = ctx.createGain()
  vca.gain.value = 0
  vca.connect(output)

  // --- Filter (extended) ---
  const ftype = patch.filter.typeExt ?? 'lp'
  const filt = buildFilter(ctx, ftype, {
    cutoff: patch.filter.cutoff,
    res: patch.filter.res,
    combMs: patch.filter.combMs,
    combFb: patch.filter.combFb,
    formant: patch.filter.formant,
  })
  filt.out.connect(vca)

  // --- Oscillators (extended) ---
  const oscA = patch.osc.a
  const waveExt = oscA.waveExt ?? 'sine'
  let oscOut: AudioNode
  let fmHandle: ReturnType<typeof buildFmOsc> | null = null
  let wtHandle: ReturnType<typeof buildWavetableScanner> | null = null
  if (waveExt === 'fm') {
    fmHandle = buildFmOsc(ctx, midiToFreq(60), {
      fmRatio: oscA.fmRatio ?? 2.0,
      fmDepthHz: (oscA.fmAmount ?? 0.5) * 500,
    })
    oscOut = fmHandle.out
  } else if (waveExt === 'noise') {
    oscOut = buildNoiseSource(ctx)
  } else if (waveExt === 'wavetable') {
    const count = oscA.wavetables?.length ?? 2
    wtHandle = buildWavetableScanner(ctx, count)
    wtHandle.setPosition(oscA.wavetablePos ?? 0)
    oscOut = wtHandle.out
  } else {
    // basic waveform via a plain oscillator
    const osc = ctx.createOscillator()
    osc.type = waveExt === 'sampleHold' ? 'square' : (waveExt as OscillatorType)
    osc.frequency.value = midiToFreq(60)
    osc.start()
    oscOut = osc
  }
  oscOut.connect(filt.out === filt.out ? (filt as unknown as { out: AudioNode }).out : filt.out)

  // --- Modulation sources ---
  const sources: Partial<Record<ModSource, AudioNode>> = {}
  const lfos = patch.lfos ?? []
  const lfoNodes: AudioNode[] = []
  lfos.forEach((lfoSpec, idx) => {
    const rate = lfoSpec.sync && lfoSpec.sync !== 'off'
      ? syncedLfoRate(bpm, lfoSpec.sync)
      : lfoSpec.rateHz
    const lfo = buildLfo(ctx, { ...lfoSpec, rateHz: rate })
    const key = ('lfo' + (idx + 1)) as ModSource
    sources[key] = lfo.out
    lfoNodes.push(lfo.out)
  })
  const stepSeq = patch.stepSeq
  if (stepSeq) {
    const ss = buildStepSeq(ctx, stepSeq, bpm)
    sources['stepSeq'] = ss.out
  }

  // --- Mod matrix ---
  const dests: DestParamMap = {
    filterCutoff: filt.cutoffParam,
    vca: vca.gain,
    fmAmount: fmHandle ? (fmHandle as unknown as { setFmAmount: (n: number) => void }).out.gain : undefined,
    wavetablePos: wtHandle ? (wtHandle as unknown as { out: GainNode }).out.gain : undefined,
  }
  let builtMatrix: BuiltModMatrix | null = null
  if (patch.modMatrix && patch.modMatrix.length > 0) {
    builtMatrix = buildModMatrix(ctx, patch.modMatrix, sources, dests)
  }

  // --- Envelope scheduling ---
  const trigger = (t: number, note: number, velocity: number) => {
    const atk = Math.max(0.0005, patch.amp.attackMs / 1000)
    const dec = Math.max(0.005, patch.amp.decayMs / 1000)
    const sus = Math.max(0, Math.min(1, patch.amp.sustain))
    const peak = velocity
    vca.gain.cancelScheduledValues(t)
    vca.gain.setValueAtTime(0, t)
    vca.gain.linearRampToValueAtTime(peak, t + atk)
    vca.gain.setTargetAtTime(peak * sus, t + atk, dec / 3)
  }
  const release = (t: number) => {
    const rel = Math.max(0.005, patch.amp.releaseMs / 1000)
    vca.gain.setTargetAtTime(0, t, rel / 4)
  }
  const dispose = () => {
    if (builtMatrix) builtMatrix.disconnect()
    for (const n of lfoNodes) { try { (n as OscillatorNode).stop?.() } catch { /* not an osc */ } }
  }

  return { trigger, release, dispose }
}
