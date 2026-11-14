interface IntervalClock {
  setInterval: (callback: () => void, delay: number) => number
  clearInterval: (id: number) => void
}

export class CalculatingIndicator {
  private readonly onChange: (visible: boolean) => void
  private readonly clock: IntervalClock
  private timer: number | undefined
  private visible = false

  constructor(onChange: (visible: boolean) => void, clock: IntervalClock) {
    this.onChange = onChange
    this.clock = clock
  }

  start() {
    if (this.timer !== undefined) return
    this.visible = true
    this.onChange(true)
    this.timer = this.clock.setInterval(() => {
      this.visible = !this.visible
      this.onChange(this.visible)
    }, 500)
  }

  stop() {
    if (this.timer === undefined) return
    this.clock.clearInterval(this.timer)
    this.timer = undefined
    this.visible = false
    this.onChange(false)
  }
}
