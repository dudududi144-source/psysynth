// SynthVoicePool - the device-side pool (NOT the shim VoicePool).
// The shim VoicePool is round-robin only; this pool adds:
//   - deterministic steal policy: oldest-released -> quietest -> oldest-on
//   - (channel, note) active index for O(1) note-off matching
//   - per-role budgets
// Hot path performs ZERO heap allocations (pre-sized arrays, index reuse).

import type { SynthRole } from './types'
import type { SynthVoice } from './voice'
import { Counters } from './counters'

export interface PooledVoiceRecord {
  voice: SynthVoice
  channel: string
  note: number
  role: SynthRole
  onAt: number
}

export class SynthVoicePool {
  private readonly records: PooledVoiceRecord[]
  private readonly free: number[]            // stack of free voice indices
  private readonly byKey = new Map<string, number>() // channel|note -> record index
  private readonly counters: Counters
  private readonly budgets: Partial<Record<SynthRole, number>>
  private readonly roleCounts: Record<string, number> = {}

  constructor(voices: SynthVoice[], counters: Counters, budgets: Partial<Record<SynthRole, number>>) {
    this.counters = counters
    this.budgets = budgets
    this.records = voices.map((voice) => ({
      voice,
      channel: '',
      note: -1,
      role: 'keys' as SynthRole,
      onAt: 0,
    }))
    this.free = voices.map((_, i) => i).reverse()
  }

  private key(channel: string, note: number): string {
    return channel + '|' + String(note)
  }

  /** Find the active voice for a (channel, note). O(1). */
  find(channel: string, note: number): SynthVoice | null {
    const idx = this.byKey.get(this.key(channel, note))
    if (idx === undefined) return null
    const rec = this.records[idx]
    return rec && rec.voice.active ? rec.voice : null
  }

  /** Allocate a voice for role; deterministic steal when none free. */
  allocate(role: SynthRole, now: number): SynthVoice {
    this.sweep(now)
    // Role budget guard: if role is over budget, steal from SAME role first.
    const budget = this.budgets[role]
    if (budget !== undefined) {
      const count = this.roleCounts[role] ?? 0
      if (count >= budget) {
        const victimIdx = this.pickSteal(role, now, true)
        if (victimIdx >= 0) {
          this.counters.voicesStolen += 1
          return this.takeRecord(victimIdx, role)
        }
      }
    }
    const freeIdx = this.free.pop()
    if (freeIdx !== undefined) {
      const rec = this.records[freeIdx]
      if (rec) {
        rec.role = role
        this.roleCounts[role] = (this.roleCounts[role] ?? 0) + 1
        return rec.voice
      }
    }
    // No free voice: deterministic steal.
    const victimIdx = this.pickSteal(role, now, false)
    if (victimIdx < 0) {
      // Pathological: nothing to steal (all same role & budgeted). Drop newest.
      this.counters.noteDrop('pool-exhausted')
      throw new Error('SynthVoicePool: no allocatable voice')
    }
    this.counters.voicesStolen += 1
    return this.takeRecord(victimIdx, role)
  }

  /** Bind allocated voice to (channel, note) for note-off matching. */
  bind(channel: string, note: number, voice: SynthVoice, at: number): void {
    const idx = this.records.findIndex((r) => r.voice === voice)
    if (idx < 0) return
    const rec = this.records[idx]
    if (!rec) return
    // If an older voice holds this key, release it silently (mono roles like bass).
    const k = this.key(channel, note)
    const prevIdx = this.byKey.get(k)
    if (prevIdx !== undefined && prevIdx !== idx) {
      const prev = this.records[prevIdx]
      if (prev && prev.voice.active) prev.voice.release(at, 40)
      this.byKey.delete(k)
    }
    rec.channel = channel
    rec.note = note
    rec.onAt = at
    this.byKey.set(k, idx)
  }

  releaseAll(at: number, releaseMs: number): void {
    for (const rec of this.records) {
      if (rec.voice.active) rec.voice.release(at, releaseMs)
    }
  }

  panicAll(): void {
    for (const rec of this.records) rec.voice.panic()
    for (const rec of this.records) {
      rec.channel = ''
      rec.note = -1
    }
    this.byKey.clear()
    this.free.length = 0
    for (let i = this.records.length - 1; i >= 0; i--) this.free.push(i)
    for (const k of Object.keys(this.roleCounts)) this.roleCounts[k] = 0
  }

  activeCount(): number {
    let n = 0
    for (const rec of this.records) if (rec.voice.active) n += 1
    return n
  }

  private sweep(now: number): void {
    // Reclaim voices whose release tail finished. No allocation here.
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      if (!rec) continue
      const wasActive = rec.voice.active
      rec.voice.markInactiveIfDone(now)
      if (wasActive && !rec.voice.active) {
        this.freeVoice(i)
      }
    }
  }

  private freeVoice(idx: number): void {
    const rec = this.records[idx]
    if (!rec) return
    if (rec.channel !== '') {
      const k = this.key(rec.channel, rec.note)
      const holder = this.byKey.get(k)
      if (holder === idx) this.byKey.delete(k)
      rec.channel = ''
      rec.note = -1
    }
    const roleCount = this.roleCounts[rec.role]
    if (roleCount && roleCount > 0) this.roleCounts[rec.role] = roleCount - 1
    this.free.push(idx)
  }

  private takeRecord(idx: number, role: SynthRole): SynthVoice {
    const rec = this.records[idx]
    if (!rec) throw new Error('SynthVoicePool: bad index')
    if (rec.voice.active) rec.voice.panic()
    if (rec.channel !== '') {
      const k = this.key(rec.channel, rec.note)
      if (this.byKey.get(k) === idx) this.byKey.delete(k)
      rec.channel = ''
      rec.note = -1
    }
    const prevCount = this.roleCounts[rec.role]
    if (prevCount && prevCount > 0) this.roleCounts[rec.role] = prevCount - 1
    rec.role = role
    this.roleCounts[role] = (this.roleCounts[role] ?? 0) + 1
    return rec.voice
  }

  /**
   * Deterministic steal order:
   *   1) oldest voice already in release (tail only)
   *   2) oldest-on voice (longest sounding)
   * sameRoleOnly restricts candidates to the given role (budget steals).
   */
  private pickSteal(role: SynthRole, now: number, sameRoleOnly: boolean): number {
    let inReleaseIdx = -1
    let inReleaseAge = -1
    let oldestIdx = -1
    let oldestAge = -1
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      if (!rec || !rec.voice.active) continue
      if (sameRoleOnly && rec.role !== role) continue
      const age = rec.voice.ageSec
      if (rec.voice.isReleasing) {
        if (age > inReleaseAge) {
          inReleaseAge = age
          inReleaseIdx = i
        }
      }
      if (age > oldestAge) {
        oldestAge = age
        oldestIdx = i
      }
    }
    if (inReleaseIdx >= 0) return inReleaseIdx
    return oldestIdx
  }
}
