import assert from 'node:assert/strict'
import test from 'node:test'
import { OsEventTypeList as Event } from '@evenrealities/even_hub_sdk'
import { CURSOR_MODE_ID, NORMAL_MODE_ID, SpectrumControls, hubInputType } from '../src/spectrum-controls.ts'
import { cursorReadout, prepareSpectrum } from '../src/spectrum.ts'
import { LatestFrameSender } from '../src/latest-frame-sender.ts'

const input = (eventType, field = 'sysEvent') => ({ [field]: { eventType } })
const menu = itemID => ({ menuItemClickEvent: { itemID } })

function fixture(peakBin = 128) {
  let now = 0
  const controls = new SpectrumControls(() => now)
  const meanPower = new Float64Array(1025)
  meanPower[384] = 0.01
  meanPower[peakBin] = 0.125
  meanPower[600] = 100 // A stronger peak outside the displayed frequency range.
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, hopSize: 512, frameCount: 1, meanPower })
  controls.setSpectrum(plot, meanPower)
  return { controls, plot, meanPower, advance: (milliseconds = 100) => { now += milliseconds } }
}

test('new results start normal; entering cursor selects the in-band maximum, with stable tie handling', () => {
  const { controls, plot, meanPower } = fixture()
  assert.equal(controls.spectrum.mode, 'normal')
  assert.equal(controls.spectrum.peakBin, 128)
  assert.equal(controls.handleEvent(menu(CURSOR_MODE_ID), true), 'redraw')
  assert.equal(controls.spectrum.mode, 'cursor')
  assert.equal(controls.spectrum.cursorBin, 128)
  meanPower[100] = meanPower[128]
  controls.setSpectrum(plot, meanPower)
  assert.equal(controls.spectrum.mode, 'normal')
  assert.equal(controls.spectrum.peakBin, 100)
})

test('peak selection uses the original powers even when the displayed values are floored', () => {
  const controls = new SpectrumControls()
  const meanPower = new Float64Array(1025)
  meanPower[12] = 1e-30
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, meanPower })
  assert.ok([...plot.dbValues].every(value => value === -120))
  controls.setSpectrum(plot, meanPower)
  assert.equal(controls.spectrum.peakBin, 12)
  meanPower.fill(0)
  controls.setSpectrum(plot, meanPower)
  assert.equal(controls.spectrum.peakBin, 0)
})

test('up moves one bin lower, down moves one bin higher, and neither edge wraps', () => {
  const { controls } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  controls.handleEvent(input(Event.SCROLL_TOP_EVENT, 'textEvent'), true)
  assert.equal(controls.spectrum.cursorBin, 127)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT, 'listEvent'), true)
  assert.equal(controls.spectrum.cursorBin, 128)
  for (let n = 0; n < 500; n++) controls.handleEvent(input(Event.SCROLL_TOP_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 0)
  assert.equal(controls.handleEvent(input(Event.SCROLL_TOP_EVENT), true), 'none')
  for (let n = 0; n < 500; n++) controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 384)
  assert.equal(controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true), 'none')
})

test('same-direction input accelerates from the third event up to 64 bins (500 Hz)', () => {
  for (const [start, direction, type] of [[0, 1, Event.SCROLL_BOTTOM_EVENT], [384, -1, Event.SCROLL_TOP_EVENT]]) {
    const { controls, plot, advance } = fixture(start)
    controls.handleEvent(menu(CURSOR_MODE_ID), true)
    let previous = start
    for (const step of [1, 1, 4, 8, 16, 32, 64, 64]) {
      advance()
      assert.equal(controls.handleEvent(input(type), true), 'redraw')
      const next = controls.spectrum.cursorBin
      assert.equal(next - previous, direction * step)
      assert.ok(Math.abs(cursorReadout(plot, next).frequencyHz - cursorReadout(plot, previous).frequencyHz) <= 500)
      previous = next
    }
  }
})

test('799 ms continues the gesture but an 800 ms gap restarts with two fine steps', () => {
  const { controls, advance } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  advance(799)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  advance(799)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 134)
  advance(800)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 135)
  advance(799)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 136)
  advance(799)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 140)
})

test('spaced scrolls remain one bin and reversing at full speed restarts fine adjustment', () => {
  const { controls, advance } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  for (let n = 0; n < 5; n++) {
    advance(1000)
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
    assert.equal(controls.spectrum.cursorBin, 129 + n)
  }
  controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true)
  for (let n = 0; n < 7; n++) {
    advance()
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  }
  assert.equal(controls.spectrum.cursorBin, 254)
  for (const bin of [253, 252, 248]) {
    advance()
    controls.handleEvent(input(Event.SCROLL_TOP_EVENT), true)
    assert.equal(controls.spectrum.cursorBin, bin)
  }
  advance()
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 249)
})

