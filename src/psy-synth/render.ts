// Offline renderer for browser CI (Phase 6 render-proof). Bun tests never call
// renderOffline (no OfflineAudioContext headless); they prove the same property
// via the stub's renderFingerprint(). This module is the REAL-audio counterpart:
// render the exact same device + event stream to an AudioBuffer, then assert
// peak/RMS and bit-identity across seeds in CI.

import { SynthDevice } from './device'
import type { SynthRole } from './types'

export interface RenderNoteEvent {
  note: number
  velocity: number
  duration: number
  channel: SynthRole
  at: number
}

export interface RenderContextEvent {
  style?: string
  energy?: number
}

export interface RenderOptions {
  lengthSec: number
  sampleRate?: number
  seed?: number
  maxVoices?: number
  patchManifest: unknown
  styleBanks?: unknown
  events: RenderNoteEvent[]
  context?: RenderContextEvent
}

export interface RenderMetrics {
  peak: number
  rms: number
  samples: number
  channels: number
}

/** True when a real OfflineAudioContext is available (browser / browser CI). */
export function hasOfflineAudio(): boolean {
  return typeof (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext !== 'undefined'
}

/**
 * Render the device offline and return the buffer. Browser CI only.
 * Deterministic for a fixed (seed, patchManifest, events) triple.
 */
export async function renderOffline(opts: RenderOptions): Promise<AudioBuffer> {
  if (!hasOfflineAudio()) {
    throw new Error('renderOffline requires OfflineAudioContext (browser CI only)')
  }
  const sampleRate = opts.sampleRate ?? 44100
  const length = Math.ceil(opts.lengthSec * sampleRate)
  const Ctor = (globalThis as { OfflineAudioContext: new (c: number, l: number, r: number) => OfflineAudioContext }).OfflineAudioContext
  const ctx = new Ctor(2, length, sampleRate)
  const master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(ctx.destination)

  const device = new SynthDevice({
    deviceId: 'psysynth-render',
    audioContext: ctx,
    outputNode: master,
    maxVoices: opts.maxVoices ?? 16,
    seed: opts.seed ?? 1,
  })
  device.patches.load(opts.patchManifest)
  if (Array.isArray(opts.styleBanks)) {
    for (const bank of opts.styleBanks as Array<Record<string, unknown>>) {
      device.patches.registerBank(bank as never)
    }
  }
  if (opts.context) {
    device.onContext({
      key: 'A minor', rootPc: 9, scale: 'naturalMinor',
      energy: opts.context.energy ?? 0.5,
      style: opts.context.style ?? 'FULL-ON',
      section: 'drop', beatsPerBar: 4,
    })
  }
  device.onStart()
  for (const e of opts.events) {
    device.onEvent({
      type: 'note', note: e.note, velocity: e.velocity, duration: e.duration,
      channel: e.channel, at: e.at,
    })
  }
  return ctx.startRendering()
}

/** Peak + RMS over all channels. */
export function computeMetrics(buffer: AudioBuffer): RenderMetrics {
  let peak = 0
  let sumSq = 0
  let samples = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? 0
      const av = Math.abs(v)
      if (av > peak) peak = av
      sumSq += v * v
      samples += 1
    }
  }
  return {
    peak,
    rms: samples > 0 ? Math.sqrt(sumSq / samples) : 0,
    samples,
    channels: buffer.numberOfChannels,
  }
}
