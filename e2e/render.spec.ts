// Playwright browser-CI test: real OfflineAudioContext render proof.
// Kept in e2e/ (NOT tests/) so `bun test tests/` never picks it up - it needs
// a real browser and is driven by the dedicated browser CI job.
//
// Flow: load browser/render-harness.html (loads public/render-harness.js),
// wait for window.__RESULT, assert audible + bit-identical output.

import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

declare global {
  interface Window {
    __RESULT?: {
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
  }
}

test('offline render produces audible, deterministic samples (real browser)', async ({ page }) => {
  const pagePath = join(__dirname, '..', 'browser', 'render-harness.html')
  await page.goto(pathToFileURL(pagePath).toString())

  await page.waitForFunction(() => window.__RESULT !== undefined, undefined, { timeout: 60000 })

  const result = await page.evaluate(() => window.__RESULT)
  expect(result, 'render harness produced a result').toBeDefined()
  console.log('render-proof result:', JSON.stringify(result))

  expect(result!.error, `render error: ${result!.error}`).toBeUndefined()
  expect(result!.samples).toBeGreaterThan(0)
  expect(result!.channels).toBe(2)
  expect(result!.peak, 'audible peak').toBeGreaterThan(0.001)
  expect(result!.peak, 'not clipping').toBeLessThanOrEqual(1.0)
  expect(result!.rms, 'audible rms').toBeGreaterThan(0.0001)
  expect(result!.lengthMatch).toBe(true)
  expect(result!.bitIdentical, 'same seed => bit-identical render').toBe(true)
  expect(result!.ok).toBe(true)
})