test('twelve continuous inputs cross the full band, stop at either edge and permit fine reversal', () => {
  for (const [start, end, type, reverse] of [[0, 384, Event.SCROLL_BOTTOM_EVENT, Event.SCROLL_TOP_EVENT], [384, 0, Event.SCROLL_TOP_EVENT, Event.SCROLL_BOTTOM_EVENT]]) {
    const { controls, advance } = fixture(start)
    controls.handleEvent(menu(CURSOR_MODE_ID), true)
    for (let n = 0; n < 12; n++) {
      advance()
      controls.handleEvent(input(type), true)
      if (n === 10) assert.equal(controls.spectrum.cursorBin, start === 0 ? 382 : 2)
    }
    assert.equal(controls.spectrum.cursorBin, end)
    const revision = controls.spectrum.revision
    advance()
    assert.equal(controls.handleEvent(input(type), true), 'none')
    assert.equal(controls.spectrum.revision, revision)
    advance()
    controls.handleEvent(input(reverse), true)
    assert.equal(controls.spectrum.cursorBin, end === 0 ? 1 : 383)
  }
})

test('peak snap, menu actions, overlays and new results reset acceleration', () => {
  const resets = [
    controls => controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true),
    controls => controls.handleEvent(menu(CURSOR_MODE_ID), true),
    controls => { controls.handleEvent(menu(NORMAL_MODE_ID), true); controls.handleEvent(menu(CURSOR_MODE_ID), true) },
    controls => { controls.handleEvent(input(Event.LONG_PRESS_EVENT), true); controls.handleEvent(menu(CURSOR_MODE_ID), true) },
    controls => {
      controls.handleEvent(input(Event.FOREGROUND_ENTER_EVENT), true)
      assert.equal(controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true), 'none')
      controls.handleEvent(input(Event.FOREGROUND_EXIT_EVENT), true)
    },
    (controls, plot, meanPower) => { controls.setSpectrum(plot, meanPower); controls.handleEvent(menu(CURSOR_MODE_ID), true) },
    (controls, plot, meanPower) => { controls.clearSpectrum(); controls.setSpectrum(plot, meanPower); controls.handleEvent(menu(CURSOR_MODE_ID), true) },
  ]
  for (const reset of resets) {
    const { controls, plot, meanPower, advance } = fixture()
    controls.handleEvent(menu(CURSOR_MODE_ID), true)
    for (let n = 0; n < 3; n++) { advance(); controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true) }
    assert.equal(controls.spectrum.cursorBin, 134)
    reset(controls, plot, meanPower)
    const start = controls.spectrum.cursorBin
    for (let n = 1; n <= 2; n++) {
      advance()
      controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
      assert.equal(controls.spectrum.cursorBin, start + n)
    }
  }
})

test('cursor taps and audio do not change acceleration; waiting never moves the cursor', () => {
  const { controls, advance } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), true), 'none')
  assert.equal(controls.handleEvent({ audioEvent: { audioPcm: new Uint8Array(3200) } }, true), 'none')
  advance()
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 130)
  advance()
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 134)
  const revision = controls.spectrum.revision
  advance(10000)
  assert.equal(controls.spectrum.cursorBin, 134)
  assert.equal(controls.spectrum.revision, revision)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 135)
})

test('cursor taps never request recording; double-tap snaps locally and menu re-entry selects the maximum', () => {
  const { controls } = fixture()
  const recordingRequests = []
  const dispatch = event => {
    const action = controls.handleEvent(event, true)
    if (action === 'tap') recordingRequests.push('audioControl(true)')
    return action
  }
  dispatch(menu(CURSOR_MODE_ID))
  dispatch(input(Event.CLICK_EVENT))
  dispatch({ sysEvent: { eventSource: 1 } })
  dispatch(input(Event.SCROLL_BOTTOM_EVENT))
  assert.equal(controls.spectrum.cursorBin, 129)
  dispatch(input(Event.DOUBLE_CLICK_EVENT))
  assert.equal(controls.spectrum.cursorBin, 128)
  dispatch(input(Event.SCROLL_TOP_EVENT))
  dispatch(menu(CURSOR_MODE_ID))
  assert.equal(controls.spectrum.cursorBin, 128)
  assert.deepEqual(recordingRequests, [])
})

test('double-tap skips a tiny nearby ripple, snaps to a prominent peak and resets acceleration', () => {
  const { controls, meanPower, advance } = fixture()
  for (let k = 176; k <= 195; k++) meanPower[k] = 0.02 - (k - 176) * 0.0005
  meanPower[190] = 0.0138 // A local ripple below 6 dB on the descending shoulder.
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, meanPower })
  controls.setSpectrum(plot, meanPower)
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  for (let n = 0; n < 6; n++) {
    advance()
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  }
  assert.equal(controls.spectrum.cursorBin, 190)
  assert.equal(controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true), 'redraw')
  assert.equal(controls.spectrum.cursorBin, 176)
  assert.equal(controls.spectrum.peakBin, 128)
  assert.equal(controls.spectrum.plot, plot)
  assert.equal(cursorReadout(plot, 176).frequencyLabel, '1375.00 Hz')
  assert.equal(controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true), 'none')
  for (const bin of [177, 178, 182]) {
    advance()
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
    assert.equal(controls.spectrum.cursorBin, bin)
  }
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  assert.equal(controls.spectrum.cursorBin, 128)
})

