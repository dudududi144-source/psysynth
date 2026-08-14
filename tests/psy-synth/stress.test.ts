import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SynthDevice } from '../../src/psy-synth/device'
import { StubAudioHost } from '../helpers/stub-audio'

// Phase 6 stress gate (ARCHITECTURE.md section 8):
//   - Heap allocations in onEvent path: 0
//   - GC dropouts during 5-min 16th-bass loop: 0  (proxy: no node churn)
//   - zero steals on a sufficient bass budget
//
// We cannot measure real GC headless, so the family proxy is used: the pooled
// design creates ALL nodes at onStart. If the hot path allocated nodes,
// host.createdNodes would grow. Constant createdNodes == no node churn == no
// GC-induced dropouts (the psy5 property this device inherits).

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/manifest.json'), 'utf8'),
)

describe('stress - 5-minute rolling bass at 145 BPM', () => {
  it('zero node churn, zero bass steals, zero drops', () => {
    const host = new StubAudioHost()
    const device = new SynthDevice({
      deviceId: 'stress',
      audioContext: host,
      outputNode: host.createGain(),
      maxVoices: 16,
      seed: 1,
      roleBudgets: { bass: 8 },
    })
    device.patches.load(MANIFEST)
    device.onContext({
      key: 'A minor', rootPc: 9, scale: 'naturalMinor',
      energy: 0.8, style: 'FULL-ON', section: 'drop', beatsPerBar: 4,
    })
    device.onStart()

    const nodesAfterStart = host.createdNodes
    expect(nodesAfterStart).toBeGreaterThan(0)

    const bpm = 145
    const sixteenth = 60 / bpm / 4
    const durationSec = 300 // 5 minutes
    const count = Math.floor(durationSec / sixteenth)
    expect(count).toBeGreaterThan(2800)

    let maxActive = 0
    for (let i = 0; i < count; i++) {
      const at = 0.1 + i * sixteenth
      host.currentTime = at
      device.onEvent({
        type: 'note', note: 45 + (i % 2 === 0 ? 0 : 12), velocity: 0.8,
        duration: sixteenth * 0.9, channel: 'bass', at,
      })
      const active = device.getDiagnostics().voicesActive
      if (active > maxActive) maxActive = active
      expect(active).toBeLessThanOrEqual(16)
    }

    const diag = device.getDiagnostics()
    // No nodes created in the hot path (zero GC-dropout proxy).
    expect(host.createdNodes).toBe(nodesAfterStart)
    // Every event routed; none stale (we advanced the clock), none dropped.
    expect(diag.eventsReceived).toBe(count)
    expect(diag.eventsDropped).toBe(0)
    // Sufficient bass budget => no steals.
    expect(diag.voicesStolen).toBe(0)
    // Concurrency stayed bounded well under the pool.
    expect(maxActive).toBeLessThanOrEqual(8)
    expect(maxActive).toBeGreaterThan(0)
  })
})

describe('stress - hi-tech arp at 175 BPM under budget pressure', () => {
  it('steals stay deterministic and counted; active never exceeds pool', () => {
    const host = new StubAudioHost()
    const device = new SynthDevice({
      deviceId: 'stress-arp',
      audioContext: host,
      outputNode: host.createGain(),
      maxVoices: 4, // deliberately tight
      seed: 2,
      roleBudgets: { arp: 2 },
    })
    device.patches.load(MANIFEST)
    device.onContext({
      key: 'A minor', rootPc: 9, scale: 'phrygianDominant',
      energy: 0.9, style: 'HI-TECH', section: 'drop', beatsPerBar: 4,
    })
    device.onStart()
    const nodesAfterStart = host.createdNodes

    const sixteenth = 60 / 175 / 4
    for (let i = 0; i < 128; i++) {
      const at = 0.05 + i * sixteenth
      host.currentTime = at
      device.onEvent({
        type: 'note', note: 69 + ((i * 3) % 16), velocity: 0.7,
        duration: -1, channel: 'arp', at, // HELD notes force pool pressure
      })
      expect(device.getDiagnostics().voicesActive).toBeLessThanOrEqual(4)
    }
    const diag = device.getDiagnostics()
    expect(host.createdNodes).toBe(nodesAfterStart)
    expect(diag.eventsReceived).toBe(128)
    // Held notes on a tight budget must steal deterministically, not drop.
    expect(diag.voicesStolen).toBeGreaterThan(0)
    expect(diag.eventsDropped).toBe(0)
  })
})
