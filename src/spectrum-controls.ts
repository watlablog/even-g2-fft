import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { SpectrumPlot } from './spectrum.ts'
import { nearestSpectrumPeak, rankedSpectrumPeaks } from './spectrum.ts'

export const CURSOR_MODE_ID = 1
export const NORMAL_MODE_ID = 2
export const PEAK_MODE_ID = 3
export const RT_MODE_ID = 4
export type SpectrumMode = 'normal' | 'cursor' | 'peak'
export type InputAction = 'none' | 'tap' | 'redraw'

const SCROLL_GAP_MS = 800
const SCROLL_STEPS = [1, 1, 4, 8, 16, 32, 64] as const

export interface SpectrumView {
  plot: SpectrumPlot
  peakBin: number
  cursorBin: number
  mode: SpectrumMode
  peaks: number[]
  peakIndex: number
  revision: number
}

export function hubInputType(event: EvenHubEvent): OsEventTypeList | undefined {
  const inputs = [event.sysEvent, event.textEvent, event.listEvent]
  const explicit = inputs.find(input => input?.eventType !== undefined)
  if (explicit) return explicit.eventType
  // Protobuf may omit CLICK_EVENT because its enum value is zero.
  return inputs.some(input => input != null) ? OsEventTypeList.CLICK_EVENT : undefined
}

export class SpectrumControls {
  private current: SpectrumView | undefined
  private overlayOpen = false
  private readonly now: () => number
  private scrollDirection: -1 | 1 | undefined
  private lastScrollAt: number | undefined
  private scrollCount = 0

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  get spectrum(): Readonly<SpectrumView> | undefined { return this.current }
  get isOverlayOpen(): boolean { return this.overlayOpen }

  setSpectrum(plot: SpectrumPlot, meanPower: Float64Array) {
    this.resetScroll()
    let peakBin = 0
    for (let k = 1; k < plot.dbValues.length; k++) {
      if (meanPower[k] > meanPower[peakBin]) peakBin = k
    }
    this.current = { plot, peakBin, cursorBin: peakBin, mode: 'normal', peaks: rankedSpectrumPeaks(plot), peakIndex: 0, revision: 0 }
  }

  clearSpectrum() {
    this.resetScroll()
    this.current = undefined
  }

  rebaseCursor(bin: number): InputAction {
    const view = this.current
    if (!view || view.mode !== 'cursor') return 'none'
    if (!Number.isInteger(bin) || bin < 0 || bin >= view.plot.dbValues.length) throw new Error('Invalid cursor bin')
    this.resetScroll()
    return this.update(view, 'cursor', bin)
  }

  handleEvent(event: EvenHubEvent, spectrumActive: boolean): InputAction {
    const view = spectrumActive ? this.current : undefined
    // Menu selections must never fall through into the default CLICK handling.
    if (event.menuItemClickEvent) {
      if (!view) return 'none'
      const id = event.menuItemClickEvent.itemID
      if (id === CURSOR_MODE_ID) return this.selectMode('cursor')
      if (id === NORMAL_MODE_ID) return this.selectMode('normal')
      if (id === PEAK_MODE_ID) return this.selectMode('peak')
      return 'none'
    }
    const type = hubInputType(event)
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      this.resetScroll()
      this.overlayOpen = true
      return 'none'
    }
    if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      this.resetScroll()
      const wasOpen = this.overlayOpen
      this.overlayOpen = false
      // Repaint only after the OS has removed its overlay. This also restores
      // pixels covered by a cancelled menu without changing the mode or bin.
      if (wasOpen && view) {
        view.revision++
        return 'redraw'
      }
      return 'none'
    }
    if (this.overlayOpen) return 'none'
    if (type === OsEventTypeList.CLICK_EVENT) return view && view.mode !== 'normal' ? 'none' : 'tap'
    if (!view || view.mode === 'normal') return 'none'
    if (type === OsEventTypeList.LONG_PRESS_EVENT) {
      this.resetScroll()
      return this.update(view, 'normal', view.cursorBin)
    }
    if (view.mode === 'peak') {
      const previous = view.peakIndex
      if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) view.peakIndex = 0
      else if (type === OsEventTypeList.SCROLL_TOP_EVENT) view.peakIndex = Math.max(0, previous - 1)
      else if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) view.peakIndex = Math.min(Math.max(0, view.peaks.length - 1), previous + 1)
      if (previous === view.peakIndex) return 'none'
      return this.update(view, 'peak', view.peaks[view.peakIndex] ?? view.cursorBin)
    }
    switch (type) {
      case OsEventTypeList.SCROLL_TOP_EVENT:
        return this.scroll(view, -1)
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        return this.scroll(view, 1)
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        this.resetScroll()
        return this.update(view, 'cursor', nearestSpectrumPeak(view.plot, view.cursorBin))
      default:
        return 'none'
    }
  }

  selectMode(mode: SpectrumMode): InputAction {
    const view = this.current
    if (!view) return 'none'
    this.resetScroll()
    if (mode === 'peak') view.peakIndex = 0
    const bin = mode === 'cursor' ? view.peakBin : mode === 'peak' ? view.peaks[0] ?? view.cursorBin : view.cursorBin
    return this.update(view, mode, bin)
  }

  private resetScroll() {
    this.scrollDirection = undefined
    this.lastScrollAt = undefined
    this.scrollCount = 0
  }

  private scroll(view: SpectrumView, direction: -1 | 1): InputAction {
    const now = this.now()
    const elapsed = this.lastScrollAt === undefined ? Infinity : now - this.lastScrollAt
    const continuing = direction === this.scrollDirection && elapsed >= 0 && elapsed < SCROLL_GAP_MS
    this.scrollCount = continuing ? Math.min(this.scrollCount + 1, SCROLL_STEPS.length) : 1
    this.scrollDirection = direction
    this.lastScrollAt = now

    const step = SCROLL_STEPS[this.scrollCount - 1]!
    const lastBin = view.plot.dbValues.length - 1
    const cursorBin = Math.max(0, Math.min(lastBin, view.cursorBin + direction * step))
    // An edge ends the gesture sequence, including attempts to move past it.
    if (cursorBin === 0 || cursorBin === lastBin) this.resetScroll()
    return this.update(view, 'cursor', cursorBin)
  }

  private update(view: SpectrumView, mode: SpectrumMode, cursorBin: number): InputAction {
    if (view.mode === mode && view.cursorBin === cursorBin) return 'none'
    view.mode = mode
    view.cursorBin = cursorBin
    view.revision++
    return 'redraw'
  }
}
