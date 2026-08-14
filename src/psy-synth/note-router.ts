// NoteRouter - decides WHAT TO DO with a NoteEvent. Pure decision layer:
// no audio access, no patch access. The SynthDevice executes the decisions.
// Implements the routing table from ARCHITECTURE.md section 3.2.

import type { NoteEvent } from '../psy-foundation-shim/protocol'
import { isSynthRole, type SynthRole } from './types'
import type { Counters } from './counters'

export const HOLD_SENTINEL = -1
export const STALE_WINDOW_SEC = 0.05

export type RoutedAction =
  | { kind: 'note-on'; role: SynthRole; note: number; velocity: number; at: number; duration: number; hold: boolean }
  | { kind: 'note-off'; role: SynthRole; note: number; at: number }
  | { kind: 'drop'; reason: DropReason }

export type DropReason =
  | 'unknown-channel'
  | 'invalid-pitch'
  | 'invalid-velocity'
  | 'stale'

export class NoteRouter {
  private readonly counters: Counters
  private nowProvider: () => number

  constructor(counters: Counters, nowProvider: () => number) {
    this.counters = counters
    this.nowProvider = nowProvider
  }

  /** Test/DI seam: advance the clock source (never used for scheduling). */
  setNowProvider(p: () => number): void {
    this.nowProvider = p
  }

  route(event: NoteEvent): RoutedAction {
    // 1) Role validation - no coercion, no guessing (audit B1).
    if (!isSynthRole(event.channel)) {
      this.counters.unknownChannel += 1
      this.counters.noteDrop('unknown-channel')
      return { kind: 'drop', reason: 'unknown-channel' }
    }
    const role = event.channel

    // 2) Pitch validation.
    if (!Number.isFinite(event.note) || event.note < 0 || event.note > 127 || Math.floor(event.note) !== event.note) {
      this.counters.invalidEvent += 1
      this.counters.noteDrop('invalid-pitch')
      return { kind: 'drop', reason: 'invalid-pitch' }
    }

    // 3) Velocity validation.
    if (!Number.isFinite(event.velocity) || event.velocity < 0 || event.velocity > 1) {
      this.counters.invalidEvent += 1
      this.counters.noteDrop('invalid-velocity')
      return { kind: 'drop', reason: 'invalid-velocity' }
    }

    // 4) Stale drop (family stale-drop policy).
    const now = this.nowProvider()
    if (event.at < now - STALE_WINDOW_SEC) {
      this.counters.staleDrop += 1
      this.counters.noteDrop('stale')
      return { kind: 'drop', reason: 'stale' }
    }

    // 5) Note-off convention: velocity === 0 (audit: no contract changes needed).
    if (event.velocity === 0) {
      return { kind: 'note-off', role, note: event.note, at: event.at }
    }

    // 6) Note-on: duration semantics.
    //    duration > 0  : fixed gate, auto-release at at + duration
    //    duration == -1: HOLD until matching note-off (MIDI keyboard path)
    //    duration == 0 with vel > 0 is treated as a minimal 30ms pluck gate.
    const hold = event.duration === HOLD_SENTINEL
    const duration = hold ? HOLD_SENTINEL : event.duration <= 0 ? 0.03 : event.duration
    return {
      kind: 'note-on',
      role,
      note: event.note,
      velocity: event.velocity,
      at: event.at,
      duration,
      hold,
    }
  }
}