test('double-tap with no visible local peak stays put and still resets acceleration', () => {
  const { controls, advance } = fixture()
  const meanPower = new Float64Array(1025)
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, meanPower })
  controls.setSpectrum(plot, meanPower)
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  for (let n = 0; n < 3; n++) { advance(); controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true) }
  assert.equal(controls.spectrum.cursorBin, 6)
  assert.equal(controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true), 'none')
  assert.equal(controls.spectrum.cursorBin, 6)
  advance()
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 7)
})

test('rebasing precision input uses the displayed bin and resets prior acceleration', () => {
  const { controls, advance } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  for (let n = 0; n < 7; n++) { advance(); controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true) }
  assert.equal(controls.spectrum.cursorBin, 254)
  controls.rebaseCursor(200)
  controls.handleEvent(input(Event.SCROLL_TOP_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 199)
  controls.handleEvent(input(Event.DOUBLE_CLICK_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 128)
  assert.throws(() => controls.rebaseCursor(385), /Invalid cursor bin/)
  controls.handleEvent(menu(NORMAL_MODE_ID), true)
  assert.equal(controls.rebaseCursor(200), 'none')
})

test('long press returns to normal; release does not request recording; the next tap does', () => {
  const { controls } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  assert.equal(controls.handleEvent(input(Event.LONG_PRESS_EVENT), true), 'redraw')
  assert.equal(controls.spectrum.mode, 'normal')
  assert.equal(controls.handleEvent(input(Event.LONG_PRESS_RELEASE_EVENT), true), 'none')
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), true), 'tap')
})

test('normal mode ignores scroll/double-tap/hold and menu selections never fall through into clicks', () => {
  const { controls } = fixture()
  for (const type of [Event.SCROLL_TOP_EVENT, Event.SCROLL_BOTTOM_EVENT, Event.DOUBLE_CLICK_EVENT, Event.LONG_PRESS_EVENT, Event.LONG_PRESS_RELEASE_EVENT]) {
    assert.equal(controls.handleEvent(input(type), true), 'none')
  }
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  assert.equal(controls.handleEvent({ ...menu(NORMAL_MODE_ID), sysEvent: {} }, true), 'redraw')
  assert.equal(controls.spectrum.mode, 'normal')
  assert.equal(controls.handleEvent({ ...menu(999), sysEvent: {} }, true), 'none')
  assert.equal(controls.handleEvent({ ...menu(CURSOR_MODE_ID), sysEvent: {} }, false), 'none')
})

test('menu overlays suppress underlying input and closing preserves the selected mode and bin', () => {
  const { controls } = fixture()
  controls.handleEvent(input(Event.FOREGROUND_ENTER_EVENT), true)
  assert.equal(controls.isOverlayOpen, true)
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), true), 'none')
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  assert.equal(controls.spectrum.mode, 'cursor')
  controls.handleEvent(input(Event.SCROLL_TOP_EVENT), true)
  controls.handleEvent(input(Event.LONG_PRESS_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 128)
  assert.equal(controls.spectrum.mode, 'cursor')
  assert.equal(controls.handleEvent(input(Event.FOREGROUND_EXIT_EVENT), true), 'redraw')
  assert.equal(controls.isOverlayOpen, false)
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  controls.handleEvent(input(Event.FOREGROUND_ENTER_EVENT), true)
  controls.handleEvent(input(Event.FOREGROUND_EXIT_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 129)
  assert.equal(controls.spectrum.mode, 'cursor')
  controls.handleEvent(input(Event.FOREGROUND_ENTER_EVENT), false)
  controls.clearSpectrum()
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), false), 'none')
  controls.handleEvent(input(Event.FOREGROUND_EXIT_EVENT), false)
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), false), 'tap')
})

test('input normalization accepts sys/text/list, preserves explicit enums and ignores audio-only events', () => {
  assert.equal(hubInputType({ sysEvent: {}, textEvent: { eventType: Event.SCROLL_BOTTOM_EVENT } }), Event.SCROLL_BOTTOM_EVENT)
  assert.equal(hubInputType({ listEvent: {} }), Event.CLICK_EVENT)
  assert.equal(hubInputType({ audioEvent: { audioPcm: new Uint8Array(3200) } }), undefined)
  assert.equal(hubInputType({ textEvent: null, sysEvent: null }), undefined)
})

