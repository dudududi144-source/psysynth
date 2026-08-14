import { describe, expect, it } from 'bun:test'
import { MidiMap, DEFAULT_CC_MAP } from '../../src/psy-synth/midi-map'

describe('MidiMap - CC table + learn state machine', () => {
  it('default table maps 74/71/5/12 (+ sends)', () => {
    const m = new MidiMap()
    expect(m.parameterFor(74)).toBe('cutoff')
    expect(m.parameterFor(71)).toBe('resonance')
    expect(m.parameterFor(5)).toBe('glide')
    expect(m.parameterFor(12)).toBe('energyMacro')
    expect(m.parameterFor(99)).toBeUndefined()
  })

  it('learn: next CC claims the target parameter', () => {
    const m = new MidiMap()
    m.startLearn('cutoff')
    expect(m.isLearning()).toBe(true)
    expect(m.parameterFor(21)).toBe('cutoff')
    expect(m.isLearning()).toBe(false)
    expect(m.parameterFor(21)).toBe('cutoff') // persisted in the table
  })

  it('learn overwrite: CC 74 can be re-claimed by another param', () => {
    const m = new MidiMap()
    m.startLearn('resonance')
    expect(m.parameterFor(74)).toBe('resonance')
    expect(m.parameterFor(74)).toBe('resonance')
  })

  it('cancelLearn leaves the table untouched', () => {
    const m = new MidiMap()
    m.startLearn('cutoff')
    m.cancelLearn()
    expect(m.isLearning()).toBe(false)
    expect(m.parameterFor(21)).toBeUndefined()
  })

  it('toJSON/fromJSON roundtrip (host-owned persistence)', () => {
    const m = new MidiMap()
    m.startLearn('glide')
    m.parameterFor(30)
    const json = m.toJSON()
    const m2 = new MidiMap({})
    const accepted = m2.fromJSON(json)
    expect(accepted).toBeGreaterThan(0)
    expect(m2.parameterFor(30)).toBe('glide')
  })

  it('fromJSON rejects malformed cc and unknown params', () => {
    const m = new MidiMap({})
    const accepted = m.fromJSON({ '-5': 'cutoff', '200': 'cutoff', '40': 'wobble', '41': 'cutoff' })
    expect(accepted).toBe(1)
    expect(m.parameterFor(41)).toBe('cutoff')
  })

  it('onChange fires after learn', () => {
    const m = new MidiMap()
    let fired = 0
    const off = m.onChange(() => {
      fired += 1
    })
    m.startLearn('delaySend')
    m.parameterFor(50)
    expect(fired).toBe(1)
    off()
    m.startLearn('reverbSend')
    m.parameterFor(51)
    expect(fired).toBe(1) // unsubscribed
  })

  it('DEFAULT_CC_MAP is frozen', () => {
    expect(Object.isFrozen(DEFAULT_CC_MAP)).toBe(true)
  })
})
