import { DB_FLOOR } from './fft.ts'
import type { AveragedSpectrum } from './fft.ts'
import { prepareSpectrum } from './spectrum.ts'
import type { SpectrumPlot } from './spectrum.ts'

export const RT_HOLD_MS = 500

interface DisplayClock {
  now(): number
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(id: number): void
}

// Read time starts after a complete transfer. Waiting never occupies the sender,
// so pause, mode changes and disposal do not have to wait out a display hold.
export class RealtimeDisplay {
  private range: Pick<SpectrumPlot, 'yMin' | 'yMax'> | undefined
  private nextAt = 0
  private timer: number | undefined
  private disposed = false
  private readonly onReady: () => void
  private readonly clock: DisplayClock

  constructor(onReady: () => void, clock?: DisplayClock) {
    this.onReady = onReady
    this.clock = clock ?? {
      now: () => performance.now(),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: id => window.clearTimeout(id),
    }
  }

  get canPresent(): boolean { return !this.disposed && this.clock.now() >= this.nextAt }

  prepare(spectrum: AveragedSpectrum): SpectrumPlot {
    const plot = prepareSpectrum(spectrum)
    if (this.range) return { ...plot, ...this.range }
    // Digital silence must not lock a 10 dB range around the display floor.
    if (!plot.dbValues.some(value => value > DB_FLOOR)) return { ...plot, yMin: DB_FLOOR, yMax: 100 }
    return plot
  }

  fitPausedUpper(plot: SpectrumPlot): SpectrumPlot {
    const maximum = Math.max(...plot.dbValues)
    // Silence has no meaningful peak to fit. Keep the last useful scale.
    if (maximum <= DB_FLOOR) return plot
    const span = maximum - plot.yMin
    const yMax = span > 1e-6 ? maximum + span * 0.1 : plot.yMin + 10
    this.range = { yMin: plot.yMin, yMax }
    return { ...plot, yMax }
  }

  presented(plot: SpectrumPlot) {
    if (this.disposed) return
    if (!this.range && plot.dbValues.some(value => value > DB_FLOOR)) {
      this.range = { yMin: plot.yMin, yMax: plot.yMax }
    }
    this.cancel()
    this.nextAt = this.clock.now() + RT_HOLD_MS
  }

  request() {
    if (this.disposed) return
    if (this.canPresent) {
      this.cancel()
      this.onReady()
    } else if (this.timer === undefined) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = undefined
        this.request()
      }, Math.max(0, this.nextAt - this.clock.now()))
    }
  }

  cancel() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }

  resetTiming() {
    this.cancel()
    this.nextAt = 0
  }

  dispose() {
    this.disposed = true
    this.cancel()
  }
}
