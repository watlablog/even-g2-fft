import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzePcm, FFT_SIZE, HOP_SIZE, REFERENCE_AMPLITUDE } from '../src/fft.ts'
import { RecordingBuffer } from '../src/recording.ts'

function sine(amplitude, length = FFT_SIZE * 4, frequency = 1000) {
  return Float32Array.from({ length }, (_, n) => amplitude * Math.sin(2 * Math.PI * frequency * n / 16000))
}

function near(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)
}

for (const amplitude of [0.5, 1]) {
  test(`Hann-corrected 1 kHz spectrum matches RMS theory for peak amplitude ${amplitude}`, () => {
    const spectrum = analyzePcm(sine(amplitude))
    const peak = spectrum.meanPower.indexOf(Math.max(...spectrum.meanPower))
    assert.equal(peak, 128)
    assert.equal(peak * spectrum.sampleRate / spectrum.fftSize, 1000)
    near(spectrum.meanPower[peak], amplitude ** 2 / 2)
    const db = 10 * Math.log10(spectrum.meanPower[peak] / REFERENCE_AMPLITUDE ** 2)
    near(db, 20 * Math.log10(amplitude / Math.sqrt(2) / REFERENCE_AMPLITUDE), 1e-6)
  })
}

test('overlapped frame powers match an independent direct DFT, not mean amplitude squared', () => {
  const samples = Float32Array.from({ length: FFT_SIZE + HOP_SIZE * 4 + 117 }, (_, n) =>
    (0.1 + 0.8 * n / 4096) * Math.sin(2 * Math.PI * 1000 * n / 16000) + 0.05)
  const spectrum = analyzePcm(samples)
  assert.equal(spectrum.frameCount, 5)
  for (const k of [0, 1, 128, 384, 1024]) {
    const powers = []
    for (let frame = 0; frame < spectrum.frameCount; frame++) {
      let real = 0
      let imaginary = 0
      let sumWindow = 0
      for (let n = 0; n < FFT_SIZE; n++) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / FFT_SIZE)
        const value = samples[frame * HOP_SIZE + n] * window
        real += value * Math.cos(2 * Math.PI * k * n / FFT_SIZE)
        imaginary -= value * Math.sin(2 * Math.PI * k * n / FFT_SIZE)
        sumWindow += window
      }
      powers.push((k === 0 || k === 1024 ? 1 : 2) * (real ** 2 + imaginary ** 2) / sumWindow ** 2)
    }
    const expected = powers.reduce((sum, value) => sum + value, 0) / powers.length
    near(spectrum.meanPower[k], expected, 1e-11)
    if (k === 128) {
      const amplitudeAverageSquared = (powers.reduce((sum, value) => sum + Math.sqrt(value), 0) / powers.length) ** 2
      assert.ok(spectrum.meanPower[k] - amplitudeAverageSquared > 0.001)
    }
  }
})

test('DC and Nyquist use their own one-sided power scaling without detrending', () => {
  near(analyzePcm(new Float32Array(FFT_SIZE).fill(0.5)).meanPower[0], 0.25)
  near(analyzePcm(Float32Array.from({ length: FFT_SIZE }, (_, n) => n % 2 ? -0.5 : 0.5)).meanPower[1024], 0.25)
})

test('uses only complete frames and rejects recordings shorter than 128 ms', () => {
  assert.throws(() => analyzePcm(new Float32Array(2047)), /too short/)
  for (const [length, frames] of [[2048, 1], [2559, 1], [2560, 2], [3071, 2], [3072, 3]]) {
    assert.equal(analyzePcm(sine(0.5, length)).frameCount, frames)
  }
  const samples = sine(0.5, 3072)
  const withTail = new Float32Array(samples.length + 511).fill(1)
  withTail.set(samples)
  assert.deepEqual(analyzePcm(withTail).meanPower, analyzePcm(samples).meanPower)
})

test('uses the full recording even when the last five seconds are silent', () => {
  const recording = new RecordingBuffer()
  recording.start()
  const samples = new Int16Array(16000 * 8)
  for (let n = 0; n < 16000 * 2; n++) samples[n] = Math.round(16384 * Math.sin(2 * Math.PI * 1000 * n / 16000))
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((value, n) => view.setInt16(n * 2, value, true))
  recording.appendPcm(bytes)
  recording.stop()
  assert.equal(recording.copyRecording().length, 128000)
  assert.ok([...recording.columns(252).maximum].every(value => value === 0))
  assert.ok(analyzePcm(recording.copyRecording()).meanPower[128] > 0.01)
})

test('rejects invalid samples and sample rates instead of producing NaN spectra', () => {
  const samples = sine(0.5)
  samples[3] = NaN
  assert.throws(() => analyzePcm(samples), /non-finite/)
  assert.throws(() => analyzePcm(sine(0.5), 0), /sample rate/)
})

test('single-frame analysis uses the same RMS theory, reports no overlap, and rejects other lengths', async () => {
  const { analyzeFrame } = await import('../src/fft.ts')
  const frame = analyzeFrame(sine(1, FFT_SIZE))
  assert.equal(frame.frameCount, 1)
  assert.equal(frame.hopSize, FFT_SIZE)
  near(frame.meanPower[128], .5)
  assert.deepEqual(frame.meanPower, analyzePcm(sine(1, FFT_SIZE)).meanPower)
  assert.throws(() => analyzeFrame(sine(1, FFT_SIZE - 1)), /exactly/)
  assert.throws(() => analyzeFrame(sine(1, FFT_SIZE * 2)), /exactly/)
})
