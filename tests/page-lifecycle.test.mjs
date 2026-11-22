import assert from 'node:assert/strict'
import test from 'node:test'
import { CreateStartUpPageContainer, StartUpPageCreateResult } from '@evenrealities/even_hub_sdk'
import { initializePage } from '../src/page-lifecycle.ts'

function page() {
  return new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [{ containerID: 1, containerName: 'status', xPosition: 0, yPosition: 0, width: 576, height: 80, isEventCapture: 1, content: 'FFT ready' }],
    imageObject: [{ containerID: 2, containerName: 'waveform', xPosition: 144, yPosition: 92, width: 288, height: 144 }],
  })
}

test('fresh launch creates the initial page without rebuilding', async () => {
  let rebuilds = 0
  const result = await initializePage({
    async createStartUpPageContainer() { return StartUpPageCreateResult.success },
    async rebuildPageContainer() { rebuilds++; return true },
  }, page())
  assert.equal(result, 'created')
  assert.equal(rebuilds, 0)
})

test('reload restores the complete layout when the host rejects a second startup', async () => {
  const layout = page()
  const calls = []
  const result = await initializePage({
    async createStartUpPageContainer(value) { calls.push(['create', value]); return StartUpPageCreateResult.invalid },
    async rebuildPageContainer(value) { calls.push(['rebuild', value]); return true },
  }, layout)
  assert.equal(result, 'rebuilt')
  assert.deepEqual(calls.map(([method]) => method), ['create', 'rebuild'])
  assert.equal(calls[1][1].containerTotalNum, 2)
  assert.deepEqual(calls[1][1].textObject, layout.textObject)
  assert.deepEqual(calls[1][1].imageObject, layout.imageObject)
})

test('failed restoration surfaces an error without retrying or shutting down the app', async () => {
  let rebuilds = 0
  await assert.rejects(initializePage({
    async createStartUpPageContainer() { return StartUpPageCreateResult.invalid },
    async rebuildPageContainer() { rebuilds++; return false },
  }, page()), /create: 1, rebuild: false/)
  assert.equal(rebuilds, 1)
})

test('oversize, out-of-memory and transport errors are not treated as reloads', async () => {
  for (const failure of [StartUpPageCreateResult.oversize, StartUpPageCreateResult.outOfMemory, new Error('connection lost')]) {
    let rebuilds = 0
    await assert.rejects(initializePage({
      async createStartUpPageContainer() { if (failure instanceof Error) throw failure; return failure },
      async rebuildPageContainer() { rebuilds++; return true },
    }, page()), failure instanceof Error ? /connection lost/ : /Failed to create startup page/)
    assert.equal(rebuilds, 0)
  }
})

test('invalid local layout is rejected before either native call', async () => {
  const layout = page()
  layout.textObject[0].zOrderIndex = 1
  let calls = 0
  await assert.rejects(initializePage({
    async createStartUpPageContainer() { calls++; return StartUpPageCreateResult.invalid },
    async rebuildPageContainer() { calls++; return true },
  }, layout), /Z_ORDER_INDEX|zOrderIndex/)
  assert.equal(calls, 0)
})
