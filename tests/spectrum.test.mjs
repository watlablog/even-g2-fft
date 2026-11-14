import assert from 'node:assert/strict'
import test from 'node:test'
import { REFERENCE_AMPLITUDE } from '../src/fft.ts'
import { prepareSpectrum, splitSpectrumImage, SCREEN_WIDTH, SCREEN_HEIGHT } from '../src/spectrum.ts'

function spectrum(values) {
  const meanPower = new Float64Array(1025)
  values.forEach((db, k) => { meanPower[k] = REFERENCE_AMPLITUDE ** 2 * 10 ** (db / 10) })
  return { sampleRate: 16000, fftSize: 2048, hopSize: 512, frameCount: 1, meanPower }
}

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
