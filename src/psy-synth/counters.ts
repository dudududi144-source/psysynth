// Observability counters. Main-thread read only; incremented from the event
// path with plain integer math (no allocation, no logging in audio path).

export interface DropReasons {
  [reason: string]: number
}

export class Counters {
  eventsReceived = 0
  eventsDropped = 0
  voicesOn = 0
  voicesStolen = 0
  unknownChannel = 0
  staleDrop = 0
  invalidEvent = 0
  patchLoadErrors = 0
  readonly dropReasons: DropReasons = {}

  noteDrop(reason: string): void {
    this.eventsDropped += 1
    this.dropReasons[reason] = (this.dropReasons[reason] ?? 0) + 1
  }

  snapshot(): {
    eventsReceived: number
    eventsDropped: number
    dropReasons: DropReasons
    voicesOn: number
    voicesStolen: number
    unknownChannel: number
    staleDrop: number
    invalidEvent: number
    patchLoadErrors: number
  } {
    return {
      eventsReceived: this.eventsReceived,
      eventsDropped: this.eventsDropped,
      dropReasons: { ...this.dropReasons },
      voicesOn: this.voicesOn,
      voicesStolen: this.voicesStolen,
      unknownChannel: this.unknownChannel,
      staleDrop: this.staleDrop,
      invalidEvent: this.invalidEvent,
      patchLoadErrors: this.patchLoadErrors,
    }
  }

  reset(): void {
    this.eventsReceived = 0
    this.eventsDropped = 0
    this.voicesOn = 0
    this.voicesStolen = 0
    this.unknownChannel = 0
    this.staleDrop = 0
    this.invalidEvent = 0
    this.patchLoadErrors = 0
    for (const k of Object.keys(this.dropReasons)) delete this.dropReasons[k]
  }
}
