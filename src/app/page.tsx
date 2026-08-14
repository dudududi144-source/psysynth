'use client'
// Standalone demo host for psysynth. Mirrors the INTEGRATION-GUIDE wiring:
// shared AudioContext + createSynthDevice + MIDI-in via WebMIDI (host-owned).

import { useCallback, useEffect, useRef, useState } from 'react'

type SynthModule = typeof import('../psy-synth/index')

interface Diag {
  eventsReceived: number
  voicesActive: number
  voicesStolen: number
  eventsDropped: number
  patchesLoaded: number
}

const ROLES = ['bass', 'lead', 'arp', 'pad', 'stab', 'pluck', 'keys'] as const
const KEYS = [45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64] // A minor-ish row

export default function DemoPage() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<(typeof ROLES)[number]>('bass')
  const [diag, setDiag] = useState<Diag | null>(null)
  const [midiName, setMidiName] = useState<string | null>(null)
  const synthRef = useRef<{ device: import('../psy-synth/device').SynthDevice } | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  const start = useCallback(async () => {
    if (ready) return
    try {
      const ctx = new AudioContext()
      await ctx.resume()
      const master = ctx.createGain()
      master.gain.value = 0.8
      master.connect(ctx.destination)
      const mod: SynthModule = await import('../psy-synth/index')
      const bundle = mod.createSynthDevice({
        deviceId: 'psysynth-demo',
        audioContext: ctx,
        outputNode: master,
        patchManifestUrl: '/patches/manifest.json',
        maxVoices: 16,
        seed: 1,
      })
      const accepted = await bundle.load()
      bundle.device.onStart()
      synthRef.current = bundle
      ctxRef.current = ctx
      setReady(true)
      setDiag({ eventsReceived: 0, voicesActive: 0, voicesStolen: 0, eventsDropped: 0, patchesLoaded: accepted })
    } catch (e) {
      setError(String(e))
    }
  }, [ready])

  // Diagnostics poller (main thread only - audio path stays clean)
  useEffect(() => {
    if (!ready) return
    const id = setInterval(() => {
      const s = synthRef.current
      if (!s) return
      const d = s.device.getDiagnostics()
      setDiag({
        eventsReceived: d.eventsReceived,
        voicesActive: d.voicesActive,
        voicesStolen: d.voicesStolen,
        eventsDropped: d.eventsDropped,
        patchesLoaded: d.patchesLoaded,
      })
    }, 250)
    return () => clearInterval(id)
  }, [ready])

  const noteOn = useCallback(
    (note: number, vel = 0.8) => {
      const s = synthRef.current
      const ctx = ctxRef.current
      if (!s || !ctx) return
      s.device.onEvent({ type: 'note', note, velocity: vel, duration: -1, channel: role, at: ctx.currentTime + 0.003 })
    },
    [role],
  )
  const noteOff = useCallback((note: number) => {
    const s = synthRef.current
    const ctx = ctxRef.current
    if (!s || !ctx) return
    s.device.onEvent({ type: 'note', note, velocity: 0, duration: 0, channel: role, at: ctx.currentTime + 0.003 })
  }, [role])

  // WebMIDI lives in the HOST (never inside the device).
  useEffect(() => {
    if (!ready) return
    let access: MIDIAccess | null = null
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }
    if (!nav.requestMIDIAccess) return
    nav
      .requestMIDIAccess()
      .then((a) => {
        access = a
        const input = a.inputs.values().next().value as MIDIInput | undefined
        if (!input) return
        setMidiName(input.name ?? 'MIDI device')
        input.onmidimessage = (e) => {
          const d = e.data
          if (!d || d.length < 3) return
          const cmd = d[0]! & 0xf0
          const note = d[1]!
          const vel = d[2]!
          const ctx = ctxRef.current
          if (!ctx) return
          const t = ctx.currentTime + 0.003
          const s = synthRef.current
          if (!s) return
          if (cmd === 0x90 && vel > 0) {
            s.device.onEvent({ type: 'note', note, velocity: vel / 127, duration: -1, channel: role, at: t })
          } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
            s.device.onEvent({ type: 'note', note, velocity: 0, duration: 0, channel: role, at: t })
          }
        }
      })
      .catch(() => setMidiName(null))
    return () => {
      void access
    }
  }, [ready, role])

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, letterSpacing: 2 }}>PSY SYNTH DEVICE</h1>
      <p style={{ color: '#9d8fc0', fontSize: 12 }}>
        standalone demo host - PsyDevice HOW layer - no composition, no transport ownership
      </p>

      {!ready ? (
        <div>
          <button
            onClick={start}
            style={{ padding: '12px 28px', borderRadius: 999, border: 'none', fontWeight: 800, cursor: 'pointer', background: 'linear-gradient(90deg,#00ffc8,#b967ff)', color: '#0a0518' }}
          >
            START AUDIO
          </button>
          {error ? <p style={{ color: '#ff4d6d' }}>{error}</p> : null}
        </div>
      ) : null}

      <div style={{ margin: '14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ROLES.map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            style={{
              padding: '6px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
              border: role === r ? '1px solid #00ffc8' : '1px solid rgba(150,90,255,.3)',
              background: role === r ? 'rgba(0,255,200,.08)' : 'rgba(12,6,28,.6)',
              color: role === r ? '#00ffc8' : '#9d8fc0',
            }}
          >
            {r.toUpperCase()}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#9d8fc0', alignSelf: 'center' }}>
          {midiName ? 'MIDI: ' + midiName : 'MIDI: none'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {KEYS.map((k) => (
          <button
            key={k}
            onPointerDown={() => noteOn(k)}
            onPointerUp={() => noteOff(k)}
            onPointerLeave={() => noteOff(k)}
            style={{
              width: 56, height: 90, borderRadius: 8, cursor: 'pointer',
              border: '1px solid rgba(150,90,255,.3)',
              background: 'linear-gradient(180deg,#1c1136,#0d0620)', color: '#b967ff', fontWeight: 800,
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {diag ? (
        <pre style={{ marginTop: 16, fontSize: 11, color: '#49ffa4' }}>
{JSON.stringify(diag, null, 2)}
        </pre>
      ) : null}
    </main>
  )
}
