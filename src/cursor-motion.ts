export interface CursorFrame {
  bin: number
  moving: boolean
}

interface MotionClock {
  now(): number
  setTimeout(callback: () => void, delay: number): number
  clearTimeout(id: number): void
}

const FRAME_MS = 100
const TRANSITION_MS = 250
const SETTLE_MS = 600

export class CursorMotion {
  private target: number | undefined
  private from = 0
  private startedAt = 0
  private duration = 0
  private lastInputAt = 0
  private moving = false
  private timer: number | undefined

  constructor(onFrame: () => void, clock?: MotionClock) {
    this.requestFrame = onFrame
    this.clock = clock ?? {
      now: () => performance.now(),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: id => window.clearTimeout(id),
    }
  }

  private readonly requestFrame: () => void
  private readonly clock: MotionClock

  get frame(): CursorFrame | undefined {
    if (this.target === undefined) return undefined
    const now = this.clock.now()
    return { bin: Math.round(this.position(now)), moving: this.moving && now - this.lastInputAt < SETTLE_MS }
  }

  setPosition(bin: number) {
    this.cancelTimer()
    this.target = bin
    this.from = bin
    this.duration = 0
    this.moving = false
    this.requestFrame()
  }

  moveTo(bin: number) {
    const now = this.clock.now()
    const from = this.target === undefined ? bin : this.position(now)
    this.cancelTimer()
    this.target = bin
    this.from = from
    this.startedAt = now
    this.lastInputAt = now
    this.duration = Math.abs(bin - from) <= 4 ? 0 : TRANSITION_MS
    this.moving = true
    this.requestFrame()
    this.schedule()
  }

  clear() {
    this.cancelTimer()
    this.target = undefined
    this.moving = false
  }

  private position(now: number): number {
    if (this.duration === 0) return this.target ?? this.from
    const fraction = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration))
    return this.from + ((this.target ?? this.from) - this.from) * fraction
  }

  private cancelTimer() {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule() {
    if (!this.moving || this.target === undefined) return
    const now = this.clock.now()
    const untilSettled = Math.max(0, this.lastInputAt + SETTLE_MS - now)
    const untilTarget = this.startedAt + this.duration - now
    const delay = untilTarget > 0 ? Math.min(FRAME_MS, untilTarget, untilSettled) : untilSettled
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      if (this.clock.now() - this.lastInputAt >= SETTLE_MS) this.moving = false
      this.requestFrame()
      this.schedule()
    }, delay)
  }
}
