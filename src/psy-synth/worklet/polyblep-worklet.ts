// AudioWorklet processor source for true PolyBLEP oscillators with hard sync
// and PWM. This is the REAL-AUDIO integration of src/psy-synth/dsp/polyblep.ts.
//
// The worklet runs in AudioWorkletGlobalScope (no module imports), so the
// PolyBLEP math is INLINED below and kept byte-for-byte consistent with the pure
// core (tests/psy-synth/polyblep.test.ts guards the math; browser CI guards
// this processor end-to-end).
//
// The DEFAULT voice path stays on PeriodicWave (green tests unchanged). A host
// opts in via registerPolyBlep() and routes a voice through the worklet node.

export const POLYBLEP_WORKLET_NAME = 'polyblep-oscillator'

/** Self-contained processor source (no imports - valid in worklet scope). */
export const POLYBLEP_WORKLET_SOURCE = `
function polyblep(t, dt) {
  if (dt <= 0) return 0
  if (t < dt) { var x = t / dt; return x + x - x * x - 1 }
  if (t > 1 - dt) { var y = (t - 1) / dt; return y * y + y + y + 1 }
  return 0
}

class PolyBlepOscillatorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440, minValue: 20, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'duty',      defaultValue: 0.5, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'wave',      defaultValue: 0,   minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sync',      defaultValue: 0,   minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }
  constructor() {
    super()
    this.phase = 0
    this.lastSync = false
  }
  process(inputs, outputs, params) {
    const out = outputs[0]
    const ch = out[0]
    if (!ch) return true
    const freq = params.frequency
    const duty = params.duty[0]
    const wave = params.wave[0] >= 0.5 ? 1 : 0
    const syncNow = params.sync[0] >= 0.5
    // Hard sync on rising edge (once per block; sync is k-rate).
    if (syncNow && !this.lastSync) this.phase = 0
    this.lastSync = syncNow
    for (let i = 0; i < ch.length; i++) {
      const f = freq.length > 1 ? freq[i] : freq[0]
      const dt = f / sampleRate
      const t = this.phase
      let s
      if (wave === 0) {
        s = 2 * t - 1 - polyblep(t, dt)
      } else {
        const naive = t < duty ? 1 : -1
        s = naive + polyblep(t, dt) - polyblep((t + (1 - duty)) % 1, dt)
      }
      ch[i] = s
      this.phase = (this.phase + dt) % 1
      if (this.phase < 0) this.phase += 1
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch)
    return true
  }
}
registerProcessor('${POLYBLEP_WORKLET_NAME}', PolyBlepOscillatorProcessor)
`

export interface PolyBlepHandle {
  url: string
  node: AudioWorkletNode
  params: {
    frequency: AudioParam
    duty: AudioParam
    wave: AudioParam
    sync: AudioParam
  }
}

/** True when AudioWorklet is available (browser; not headless bun). */
export function hasAudioWorklet(ctx: BaseAudioContext): boolean {
  return typeof ctx.audioWorklet !== 'undefined'
}

/**
 * Register the processor and create a node. Browser-only.
 * `wave`: 0 = saw, 1 = pulse/PWM. `sync`: drive high to hard-sync the phase.
 */
export async function createPolyBlepNode(
  ctx: BaseAudioContext,
  opts: { frequency?: number; duty?: number; wave?: number } = {},
): Promise<PolyBlepHandle> {
  if (!hasAudioWorklet(ctx)) {
    throw new Error('createPolyBlepNode requires AudioWorklet (browser only)')
  }
  const blob = new Blob([POLYBLEP_WORKLET_SOURCE], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await ctx.audioWorklet.addModule(url)
  const node = new AudioWorkletNode(ctx, POLYBLEP_WORKLET_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  const frequency = node.parameters.get('frequency')
  const duty = node.parameters.get('duty')
  const wave = node.parameters.get('wave')
  const sync = node.parameters.get('sync')
  if (!frequency || !duty || !wave || !sync) {
    throw new Error('polyblep worklet parameters missing')
  }
  frequency.value = opts.frequency ?? 440
  duty.value = opts.duty ?? 0.5
  wave.value = opts.wave ?? 0
  return { url, node, params: { frequency, duty, wave, sync } }
}
