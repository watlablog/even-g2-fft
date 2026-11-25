import { FFT_SIZE } from './fft.ts'
import type { AveragedSpectrum } from './fft.ts'
import { SAMPLE_RATE } from './recording.ts'

export const RT_AVERAGE_FRAMES = 4
export const RT_AVERAGE_WINDOW_MS = RT_AVERAGE_FRAMES * FFT_SIZE / SAMPLE_RATE * 1000

// Retain only four frames of FFT power, never PCM or an ever-growing history.
export class RealtimeAverage {
  private frames: Array<{ index: number; power: Float64Array }> = []
  private format: Pick<AveragedSpectrum, 'sampleRate' | 'fftSize' | 'hopSize'> | undefined
  private lastIndex = -1

  clear() {
    this.frames = []
    this.format = undefined
    this.lastIndex = -1
  }

  push(spectrum: AveragedSpectrum, index: number): AveragedSpectrum {
    if (!Number.isSafeInteger(index) || index < 0 || index <= this.lastIndex) throw new Error('Invalid RT frame index')
    const { sampleRate, fftSize, hopSize, meanPower } = spectrum
    if (spectrum.frameCount !== 1 || !Number.isFinite(sampleRate) || sampleRate <= 0 ||
        fftSize !== FFT_SIZE || hopSize !== FFT_SIZE || meanPower.length !== fftSize / 2 + 1) {
      throw new Error('Invalid single-frame RT spectrum')
    }
    if (this.format && (sampleRate !== this.format.sampleRate || fftSize !== this.format.fftSize || hopSize !== this.format.hopSize)) {
      throw new Error('RT spectrum format changed')
    }
    for (const power of meanPower) {
      if (!Number.isFinite(power) || power < 0) throw new Error('Invalid RT spectrum power')
    }
    this.format = { sampleRate, fftSize, hopSize }
    this.lastIndex = index
    // Source indices advance even for skipped worker jobs. Old powers must
    // expire with input time instead of stretching the window after a stall.
    this.frames = this.frames.filter(frame => index - frame.index < RT_AVERAGE_FRAMES)
    this.frames.push({ index, power: meanPower.slice() })
    const averaged = new Float64Array(meanPower.length)
    for (const frame of this.frames) {
      for (let bin = 0; bin < averaged.length; bin++) averaged[bin] += frame.power[bin] / this.frames.length
    }
    return { sampleRate, fftSize, hopSize, frameCount: this.frames.length, meanPower: averaged }
  }
}
