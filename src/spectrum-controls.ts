import { OsEventTypeList } from '@evenrealities/even_hub_sdk'
import type { EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { SpectrumPlot } from './spectrum.ts'

export const CURSOR_MODE_ID = 1
export const NORMAL_MODE_ID = 2
export type SpectrumMode = 'normal' | 'cursor'
export type InputAction = 'none' | 'tap' | 'redraw'

export interface SpectrumView {
  plot: SpectrumPlot
  peakBin: number
  cursorBin: number
  mode: SpectrumMode
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

  get spectrum(): Readonly<SpectrumView> | undefined { return this.current }
  get isOverlayOpen(): boolean { return this.overlayOpen }

  setSpectrum(plot: SpectrumPlot, meanPower: Float64Array) {
    let peakBin = 0
    for (let k = 1; k < plot.dbValues.length; k++) {
      if (meanPower[k] > meanPower[peakBin]) peakBin = k
    }
    this.current = { plot, peakBin, cursorBin: peakBin, mode: 'normal', revision: 0 }
  }

  clearSpectrum() {
    this.current = undefined
  }

  handleEvent(event: EvenHubEvent, spectrumActive: boolean): InputAction {
    const view = spectrumActive ? this.current : undefined
    // Menu selections must never fall through into the default CLICK handling.
    if (event.menuItemClickEvent) {
      if (!view) return 'none'
      const id = event.menuItemClickEvent.itemID
      if (id === CURSOR_MODE_ID) return this.update(view, 'cursor', view.peakBin)
      if (id === NORMAL_MODE_ID) return this.update(view, 'normal', view.cursorBin)
      return 'none'
    }
    const type = hubInputType(event)
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
      this.overlayOpen = true
      return 'none'
    }
    if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
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
    if (type === OsEventTypeList.CLICK_EVENT) return view?.mode === 'cursor' ? 'none' : 'tap'
    if (!view || view.mode !== 'cursor') return 'none'
    switch (type) {
      case OsEventTypeList.SCROLL_TOP_EVENT:
        return this.update(view, 'cursor', Math.max(0, view.cursorBin - 1))
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        return this.update(view, 'cursor', Math.min(view.plot.dbValues.length - 1, view.cursorBin + 1))
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        return this.update(view, 'cursor', view.peakBin)
      case OsEventTypeList.LONG_PRESS_EVENT:
        return this.update(view, 'normal', view.cursorBin)
      default:
        return 'none'
    }
  }

  private update(view: SpectrumView, mode: SpectrumMode, cursorBin: number): InputAction {
    if (view.mode === mode && view.cursorBin === cursorBin) return 'none'
    view.mode = mode
    view.cursorBin = cursorBin
    view.revision++
    return 'redraw'
  }
}
