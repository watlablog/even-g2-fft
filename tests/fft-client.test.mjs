import assert from 'node:assert/strict'
import test from 'node:test'
import { FftClient } from '../src/fft-client.ts'

class FakeWorker extends EventTarget {
  requests = []
  terminated = false
  postMessage(request, transfer) { this.requests.push({ request, transfer }) }
  terminate() { this.terminated = true }
  respond(data) { this.dispatchEvent(new MessageEvent('message', { data: { requestId: this.requests.at(-1).request.requestId, ...data } })) }
}

test('waits for the matching worker response, transfers PCM and rejects overlapping jobs', async () => {
  const worker = new FakeWorker()
  const client = new FftClient(worker)
  const pcm = new Float32Array(2048)
  let resolved = false
  const pending = client.analyze(pcm, 16000, 4).then(value => { resolved = true; return value })
  assert.equal(worker.requests[0].transfer[0], pcm.buffer)
  await assert.rejects(client.analyze(pcm, 16000, 5), /already running/)
  worker.respond({ session: 3, ok: true, spectrum: 'stale' })
  await Promise.resolve()
  assert.equal(resolved, false)
  const spectrum = { frameCount: 1, meanPower: new Float64Array(1025) }
  worker.respond({ session: 4, ok: true, spectrum })
  assert.equal(await pending, spectrum)
  client.dispose()
})

test('worker analysis errors reject the job and allow a subsequent analysis', async () => {
  const worker = new FakeWorker()
  const client = new FftClient(worker)
  const first = client.analyze(new Float32Array(2048), 16000, 1)
  worker.respond({ session: 1, ok: false, error: 'analysis failed' })
  await assert.rejects(first, /analysis failed/)
  const second = client.analyze(new Float32Array(2048), 16000, 2)
  worker.respond({ session: 2, ok: true, spectrum: { frameCount: 1 } })
  assert.equal((await second).frameCount, 1)
  client.dispose()
})

test('worker failure and disposal reject pending analysis instead of leaving calculating active', async () => {
  const worker = new FakeWorker()
  const client = new FftClient(worker)
  const pending = client.analyze(new Float32Array(2048), 16000, 1)
  worker.dispatchEvent(Object.assign(new Event('error'), { message: 'worker crashed' }))
  await assert.rejects(pending, /worker crashed/)
  await assert.rejects(client.analyze(new Float32Array(2048), 16000, 2), /unavailable/)
  client.dispose()
  assert.equal(worker.terminated, true)

  const secondWorker = new FakeWorker()
  const secondClient = new FftClient(secondWorker)
  const cancelled = secondClient.analyze(new Float32Array(2048), 16000, 1)
  secondClient.dispose()
  await assert.rejects(cancelled, /cancelled/)
  assert.equal(secondWorker.terminated, true)
})

test('a delayed response in the same session cannot settle a later single-frame request', async () => {
  const worker = new FakeWorker()
  const client = new FftClient(worker)
  const first = client.analyzeFrame(new Float32Array(2048), 16000, 7)
  const oldId = worker.requests[0].request.requestId
  assert.equal(worker.requests[0].request.kind, 'single')
  worker.respond({ session: 7, ok: true, spectrum: 'first' })
  assert.equal(await first, 'first')
  let resolved = false
  const next = client.analyzeFrame(new Float32Array(2048), 16000, 7).then(value => { resolved = true; return value })
  worker.respond({ session: 7, requestId: oldId, ok: true, spectrum: 'stale' })
  await Promise.resolve(); assert.equal(resolved, false)
  worker.respond({ session: 7, ok: true, spectrum: 'next' })
  assert.equal(await next, 'next')
  client.dispose()
})
