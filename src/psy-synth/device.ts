// SynthDevice - the PsyDevice implementation (HOW layer only).
// No composition. No scheduling clocks. No ctx.destination. No throwing.

import type { PsyDevice } from '../psy-foundation-shim/device'
import type {
  DeviceCapabilities,
  MusicalContext,
  MusicalEvent,
} from '../psy-foundation-shim/protocol'
import type { MusicalTransport } from '../psy-foundation-shim/transport'
import { SYNTH_ROLES, type SynthRole } from './types'
import { SynthVoice, type VoiceAudioHost } from './voice'
import { SynthVoicePool } from './voice-pool'
import { NoteRouter, type RoutedAction } from './note-router'
import { PatchLibrary } from './patch-library'
import { VarianceRules } from './variance-rules'
import { MidiMap, type SynthParameterId } from './midi-map'
import { LatencyMeter } from './latency'
import { Counters } from './counters'

export interface SynthDeviceOptions {
  deviceId?: string
  /** SHARED host AudioContext - the device never creates its own. */
  audioContext: VoiceAudioHost
  /** SHARED host engine bus - the device never touches ctx.destination. */
  outputNode: AudioNode
  /** Optional host FX send nodes; sends collapse to 0 when absent. */
  delaySendNode?: AudioNode | null
  reverbSendNode?: AudioNode | null
  maxVoices?: number
  seed?: number
  roleBudgets?: Partial<Record<SynthRole, number>>
}

const DEFAULT_ROLE_BUDGETS: Partial<Record<SynthRole, number>> = {
  bass: 4,
  lead: 4,
  arp: 4,
  pad: 6,
  stab: 4,
  pluck: 6,
  keys: 4,
}

export class SynthDevice implements PsyDevice {
  readonly id: string
  private readonly ctx: VoiceAudioHost
  private readonly outputNode: AudioNode
  private readonly delaySendNode: AudioNode | null
  private readonly reverbSendNode: AudioNode | null

  private readonly counters = new Counters()
  private readonly router: NoteRouter
  private readonly library: PatchLibrary
  private readonly variance: VarianceRules
  private readonly midiMap = new MidiMap()
  private readonly latency = new LatencyMeter()

  private readonly roleBuses = new Map<SynthRole, GainNode>()
  private readonly deviceOut: GainNode
  private pool: SynthVoicePool
  private readonly maxVoices: number
  private readonly seed: number

  private transport: MusicalTransport | null = null   // single source (audit B12)
  private context: MusicalContext | null = null
  private energy = 0.5
  private readonly lastFreqByRole = new Map<SynthRole, number>()
  private readonly stepCounterByRole = new Map<SynthRole, number>()
  private readonly ccOverrides = new Map<SynthParameterId, number>()
  private started = false

  constructor(opts: SynthDeviceOptions) {
    this.id = opts.deviceId ?? 'psysynth'
    this.ctx = opts.audioContext
    this.outputNode = opts.outputNode
    this.delaySendNode = opts.delaySendNode ?? null
    this.reverbSendNode = opts.reverbSendNode ?? null
    this.maxVoices = Math.max(1, Math.min(64, opts.maxVoices ?? 16))
    this.seed = (opts.seed ?? 1) >>> 0

    this.deviceOut = this.ctx.createGain()
    this.deviceOut.gain.value = 1
    this.deviceOut.connect(this.outputNode)

    for (const role of SYNTH_ROLES) {
      const bus = this.ctx.createGain()
      bus.gain.value = 1
      bus.connect(this.deviceOut)
      this.roleBuses.set(role, bus)
    }

    this.router = new NoteRouter(this.counters, () => this.ctx.currentTime)
    this.library = new PatchLibrary(this.counters)
    this.variance = new VarianceRules(this.seed)

    // Pre-allocate ALL voices now (onStart may come later; pool is lazy-free).
    const voices: SynthVoice[] = []
    for (let i = 0; i < this.maxVoices; i++) {
      voices.push(
        new SynthVoice(i, this.ctx, {
          dry: this.deviceOut, // reconnected per trigger to the role bus
          delaySend: this.delaySendNode ?? this.deviceOut,
          reverbSend: this.reverbSendNode ?? this.deviceOut,
        }),
      )
    }
    this.pool = new SynthVoicePool(voices, this.counters, opts.roleBudgets ?? DEFAULT_ROLE_BUDGETS)
  }

  // ── PsyDevice contract ─────────────────────────────────────────────────────

  capabilities(): DeviceCapabilities {
    return {
      audio: true,
      midi: true,
      inputs: 0,
      outputs: 1,
      voices: this.maxVoices,
      latencyMs: this.latency.reportMs(), // SAME source as reportLatencyMs (audit B9)
      roles: SYNTH_ROLES.slice(),          // canonical enum ONLY (audit B10)
    }
  }

  onStart(): void {
    if (this.started) return
    this.latency.probe(this.ctx)
    this.started = true
  }

  onStop(): void {
    if (!this.started) return
    this.pool.panicAll() // fast-release all voices, no dangling tails
    this.lastFreqByRole.clear()
    this.stepCounterByRole.clear()
    this.started = false
  }

  onTransport(transport: MusicalTransport): void {
    // Single cached snapshot; used only for phase sync contexts, never timing.
    this.transport = transport
  }

  onContext(context: MusicalContext): void {
    this.context = context
    this.energy = clamp01(context.energy)
    this.library.setStyle(context.style)
  }

