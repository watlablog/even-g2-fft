export const SAMPLE_RATE = 16_000
export const WINDOW_SECONDS = 5

export interface ColumnEnvelope {
  minimum: Float32Array
  maximum: Float32Array
  present: Uint8Array
}

export class RecordingBuffer {
  readonly sampleRate: number
  readonly windowSeconds: number
  private readonly ring: Float32Array
  private chunks: Float32Array[] = []
  private accepting = false
  sampleCount = 0
  packetCount = 0

  constructor(
    sampleRate = SAMPLE_RATE,
    windowSeconds = WINDOW_SECONDS,
  ) {
    this.sampleRate = sampleRate
    this.windowSeconds = windowSeconds
    this.ring = new Float32Array(sampleRate * windowSeconds)
  }

  start() {
    this.ring.fill(0)
    this.chunks = []
    this.sampleCount = 0
    this.packetCount = 0
    this.accepting = true
  }

  stop() {
    this.accepting = false
  }

  appendPcm(pcm: Uint8Array): boolean {
    if (!this.accepting) return false
    if (pcm.byteLength % 2 !== 0) throw new Error('PCM frame contains an incomplete 16-bit sample')
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const samples = new Float32Array(pcm.byteLength / 2)
    for (let i = 0; i < samples.length; i++) {
      const value = view.getInt16(i * 2, true) / 32768
      samples[i] = value
      this.ring[(this.sampleCount + i) % this.ring.length] = value
    }
    // Preserve the entire recording for the later FFT, independently of the ring.
    this.chunks.push(samples)
    this.sampleCount += samples.length
    this.packetCount += 1
    return true
  }

  copyRecording(): Float32Array {
    const samples = new Float32Array(this.sampleCount)
    let offset = 0
    for (const chunk of this.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    return samples
  }

  columns(width: number): ColumnEnvelope {
    const minimum = new Float32Array(width)
    const maximum = new Float32Array(width)
    const present = new Uint8Array(width)
    const windowStart = this.sampleCount - this.ring.length
    for (let x = 0; x < width; x++) {
      const start = Math.max(0, windowStart + Math.floor(x * this.ring.length / width))
      const end = windowStart + Math.floor((x + 1) * this.ring.length / width)
      if (start >= end) continue // Unrecorded time stays blank, not zero-filled.
      let low = Infinity
      let high = -Infinity
      for (let i = start; i < end; i++) {
        const sample = this.ring[i % this.ring.length]
        low = Math.min(low, sample)
        high = Math.max(high, sample)
      }
      minimum[x] = low
      maximum[x] = high
      present[x] = 1
    }
    return { minimum, maximum, present }
  }
}
