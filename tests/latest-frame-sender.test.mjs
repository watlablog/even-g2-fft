import assert from 'node:assert/strict'
import test from 'node:test'
import { LatestFrameSender } from '../src/latest-frame-sender.ts'

test('serializes transfers and replaces delayed frames with the latest source', async () => {
  let revision = 1
  let release
  let active = 0
  let maxActive = 0
  const sent = []
  const sender = new LatestFrameSender(async () => {
    active++
    maxActive = Math.max(maxActive, active)
    sent.push(revision)
    if (sent.length === 1) await new Promise(resolve => { release = resolve })
    active--
  }, error => { throw error })
  const finished = sender.request()
  await Promise.resolve()
  revision = 2
  sender.request()
  revision = 3
  sender.request()
  revision = 4 // A stop-time snapshot while the first transfer is still in flight.
  sender.request()
  release()
  await finished
  assert.deepEqual(sent, [1, 4])
  assert.equal(maxActive, 1)
})

test('reports transfer failures, can retry, and discards pending work on disposal', async () => {
  const errors = []
  let calls = 0
  const sender = new LatestFrameSender(async () => {
    if (++calls === 1) throw new Error('transfer failed')
  }, error => errors.push(error.message))
  await sender.request()
  await sender.request()
  assert.equal(calls, 2)
  assert.deepEqual(errors, ['transfer failed'])
  const pending = sender.request()
  sender.dispose()
  await pending
  await sender.request()
  assert.equal(calls, 2)
})

test('whenIdle waits for the in-flight transfer before a page can be rebuilt', async () => {
  let release
  const events = []
  const sender = new LatestFrameSender(async () => {
    events.push('old image started')
    await new Promise(resolve => { release = resolve })
    events.push('old image finished')
  }, error => { throw error })
  sender.request()
  await Promise.resolve()
  sender.request()
  sender.dispose() // Drop pending work, but wait for the already-started image.
  const switching = sender.whenIdle().then(() => events.push('page rebuilt'))
  await Promise.resolve()
  assert.deepEqual(events, ['old image started'])
  release()
  await switching
  assert.deepEqual(events, ['old image started', 'old image finished', 'page rebuilt'])
})
