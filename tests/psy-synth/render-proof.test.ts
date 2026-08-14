import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SynthDevice } from '../../src/psy-synth/device'
import { StubAudioHost } from '../helpers/stub-audio'
import type { SynthRole } from '../../src/psy-synth/types'

// Headless render-proof: two runs with the SAME (seed, manifest, event stream)
// must produce a BIT-IDENTICAL AudioParam scheduling fingerprint. This proves
// the HOW layer is reproducible; the browser-CI counterpart (src/psy-synth/
// render.ts) asserts the same property on real samples.

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/manifest.json'), 'utf8'),
)
const BANKS = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/style-banks.json'), 'utf8'),
)

interface Ev {
  note: number
  velocity: number
  duration: number
  channel: SynthRole
  at: number
}

/** Deterministic phrase: 2 bars of rolling bass + arp + lead + a pad. */
function buildPhrase(): Ev[] {
  const events: Ev[] = []
  const sixteenth = 60 / 145 / 4
  let t = 0.1
  // Pad at the start (long, held).
  events.push({ note: 45, velocity: 0.6, duration: 3.0, channel: 'pad', at: t })
  // 32 sixteenth bass notes (2 bars) + arp + occasional lead.
  for (let i = 0; i < 32; i++) {
    const at = t + i * sixteenth
    events.push({ note: 45 + (i % 4), velocity: 0.8, duration: sixteenth * 0.9, channel: 'bass', at })
    if (i % 2 === 0) {
      events.push({ note: 69 + ((i * 3) % 12), velocity: 0.6, duration: sixteenth * 0.5, channel: 'arp', at: at + sixteenth * 0.5 })
    }
    if (i % 8 === 0) {
      events.push({ note: 57 + ((i * 5) % 12), velocity: 0.7, duration: sixteenth * 3, channel: 'lead', at })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

function run(seed: number): string {
  const host = new StubAudioHost()
  const device = new SynthDevice({
    deviceId: 'render-proof',
    audioContext: host,
    outputNode: host.createGain(),
    maxVoices: 16,
    seed,
  })
  device.patches.load(MANIFEST)
  for (const bank of BANKS) device.patches.registerBank(bank as never)
  device.onContext({
    key: 'A minor', rootPc: 9, scale: 'naturalMinor',
    energy: 0.7, style: 'FULL-ON', section: 'drop', beatsPerBar: 4,
  })
  device.onStart()
  const nodesAfterStart = host.createdNodes

  const events = buildPhrase()
  for (const e of events) {
    host.currentTime = e.at // deterministic clock progression
    device.onEvent({ type: 'note', note: e.note, velocity: e.velocity, duration: e.duration, channel: e.channel, at: e.at })
  }
  // Voice construction must not add nodes beyond the pre-allocated pool.
  expect(host.createdNodes).toBe(nodesAfterStart)
  return host.renderFingerprint()
}

describe('render-proof (headless scheduling determinism)', () => {
  it('same seed + phrase => bit-identical scheduling fingerprint', () => {
    const a = run(1)
    const b = run(1)
    const c = run(1)
    expect(a.length).toBeGreaterThan(0)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('different seed => different fingerprint (variance is live, not dead)', () => {
    const a = run(1)
    const b = run(2)
    expect(a).not.toBe(b)
  })

  it('fingerprint is stable across repeated runs (no hidden state)', () => {
    const results = new Set<string>()
    for (let i = 0; i < 4; i++) results.add(run(7))
    expect(results.size).toBe(1)
  })
})
