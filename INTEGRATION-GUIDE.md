# PSY Synth Device - Integration Guide

How to connect the PSY Synth Device to any PSY family host (PSY4, PSY6, or future products). Mirror of psy-sampler's integration pattern, adapted for synthesis + MIDI.

## Architecture Recap

```
Host (PSY4/PSY6/future)
  |
  Composition Engine -> NoteEvent { type:'note', note, velocity, duration, channel, at }
  |
  SynthBridge (adapter in host)
  |
  DeviceHost + InMemoryChannel (foundation contract)
  |
  SynthDevice (this repo)
  |
  Audio output -> host engine bus (shared AudioContext)
```

## Step 1 - Build the synth bundle

```bash
cd psysynth
bun run scripts/build-bundle.ts
# -> public/psysynth.js (ESM, single file)
```

## Step 2 - Copy bundle and patches to host

```bash
cp psysynth/public/psysynth.js   host/public/
cp -r psysynth/public/patches    host/public/
```

## Step 3 - Create SynthBridge in the host

The bridge converts host-internal notes to canonical NoteEvents and routes them through a DeviceHost. Minimal reference:

```ts
import { InMemoryChannel, DeviceHost } from './synth-bridge-contracts'

export class SynthBridge {
  readonly host: DeviceHost

  constructor() {
    const channel = new InMemoryChannel('host-synth')
    this.host = new DeviceHost(channel)
  }

  // Host produced a note (composition path)
  publishNote(at: number, channel: string, midi: number, velocity: number, duration: number): void {
    this.host.publish({ type: 'note', note: midi, velocity, duration, channel, at })
  }

  // MIDI keyboard path (hold mode)
  publishMidiOn(at: number, channel: string, midi: number, velocity: number): void {
    this.publishNote(at, channel, midi, velocity, -1)
  }
  publishMidiOff(at: number, channel: string, midi: number): void {
    this.publishNote(at, channel, midi, 0, 0)
  }

  // Transport changed
  publishTransport(snap: { bpm: number; bar: number; revision: number }): void {
    this.host.pushTransport({
      bpm: snap.bpm, beat: snap.bar * 4, bar: snap.bar,
      beatsPerBar: 4, beatTime: 0, barTime: 0,
      phase: 0, barPhase: 0, confidence: 1, locked: true,
      revision: snap.revision,
      origin: { audioTime: 0, beatIndex: 0, bpm: snap.bpm },
      lastObservationAgo: 0, observationCount: 1,
    }, 0)
  }
}
```

Bridge rules (do not violate):
1. channel must be a canonical role: bass | lead | arp | pad | stab | pluck | keys. Unknown values are dropped by the device (and counted).
2. Never fabricate pitch for unpitched material - if the host has unpitched voices, keep them on the sampler/drum devices, not here.
3. at is AudioContext time. The bridge does not add latency compensation; the device reports its own.

## Step 4 - Load the synth in the host page

```ts
// After host engine init (AudioContext available):
const { SynthBridge } = await import('../lib/synth-bridge')
const bridge = new SynthBridge()
composer.attachSynthBridge(bridge)   // host-side seam (PSY4: like attachSamplerBridge)

const synthModule = await import('/psysynth.js')
const bundle = synthModule.createSynthDevice({
  audioContext: engine.audioContext,      // SHARED - never create your own
  outputNode: engine.engineBusInput,      // SHARED master bus
  patchManifestUrl: '/patches/manifest.json',
  seed: 1,
  delaySendNode: engine.delaySend ?? null,    // optional
  reverbSendNode: engine.reverbSend ?? null,  // optional
})
bridge.host.register(bundle.device)
bundle.device.onStart?.()
await bundle.load()
```

## Step 5 - Feed transport and context

- On every tempo/beat update: bridge.publishTransport(snapshot).
- On style/section change: bridge.host.pushContext({ key, rootPc, scale, energy, style, section, beatsPerBar }) - the device switches patch banks accordingly.

## MIDI Wiring (host side)

```ts
// WebMIDI lives in the HOST/bridge, never in the device
const access = await navigator.requestMIDIAccess()
for (const input of access.inputs.values()) {
  input.onmidimessage = (e) => {
    const [status, data1, data2] = e.data
    const cmd = status & 0xf0
    const t = engine.audioContext.currentTime + 0.003  // tiny safety margin
    if (cmd === 0x90 && data2 > 0) bridge.publishMidiOn(t, currentRole, data1, data2 / 127)
    else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) bridge.publishMidiOff(t, currentRole, data1)
    else if (cmd === 0xB0) synth.setParameterByCC(data1, data2 / 127)  // via midi-map
  }
}
```

## Voice Budget Negotiation

Declare per-host budgets at creation: createSynthDevice({ ..., maxVoices: 12 }) when running alongside sampler + drums on the same bus. Default 16. The pool hard-caps at this value; steals are deterministic and counted.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Silence, unknownChannel counter rising | non-canonical channel strings | map host voice names to the 7 canonical roles |
| Notes cut early | duration shorter than amp release | raise duration at bridge; device respects duration as gate |
| Held notes never release | note-off not published | ensure publishMidiOff on 0x80 AND 0x90 vel 0 |
| Steal clicks on arp | budget too low at high BPM | raise maxVoices or cap pad cost |
| Two clocks fighting | host added a device-side scheduler | remove it; device is clock-free by design |
