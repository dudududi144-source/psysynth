// psysynth public API - the factory mirrors psy-sampler's createSamplerDevice.
// Bundle exports: createSynthDevice, SynthDevice, types. No globals.

import { SynthDevice, type SynthDeviceOptions } from './device'
import type { SynthRole } from './types'

export interface CreateSynthDeviceOpts extends SynthDeviceOptions {
  /** URL of the patch manifest JSON. Fetch happens HERE (load step), never in audio path. */
  patchManifestUrl?: string
  /** Inline manifest (alternative to URL; tests + SSR-safe path). */
  patchManifest?: unknown
  /** Optional style banks JSON (array of StyleBank). */
  styleBanks?: unknown
}

export interface SynthDeviceBundle {
  device: SynthDevice
  /** Load patches (fetch + validate). Resolves with accepted patch count. */
  load(): Promise<number>
  /** Release resources (fast-release voices; host keeps the AudioContext). */
  dispose(): void
}

export function createSynthDevice(opts: CreateSynthDeviceOpts): SynthDeviceBundle {
  const device = new SynthDevice(opts)
  let loaded = false

  async function load(): Promise<number> {
    let manifest: unknown = opts.patchManifest
    if (manifest === undefined && opts.patchManifestUrl) {
      const resp = await fetch(opts.patchManifestUrl)
      if (!resp.ok) throw new Error('psysynth: manifest fetch failed: ' + resp.status)
      manifest = await resp.json()
    }
    if (manifest === undefined) return 0
    const accepted = device.patches.load(manifest)
    if (Array.isArray(opts.styleBanks)) {
      for (const bank of opts.styleBanks as Array<Record<string, unknown>>) {
        device.patches.registerBank(bank as never)
      }
    }
    loaded = accepted > 0
    return accepted
  }

  function dispose(): void {
    device.onStop?.()
  }

  return { device, load, dispose }
}

export { SynthDevice }
export type { SynthDeviceOptions }
export type { SynthRole }
export { SYNTH_ROLES } from './types'
