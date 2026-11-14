import assert from 'node:assert/strict'
import test from 'node:test'
import { RecordingBuffer } from '../src/recording.ts'

function pcm(values) {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, i) => view.setInt16(i * 2, value, true))
  return bytes
}

test('decodes signed little-endian PCM including a nonzero byte offset', () => {
  const recording = new RecordingBuffer(10, 5)
  const bytes = new Uint8Array(10)
  bytes.set(pcm([-32768, -1, 0, 32767]), 2)
  recording.start()
  recording.appendPcm(bytes.subarray(2))
  assert.deepEqual([...recording.copyRecording()], [-1, -1 / 32768, 0, 32767 / 32768])
})

test('starts right-aligned, leaves unrecorded columns blank, and keeps both extrema', () => {
  const recording = new RecordingBuffer(10, 5)
  recording.start()
  recording.appendPcm(pcm([32767, -32768, 0, 0, 0, 0, 0, 0, 0, 16384]))
  const columns = recording.columns(5)
  assert.deepEqual([...columns.present], [0, 0, 0, 0, 1])
  assert.equal(columns.minimum[4], -1)
  assert.equal(columns.maximum[4], 32767 / 32768)
})

test('a loud interval moves left while the newest samples enter on the right', () => {
  const recording = new RecordingBuffer(10, 5)
  recording.start()
  recording.appendPcm(pcm(Array(10).fill(16384)))
  assert.equal(recording.columns(5).maximum[4], 0.5)
  recording.appendPcm(pcm(Array(20).fill(0)))
  const columns = recording.columns(5)
  assert.deepEqual([...columns.present], [0, 0, 1, 1, 1])
  assert.equal(columns.maximum[2], 0.5)
  assert.equal(columns.maximum[4], 0)
})

test('the display wraps at five seconds without discarding the full recording', () => {
  const recording = new RecordingBuffer(10, 5)
  recording.start()
  recording.appendPcm(pcm(Array(60).fill(-16384)))
  recording.appendPcm(pcm(Array(50).fill(8192)))
  assert.equal(recording.sampleCount, 110)
  assert.equal(recording.copyRecording().length, 110)
  assert.equal(recording.copyRecording()[0], -0.5)
  assert.deepEqual([...recording.columns(5).minimum], Array(5).fill(0.25))
})

test('stop closes the recording immediately and freezes the waveform against late PCM', () => {
  const recording = new RecordingBuffer(10, 5)
  recording.start()
  recording.appendPcm(pcm([8192, -8192]))
  const before = recording.columns(5)
  recording.stop()
  assert.equal(recording.appendPcm(pcm(Array(100).fill(32767))), false)
  assert.equal(recording.sampleCount, 2)
  assert.deepEqual(recording.columns(5), before)
  recording.start()
  assert.equal(recording.copyRecording().length, 0)
  assert.deepEqual([...recording.columns(5).present], [0, 0, 0, 0, 0])
})
