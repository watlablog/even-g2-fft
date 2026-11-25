import assert from 'node:assert/strict'
import test from 'node:test'
import { CursorMotion } from '../src/cursor-motion.ts'

function fixture() {
  let now = 0
  let id = 0
  let frames = 0
  const tasks = new Map()
  const motion = new CursorMotion(() => { frames++ }, {
    now: () => now,
    setTimeout(callback, delay) { tasks.set(++id, { callback, at: now + delay }); return id },
    clearTimeout(timer) { tasks.delete(timer) },
  })
  function advance(milliseconds) {
    const until = now + milliseconds
    while (true) {
      const next = [...tasks.entries()].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      tasks.delete(next[0])
      next[1].callback()
    }
    now = until
  }
  return { motion, advance, tasks, frames: () => frames, stall: milliseconds => { now += milliseconds } }
}

test('fine input moves immediately; marker changes back to a line at 600 ms', () => {
  const { motion, advance, tasks } = fixture()
  motion.setPosition(128)
  assert.deepEqual(motion.frame, { bin: 128, moving: false })
  motion.moveTo(129)
  assert.deepEqual(motion.frame, { bin: 129, moving: true })
  advance(599)
  assert.equal(motion.frame.moving, true)
  advance(1)
  assert.deepEqual(motion.frame, { bin: 129, moving: false })
  assert.equal(tasks.size, 0)
})

test('large movements interpolate integer bins over 250 ms without overshoot', () => {
  const { motion, advance } = fixture()
  motion.setPosition(0)
  motion.moveTo(64)
  assert.deepEqual(motion.frame, { bin: 0, moving: true })
  advance(100)
  assert.equal(motion.frame.bin, 26)
  advance(100)
  assert.equal(motion.frame.bin, 51)
  advance(50)
  assert.equal(motion.frame.bin, 64)
  advance(350)
  assert.deepEqual(motion.frame, { bin: 64, moving: false })
})

test('new input retargets the current transition, extends preview, and does not queue old targets', () => {
  const { motion, advance, tasks } = fixture()
  motion.setPosition(0)
  motion.moveTo(64)
  advance(100)
  motion.moveTo(128)
  assert.equal(motion.frame.bin, 26)
  assert.equal(tasks.size, 1)
  advance(250)
  assert.equal(motion.frame.bin, 128)
  advance(349)
  assert.equal(motion.frame.moving, true)
  advance(1)
  assert.deepEqual(motion.frame, { bin: 128, moving: false })
})

test('snap or reversal can reset to the shown bin, then move one bin without finishing the old target', () => {
  const { motion, advance, tasks } = fixture()
  motion.setPosition(128)
  motion.moveTo(192)
  advance(100)
  const shown = motion.frame.bin
  motion.setPosition(shown)
  motion.moveTo(shown - 1)
  assert.equal(motion.frame.bin, shown - 1)
  motion.setPosition(176)
  assert.deepEqual(motion.frame, { bin: 176, moving: false })
  assert.equal(tasks.size, 0)
  advance(1000)
  assert.equal(motion.frame.bin, 176)
})

test('clearing a result cancels all callbacks and a delayed frame catches up immediately', () => {
  const { motion, advance, frames, tasks, stall } = fixture()
  motion.setPosition(0)
  motion.moveTo(64)
  stall(1000)
  assert.deepEqual(motion.frame, { bin: 64, moving: false })
  motion.clear()
  const count = frames()
  advance(1000)
  assert.equal(frames(), count)
  assert.equal(motion.frame, undefined)
  assert.equal(tasks.size, 0)
})
