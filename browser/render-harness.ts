// Browser-CI render harness. Bundled to public/render-harness.js and loaded by
// browser/render-harness.html. Runs the offline render proof in a REAL browser
// (OfflineAudioContext) and exposes window.runRender() + window.__RESULT.
//
// Browser-side counterpart of tests/psy-synth/render-offline.browser.test.ts
// (which self-skips headless). Playwright (e2e/render.spec.ts) drives the page.

import { renderOffline, computeMetrics } from '../src/psy-synth/render'
import type { RenderNoteEvent } from '../src/psy-synth/render'
import MANIFEST from '../public/patches/manifest.json'
import BANKS from '../public/patches/style-banks.json'

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

export interface RenderProofResult {
  ok: boolean
  samples: number
  channels: number
  peak: number
  rms: number
  bitIdentical: boolean
  lengthMatch: boolean
  durationMs: number
  error?: string
}

export async function runRender(): Promise<RenderProofResult> {
  const started = Date.now()
  try {
    const opts = {
      lengthSec: 2.0,
      sampleRate: 44100,
      seed: 1,
      patchManifest: MANIFEST as unknown,
      styleBanks: BANKS as unknown,
      events: phrase(),
      context: { style: 'FULL-ON', energy: 0.8 },
    }
    const a = await renderOffline(opts)
    const b = await renderOffline(opts)
    const ma = computeMetrics(a)
    let lengthMatch = a.length === b.length && a.numberOfChannels === b.numberOfChannels
    let bitIdentical = lengthMatch
    if (lengthMatch) {
      for (let c = 0; c < a.numberOfChannels && bitIdentical; c++) {
        const da = a.getChannelData(c)
        const db = b.getChannelData(c)
        for (let i = 0; i < da.length; i++) {
          if (da[i] !== db[i]) { bitIdentical = false; break }
        }
      }
    }
    const audible = ma.peak > 0.001 && ma.rms > 0.0001 && ma.peak <= 1.0
    return {
      ok: audible && bitIdentical && lengthMatch,
      samples: ma.samples, channels: ma.channels, peak: ma.peak, rms: ma.rms,
      bitIdentical, lengthMatch, durationMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ok: false, samples: 0, channels: 0, peak: 0, rms: 0,
      bitIdentical: false, lengthMatch: false, durationMs: Date.now() - started,
      error: String(e),
    }
  }
}

;(globalThis as { runRender?: () => Promise<RenderProofResult> }).runRender = runRender
