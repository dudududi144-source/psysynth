// Voice engine wiring: the engine-router decision must flow into SynthVoice at
// trigger time. Headless - asserts the RESOLVED ENGINE recorded on the voice.
// (Actual worklet rendering is the browser-CI half; the decision is headless.)

import { describe, expect, it } from 'bun:test'
import { SynthVoice } from '../../src/psy-synth/voice'
import type { SynthPatch } from '../../src/psy-synth/types'
import { StubAudioHost, stubDest } from '../helpers/stub-audio'

const prov = { author: 'test', license: 'original', created: '2026-08-14' }

function patch(over: Partial<SynthPatch> = {}): SynthPatch {
  return {
    id: 'p', role: 'lead', provenance: prov,
    osc: { a: { wave: 'saw', gain: 0.6 } },
    glideMs: 0,
    filter: { type: 'lp', cutoff: 2000, res: 0.4, envDepth: 0.5, envAttackMs: 1, envDecayMs: 200, velTrack: 0.1 },
    amp: { attackMs: 1, decayMs: 200, sustain: 0.7, releaseMs: 100 },
    driveDb: 2, sends: { delay: 0.3, reverb: 0.1 }, humanize: false,
    ...over,
  } as SynthPatch
}

function makeVoice(): SynthVoice {
  const host = new StubAudioHost()
  return new SynthVoice(0, host, { dry: stubDest(), delaySend: stubDest(), reverbSend: stubDest() })
}

function triggerParams(p: SynthPatch) {
  return {
    note: 57, velocity: 0.8, at: 0.1, patch: p,
    glideFromHz: null, detuneDriftCents: 0, cutoffMult: 1, cutoffBias: 1,
    resMult: 1, energyCutoffHz: 0, autoReleaseAt: 0.4,
    delaySendLevel: 0.3, reverbSendLevel: 0.1,
  }
}

describe('voice engine wiring (engine-router decision at trigger)', () => {
  it('plain static patch resolves to periodic', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch()))
    expect(v.engine).toBe('periodic')
  })

  it('hard-sync patch resolves to polyblep', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } })))
    expect(v.engine).toBe('polyblep')
  })

  it('ring-mod patch resolves to polyblep', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'sine', gain: 0.2, ringMod: 0.35 } } })))
    expect(v.engine).toBe('polyblep')
  })

  it('explicit oscEngine=periodic wins even over a sync patch', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch({ oscEngine: 'periodic', osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } })))
    expect(v.engine).toBe('periodic')
  })

  it('explicit oscEngine=polyblep wins for a plain patch', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch({ oscEngine: 'polyblep' })))
    expect(v.engine).toBe('polyblep')
  })

  it('engine decision re-evaluated on every trigger', () => {
    const v = makeVoice()
    v.trigger(triggerParams(patch()))
    expect(v.engine).toBe('periodic')
    v.trigger(triggerParams(patch({ osc: { a: { wave: 'saw', gain: 0.6 }, b: { wave: 'saw', gain: 0.5, sync: true } } })))
    expect(v.engine).toBe('polyblep')
    v.trigger(triggerParams(patch()))
    expect(v.engine).toBe('periodic')
  })
})
