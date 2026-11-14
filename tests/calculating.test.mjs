import assert from 'node:assert/strict'
import test from 'node:test'
import { CalculatingIndicator } from '../src/calculating.ts'

test('shows immediately and toggles every 500 ms until stopped, without an artificial minimum duration', () => {
  let now = 0
  let callback
  let cleared = false
  const changes = []
  const indicator = new CalculatingIndicator(visible => changes.push([now, visible]), {
    setInterval(fn, delay) { assert.equal(delay, 500); callback = fn; return 0 },
    clearInterval(id) { assert.equal(id, 0); cleared = true },
  })
  indicator.start()
  indicator.start()
  now = 500
  callback()
  now = 1000
  callback()
  now = 1100
  indicator.stop()
  indicator.stop()
  assert.equal(cleared, true)
  assert.deepEqual(changes, [[0, true], [500, false], [1000, true], [1100, false]])

  now = 2000
  indicator.start()
  now = 2001
  indicator.stop()
  assert.deepEqual(changes.slice(-2), [[2000, true], [2001, false]])
})
