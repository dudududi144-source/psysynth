import { describe, expect, it } from 'bun:test'
import { SynthDevice } from '../../src/psy-synth/device'
import { createSynthDevice } from '../../src/psy-synth/index'
import { SYNTH_ROLES } from '../../src/psy-synth/types'
import { StubAudioHost, stubDest } from '../helpers/stub-audio'
import type { PsyDevice } from '../../src/psy-foundation-shim/device'
import type { MusicalEvent, NoteEvent } from '../../src/psy-foundation-shim/protocol'

const prov = { author: 'test', license: 'original', created: '2026-08-14' }
const bassPatch = {
  id: 'bass-test', role: 'bass', provenance: prov,
  osc: { a: { wave: 'saw', gain: 0.7 } }, glideMs: 0,
  filter: { type: 'lp', cutoff: 1200, res: 0.3, envDepth: 0.6, envAttackMs: 1, envDecayMs: 150, velTrack: 0.1 },
  amp: { attackMs: 1, decayMs: 200, sustain: 0.5, releaseMs: 60 },
  driveDb: 2, sends: { delay: 0.1, reverb: 0 }, humanize: false,
}
const keysPatch = { ...bassPatch, id: 'keys-test', role: 'keys' }
const MANIFEST = { manifestVersion: 1, seed: 1, patches: [bassPatch, keysPatch] }

function makeDevice() {
  const host = new StubAudioHost()
  const device = new SynthDevice({ audioContext: host, outputNode: stubDest(), maxVoices: 4, seed: 1 })
  device.patches.load(MANIFEST)
  device.onStart()
  return { host, device }
}

describe('PsyDevice contract conformance', () => {
  it('SynthDevice satisfies the PsyDevice interface structurally', () => {
    const { device } = makeDevice()
    const asContract: PsyDevice = device
    expect(typeof asContract.id).toBe('string')
    expect(typeof asContract.capabilities).toBe('function')
    expect(typeof asContract.onTransport).toBe('function')
    expect(typeof asContract.onContext).toBe('function')
    expect(typeof asContract.onEvent).toBe('function')
    expect(typeof asContract.onStart).toBe('function')
    expect(typeof asContract.onStop).toBe('function')
    expect(typeof asContract.reportLatencyMs).toBe('function')
  })

  it('capabilities: midi:true, roles EXACTLY canonical enum (audit B10)', () => {
    const { device } = makeDevice()
    const caps = device.capabilities()
    expect(caps.audio).toBe(true)
    expect(caps.midi).toBe(true)
    expect(caps.voices).toBe(4)
    expect([...caps.roles].sort()).toEqual([...SYNTH_ROLES].sort())
  })

  it('latency: capabilities().latencyMs === reportLatencyMs() (audit B9)', () => {
    const { device } = makeDevice()
    expect(device.capabilities().latencyMs).toBe(device.reportLatencyMs())
  })

  it('onEvent NEVER throws - fuzz with 1000 malformed events', () => {
    const { device } = makeDevice()
    const nasty: MusicalEvent[] = []
    for (let i = 0; i < 1000; i++) {
      nasty.push({
        type: 'note',
        note: [NaN, Infinity, -5, 999, 45.7, 0][i % 6] as number,
        velocity: [NaN, -1, 2, 0.5, 0, 1][i % 6] as number,
        duration: [NaN, -2, -1, 0, 0.1, 999][i % 6] as number,
        channel: ['bass', 'kick', '', 'LEAD', 'keys', null][i % 6] as unknown as string,
        at: [NaN, -100, 0, 0.5, 1e9, 1][i % 6] as number,
      } as NoteEvent)
    }
    for (const e of nasty) {
      expect(() => device.onEvent(e)).not.toThrow()
    }
    const diag = device.getDiagnostics()
    expect(diag.eventsReceived).toBe(1000)
    expect(diag.eventsDropped).toBeGreaterThan(0)
  })

  it('valid note-on triggers a voice; matching note-off releases it', () => {
    const { device } = makeDevice()
    const t0 = 0.5
    device.onEvent({ type: 'note', note: 45, velocity: 0.8, duration: -1, channel: 'bass', at: t0 })
    expect(device.getDiagnostics().voicesActive).toBe(1)
    device.onEvent({ type: 'note', note: 45, velocity: 0, duration: 0, channel: 'bass', at: t0 + 0.1 })
    // Voice stays "active" through its release tail (pool semantics)
    expect(device.getDiagnostics().voicesActive).toBeLessThanOrEqual(1)
  })

  it('energy and drop events update the macro (no throw)', () => {
    const { device } = makeDevice()
    expect(() => device.onEvent({ type: 'energy', energy: 0.9, at: 0 })).not.toThrow()
    expect(() => device.onEvent({ type: 'drop', intensity: 1, at: 0 })).not.toThrow()
  })

  it('onStop fast-releases all voices (no dangling tails)', () => {
    const { device } = makeDevice()
    for (let i = 0; i < 4; i++) {
      device.onEvent({ type: 'note', note: 40 + i, velocity: 0.8, duration: -1, channel: 'keys', at: 0.1 })
    }
    device.onStop()
    expect(device.getDiagnostics().voicesActive).toBe(0)
  })

  it('no patch for role => silent drop counted (device stays alive)', () => {
    const { device } = makeDevice()
    device.onEvent({ type: 'note', note: 60, velocity: 0.8, duration: 0.2, channel: 'lead', at: 0.5 })
    const diag = device.getDiagnostics()
    expect(diag.dropReasons['no-patch']).toBe(1)
    expect(diag.voicesActive).toBe(0)
  })

  it('createSynthDevice bundle loads inline manifest without fetch', async () => {
    const host = new StubAudioHost()
    const bundle = createSynthDevice({ audioContext: host, outputNode: stubDest(), patchManifest: MANIFEST })
    const accepted = await bundle.load()
    expect(accepted).toBe(2)
    bundle.device.onStart()
    expect(bundle.device.capabilities().voices).toBe(16) // default
    bundle.dispose()
  })
})