test('cursor readout reports the selected bin with two decimals, units and the dB-floor qualifier', () => {
  const { plot } = fixture()
  const peak = cursorReadout(plot, 128)
  assert.equal(peak.frequencyLabel, '1000.00 Hz')
  assert.equal(peak.amplitudeLabel, '84.95 dB')
  const silent = cursorReadout(plot, 127)
  assert.equal(silent.frequencyLabel, '992.19 Hz')
  assert.equal(silent.amplitudeLabel, '≤-120.00 dB')
  assert.throws(() => cursorReadout(plot, -1), /Invalid/)
  assert.throws(() => cursorReadout(plot, 385), /Invalid/)
})

test('acceleration uses input time while delayed whole-frame transfers coalesce to the latest state', async () => {
  const { controls, plot, advance } = fixture()
  controls.handleEvent(menu(CURSOR_MODE_ID), true)
  let release
  const sent = []
  let batches = 0
  const sender = new LatestFrameSender(async () => {
    const { cursorBin, revision } = controls.spectrum
    batches++
    for (let tile = 0; tile < 4; tile++) {
      sent.push({ cursorBin, revision, tile })
      if (batches === 1 && tile === 0) await new Promise(resolve => { release = resolve })
    }
  }, error => { throw error })
  const first = sender.request()
  await Promise.resolve()
  for (let n = 0; n < 7; n++) {
    advance(100)
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
    sender.request()
  }
  assert.equal(controls.spectrum.cursorBin, 254)
  assert.equal(controls.spectrum.plot, plot)
  advance(2000) // Transfer latency must not alter input already processed.
  release()
  await first
  assert.equal(batches, 2)
  assert.deepEqual(sent.map(value => value.cursorBin), [128, 128, 128, 128, 254, 254, 254, 254])
  assert.deepEqual(sent.map(value => value.tile), [0, 1, 2, 3, 0, 1, 2, 3])
  assert.equal(cursorReadout(plot, controls.spectrum.cursorBin).frequencyLabel, '1984.38 Hz')
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  assert.equal(controls.spectrum.cursorBin, 255)
})

test('Peak mode steps amplitude ranks without acceleration or wrapping and double-tap resets Top1', async () => {
  const { PEAK_MODE_ID } = await import('../src/spectrum-controls.ts')
  const controls = new SpectrumControls(() => 0)
  const meanPower = Float64Array.from([0, .1, 0, 1, 0, .5, 0])
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, meanPower })
  controls.setSpectrum(plot, meanPower)
  assert.equal(controls.handleEvent(menu(PEAK_MODE_ID), true), 'redraw')
  assert.equal(controls.spectrum.mode, 'peak')
  assert.deepEqual(controls.spectrum.peaks, [3, 5, 1])
  for (const [type, index, bin] of [
    [Event.SCROLL_TOP_EVENT, 0, 3], [Event.SCROLL_BOTTOM_EVENT, 1, 5],
    [Event.SCROLL_BOTTOM_EVENT, 2, 1], [Event.SCROLL_BOTTOM_EVENT, 2, 1],
    [Event.SCROLL_TOP_EVENT, 1, 5], [Event.DOUBLE_CLICK_EVENT, 0, 3],
  ]) {
    controls.handleEvent(input(type), true)
    assert.equal(controls.spectrum.peakIndex, index)
    assert.equal(controls.spectrum.cursorBin, bin)
  }
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), true), 'none')
  controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
  controls.handleEvent(menu(PEAK_MODE_ID), true)
  assert.equal(controls.spectrum.peakIndex, 0)
  controls.handleEvent(input(Event.LONG_PRESS_EVENT), true)
  assert.equal(controls.spectrum.mode, 'normal')
  assert.equal(controls.handleEvent(input(Event.LONG_PRESS_RELEASE_EVENT), true), 'none')
  assert.equal(controls.handleEvent(input(Event.CLICK_EVENT), true), 'tap')
})

test('Peak mode with no peaks suppresses taps and safely ignores scrolling and double tap', async () => {
  const { PEAK_MODE_ID } = await import('../src/spectrum-controls.ts')
  const { controls, plot } = fixture()
  plot.dbValues.fill(-120)
  controls.setSpectrum(plot, new Float64Array(1025))
  controls.handleEvent(menu(PEAK_MODE_ID), true)
  assert.deepEqual(controls.spectrum.peaks, [])
  for (const type of [Event.SCROLL_BOTTOM_EVENT, Event.SCROLL_TOP_EVENT, Event.DOUBLE_CLICK_EVENT, Event.CLICK_EVENT]) {
    assert.equal(controls.handleEvent(input(type), true), 'none')
  }
  controls.handleEvent(input(Event.LONG_PRESS_EVENT), true)
  assert.equal(controls.spectrum.mode, 'normal')
})
