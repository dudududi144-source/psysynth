import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderOffline, computeMetrics, hasOfflineAudio } from '../../src/psy-synth/render'
import type { RenderNoteEvent } from '../../src/psy-synth/render'

// Browser-CI real-sample render proof (Phase 6). These tests self-skip when
// OfflineAudioContext is unavailable (headless bun), and run in a browser CI
// environment where real samples can be rendered and asserted.

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/manifest.json'), 'utf8'),
)
const BANKS = JSON.parse(
  readFileSync(join(import.meta.dir, '../../public/patches/style-banks.json'), 'utf8'),
)

function phrase(): RenderNoteEvent[] {
  const events: RenderNoteEvent[] = []
  const sixteenth = 60 / 145 / 4
  const t0 = 0.05
  events.push({ note: 45, velocity: 0.6, duration: 1.6, channel: 'pad', at: t0 })
  for (let i = 0; i < 32; i++) {
    const at = t0 + i * sixteenth
    events.push({ note: 45 + (i % 4), velocity: 0.8, duration: sixteenth * 0.9, channel: 'bass', at })
    if (i % 2 === 0) {
      events.push({ note: 69 + ((i * 3) % 12), velocity: 0.55, duration: sixteenth * 0.5, channel: 'arp', at: at + sixteenth * 0.5 })
    }
    if (i % 8 === 0) {
      events.push({ note: 57 + ((i * 5) % 12), velocity: 0.7, duration: sixteenth * 3, channel: 'lead', at })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

function baseOpts() {
  return {
    lengthSec: 2.0,
    sampleRate: 44100,
    seed: 1,
    patchManifest: MANIFEST,
    styleBanks: BANKS,
    events: phrase(),
    context: { style: 'FULL-ON', energy: 0.8 },
  }
}

describe.skipIf(!hasOfflineAudio())('render-offline (browser CI, real samples)', () => {
  it('renders the style suite to real samples with sane peak/RMS', async () => {
    const buffer = await renderOffline(baseOpts())
    const m = computeMetrics(buffer)
    expect(m.samples).toBeGreaterThan(0)
    expect(m.channels).toBe(2)
    // Audible but not clipping (device headroom + 0.8 master).
    expect(m.peak).toBeGreaterThan(0.001)
    expect(m.peak).toBeLessThanOrEqual(1.0)
    expect(m.rms).toBeGreaterThan(0.0001)
    expect(m.rms).toBeLessThan(m.peak)
  })

  it('is bit-identical across two renders with the same seed', async () => {
    const a = await renderOffline(baseOpts())
    const b = await renderOffline(baseOpts())
    expect(a.length).toBe(b.length)
    expect(a.numberOfChannels).toBe(b.numberOfChannels)
    for (let c = 0; c < a.numberOfChannels; c++) {
      const da = a.getChannelData(c)
      const db = b.getChannelData(c)
      expect(da.length).toBe(db.length)
      for (let i = 0; i < da.length; i++) {
        expect(da[i]).toBe(db[i])
      }
    }
  })

  it('different seed changes the rendered audio (variance is live)', async () => {
    const a = await renderOffline(baseOpts())
    const b = await renderOffline({ ...baseOpts(), seed: 2 })
    const da = a.getChannelData(0)
    const db = b.getChannelData(0)
    let diff = 0
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) diff += 1
    }
    expect(diff).toBeGreaterThan(0)
  })
})
