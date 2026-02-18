export interface UnknownSpeaker {
  speakerLabel: string
  firstHeard: number
  lastHeard: number
  sentenceCount: number
  prompted: boolean
  dismissed: boolean
}

export class NewSpeakerDetector {
  private unknowns: Map<string, UnknownSpeaker> = new Map()
  private readonly SENTENCE_THRESHOLD = 2
  private readonly STALE_MS = 300_000

  ingestSpeech(speakerLabel: string, sentenceCount: number, knownLabels: Set<string>): void {
    if (!speakerLabel) return

    const now = Date.now()

    if (knownLabels.has(speakerLabel)) {
      this.unknowns.delete(speakerLabel)
      return
    }

    const existing = this.unknowns.get(speakerLabel)
    if (existing) {
      existing.lastHeard = now
      existing.sentenceCount += Math.max(0, sentenceCount)
    } else {
      this.unknowns.set(speakerLabel, {
        speakerLabel,
        firstHeard: now,
        lastHeard: now,
        sentenceCount: Math.max(0, sentenceCount),
        prompted: false,
        dismissed: false,
      })
    }

    this.cleanup()
  }

  markPrompted(speakerLabel: string): void {
    const speaker = this.unknowns.get(speakerLabel)
    if (speaker) {
      speaker.prompted = true
    }
  }

  dismissSpeaker(speakerLabel: string): void {
    const speaker = this.unknowns.get(speakerLabel)
    if (speaker) {
      speaker.dismissed = true
      speaker.prompted = true
      speaker.lastHeard = Date.now()
    }
  }

  getPendingPrompts(): UnknownSpeaker[] {
    return Array.from(this.unknowns.values())
      .filter(speaker => !speaker.prompted && !speaker.dismissed && speaker.sentenceCount >= this.SENTENCE_THRESHOLD)
      .sort((a, b) => a.firstHeard - b.firstHeard)
  }

  cleanup(): void {
    const now = Date.now()
    for (const [label, speaker] of this.unknowns.entries()) {
      if (now - speaker.lastHeard > this.STALE_MS) {
        this.unknowns.delete(label)
      }
    }
  }
}
