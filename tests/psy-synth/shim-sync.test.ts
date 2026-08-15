import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Shim purity gate (CONTRIBUTING.md rule #1):
//  1. Every content shim file carries the VERBATIM header.
//  2. Content shim files are pinned to the canonical foundation commit.
//  3. index.ts is a pure re-export barrel (no logic).
// A full byte-diff against psy-sampler's shim runs in CI-sync jobs (network);
// this local gate catches accidental edits immediately and offline.

const SHIM_DIR = join(import.meta.dir, '../../src/psy-foundation-shim')
const PINNED_COMMIT = '4ae95d3'

const CONTENT_FILES = ['protocol.ts', 'transport.ts', 'device.ts', 'host.ts', 'voice-pool.ts']

describe('shim-sync (structural gate)', () => {
  for (const file of CONTENT_FILES) {
    it(file + ' has the VERBATIM header', () => {
      const text = readFileSync(join(SHIM_DIR, file), 'utf8')
      expect(text.startsWith('// VERBATIM SHIM')).toBe(true)
    })
    it(file + ' warns against modification', () => {
      const text = readFileSync(join(SHIM_DIR, file), 'utf8')
      expect(text.includes('Do not modify')).toBe(true)
    })
  }

  it('pinned commit reference is present in versioned shims', () => {
    // transport/device/host carry explicit SHIM_VERSION pins; protocol and
    // voice-pool are merged shims pinned by provenance header. At minimum the
    // repo must reference the pin somewhere per versioned file.
    for (const file of ['transport.ts', 'device.ts']) {
      const text = readFileSync(join(SHIM_DIR, file), 'utf8')
      expect(text).toContain(PINNED_COMMIT)
      expect(text).toContain('SHIM_VERSION')
    }
  })

  it('index.ts is a pure barrel: only import/export lines', () => {
    const text = readFileSync(join(SHIM_DIR, 'index.ts'), 'utf8')
    const code = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//'))
    for (const line of code) {
      const ok = line.startsWith('import') || line.startsWith('export') ||
        line.startsWith('}') || line.startsWith(']') || /^[A-Za-z_$][A-Za-z0-9_$]*,?$/.test(line) ||
        line.startsWith('type') || line.startsWith("'")
      expect(ok).toBe(true)
    }
  })

  it('no runtime import of psy-foundation packages anywhere in src/', () => {
    const files = [
      '../../src/psy-synth/device.ts',
      '../../src/psy-synth/index.ts',
      '../../src/psy-synth/voice.ts',
      '../../src/psy-synth/voice-pool.ts',
      '../../src/psy-synth/note-router.ts',
      '../../src/psy-synth/patch-library.ts',
    ]
    for (const rel of files) {
      const text = readFileSync(join(import.meta.dir, rel), 'utf8')
      expect(text.includes("from '@psy-foundation/")).toBe(false)
    }
  })
})
