import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeAverage, RT_AVERAGE_FRAMES, RT_AVERAGE_WINDOW_MS } from '../src/realtime-average.ts'
import { analyzeFrame, FFT_SIZE, REFERENCE_AMPLITUDE } from '../src/fft.ts'

function frame(power) {
  const meanPower = new Float64Array(FFT_SIZE / 2 + 1)
  meanPower[128] = power
  return { sampleRate: 16000, fftSize: FFT_SIZE, hopSize: FFT_SIZE, frameCount: 1, meanPower }
}

test('uses available startup frames, then keeps exactly the most recent four powers (512 ms)', () => {
  const average = new RealtimeAverage()
  assert.equal(RT_AVERAGE_FRAMES, 4)
  assert.equal(RT_AVERAGE_WINDOW_MS, 512)
  for (const [index, power, expected, count] of [[1, 1, 1, 1], [2, 3, 2, 2], [3, 5, 3, 3], [4, 7, 4, 4], [5, 9, 6, 4]]) {
    const result = average.push(frame(power), index)
    assert.equal(result.meanPower[128], expected)
    assert.equal(result.frameCount, count)
    assert.equal(result.hopSize, FFT_SIZE)
  }
})

test('averages linear RMS power, not dB or amplitude, and retains DC and Nyquist independently', () => {
  const average = new RealtimeAverage()
  const amplitudes = [1, .1, .5, 0]
  let result
  amplitudes.forEach((amplitude, index) => {
    const samples = Float32Array.from({ length: FFT_SIZE }, (_, n) => amplitude * Math.sin(2 * Math.PI * n / 16))
    const spectrum = analyzeFrame(samples)
    spectrum.meanPower[0] = index
    spectrum.meanPower[FFT_SIZE / 2] = index * 2
    result = average.push(spectrum, index + 1)
  })
  const expected = amplitudes.reduce((sum, amplitude) => sum + amplitude ** 2 / 2, 0) / 4
  assert.ok(Math.abs(result.meanPower[128] - expected) < 1e-8)
  const db = 10 * Math.log10(result.meanPower[128] / REFERENCE_AMPLITUDE ** 2)
  assert.ok(Math.abs(db - 10 * Math.log10(expected / REFERENCE_AMPLITUDE ** 2)) < 1e-6)
  assert.equal(result.meanPower[0], 1.5)
  assert.equal(result.meanPower[FFT_SIZE / 2], 3)
})

test('input-time gaps expire old powers instead of stretching the average across slow worker jobs', () => {
  const average = new RealtimeAverage()
  average.push(frame(1), 1)
  average.push(frame(3), 2)
  assert.equal(average.push(frame(5), 4).frameCount, 3)
  const later = average.push(frame(7), 5)
  assert.equal(later.frameCount, 3)
  assert.equal(later.meanPower[128], 5)
  const stalled = average.push(frame(100), 100)
  assert.equal(stalled.frameCount, 1)
  assert.equal(stalled.meanPower[128], 100)
})

test('clearing on pause or restart prevents stopped audio from entering resumed averages', () => {
  const average = new RealtimeAverage()
  for (let index = 1; index <= 4; index++) average.push(frame(100), index)
  average.clear()
  const resumed = average.push(frame(.01), 5)
  assert.equal(resumed.frameCount, 1)
  assert.equal(resumed.meanPower[128], .01)
  average.clear()
  assert.equal(average.push(frame(1), 1).frameCount, 1)
})

test('input and output mutation cannot alter saved frame powers; long runs keep a four-frame window', () => {
  const average = new RealtimeAverage()
  const input = frame(1)
  const first = average.push(input, 1)
  input.meanPower.fill(1000)
  first.meanPower.fill(2000)
  assert.equal(average.push(frame(3), 2).meanPower[128], 2)
  for (let index = 3; index <= 1000; index++) {
    const result = average.push(frame(index), index)
    assert.equal(result.frameCount, Math.min(index, 4))
    if (index >= 6) assert.equal(result.meanPower[128], index - 1.5)
  }
})

test('rejects non-monotonic frame indices, incompatible metadata and invalid powers', () => {
  const average = new RealtimeAverage()
  average.push(frame(1), 1)
  for (const index of [1, 0, 1.5, Infinity]) assert.throws(() => average.push(frame(1), index), /index/)
  assert.throws(() => average.push({ ...frame(1), frameCount: 2 }, 2), /single-frame/)
  assert.throws(() => average.push({ ...frame(1), sampleRate: 8000 }, 2), /format changed/)
  assert.throws(() => average.push(frame(-1), 2), /power/)
  assert.throws(() => average.push(frame(NaN), 2), /power/)
})
