# PSY Synth Device - Style Architecture

The psytrance-grade requirement, made explicit. Style lives in DATA (patches + subgenre presets), never in device code. Device code is genre-agnostic; this document defines the genre content it must express.

## 1. WHAT/HOW Split for Style

| Concern | Owner | Example |
|---|---|---|
| Which notes, which pattern, when | Host composer (WHAT) | 16th offbeat bass line at bar 17 |
| How a bass note sounds | psysynth patch (HOW) | 303-style: saw+sub, cutoff 1.2k, env depth 80%, glide 40ms |
| Which patch bank fits the genre | Host onContext(style) -> device bank switch | style=DARK-PSY => darkpsy bank |

The device never decides "play offbeat". It only renders whatever arrives with the right character.

## 2. Canonical Roles - Full Specs

Every value below is a PATCH PARAMETER DEFAULT, overridable per patch.

### 2.1 bass (the heart of psy)

Sub-styles expressed as patch variants: rolling (16th), offbeat (8th after kick), gallop (1+2&... pattern feel), minimal.

| Param | Value | Notes |
|---|---|---|
| osc A | saw, gain 0.7 | main body |
| osc B | square, -12 st, gain 0.4 | weight |
| sub | sine, -12 st, gain 0.5, mono-summed | sub layer |
| glide | 0..60ms (patch-dependent; gallop 30-45ms) | portamento, last-note legato |
| filter | Moog LPF, cutoff 800..2500Hz, res 0.25..0.45 | velocity tracks cutoff +15% |
| filter env | attack 1ms, decay 120..250ms, depth 55..85% | the "pluck" of the note |
| amp env | attack 1ms, decay = min(duration, 300ms), sustain 0.55, release 60ms | sidechain-ready: fast release |
| voice cost | 1 | 4-voice budget cap |
| required behavior | zero retrigger clicks on 16th repeats; phase-continuous glide; no DC thump | click-free gate test mandatory |

### 2.2 lead (full-on squelch)

| Param | Value |
|---|---|
| osc A/B | saw x2, detune 6..12 cents, optional hard sync for hitech variants |
| glide | 0..120ms, legato-only mode |
| filter | LPF cutoff 1.5..3.5kHz, res 0.5..0.75 (audible squelch, no self-osc artifacts) |
| filter env | depth 40..70%, decay 200..500ms; optional LFO->cutoff (0.5..4Hz or 1/4..1/16 tempo-sync) |
| amp env | sustain 0.8, release 120ms |
| sends | delaySend 0.35..0.5 (dotted-8th convention), reverbSend 0.15 |
| energy macro | +20% cutoff, +15% res, +unison spread on drop |

### 2.3 arp (hi-tech engine)

| Param | Value |
|---|---|
| osc | square or saw, single osc (voice-cost sensitive) |
| amp env | attack 0.5ms, decay 60..120ms, sustain 0, release 30ms |
| filter env | short, depth 50%, tight tracking of velocity |
| per-step variance | seeded cutoff offset +-8% (deterministic) - the "alive" hi-tech feel |
| octave ornament | seeded, optional per patch (+12 on every 4th step etc.) |
| sends | delaySend 0.45 (stereo eighth or dotted-8th), reverbSend 0.1 |
| required behavior | zero voice-steal artifacts at 170-200 BPM 16ths (stress test) |

### 2.4 pad (breaks and intros)

| Param | Value |
|---|---|
| osc | saw x2 wide detune 10..18 cents + optional sine sub |
| amp env | attack 800..2500ms, release 1500..3000ms |
| filter | LPF 700..1200Hz, res low (0.1..0.2), slow LFO drift |
| sends | reverbSend 0.4..0.6, delaySend 0.1 |
| voice cost | 2 (dual-osc heavy) |
| required behavior | release tails never cut by new pad notes (steal policy must prefer oldest-released pads) |

### 2.5 stab (goa chords)

Single incoming note triggers internal chord intervals (patch-defined, e.g. [0,3,7] or [0,4,7,10]); one voice renders the chord as stacked oscs. Decay 200..400ms, optional band-pass flavor for classic goa color.

### 2.6 pluck (forest/organic)

Fast decay (80..150ms), optional ring-mod or osc-sync edge, lowpass with high env depth, minimal sends. Deterministic per-note brightness variance +-5%.

### 2.7 keys (break melodies)

Triangle + sine mix, soft attack 5..15ms, chorus via 3-6 cent detune, medium release. The "calm before the drop" voice.

## 3. Subgenre Preset Banks

