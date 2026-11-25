import assert from 'node:assert/strict'
import test from 'node:test'
import { REFERENCE_AMPLITUDE } from '../src/fft.ts'
import { nearestSpectrumPeak, prepareSpectrum, splitSpectrumImage, SCREEN_WIDTH, SCREEN_HEIGHT } from '../src/spectrum.ts'

function spectrum(values) {
  const meanPower = new Float64Array(1025)
  values.forEach((db, k) => { meanPower[k] = REFERENCE_AMPLITUDE ** 2 * 10 ** (db / 10) })
  return { sampleRate: 16000, fftSize: 2048, hopSize: 512, frameCount: 1, meanPower }
}

function plotWithValues(values) {
  return { binHz: 7.8125, dbValues: Float64Array.from(values), yMin: -120, yMax: 100 }
}

test('nearest peak follows frequency distance instead of the global maximum', () => {
  const plot = plotWithValues([-120, 60, -120, -120, -120, 20, -120, -120, 30, -120])
  assert.equal(nearestSpectrumPeak(plot, 4), 5)
  assert.equal(nearestSpectrumPeak(plot, 7), 8)
  assert.equal(nearestSpectrumPeak(plot, 1), 1)
  assert.equal(nearestSpectrumPeak(plot, 0), 1)
  assert.equal(nearestSpectrumPeak(plot, 9), 8)
})

test('small ripples on a large mountain are skipped in favour of its prominent summit', () => {
  const plot = plotWithValues([-40, -35, -30, -29, -30, -20, -10, 0, -5, -4, -5, -20, -30])
  assert.equal(nearestSpectrumPeak(plot, 3), 7)
  assert.equal(nearestSpectrumPeak(plot, 9), 7)
})

test('prominence accepts exactly 6 dB, rejects smaller relief and does not require a loud absolute level', () => {
  assert.equal(nearestSpectrumPeak(plotWithValues([-20, -14.01, -20, -20, -14, -20]), 1), 4)
  assert.equal(nearestSpectrumPeak(plotWithValues([-60, -53, -60]), 0), 1)
  assert.equal(nearestSpectrumPeak(plotWithValues([-20, -19, -20]), 0), 0)
})

test('the higher valley determines prominence rather than the deepest valley on either side', () => {
  assert.equal(nearestSpectrumPeak(plotWithValues([-40, -20, -25, -10, -40]), 1), 3)
})

test('equal-height summits do not block the prominence search', () => {
  const plot = plotWithValues([-40, -10, -13, -10, -40])
  assert.equal(nearestSpectrumPeak(plot, 0), 1)
  assert.equal(nearestSpectrumPeak(plot, 4), 3)
})

test('equidistant peaks prefer greater amplitude, then lower frequency', () => {
  assert.equal(nearestSpectrumPeak(plotWithValues([-120, 20, -120, -120, -120, 30, -120]), 3), 5)
  assert.equal(nearestSpectrumPeak(plotWithValues([-120, 30, -120, -120, -120, 30, -120]), 3), 1)
})

test('flat-topped peaks snap to their middle bin, rounding down for an even plateau', () => {
  assert.equal(nearestSpectrumPeak(plotWithValues([-120, 20, 20, 20, -120]), 3), 2)
  assert.equal(nearestSpectrumPeak(plotWithValues([-120, 20, 20, -120]), 2), 1)
})

test('silence, flat spectra and slopes keep the cursor; clipped band edges are not peaks', () => {
  for (const values of [[-120, -120, -120], [20, 20, 20], [-30, -20, -10], [-10, -20, -30], [20, 20, -120], [-120, 20, 20]]) {
    assert.equal(nearestSpectrumPeak(plotWithValues(values), 1), 1)
  }
  assert.equal(nearestSpectrumPeak(plotWithValues([-130, -120, -130]), 0), 0)
  assert.equal(nearestSpectrumPeak(plotWithValues([100, -120, 20, -120, 100]), 0), 2)
  assert.equal(nearestSpectrumPeak(plotWithValues([100, -120, 20, -120, 100]), 4), 2)
})

