import { analyzeFrame, analyzePcm } from './fft.ts'
import type { AnalysisRequest, AnalysisResponse } from './fft.ts'

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { session, requestId, kind, samples, sampleRate } = event.data
  let response: AnalysisResponse
  try {
    const spectrum = kind === 'single' ? analyzeFrame(samples, sampleRate) : analyzePcm(samples, sampleRate)
    response = { session, requestId, ok: true, spectrum }
    self.postMessage(response, { transfer: [spectrum.meanPower.buffer as ArrayBuffer] })
  } catch (error) {
    response = { session, requestId, ok: false, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(response)
  }
}