A bank = { patch overrides + macro tuning } selected by onContext(style). All values are defaults per bank.

| Subgenre | Typical BPM | cutoff tendency | resonance | glide | delay convention | energy macro character |
|---|---|---|---|---|---|---|
| FULL-ON | 142-148 | bright (2.5k+) | 0.5-0.65 | lead 60ms | dotted 8th, fb 0.35 | punchy, wide leads |
| DARK-PSY | 155-165 | dark (900-1.6k) | 0.4-0.55 | bass 40ms | 8th, darker LP in loop | bass weight + drive |
| PROGRESSIVE | 136-140 | warm (1.2k-2k) | 0.3-0.45 | off | 16th ping, low fb | pluck layers, groove |
| GOA | 140-146 | mid, melodic | 0.45-0.6 | lead 80ms | dotted 8th + reverb | stabs + oriental scales |
| HI-TECH | 168-200 | very bright (3k+) | 0.55-0.7 | arp-driven | 16th delay wash | arp density + sync leads |
| FOREST | 140-150 | organic, mid-dark | 0.35-0.5 | light | sparse, ping | plucks + texture |

Bank selection is a host decision via MusicalContext.style; unknown style => FULL-ON defaults + counter.

## 4. FX Interaction Contract

The synth does NOT own delay/reverb/ducking. Conventions with the host:

1. Sidechain: host ducks the engine bus on kick (psy3-clean lineage). The device's bass amp envelope must have release <= 80ms so ducking reads as pumping, not fighting the tail.
2. Delay: host provides delaySend node (dotted 8th = 0.75 * 60/bpm). Device sends are level-only.
3. Reverb: host provides reverbSend node. Device sends per patch.
4. Drive/saturation: device-internal per-patch drive (osc->filter pre-drive 0..12dB) is allowed; bus mastering is not.
5. If host send nodes are absent, sends collapse silently into outputNode (no errors, counter increments).

## 5. Timing Feel Contract

- Grid: 16th resolution is the design grid (arp decay, bass gate math).
- Offbeat bass: arrives as events from host; device guarantees < 2ms jitter between event.at and audible onset.
- Swing: host-owned. Device renders event.at exactly; never applies its own swing.
- Live play (MIDI hold mode): no quantization in device; host decides.

## 6. Patch Schema (public/patches/manifest.json)

```json
{
  "manifestVersion": 1,
  "seed": 1,
  "patches": [
    {
      "id": "bass-acid-303-a",
      "role": "bass",
      "provenance": { "author": "psysynth", "license": "original", "created": "2026-08-14" },
      "osc": { "a": { "wave": "saw", "gain": 0.7 }, "b": { "wave": "square", "semitones": -12, "gain": 0.4 }, "sub": { "semitones": -12, "gain": 0.5 } },
      "glideMs": 40,
      "filter": { "type": "lp", "cutoff": 1400, "res": 0.35, "envDepth": 0.75, "envDecayMs": 180, "velTrack": 0.15 },
      "amp": { "attackMs": 1, "decayMs": 220, "sustain": 0.55, "releaseMs": 60 },
      "driveDb": 3,
      "sends": { "delay": 0.1, "reverb": 0.0 },
      "humanize": false
    }
  ]
}
```

Validation rules: role must be in canonical enum; cutoff 40..18000; res 0..0.95; envelopes >= 0.5ms; sends 0..1; provenance present (audit lineage: unified asset provenance, opportunity #10). Invalid patch => rejected at load with counter; never at runtime.

## 7. Style Acceptance Criteria (the sound test)

A build is psytrance-grade only if ALL pass (render-proof + listening panel):

1. Rolling bass 145 BPM: 16th notes at velocity 0.8/0.9 alternating - audible even groove, zero clicks, sub present on small speakers after HPF check.
2. Offbeat bass + kick pumping: with host duck, the classic "breathing" is heard; bass tail never masks kick transient.
3. Squelch lead at 145: resonance sweep clearly vocal on cutoff automation; no self-oscillation whistle.
4. Hi-tech arp at 175: 32 consecutive 16ths, zero steal artifacts, per-step brightness variance audible but deterministic (same seed => same render, bit-compared in OfflineAudioContext).
5. Goa stab: single note renders full chord, decays in < 450ms.
6. Pad in break: 2.5s attack does not starve lead voices (budget caps hold).
7. MIDI hold: held notes sustain indefinitely until note-off; 10 rapid on/off cycles leave zero zombie voices (pool state assertion).
8. Bank switch mid-song (section event): no clicks, no dropped notes, < 5ms switch cost.
