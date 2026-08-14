import { describe, expect, it } from 'bun:test'
import { SynthVoicePool } from '../../src/psy-synth/voice-pool'
import { Counters } from '../../src/psy-synth/counters'
import type { SynthVoice } from '../../src/psy-synth/voice'

/** Minimal fake voice satisfying the members SynthVoicePool touches. */
class FakeVoice {
  active = false
  private onAt = 0
  private released: number | null = null
  panicCount = 0
  releaseCount = 0
  panic(): void {
    this.panicCount += 1
    this.active = false
    this.released = null
  }
  release(at: number, _ms: number): void {
    this.releaseCount += 1
    this.released = at
  }
  get isReleasing(): boolean {
    return this.released !== null
  }
  get ageSec(): number {
    return this.onAt
  }
  markInactiveIfDone(now: number): void {
    if (this.active && this.released !== null && now > this.released + 0.35) this.active = false
  }
  start(age: number): void {
    this.active = true
    this.onAt = age
    this.released = null
  }
}

function makePool(n: number, budgets = {}) {
  const counters = new Counters()
  const voices = Array.from({ length: n }, () => new FakeVoice()) as unknown as SynthVoice[]
  const pool = new SynthVoicePool(voices, counters, budgets)
  return { pool, counters, voices: voices as unknown as FakeVoice[] }
}

describe('SynthVoicePool - allocation and deterministic steal', () => {
  it('allocates free voices before stealing', () => {
    const { pool, voices } = makePool(3)
    const v1 = pool.allocate('bass', 0)
    v1['start']?.call(v1, 0)
    const v2 = pool.allocate('bass', 0)
    expect(v2).not.toBe(v1)
    expect(voices.filter((v) => v.panicCount > 0).length).toBe(0)
  })

  it('steal order: oldest-released first, then oldest-on', () => {
    const { pool, counters, voices } = makePool(2)
    const a = pool.allocate('bass', 0)
    ;(a as unknown as FakeVoice).start(1) // oldest
    const b = pool.allocate('lead', 0)
    ;(b as unknown as FakeVoice).start(0.5)
    // Release b (tail only)
    b.release(0.6, 100)
    const c = pool.allocate('arp', 0) // should steal b (in release), not a
    expect(c).toBe(b)
    expect(counters.voicesStolen).toBe(1)
    expect(voices[1]!.panicCount).toBe(1)
  })

  it('budget steals prefer the same role', () => {
    const { pool } = makePool(2, { bass: 1 })
    const a = pool.allocate('bass', 0)
    ;(a as unknown as FakeVoice).start(1)
    // Second bass exceeds budget -> steals from bass (same role)
    const b = pool.allocate('bass', 0)
    expect(b).toBe(a)
  })

  it('bind + find: O(1) note-off matching per (channel, note)', () => {
    const { pool } = makePool(4)
    const v = pool.allocate('bass', 0)
    ;(v as unknown as FakeVoice).start(0)
    pool.bind('bass', 45, v, 0)
    expect(pool.find('bass', 45)).toBe(v)
    expect(pool.find('bass', 46)).toBeNull()
    expect(pool.find('lead', 45)).toBeNull()
  })

  it('binding a duplicate (channel, note) releases the previous voice', () => {
    const { pool } = makePool(4)
    const v1 = pool.allocate('bass', 0)
    ;(v1 as unknown as FakeVoice).start(0)
    pool.bind('bass', 45, v1, 0)
    const v2 = pool.allocate('bass', 0)
    ;(v2 as unknown as FakeVoice).start(0)
    pool.bind('bass', 45, v2, 0.1)
    expect((v1 as unknown as FakeVoice).releaseCount).toBe(1)
    expect(pool.find('bass', 45)).toBe(v2)
  })

  it('panicAll frees everything and clears the index', () => {
    const { pool } = makePool(3)
    for (let i = 0; i < 3; i++) {
      const v = pool.allocate('lead', 0)
      ;(v as unknown as FakeVoice).start(0)
      pool.bind('lead', 60 + i, v, 0)
    }
    pool.panicAll()
    expect(pool.activeCount()).toBe(0)
    expect(pool.find('lead', 60)).toBeNull()
  })

  it('release tails reclaim voices without stealing (sweep)', () => {
    const { pool, counters } = makePool(1)
    const v = pool.allocate('pad', 0)
    ;(v as unknown as FakeVoice).start(0)
    v.release(0.1, 100)
    // After the tail the sweep should reclaim; no steal needed.
    const w = pool.allocate('pad', 1.0)
    expect(w).toBe(v)
    expect(counters.voicesStolen).toBe(0)
  })

  it('steal sequence is deterministic across runs', () => {
    function run() {
      const { pool } = makePool(4)
      const ids: number[] = []
      for (let i = 0; i < 10; i++) {
        const v = pool.allocate('arp', 0)
        const fv = v as unknown as FakeVoice
        fv.start(i) // strictly increasing ages
        pool.bind('arp', 50 + (i % 5), v, i)
        ids.push((v as unknown as { index?: number }).index ?? 0)
      }
      return ids.join(',')
    }
    expect(run()).toBe(run())
  })
})
