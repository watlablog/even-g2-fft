import { SAMPLE_RATE } from './recording.ts'

export const FFT_SIZE = 2048
export const HOP_SIZE = 512
export const REFERENCE_AMPLITUDE = 2e-5
export const DB_FLOOR = -120
export const MAX_FREQUENCY = 3000

export class RecordingTooShortError extends Error {
  constructor() {
    super('Recording too short (minimum 128 ms). Tap to record again.')
    this.name = 'RecordingTooShortError'
  }
}

export interface AveragedSpectrum {
  sampleRate: number
  fftSize: number
  hopSize: number
  frameCount: number
  meanPower: Float64Array
}

const window = Float64Array.from({ length: FFT_SIZE }, (_, n) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * n / FFT_SIZE))
const windowSum = window.reduce((sum, value) => sum + value, 0)
const cos = Float64Array.from({ length: FFT_SIZE / 2 }, (_, n) => Math.cos(2 * Math.PI * n / FFT_SIZE))
const sin = Float64Array.from({ length: FFT_SIZE / 2 }, (_, n) => -Math.sin(2 * Math.PI * n / FFT_SIZE))
const reversed = Uint16Array.from({ length: FFT_SIZE }, (_, n) => {
  let result = 0
  for (let bits = FFT_SIZE; bits > 1; bits /= 2) {
    result = result * 2 + (n & 1)
    n >>>= 1
  }
  return result
})

// In-place radix-2 FFT; input is already in bit-reversed order.
function transform(real: Float64Array, imaginary: Float64Array) {
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2
    const step = FFT_SIZE / size
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let j = 0; j < half; j++) {
        const a = start + j
        const b = a + half
        const twiddle = j * step
        const r = real[b] * cos[twiddle] - imaginary[b] * sin[twiddle]
        const i = real[b] * sin[twiddle] + imaginary[b] * cos[twiddle]
        real[b] = real[a] - r
        imaginary[b] = imaginary[a] - i
        real[a] += r
        imaginary[a] += i
      }
    }
  }
}

export function analyzePcm(samples: Float32Array, sampleRate = SAMPLE_RATE): AveragedSpectrum {
  if (samples.length < FFT_SIZE) throw new RecordingTooShortError()
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate')
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('PCM contains a non-finite sample')
  }
  const frameCount = 1 + Math.floor((samples.length - FFT_SIZE) / HOP_SIZE)
  const meanPower = new Float64Array(FFT_SIZE / 2 + 1)
  const real = new Float64Array(FFT_SIZE)
  const imaginary = new Float64Array(FFT_SIZE)
  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * HOP_SIZE
    for (let n = 0; n < FFT_SIZE; n++) real[reversed[n]] = samples[offset + n] * window[n]
    imaginary.fill(0)
    transform(real, imaginary)
    for (let k = 0; k < meanPower.length; k++) {
      const oneSided = k === 0 || k === FFT_SIZE / 2 ? 1 : 2
      meanPower[k] += oneSided * (real[k] ** 2 + imaginary[k] ** 2) / (windowSum ** 2)
    }
  }
  for (let k = 0; k < meanPower.length; k++) meanPower[k] /= frameCount
  return { sampleRate, fftSize: FFT_SIZE, hopSize: HOP_SIZE, frameCount, meanPower }
}

// A single RT frame uses the same Hann and RMS normalization as recording analysis.
export function analyzeFrame(samples: Float32Array, sampleRate = SAMPLE_RATE): AveragedSpectrum {
  if (samples.length !== FFT_SIZE) throw new Error(`Expected exactly ${FFT_SIZE} samples`)
  return { ...analyzePcm(samples, sampleRate), hopSize: FFT_SIZE }
}

export interface AnalysisRequest {
  requestId: number
  kind: 'average' | 'single'
  session: number
  samples: Float32Array
  sampleRate: number
}

export type AnalysisResponse =
  | { session: number; requestId: number; ok: true; spectrum: AveragedSpectrum }
  | { session: number; requestId: number; ok: false; error: string }
