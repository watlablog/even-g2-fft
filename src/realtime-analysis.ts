import { FFT_SIZE } from './fft.ts'
import type { AveragedSpectrum } from './fft.ts'

// One assembly buffer, one running job, one replaceable waiting frame. No history.
export class RealtimeAnalysis {
  private assembly = new Float32Array(FFT_SIZE)
  private filled = 0
  private pending: { samples: Float32Array; index: number } | undefined
  private running = false
  private accepting = false
  private generation = 0
  private disposed = false
  completedFrames = 0
  replacedFrames = 0

  private readonly analyze: (samples: Float32Array) => Promise<AveragedSpectrum>
  private readonly onResult: (spectrum: AveragedSpectrum, sequence: number) => void
  private readonly onError: (error: unknown) => void

  constructor(
    analyze: (samples: Float32Array) => Promise<AveragedSpectrum>,
    onResult: (spectrum: AveragedSpectrum, sequence: number) => void,
    onError: (error: unknown) => void,
  ) {
    this.analyze = analyze
    this.onResult = onResult
    this.onError = onError
  }

  resume() {
    if (this.disposed) return
    this.pause()
    this.accepting = true
  }

  pause() {
    this.accepting = false
    this.generation++
    this.filled = 0
    this.pending = undefined
  }

  appendPcm(pcm: Uint8Array) {
    if (!this.accepting || this.disposed) return
    if (pcm.byteLength % 2 !== 0) throw new Error('PCM frame contains an incomplete 16-bit sample')
    const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    for (let index = 0; index < pcm.byteLength; index += 2) {
      this.assembly[this.filled++] = data.getInt16(index, true) / 32768
      if (this.filled === FFT_SIZE) {
        if (this.pending) this.replacedFrames++
        this.completedFrames++
        this.pending = { samples: this.assembly, index: this.completedFrames }
        this.assembly = new Float32Array(FFT_SIZE)
        this.filled = 0
      }
    }
    this.pump()
  }

  dispose() {
    this.pause()
    this.disposed = true
  }

  private pump() {
    if (this.running || !this.accepting || !this.pending || this.disposed) return
    const { samples, index: sequence } = this.pending
    this.pending = undefined
    const generation = this.generation
    this.running = true
    void this.analyze(samples).then(spectrum => {
      if (!this.disposed && this.accepting && generation === this.generation) this.onResult(spectrum, sequence)
    }).catch(error => {
      if (!this.disposed && this.accepting && generation === this.generation) this.onError(error)
    }).finally(() => {
      this.running = false
      this.pump()
    })
  }
}
