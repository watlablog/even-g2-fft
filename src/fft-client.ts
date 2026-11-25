import type { AnalysisRequest, AnalysisResponse, AveragedSpectrum } from './fft.ts'

export class FftClient {
  private readonly worker: Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>
  private pending: {
    session: number
    requestId: number
    resolve: (spectrum: AveragedSpectrum) => void
    reject: (error: Error) => void
  } | undefined
  private nextRequestId = 0
  private disposed = false
  private failed = false

  constructor(worker: Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>) {
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<AnalysisResponse>) => {
      const response = event.data
      if (!this.pending || response.session !== this.pending.session || response.requestId !== this.pending.requestId) return
      const pending = this.pending
      this.pending = undefined
      if (response.ok) pending.resolve(response.spectrum)
      else pending.reject(new Error(response.error))
    })
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.failed = true
      this.pending?.reject(new Error(event.message || 'FFT worker failed'))
      this.pending = undefined
    })
    worker.addEventListener('messageerror', () => {
      this.failed = true
      this.pending?.reject(new Error('Invalid FFT worker response'))
      this.pending = undefined
    })
  }

  analyze(samples: Float32Array, sampleRate: number, session: number): Promise<AveragedSpectrum> {
    return this.request(samples, sampleRate, session, 'average')
  }

  analyzeFrame(samples: Float32Array, sampleRate: number, session: number): Promise<AveragedSpectrum> {
    return this.request(samples, sampleRate, session, 'single')
  }

  private request(samples: Float32Array, sampleRate: number, session: number, kind: AnalysisRequest['kind']): Promise<AveragedSpectrum> {
    if (this.disposed || this.failed) return Promise.reject(new Error('FFT worker is unavailable'))
    if (this.pending) return Promise.reject(new Error('FFT analysis is already running'))
    return new Promise((resolve, reject) => {
      const requestId = ++this.nextRequestId
      this.pending = { session, requestId, resolve, reject }
      const request: AnalysisRequest = { session, requestId, kind, samples, sampleRate }
      try {
        this.worker.postMessage(request, [samples.buffer as ArrayBuffer])
      } catch (error) {
        this.pending = undefined
        reject(error)
      }
    })
  }

  dispose() {
    this.disposed = true
    this.pending?.reject(new Error('FFT analysis was cancelled'))
    this.pending = undefined
    this.worker.terminate()
  }
}
