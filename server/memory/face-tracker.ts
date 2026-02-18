export interface UnknownFace {
  faceHash: string
  firstSeen: number
  lastSeen: number
  frameCount: number
  dismissed: boolean
  dismissedAt?: number
  prompted: boolean
}

export class FacePersistenceTracker {
  private unknowns: Map<string, UnknownFace> = new Map()

  private readonly PERSIST_THRESHOLD_MS = 10_000
  private readonly DISMISS_COOLDOWN_MS = 300_000
  private readonly FACE_MATCH_DISTANCE = 10

  ingestFaces(faceHashes: string[]): UnknownFace[] {
    const now = Date.now()

    for (const faceHash of faceHashes) {
      const existing = this.findMatchingFace(faceHash)
      if (existing) {
        existing.lastSeen = now
        existing.frameCount += 1
        continue
      }

      if (this.isDismissed(faceHash)) {
        continue
      }

      this.unknowns.set(faceHash, {
        faceHash,
        firstSeen: now,
        lastSeen: now,
        frameCount: 1,
        dismissed: false,
        prompted: false,
      })
    }

    this.cleanup()
    return this.getPendingPrompts()
  }

  markPrompted(faceHash: string): void {
    const face = this.findMatchingFace(faceHash)
    if (face) {
      face.prompted = true
    }
  }

  dismissFace(faceHash: string): void {
    const now = Date.now()
    const face = this.findMatchingFace(faceHash)
    if (face) {
      face.dismissed = true
      face.dismissedAt = now
      face.prompted = true
      face.lastSeen = now
      return
    }

    this.unknowns.set(faceHash, {
      faceHash,
      firstSeen: now,
      lastSeen: now,
      frameCount: 1,
      dismissed: true,
      dismissedAt: now,
      prompted: true,
    })
  }

  isDismissed(faceHash: string): boolean {
    const now = Date.now()
    for (const face of this.unknowns.values()) {
      if (!face.dismissed || !face.dismissedAt) continue
      if (now - face.dismissedAt > this.DISMISS_COOLDOWN_MS) continue
      if (this.hammingDistance(faceHash, face.faceHash) < this.FACE_MATCH_DISTANCE) {
        return true
      }
    }
    return false
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, face] of this.unknowns.entries()) {
      if (now - face.lastSeen > this.DISMISS_COOLDOWN_MS) {
        this.unknowns.delete(key)
      }
    }
  }

  getPendingPrompts(): UnknownFace[] {
    const now = Date.now()
    const pending: UnknownFace[] = []

    for (const face of this.unknowns.values()) {
      if (face.prompted || face.dismissed) continue
      if (now - face.firstSeen >= this.PERSIST_THRESHOLD_MS) {
        pending.push(face)
      }
    }

    return pending.sort((a, b) => a.firstSeen - b.firstSeen)
  }

  private findMatchingFace(faceHash: string): UnknownFace | null {
    for (const face of this.unknowns.values()) {
      if (this.hammingDistance(faceHash, face.faceHash) < this.FACE_MATCH_DISTANCE) {
        return face
      }
    }
    return null
  }

  private hammingDistance(hash1: string, hash2: string): number {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64

    let distance = 0
    for (let i = 0; i < hash1.length; i++) {
      const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16)
      let bits = xor
      while (bits) {
        distance += bits & 1
        bits >>= 1
      }
    }
    return distance
  }
}
