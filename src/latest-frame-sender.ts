// Only a pending flag is retained. A frame is rendered when its transfer starts.
export class LatestFrameSender {
  private pending = false
  private running: Promise<void> | undefined
  private disposed = false
  private readonly sendLatest: () => Promise<void>
  private readonly onError: (error: unknown) => void

  constructor(sendLatest: () => Promise<void>, onError: (error: unknown) => void) {
    this.sendLatest = sendLatest
    this.onError = onError
  }

  request(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.pending = true
    if (!this.running) {
      this.running = Promise.resolve().then(async () => {
        while (this.pending && !this.disposed) {
          this.pending = false
          try {
            await this.sendLatest()
          } catch (error) {
            this.onError(error)
          }
        }
      }).finally(() => {
        this.running = undefined
        if (this.pending && !this.disposed) return this.request()
      })
    }
    return this.running
  }

  dispose() {
    this.disposed = true
    this.pending = false
  }

  async whenIdle(): Promise<void> {
    while (this.running) await this.running
  }
}
