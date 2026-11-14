import { analyzePcm } from './fft.ts'
import type { AnalysisRequest, AnalysisResponse } from './fft.ts'

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { session, samples, sampleRate } = event.data
  let response: AnalysisResponse
  try {
    const spectrum = analyzePcm(samples, sampleRate)
    response = { session, ok: true, spectrum }
    self.postMessage(response, { transfer: [spectrum.meanPower.buffer as ArrayBuffer] })
  } catch (error) {
    response = { session, ok: false, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(response)
  }
}
