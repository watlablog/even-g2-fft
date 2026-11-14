import { DB_FLOOR, MAX_FREQUENCY, REFERENCE_AMPLITUDE } from './fft.ts'
import type { AveragedSpectrum } from './fft.ts'

export const SCREEN_WIDTH = 576
export const SCREEN_HEIGHT = 288
export const TILE_WIDTH = 288
export const TILE_HEIGHT = 144
const LEFT = 64
const RIGHT = 563
const TOP = 18
const BOTTOM = 243

export interface SpectrumPlot {
  binHz: number
  dbValues: Float64Array
  yMin: number
  yMax: number
}

export function prepareSpectrum(spectrum: AveragedSpectrum): SpectrumPlot {
  const binHz = spectrum.sampleRate / spectrum.fftSize
  const count = Math.min(Math.floor(MAX_FREQUENCY / binHz) + 1, spectrum.meanPower.length)
  const dbValues = new Float64Array(count)
  let minimum = Infinity
  let maximum = -Infinity
  for (let k = 0; k < count; k++) {
    const power = spectrum.meanPower[k]
    if (!Number.isFinite(power) || power < 0) throw new Error('Invalid spectrum power')
    const db = power > 0 ? 10 * Math.log10(power / (REFERENCE_AMPLITUDE ** 2)) : -Infinity
    dbValues[k] = Math.max(DB_FLOOR, db)
    if (db > DB_FLOOR) {
      minimum = Math.min(minimum, db)
      maximum = Math.max(maximum, db)
    }
  }
  if (minimum === Infinity) return { binHz, dbValues, yMin: DB_FLOOR, yMax: DB_FLOOR + 10 }
  if (maximum - minimum <= 1e-6) {
    const center = (minimum + maximum) / 2
    return { binHz, dbValues, yMin: center - 5, yMax: center + 5 }
  }
  const padding = (maximum - minimum) * 0.1
  return { binHz, dbValues, yMin: minimum - padding, yMax: maximum + padding }
}

export interface SpectrumTile {
  x: number
  y: number
  pixels: Uint8Array
}

export function splitSpectrumImage(gray: Uint8Array): SpectrumTile[] {
  if (gray.length !== SCREEN_WIDTH * SCREEN_HEIGHT) throw new Error('Invalid spectrum image size')
  const tiles: SpectrumTile[] = []
  for (let y = 0; y < SCREEN_HEIGHT; y += TILE_HEIGHT) {
    for (let x = 0; x < SCREEN_WIDTH; x += TILE_WIDTH) {
      const pixels = new Uint8Array(TILE_WIDTH * TILE_HEIGHT)
      for (let row = 0; row < TILE_HEIGHT; row++) {
        const start = (y + row) * SCREEN_WIDTH + x
        pixels.set(gray.subarray(start, start + TILE_WIDTH), row * TILE_WIDTH)
      }
      tiles.push({ x, y, pixels })
    }
  }
  return tiles
}

export function drawSpectrum(context: CanvasRenderingContext2D, plot: SpectrumPlot): SpectrumTile[] {
  context.fillStyle = '#000'
  context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
  context.font = '12px monospace'
  context.textBaseline = 'middle'
  const yOf = (db: number) => TOP + (plot.yMax - db) / (plot.yMax - plot.yMin) * (BOTTOM - TOP)
  for (let i = 0; i <= 4; i++) {
    const value = plot.yMin + (plot.yMax - plot.yMin) * i / 4
    const y = Math.round(yOf(value))
    context.fillStyle = '#333'
    context.fillRect(LEFT, y, RIGHT - LEFT + 1, 1)
    context.fillStyle = '#bbb'
    context.textAlign = 'right'
    context.fillText(String(Number(value.toFixed(1))), LEFT - 8, y)
  }
  for (let frequency = 0; frequency <= MAX_FREQUENCY; frequency += 500) {
    const x = Math.round(LEFT + frequency / MAX_FREQUENCY * (RIGHT - LEFT))
    context.fillStyle = '#333'
    context.fillRect(x, TOP, 1, BOTTOM - TOP + 1)
    context.fillStyle = '#bbb'
    context.textAlign = frequency === 0 ? 'left' : frequency === MAX_FREQUENCY ? 'right' : 'center'
    context.fillText(String(frequency), x, BOTTOM + 14)
  }
  context.fillStyle = '#999'
  context.fillRect(LEFT, TOP, RIGHT - LEFT + 1, 1)
  context.fillRect(LEFT, BOTTOM, RIGHT - LEFT + 1, 1)
  context.fillRect(LEFT, TOP, 1, BOTTOM - TOP + 1)
  context.fillRect(RIGHT, TOP, 1, BOTTOM - TOP + 1)
  context.textAlign = 'center'
  context.fillStyle = '#fff'
  context.fillText('Frequency[Hz]', (LEFT + RIGHT) / 2, 277)
  context.save()
  context.translate(10, (TOP + BOTTOM) / 2)
  context.rotate(-Math.PI / 2)
  context.fillText('Amplitude', 0, 0)
  context.restore()
  context.font = '10px monospace'
  context.textAlign = 'left'
  context.fillText('dB (ref 2e-5)', LEFT, 7)

  context.save()
  context.beginPath()
  context.rect(LEFT, TOP, RIGHT - LEFT + 1, BOTTOM - TOP + 1)
  context.clip()
  context.beginPath()
  for (let k = 0; k < plot.dbValues.length; k++) {
    const x = LEFT + k * plot.binHz / MAX_FREQUENCY * (RIGHT - LEFT)
    const y = yOf(plot.dbValues[k])
    if (k === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.lineWidth = 1
  context.strokeStyle = '#fff'
  context.stroke()
  context.restore()
  const rgba = context.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT).data
  const gray = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]
  return splitSpectrumImage(gray)
}