  /** NEVER throws. Malformed events are dropped and counted. */
  onEvent(event: MusicalEvent): void {
    try {
      this.counters.eventsReceived += 1
      switch (event.type) {
        case 'note': {
          const action = this.router.route(event)
          this.execute(action)
          return
        }
        case 'energy':
          this.energy = clamp01(event.energy)
          return
        case 'drop':
          this.energy = clamp01(Math.max(this.energy, event.intensity))
          return
        case 'section':
          return // bank selection is style-driven via onContext; section is informational
        case 'pattern':
          return // v1: informational (documented optional capability)
        case 'beat':
          return // phase re-sync hook for tempo-locked LFOs (v2 polish)
      }
    } catch {
      // Defensive: contract forbids throwing out of onEvent.
      this.counters.noteDrop('unexpected-error')
    }
  }

  reportLatencyMs(): number {
    return this.latency.reportMs()
  }

  // ── Host/MIDI parameter API ────────────────────────────────────────────────

  /** MIDI CC entry point (host converts raw CC to this call). */
  setParameterByCC(cc: number, value01: number): boolean {
    const param = this.midiMap.parameterFor(cc)
    if (!param) return false
    this.ccOverrides.set(param, clamp01(value01))
    return true
  }

  midiLearnStart(target: SynthParameterId): void {
    this.midiMap.startLearn(target)
  }

  midiLearnCancel(): void {
    this.midiMap.cancelLearn()
  }

  get midi(): MidiMap {
    return this.midiMap
  }

  get patches(): PatchLibrary {
    return this.library
  }

  /** Main-thread diagnostics snapshot (no audio-path logging). */
  getDiagnostics() {
    const snap = this.counters.snapshot()
    return {
      ...snap,
      voicesActive: this.pool.activeCount(),
      patchesLoaded: this.library.count(),
      transportLocked: this.transport?.locked ?? false,
      style: this.context?.style ?? null,
    }
  }

  // ── Internal execution ─────────────────────────────────────────────────────

  private execute(action: RoutedAction): void {
    if (action.kind === 'drop') return

    if (action.kind === 'note-off') {
      const voice = this.pool.find(action.role, action.note)
      if (voice) voice.release(action.at)
      return
    }

    // note-on
    const patch = this.library.resolve(action.role)
    if (!patch) {
      this.counters.noteDrop('no-patch')
      return
    }

    const macro = this.library.macro()
    const glideMs = patch.glideMs * macro.glideBias * this.ccFactor('glide', 1)
    const cutoffMult = this.variance.cutoffMultiplier() * this.ccFactor('cutoff', 1)
    const resScale = macro.resBias * this.ccFactor('resonance', 1)
    const detuneDrift = this.variance.detuneDriftCents()
    const velocity = this.variance.humanizedVelocity(action.velocity, patch.humanize)

    // Seeded arp step variance + ornament (deterministic per role stream)
    const stepIdx = (this.stepCounterByRole.get(action.role) ?? 0) + 1
    this.stepCounterByRole.set(action.role, stepIdx)
    const stepMult = action.role === 'arp' && patch.stepVariance ? this.variance.stepCutoffMultiplier() : 1
    const ornament = action.role === 'arp' && patch.arpOrnament ? this.variance.arpOrnament(stepIdx, true) : 0

    // Chord trigger for stab role: fan out intervals on extra voices.
    const notes =
      action.role === 'stab' && patch.chordIntervals && patch.chordIntervals.length > 0
        ? [action.note, ...patch.chordIntervals.slice(0, 3).map((i) => action.note + i)]
        : [action.note + ornament]

    const energyCutoffHz = macro.energyToCutoff * (this.energy + this.ccOverride('energyMacro', 0))
    const glideFromHz = glideMs > 0 ? this.lastFreqByRole.get(action.role) ?? null : null
    const autoReleaseAt = action.hold ? null : action.at + action.duration
    const delayLevel = this.delaySendNode ? patch.sends.delay * this.ccFactor('delaySend', 1) : 0
    const reverbLevel = this.reverbSendNode ? patch.sends.reverb * this.ccFactor('reverbSend', 1) : 0
    const roleBus = this.roleBuses.get(action.role) ?? this.deviceOut

    for (const note of notes) {
      let voice: SynthVoice
      try {
        voice = this.pool.allocate(action.role, this.ctx.currentTime)
      } catch {
        this.counters.noteDrop('pool-exhausted')
        return
      }
      voice.reconnectDry(roleBus)
      voice.trigger({
        note,
        velocity,
        at: action.at,
        patch,
        glideFromHz: notes.indexOf(note) === 0 ? glideFromHz : null,
        detuneDriftCents: detuneDrift,
        cutoffMult: cutoffMult * stepMult,
        cutoffBias: macro.cutoffBias,
        resMult: resScale,
        energyCutoffHz,
        autoReleaseAt,
        delaySendLevel: delayLevel,
        reverbSendLevel: reverbLevel,
      })
      this.pool.bind(action.role, note, voice, action.at)
    }
    this.lastFreqByRole.set(action.role, midiFreqOf(action.note))
  }

  private ccOverride(param: SynthParameterId, fallback: number): number {
    return this.ccOverrides.get(param) ?? fallback
  }

  /** Map a 0..1 CC override to a multiplier around 1 (neutral at 0.5). */
  private ccFactor(param: SynthParameterId, neutral: number): number {
    const v = this.ccOverrides.get(param)
    if (v === undefined) return neutral
    return 0.25 + v * 1.5 // 0->0.25x, 0.5->1x, 1->1.75x
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function midiFreqOf(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}