test('peak snapping stays inside the displayed band without changing the spectrum', () => {
  const input = spectrum([-120, 20, -120])
  input.meanPower[385] = 1e10
  const plot = prepareSpectrum(input)
  const before = [...plot.dbValues]
  assert.equal(nearestSpectrumPeak(plot, 384), 1)
  assert.deepEqual([...plot.dbValues], before)
  assert.throws(() => nearestSpectrumPeak(plot, -1), /Invalid cursor bin/)
  assert.throws(() => nearestSpectrumPeak(plot, 385), /Invalid cursor bin/)
})

test('excludes floored values from autoscaling and adds 10% of the dB span on both sides', () => {
  const plot = prepareSpectrum(spectrum([-130, -120, -100, -40]))
  assert.deepEqual([...plot.dbValues.slice(0, 4)], [-120, -120, -100, -40])
  assert.equal(plot.yMin, -106)
  assert.equal(plot.yMax, -34)
  assert.equal(plot.dbValues.length, 385)
  assert.equal(plot.binHz * 384, 3000)
})

test('out-of-band power does not affect the 0–3000 Hz plot or autoscale', () => {
  const input = spectrum([-20, 20])
  input.meanPower[384] = REFERENCE_AMPLITUDE ** 2 * 10 ** (40 / 10)
  input.meanPower[385] = 1e10
  const plot = prepareSpectrum(input)
  assert.equal(plot.dbValues.at(-1), 40)
  assert.equal(plot.yMin, -26)
  assert.equal(plot.yMax, 46)
})

test('silence and constant levels have finite nonzero display ranges', () => {
  const silent = prepareSpectrum(spectrum([]))
  assert.equal(silent.yMin, -120)
  assert.equal(silent.yMax, -110)
  assert.ok([...silent.dbValues].every(value => value === -120))
  const constant = prepareSpectrum(spectrum([-60, -60]))
  assert.equal(constant.yMin, -65)
  assert.equal(constant.yMax, -55)
})

test('rejects invalid power', () => {
  const input = spectrum([])
  input.meanPower[1] = NaN
  assert.throws(() => prepareSpectrum(input), /Invalid/)
})

test('four 288×144 tiles reconstruct the complete image without seam gaps or overlaps', () => {
  const gray = Uint8Array.from({ length: SCREEN_WIDTH * SCREEN_HEIGHT }, (_, n) =>
    (Math.floor(n / SCREEN_WIDTH) * 7 + (n % SCREEN_WIDTH) * 3) % 256)
  const tiles = splitSpectrumImage(gray)
  assert.deepEqual(tiles.map(tile => [tile.x, tile.y]), [[0, 0], [288, 0], [0, 144], [288, 144]])
  const reconstructed = new Uint8Array(gray.length)
  for (const tile of tiles) {
    assert.equal(tile.pixels.length, 288 * 144)
    for (let row = 0; row < 144; row++) {
      reconstructed.set(tile.pixels.subarray(row * 288, (row + 1) * 288), (tile.y + row) * 576 + tile.x)
    }
  }
  assert.deepEqual(reconstructed, gray)
})

test('Peak ranking includes small ripples, orders by amplitude then frequency, and caps at ten', async () => {
  const { rankedSpectrumPeaks } = await import('../src/spectrum.ts')
  const plot = plotWithValues([-40, -10, -11, -10.5, -40, -10, -40])
  assert.deepEqual(rankedSpectrumPeaks(plot), [1, 5, 3])
  const many = plotWithValues([-120, ...Array.from({ length: 15 }, (_, n) => [n, -120]).flat()])
  assert.deepEqual(rankedSpectrumPeaks(many), [29, 27, 25, 23, 21, 19, 17, 15, 13, 11])
})

test('Peak ranking handles flat tops, silence, floor, slopes and clipped band edges', async () => {
  const { rankedSpectrumPeaks } = await import('../src/spectrum.ts')
  assert.deepEqual(rankedSpectrumPeaks(plotWithValues([100, -120, 20, 20, -120, 30, 30, 30, -120, 100])), [6, 2])
  for (const values of [[-120, -120, -120], [5, 5, 5], [0, 1, 2], [2, 1, 0]]) {
    assert.deepEqual(rankedSpectrumPeaks(plotWithValues(values)), [])
  }
})
