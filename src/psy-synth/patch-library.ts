// PatchLibrary - manifest loading, strict validation, provenance enforcement,
// style-bank selection and hot-swap. Invalid patches are rejected AT LOAD and
// counted; the runtime never sees a malformed patch.

import type { PatchManifest, StyleBank, SynthPatch, SynthRole } from './types'
import { SYNTH_ROLES } from './types'
import type { Counters } from './counters'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const WAVE_KINDS = new Set(['saw', 'square', 'triangle', 'sine'])

export function validatePatch(p: unknown, idx: number): ValidationResult {
  const errors: string[] = []
  const at = 'patches[' + idx + ']'
  if (typeof p !== 'object' || p === null) return { ok: false, errors: [at + ': not an object'] }
  const patch = p as Record<string, unknown>
  if (typeof patch.id !== 'string' || patch.id.length === 0) errors.push(at + '.id')
  if (typeof patch.role !== 'string' || !(SYNTH_ROLES as readonly string[]).includes(patch.role)) {
    errors.push(at + '.role')
  }
  const prov = patch.provenance as Record<string, unknown> | undefined
  if (!prov || typeof prov.author !== 'string' || typeof prov.license !== 'string' || typeof prov.created !== 'string') {
    errors.push(at + '.provenance (author/license/created required)')
  }
  const osc = patch.osc as Record<string, unknown> | undefined
  if (!osc || typeof osc !== 'object') {
    errors.push(at + '.osc')
  } else {
    const a = osc.a as Record<string, unknown> | undefined
    if (!a || typeof a.wave !== 'string' || !WAVE_KINDS.has(a.wave) || typeof a.gain !== 'number') {
      errors.push(at + '.osc.a (wave/gain)')
    }
  }
  if (typeof patch.glideMs !== 'number' || patch.glideMs < 0) errors.push(at + '.glideMs')
  const f = patch.filter as Record<string, unknown> | undefined
  if (!f) {
    errors.push(at + '.filter')
  } else {
    if (typeof f.cutoff !== 'number' || f.cutoff < 40 || f.cutoff > 18000) errors.push(at + '.filter.cutoff (40..18000)')
    if (typeof f.res !== 'number' || f.res < 0 || f.res > 0.95) errors.push(at + '.filter.res (0..0.95)')
    if (typeof f.envDepth !== 'number' || f.envDepth < 0 || f.envDepth > 1) errors.push(at + '.filter.envDepth')
    if (typeof f.envAttackMs !== 'number' || f.envAttackMs < 0.5) errors.push(at + '.filter.envAttackMs (>=0.5)')
    if (typeof f.envDecayMs !== 'number' || f.envDecayMs < 0.5) errors.push(at + '.filter.envDecayMs (>=0.5)')
  }
  const amp = patch.amp as Record<string, unknown> | undefined
  if (!amp) {
    errors.push(at + '.amp')
  } else {
    if (typeof amp.attackMs !== 'number' || amp.attackMs < 0.5) errors.push(at + '.amp.attackMs (>=0.5)')
    if (typeof amp.decayMs !== 'number' || amp.decayMs < 0.5) errors.push(at + '.amp.decayMs (>=0.5)')
    if (typeof amp.sustain !== 'number' || amp.sustain < 0 || amp.sustain > 1) errors.push(at + '.amp.sustain')
    if (typeof amp.releaseMs !== 'number' || amp.releaseMs < 0.5) errors.push(at + '.amp.releaseMs (>=0.5)')
  }
  const sends = patch.sends as Record<string, unknown> | undefined
  if (!sends || typeof sends.delay !== 'number' || typeof sends.reverb !== 'number' ||
      sends.delay < 0 || sends.delay > 1 || sends.reverb < 0 || sends.reverb > 1) {
    errors.push(at + '.sends (delay/reverb 0..1)')
  }
  if (typeof patch.driveDb !== 'number' || patch.driveDb < 0 || patch.driveDb > 12) errors.push(at + '.driveDb (0..12)')
  const oe = patch.oscEngine
  if (oe !== undefined && oe !== 'periodic' && oe !== 'polyblep') {
    errors.push(at + '.oscEngine (periodic|polyblep)')
  }
  return { ok: errors.length === 0, errors }
}

export class PatchLibrary {
  private readonly byId = new Map<string, SynthPatch>()
  private readonly byRole = new Map<SynthRole, SynthPatch[]>()
  private banks = new Map<string, StyleBank>()
  private activeStyle = 'FULL-ON'
  private seed = 1
  private readonly counters: Counters

  constructor(counters: Counters) {
    this.counters = counters
  }

  /** Parse + validate a manifest. Returns the number of accepted patches. */
  load(manifest: unknown): number {
    if (typeof manifest !== 'object' || manifest === null) {
      this.counters.patchLoadErrors += 1
      return 0
    }
    const m = manifest as Partial<PatchManifest>
    if (typeof m.manifestVersion !== 'number' || !Array.isArray(m.patches)) {
      this.counters.patchLoadErrors += 1
      return 0
    }
    this.byId.clear()
    this.byRole.clear()
    this.seed = typeof m.seed === 'number' ? m.seed >>> 0 : 1
    let accepted = 0
    m.patches.forEach((raw, idx) => {
      const v = validatePatch(raw, idx)
      if (!v.ok) {
        this.counters.patchLoadErrors += 1
        return
      }
      const patch = raw as SynthPatch
      if (this.byId.has(patch.id)) {
        this.counters.patchLoadErrors += 1 // duplicate id rejected
        return
      }
      this.byId.set(patch.id, patch)
      const list = this.byRole.get(patch.role) ?? []
      list.push(patch)
      this.byRole.set(patch.role, list)
      accepted += 1
    })
    return accepted
  }

  registerBank(bank: StyleBank): void {
    this.banks.set(bank.style.toUpperCase(), bank)
  }

  setStyle(style: string): void {
    this.activeStyle = style.toUpperCase()
  }

  get manifestSeed(): number {
    return this.seed
  }

  /**
   * Resolve the patch for a role under the active style:
   * style override -> first patch of the role -> null (device falls back silently).
   */
  resolve(role: SynthRole): SynthPatch | null {
    const bank = this.banks.get(this.activeStyle)
    if (bank) {
      const overrideId = bank.patchOverrides[role]
      if (overrideId) {
        const p = this.byId.get(overrideId)
        if (p && p.role === role) return p
      }
    }
    const list = this.byRole.get(role)
    return list && list.length > 0 ? (list[0] as SynthPatch) : null
  }

  /** Macro tuning for the active style (defaults when no bank). */
  macro(): { cutoffBias: number; resBias: number; glideBias: number; energyToCutoff: number } {
    const bank = this.banks.get(this.activeStyle)
    if (!bank) return { cutoffBias: 1, resBias: 1, glideBias: 1, energyToCutoff: 0 }
    return bank.macro
  }

  count(): number {
    return this.byId.size
  }

  rolesCovered(): SynthRole[] {
    return SYNTH_ROLES.filter((r) => (this.byRole.get(r)?.length ?? 0) > 0)
  }
}
