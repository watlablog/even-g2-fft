import assert from 'node:assert/strict'
import test from 'node:test'
import { OsEventTypeList as Event } from '@evenrealities/even_hub_sdk'
import { CURSOR_MODE_ID, NORMAL_MODE_ID, SpectrumControls, hubInputType } from '../src/spectrum-controls.ts'
import { cursorReadout, prepareSpectrum } from '../src/spectrum.ts'
import { LatestFrameSender } from '../src/latest-frame-sender.ts'

const input = (eventType, field = 'sysEvent') => ({ [field]: { eventType } })
const menu = itemID => ({ menuItemClickEvent: { itemID } })

function fixture() {
  const controls = new SpectrumControls()
  const meanPower = new Float64Array(1025)
  meanPower[128] = 0.125
  meanPower[384] = 0.01
  meanPower[600] = 100 // A stronger peak outside the displayed frequency range.
  const plot = prepareSpectrum({ sampleRate: 16000, fftSize: 2048, hopSize: 512, frameCount: 1, meanPower })
  controls.setSpectrum(plot, meanPower)
  return { controls, plot, meanPower }
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

test('cursor taps never request recording; double-tap and menu re-entry return to the peak', () => {
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

test('fast scroll preserves every input while delayed whole-frame transfers coalesce to the latest state', async () => {
  const { controls, plot } = fixture()
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
  for (let n = 0; n < 20; n++) {
    controls.handleEvent(input(Event.SCROLL_BOTTOM_EVENT), true)
    sender.request()
  }
  assert.equal(controls.spectrum.cursorBin, 148)
  assert.equal(controls.spectrum.plot, plot)
  release()
  await first
  assert.equal(batches, 2)
  assert.deepEqual(sent.map(value => value.cursorBin), [128, 128, 128, 128, 148, 148, 148, 148])
  assert.deepEqual(sent.map(value => value.tile), [0, 1, 2, 3, 0, 1, 2, 3])
})
