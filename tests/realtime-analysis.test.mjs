import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeAnalysis } from '../src/realtime-analysis.ts'
import { analyzeFrame, FFT_SIZE } from '../src/fft.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))
function pcm(values) {
  const bytes = new Uint8Array(values.length * 2 + 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setInt16(2 + index * 2, value, true))
  return bytes.subarray(2, bytes.length - 2)
}
function fixture() {
  const jobs = [], results = [], errors = []
  const live = new RealtimeAnalysis(samples => new Promise((resolve, reject) => jobs.push({ samples, resolve, reject })),
    (spectrum, sequence) => results.push({ spectrum, sequence }), error => errors.push(error))
  live.resume()
  return { live, jobs, results, errors }
}

test('assembles exact non-overlapping frames across arbitrary PCM packets and byte offsets', async () => {
  const { live, jobs, results } = fixture()
  live.appendPcm(pcm(Array(1000).fill(-32768)))
  assert.equal(jobs.length, 0)
  live.appendPcm(pcm([...Array(1048).fill(32767), ...Array(30).fill(123)]))
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].samples.length, FFT_SIZE)
  assert.deepEqual([...jobs[0].samples.subarray(0, 1000)], Array(1000).fill(-1))
  assert.equal(jobs[0].samples[1000], 32767 / 32768)
  jobs[0].resolve('first'); await tick()
  live.appendPcm(pcm(Array(2018).fill(456)))
  assert.equal(jobs.length, 2)
  assert.equal(jobs[1].samples[0], 123 / 32768)
  assert.equal(jobs[1].samples[30], 456 / 32768)
  jobs[1].resolve('second'); await tick()
  assert.deepEqual(results.map(r => r.spectrum), ['first', 'second'])
  live.dispose()
})

test('slow analysis retains only the newest waiting frame instead of a growing queue', async () => {
  const { live, jobs, results } = fixture()
  live.appendPcm(pcm(Array(FFT_SIZE).fill(1)))
  for (let n = 2; n <= 100; n++) live.appendPcm(pcm(Array(FFT_SIZE).fill(n)))
  assert.equal(jobs.length, 1)
  assert.equal(live.completedFrames, 100)
  assert.equal(live.replacedFrames, 98)
  jobs[0].resolve('first'); await tick()
  assert.equal(jobs.length, 2)
  assert.ok(jobs[1].samples.every(sample => sample === 100 / 32768))
  jobs[1].resolve('latest'); await tick()
  assert.deepEqual(results.map(r => r.spectrum), ['first', 'latest'])
  assert.deepEqual(results.map(r => r.sequence), [1, 100])
  live.dispose()
})

test('pause rejects late results and PCM; resuming never combines samples across the pause', async () => {
  const { live, jobs, results, errors } = fixture()
  live.appendPcm(pcm(Array(FFT_SIZE + 300).fill(100)))
  live.pause()
  live.appendPcm(pcm(Array(FFT_SIZE).fill(200)))
  live.resume()
  live.appendPcm(pcm(Array(FFT_SIZE - 1).fill(300)))
  jobs[0].resolve('stale'); await tick()
  assert.equal(results.length, 0)
  assert.equal(jobs.length, 1)
  live.appendPcm(pcm([300])); assert.equal(jobs.length, 2)
  assert.ok(jobs[1].samples.every(sample => sample === 300 / 32768))
  jobs[1].resolve('fresh'); await tick()
  assert.deepEqual(results.map(r => r.spectrum), ['fresh'])
  assert.deepEqual(errors, [])
  live.dispose()
})

test('errors from an older generation and disposed jobs cannot update or fail a new session', async () => {
  const { live, jobs, results, errors } = fixture()
  live.appendPcm(pcm(Array(FFT_SIZE).fill(0)))
  live.pause(); live.resume()
  live.appendPcm(pcm(Array(FFT_SIZE).fill(1)))
  jobs[0].reject(new Error('old failure')); await tick()
  assert.equal(jobs.length, 2)
  assert.deepEqual(errors, [])
  live.dispose(); jobs[1].resolve('late'); await tick()
  live.resume(); live.appendPcm(pcm(Array(FFT_SIZE).fill(2)))
  assert.deepEqual(results, [])
  assert.equal(jobs.length, 2)
})

test('current errors reach the error handler; malformed accepted PCM is rejected', async () => {
  const { live, jobs, errors } = fixture()
  assert.throws(() => live.appendPcm(new Uint8Array(3)), /incomplete/)
  live.appendPcm(pcm(Array(FFT_SIZE).fill(0)))
  jobs[0].reject(new Error('worker failed')); await tick()
  assert.match(errors[0].message, /worker failed/)
  live.dispose()
})

test('successive RT frames are independent Hann-corrected spectra, without power averaging', async () => {
  const results = []
  const live = new RealtimeAnalysis(async samples => analyzeFrame(samples), result => results.push(result), assert.fail)
  live.resume()
  const tone = amplitude => pcm(Array.from({ length: FFT_SIZE }, (_, n) => Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * n / 16))))
  live.appendPcm(tone(1)); await tick()
  live.appendPcm(tone(.1)); await tick()
  assert.equal(results.length, 2)
  assert.equal(results[1].hopSize, FFT_SIZE)
  assert.equal(results[1].frameCount, 1)
  const difference = 10 * Math.log10(results[0].meanPower[128] / results[1].meanPower[128])
  assert.ok(Math.abs(difference - 20) < .01)
  live.dispose()
})
