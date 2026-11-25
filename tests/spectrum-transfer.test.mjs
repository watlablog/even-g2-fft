import assert from 'node:assert/strict'
import test from 'node:test'
import { SpectrumTransfer } from '../src/spectrum-transfer.ts'

const frame = () => Array.from({ length: 4 }, (_, index) => ({
  x: index % 2 * 288, y: Math.floor(index / 2) * 144, pixels: new Uint8Array([index, 0]),
}))

test('first frame sends four tiles; unchanged and marker-only frames send zero or one', async () => {
  const sent = []
  const transfer = new SpectrumTransfer(async index => { sent.push(index) })
  assert.deepEqual(await transfer.send(frame()), { complete: true, sentTiles: 4 })
  assert.deepEqual(sent, [0, 1, 2, 3])
  sent.length = 0
  assert.deepEqual(await transfer.send(frame()), { complete: true, sentTiles: 0 })
  const moved = frame()
  moved[2].pixels[1] = 1
  assert.deepEqual(await transfer.send(moved), { complete: true, sentTiles: 1 })
  assert.deepEqual(sent, [2])
  moved[2].pixels[1] = 2 // Reusing a caller-owned buffer must not corrupt the cache.
  await transfer.send(moved)
  assert.deepEqual(sent, [2, 2])
})

test('tile sends stay sequential and a move across the split sends both changed tiles', async () => {
  let release
  const sent = []
  const transfer = new SpectrumTransfer(async index => {
    sent.push(index)
    if (index === 0) await new Promise(resolve => { release = resolve })
  })
  const initial = transfer.send(frame())
  assert.deepEqual(sent, [0])
  release()
  await initial
  sent.length = 0
  const moved = frame()
  moved[2].pixels[1] = 2
  moved[3].pixels[1] = 3
  assert.deepEqual(await transfer.send(moved), { complete: true, sentTiles: 2 })
  assert.deepEqual(sent, [2, 3])
})

test('an overlay interrupts new tile sends and resumes only the remaining tiles', async () => {
  let active = true
  const sent = []
  const transfer = new SpectrumTransfer(async index => { sent.push(index); if (index === 0) active = false })
  assert.deepEqual(await transfer.send(frame(), () => active), { complete: false, sentTiles: 1 })
  active = true
  assert.deepEqual(await transfer.send(frame(), () => active), { complete: true, sentTiles: 3 })
  assert.deepEqual(sent, [0, 1, 2, 3])
})

test('failed sends are not cached and the next frame retries the failed tile', async () => {
  let fail = true
  const sent = []
  const transfer = new SpectrumTransfer(async index => {
    sent.push(index)
    if (index === 1 && fail) throw new Error('send failed')
  })
  await assert.rejects(transfer.send(frame()), /send failed/)
  fail = false
  assert.deepEqual(await transfer.send(frame()), { complete: true, sentTiles: 3 })
  assert.deepEqual(sent, [0, 1, 1, 2, 3])
})

test('page rebuild or overlay invalidation also discards an in-flight cache update', async () => {
  let release
  let block = true
  const sent = []
  const transfer = new SpectrumTransfer(async index => {
    sent.push(index)
    if (block) { block = false; await new Promise(resolve => { release = resolve }) }
  })
  const pending = transfer.send(frame())
  transfer.invalidate()
  release()
  assert.deepEqual(await pending, { complete: false, sentTiles: 1 })
  assert.deepEqual(await transfer.send(frame()), { complete: true, sentTiles: 4 })
  assert.deepEqual(sent, [0, 0, 1, 2, 3])
})

test('freezing an interrupted live frame restores only acknowledged changed tiles, and a held frame needs no image resend', async () => {
  let active = true
  let interrupt = false
  const sent = []
  const transfer = new SpectrumTransfer(async index => {
    sent.push(index)
    if (interrupt) active = false
  })
  const committed = frame()
  await transfer.send(committed)
  sent.length = 0
  assert.deepEqual(await transfer.send(committed), { complete: true, sentTiles: 0 })
  const next = frame()
  next.forEach(tile => { tile.pixels[1] = 10 })
  interrupt = true
  assert.deepEqual(await transfer.send(next, () => active), { complete: false, sentTiles: 1 })
  interrupt = false; active = true
  assert.deepEqual(await transfer.send(committed), { complete: true, sentTiles: 1 })
  assert.deepEqual(sent, [0, 0])
  assert.deepEqual(await transfer.send(committed), { complete: true, sentTiles: 0 })
})
