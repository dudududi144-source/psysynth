import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SynthDevice } from '../../src/psy-synth/device'
import { validatePatch } from '../../src/psy-synth/patch-library'
import { SYNTH_ROLES } from '../../src/psy-synth/types'
import { StubAudioHost, stubDest } from '../helpers/stub-audio'

// Phase 6 style gate - the AUTOMATABLE subset of ARCHITECTURE-STYLE.md section 7.
// Listening-panel items (1, 2, 3, 8's subjective half) run in browser CI; the
// structural + contract items below run headless on every commit.

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/manifest.json'), 'utf8'),
)
const BANKS = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/style-banks.json'), 'utf8'),
)

function makeDevice(style: string) {
  const host = new StubAudioHost()
  const device = new SynthDevice({ audioContext: host, outputNode: stubDest(), maxVoices: 16, seed: 1 })
  device.patches.load(MANIFEST)
  for (const bank of BANKS) device.patches.registerBank(bank as never)
  device.onContext({ key: 'A minor', rootPc: 9, scale: 'naturalMinor', energy: 0.7, style, section: 'drop', beatsPerBar: 4 })
  device.onStart()
  return { host, device }
}

describe('style acceptance - manifest integrity', () => {
  it('ships >= 20 patches with provenance on every patch', () => {
    expect(MANIFEST.patches.length).toBeGreaterThanOrEqual(20)
    expect(MANIFEST.manifestVersion).toBe(1)
    for (let i = 0; i < MANIFEST.patches.length; i++) {
      const p = MANIFEST.patches[i]
      expect(validatePatch(p, i).ok).toBe(true)
      expect(p.provenance.author).toBeTruthy()
      expect(p.provenance.license).toBeTruthy()
    }
  })

  it('covers ALL 7 canonical roles (psytrance voice palette complete)', () => {
    const covered = new Set(MANIFEST.patches.map((p: { role: string }) => p.role))
    for (const role of SYNTH_ROLES) expect(covered.has(role)).toBe(true)
  })

  it('bass patches honor the sidechain contract (release <= 80ms)', () => {
    const bass = MANIFEST.patches.filter((p: { role: string }) => p.role === 'bass')
    expect(bass.length).toBeGreaterThanOrEqual(4)
    for (const b of bass) expect(b.amp.releaseMs).toBeLessThanOrEqual(80)
  })

  it('leads are delay-heavy and pads are reverb-heavy (FX convention)', () => {
    for (const p of MANIFEST.patches) {
      if (p.role === 'lead') expect(p.sends.delay).toBeGreaterThanOrEqual(0.3)
      if (p.role === 'pad') expect(p.sends.reverb).toBeGreaterThanOrEqual(0.4)
    }
  })

  it('arp patches carry the hi-tech variance flags', () => {
    const arps = MANIFEST.patches.filter((p: { role: string }) => p.role === 'arp')
    expect(arps.length).toBeGreaterThanOrEqual(2)
    expect(arps.some((p: { stepVariance?: boolean }) => p.stepVariance === true)).toBe(true)
  })
})

describe('style acceptance - subgenre banks', () => {
  it('ships all 6 subgenre banks', () => {
    const styles = new Set(BANKS.map((b: { style: string }) => b.style))
    for (const s of ['FULL-ON', 'DARK-PSY', 'PROGRESSIVE', 'GOA', 'HI-TECH', 'FOREST']) {
      expect(styles.has(s)).toBe(true)
    }
  })

  it('every bank override resolves to a real patch of the matching role', () => {
    const byId = new Map(MANIFEST.patches.map((p: { id: string; role: string }) => [p.id, p.role]))
    for (const bank of BANKS) {
      for (const [role, patchId] of Object.entries(bank.patchOverrides)) {
        const targetRole = byId.get(patchId)
        expect(targetRole).toBe(role)
      }
      // Macro sanity: cutoff bias positive, energy mapping non-negative.
      expect(bank.macro.cutoffBias).toBeGreaterThan(0)
      expect(bank.macro.energyToCutoff).toBeGreaterThanOrEqual(0)
    }
  })

  it('bank selection changes the resolved bass patch per style', () => {
    const { device } = makeDevice('FULL-ON')
    const fullonBass = device.patches.resolve('bass')?.id
    device.patches.setStyle('DARK-PSY')
    const darkBass = device.patches.resolve('bass')?.id
    expect(fullonBass).toBe('bass-acid-303')
    expect(darkBass).toBe('bass-dark-offbeat')
    expect(fullonBass).not.toBe(darkBass)
  })
})

describe('style acceptance - device behavior per role', () => {
  it('stab fans a single note into a chord (multiple voices)', () => {
    const { device } = makeDevice('GOA')
    device.onEvent({ type: 'note', note: 60, velocity: 0.8, duration: 0.3, channel: 'stab', at: 0.5 })
    const active = device.getDiagnostics().voicesActive
    expect(active).toBeGreaterThanOrEqual(2) // chord intervals => > 1 voice
    expect(active).toBeLessThanOrEqual(4)
  })

  it('hold-mode pad sustains until note-off (break contract)', () => {
    const { device, host } = makeDevice('FULL-ON')
    device.onEvent({ type: 'note', note: 50, velocity: 0.6, duration: -1, channel: 'pad', at: 0.2 })
    host.currentTime = 3.0
    // Still sounding long after a normal gate would have ended.
    expect(device.getDiagnostics().voicesActive).toBe(1)
    device.onEvent({ type: 'note', note: 50, velocity: 0, duration: 0, channel: 'pad', at: 3.0 })
    // Released into its long tail; pool still tracks it through release.
    expect(device.getDiagnostics().voicesActive).toBeLessThanOrEqual(1)
  })

  it('unknown style falls back to defaults without dropping notes', () => {
    const { device } = makeDevice('NOT-A-REAL-STYLE')
    device.onEvent({ type: 'note', note: 45, velocity: 0.8, duration: 0.2, channel: 'bass', at: 0.3 })
    const d = device.getDiagnostics()
    expect(d.voicesActive).toBe(1)
    expect(d.eventsDropped).toBe(0)
  })
})
