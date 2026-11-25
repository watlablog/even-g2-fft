import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeDisplay, RT_HOLD_MS } from '../src/realtime-display.ts'
import { LatestFrameSender } from '../src/latest-frame-sender.ts'
import { prepareSpectrum } from '../src/spectrum.ts'

function spectrum(level = 1) {
  const meanPower = new Float64Array(1025)
  meanPower[100] = level * .0001
  meanPower[128] = level * .1
  return { sampleRate: 16000, fftSize: 2048, hopSize: 2048, frameCount: 1, meanPower }
}
function fixture(onReady = () => {}) {
  let now = 0, id = 0, calls = 0
  const tasks = new Map()
  const display = new RealtimeDisplay(() => { calls++; onReady() }, {
    now: () => now,
    setTimeout(callback, delay) { tasks.set(++id, { callback, at: now + delay }); return id },
    clearTimeout(timer) { tasks.delete(timer) },
  })
  function advance(ms) {
    const until = now + ms
    while (true) {
      const next = [...tasks].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at; tasks.delete(next[0]); next[1].callback()
    }
    now = until
  }
  return { display, tasks, advance, calls: () => calls, now: () => now }
}

test('locks the first successfully presented non-silent range while preserving exact FFT values', () => {
  const { display } = fixture()
  const first = display.prepare(spectrum())
  assert.deepEqual(first, prepareSpectrum(spectrum()))
  // A prepared but interrupted frame must not fix the scale.
  const chosen = display.prepare(spectrum(10))
  display.presented(chosen)
  for (const level of [.000001, 1, 1e6]) {
    const plot = display.prepare(spectrum(level))
    assert.equal(plot.yMin, chosen.yMin)
    assert.equal(plot.yMax, chosen.yMax)
    assert.deepEqual(plot.dbValues, prepareSpectrum(spectrum(level)).dbValues)
  }
  const louder = display.prepare(spectrum(1e6))
  assert.ok(louder.dbValues[128] > louder.yMax, 'Out-of-range values remain intact for the static result and readout')
})

test('digital silence uses a broad fallback and cannot lock the display to the dB floor', () => {
  const { display } = fixture()
  const silent = display.prepare(spectrum(0))
  assert.equal(silent.yMin, -120)
  assert.equal(silent.yMax, 100)
  display.presented(silent)
  const sound = display.prepare(spectrum())
  assert.deepEqual(sound, prepareSpectrum(spectrum()))
  display.presented(sound)
  const quiet = display.prepare(spectrum(0))
  assert.equal(quiet.yMin, sound.yMin)
  assert.equal(quiet.yMax, sound.yMax)
})

test('holds for 500 ms after completion, and repeated requests do not postpone the one deadline', () => {
  const { display, advance, tasks, calls } = fixture()
  display.request(); assert.equal(calls(), 1)
  advance(800) // A slow four-tile transfer.
  display.presented(display.prepare(spectrum()))
  for (let n = 0; n < 4; n++) {
    display.request(); advance(100)
    assert.equal(calls(), 1)
    assert.equal(tasks.size, 1)
  }
  advance(RT_HOLD_MS - 401)
  assert.equal(display.canPresent, false)
  advance(1)
  assert.equal(display.canPresent, true)
  assert.equal(calls(), 2)
  assert.equal(tasks.size, 0)
})

test('pause cancels pending refresh; resume resets timing but keeps the range; disposal cancels all callbacks', () => {
  const { display, advance, tasks, calls } = fixture()
  const plot = display.prepare(spectrum())
  display.presented(plot); display.request()
  assert.equal(tasks.size, 1)
  display.cancel(); advance(1000)
  assert.equal(calls(), 0)
  display.presented(plot); display.request()
  display.resetTiming(); display.request()
  assert.equal(calls(), 1)
  assert.equal(display.prepare(spectrum(100)).yMax, plot.yMax)
  display.presented(plot); display.request(); display.dispose(); advance(1000)
  display.resetTiming(); display.request()
  assert.equal(calls(), 1)
  assert.equal(display.canPresent, false)
  assert.equal(tasks.size, 0)
})

test('the sender is idle during a hold and sends only the latest result when the hold expires', async () => {
  let latest = 1
  let sender
  const sent = []
  const { display, advance, tasks } = fixture(() => { void sender.request() })
  sender = new LatestFrameSender(async () => {
    if (!display.canPresent) { display.request(); return }
    sent.push(latest)
    display.presented(display.prepare(spectrum()))
  }, assert.fail)
  display.request(); await sender.whenIdle()
  latest = 2; display.request()
  latest = 3; display.request()
  latest = 4; display.request()
  await sender.whenIdle() // No timer or hold promise is occupying the transfer queue.
  assert.deepEqual(sent, [1])
  assert.equal(tasks.size, 1)
  advance(499); await sender.whenIdle(); assert.deepEqual(sent, [1])
  advance(1); await sender.whenIdle(); assert.deepEqual(sent, [1, 4])
  display.dispose(); sender.dispose()
})

test('Pause fits the displayed peak plus 10% headroom, preserves the lower limit and raw values, and keeps the new upper limit after resume', () => {
  const { display } = fixture()
  const initial = display.prepare(spectrum())
  display.presented(initial)
  for (const level of [1e5, .01]) {
    const shown = display.prepare(spectrum(level))
    const values = [...shown.dbValues]
    const peak = Math.max(...values)
    const paused = display.fitPausedUpper(shown)
    assert.equal(paused.yMin, initial.yMin)
    assert.equal(paused.yMax, peak + (peak - initial.yMin) * .1)
    assert.deepEqual([...paused.dbValues], values)
    assert.equal(paused.dbValues, shown.dbValues)
    display.resetTiming()
    const resumed = display.prepare(spectrum(10))
    assert.equal(resumed.yMin, paused.yMin)
    assert.equal(resumed.yMax, paused.yMax)
  }
})

test('Pause keeps a useful scale in silence and never makes an inverted axis if the whole signal is below the fixed lower limit', () => {
  const { display } = fixture()
  const first = display.prepare(spectrum())
  display.presented(first)
  const silent = display.prepare(spectrum(0))
  assert.equal(display.fitPausedUpper(silent), silent)
  const weak = display.prepare(spectrum(1e-10))
  const paused = display.fitPausedUpper(weak)
  assert.equal(paused.yMin, first.yMin)
  assert.equal(paused.yMax, first.yMin + 10)
  assert.ok(paused.yMax > paused.yMin)
})
