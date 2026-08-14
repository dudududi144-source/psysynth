import { describe, expect, it } from 'bun:test'
import { NoteRouter, HOLD_SENTINEL, STALE_WINDOW_SEC } from '../../src/psy-synth/note-router'
import { Counters } from '../../src/psy-synth/counters'
import type { NoteEvent } from '../../src/psy-foundation-shim/protocol'

function makeRouter(now: () => number): { router: NoteRouter; counters: Counters } {
  const counters = new Counters()
  return { router: new NoteRouter(counters, now), counters }
}

function note(partial: Partial<NoteEvent>): NoteEvent {
  return {
    type: 'note',
    note: 45,
    velocity: 0.8,
    duration: 0.2,
    channel: 'bass',
    at: 1,
    ...partial,
  }
}

describe('NoteRouter - routing table (ARCHITECTURE.md 3.2)', () => {
  it('routes note-on with duration > 0', () => {
    const { router } = makeRouter(() => 0)
    const a = router.route(note({ at: 1, duration: 0.25 }))
    expect(a.kind).toBe('note-on')
    if (a.kind === 'note-on') {
      expect(a.hold).toBe(false)
      expect(a.duration).toBe(0.25)
      expect(a.role).toBe('bass')
    }
  })

  it('routes HOLD sentinel (duration == -1) for MIDI hold mode', () => {
    const { router } = makeRouter(() => 0)
    const a = router.route(note({ duration: HOLD_SENTINEL }))
    expect(a.kind).toBe('note-on')
    if (a.kind === 'note-on') expect(a.hold).toBe(true)
  })

  it('routes velocity == 0 as note-off (family convention)', () => {
    const { router } = makeRouter(() => 0)
    const a = router.route(note({ velocity: 0 }))
    expect(a.kind).toBe('note-off')
  })

  it('maps duration <= 0 (non-hold) to a minimal 30ms gate', () => {
    const { router } = makeRouter(() => 0)
    const a = router.route(note({ duration: 0 }))
    expect(a.kind).toBe('note-on')
    if (a.kind === 'note-on') expect(a.duration).toBe(0.03)
  })

  it('drops unknown channel - no coercion, no guessing (audit B1)', () => {
    const { router, counters } = makeRouter(() => 0)
    const a = router.route(note({ channel: 'kick' }))
    expect(a.kind).toBe('drop')
    expect(counters.unknownChannel).toBe(1)
    expect(counters.dropReasons['unknown-channel']).toBe(1)
  })

  it('drops invalid pitch (range + non-integer)', () => {
    const { router, counters } = makeRouter(() => 0)
    expect(router.route(note({ note: -1 })).kind).toBe('drop')
    expect(router.route(note({ note: 128 })).kind).toBe('drop')
    expect(router.route(note({ note: 45.5 })).kind).toBe('drop')
    expect(counters.invalidEvent).toBe(3)
  })

  it('drops invalid velocity', () => {
    const { router } = makeRouter(() => 0)
    expect(router.route(note({ velocity: 1.5 })).kind).toBe('drop')
    expect(router.route(note({ velocity: -0.1 })).kind).toBe('drop')
  })

  it('drops stale events beyond the window', () => {
    const { router, counters } = makeRouter(() => 10)
    const a = router.route(note({ at: 10 - STALE_WINDOW_SEC - 0.01 }))
    expect(a.kind).toBe('drop')
    expect(counters.staleDrop).toBe(1)
  })

  it('accepts events inside the stale window', () => {
    const { router } = makeRouter(() => 10)
    const a = router.route(note({ at: 10 - STALE_WINDOW_SEC + 0.01 }))
    expect(a.kind).toBe('note-on')
  })

  it('validates all 7 canonical roles', () => {
    const { router } = makeRouter(() => 0)
    const roles = ['bass', 'lead', 'arp', 'pad', 'stab', 'pluck', 'keys']
    for (const r of roles) {
      expect(router.route(note({ channel: r })).kind).toBe('note-on')
    }
  })
})
