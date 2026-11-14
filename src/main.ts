import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { CalculatingIndicator } from './calculating.ts'
import { FFT_SIZE, RecordingTooShortError } from './fft.ts'
import { FftClient } from './fft-client.ts'
import { LatestFrameSender } from './latest-frame-sender.ts'
import { RecordingBuffer } from './recording.ts'
import { drawSpectrum, prepareSpectrum, SCREEN_HEIGHT, SCREEN_WIDTH } from './spectrum.ts'
import { drawWaveform, IMAGE_HEIGHT, IMAGE_WIDTH } from './waveform.ts'
import './style.css'

const textID = 1
const textName = 'recording-status'
const imageID = 2
const imageName = 'time-waveform'
const recording = new RecordingBuffer()

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <pre id="status" role="status">Connecting...</pre>
    <canvas id="waveform" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}"
      aria-label="Last five seconds of audio, amplitude minus one to plus one"></canvas>
    <canvas id="spectrum" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" hidden
      aria-label="Averaged RMS spectrum from zero to 3000 Hz in decibels"></canvas>
  </main>
`
const status = document.querySelector<HTMLPreElement>('#status')!
const waveformCanvas = document.querySelector<HTMLCanvasElement>('#waveform')!
const spectrumCanvas = document.querySelector<HTMLCanvasElement>('#spectrum')!
const waveformContext = waveformCanvas.getContext('2d', { willReadFrequently: true })!
const spectrumContext = spectrumCanvas.getContext('2d', { willReadFrequently: true })!

type AppState = 'ready' | 'starting' | 'recording' | 'calculating' | 'switching' | 'spectrum' | 'error'

function waveformPage() {
  return {
    containerTotalNum: 2,
    textObject: [new TextContainerProperty({
      containerID: textID, containerName: textName,
      xPosition: 0, yPosition: 0, width: 576, height: 80,
      paddingLength: 8, isEventCapture: 1,
      content: 'FFT ready\nTap to record',
    })],
    imageObject: [new ImageContainerProperty({
      containerID: imageID, containerName: imageName,
      xPosition: 144, yPosition: 92, width: IMAGE_WIDTH, height: IMAGE_HEIGHT,
    })],
  }
}

async function start() {
  const bridge = await waitForEvenAppBridge()
  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(waveformPage()))
  if (result !== StartUpPageCreateResult.success) {
    throw new Error(`Failed to create startup page: ${result}`)
  }

  let state: AppState = 'ready'
  let page: 'waveform' | 'spectrum' = 'waveform'
  let disposed = false
  let session = 0
  let afterStop = 0
  let stopReply: boolean | null = null
  let microphoneStop: Promise<void> = Promise.resolve()
  let microphoneStopError: unknown
  let microphoneRequested = false
  let sentFrames = 0
  let lastImageSamples = -1
  let lastImageKey = ''
  let imageError: unknown
  let errorMessage = ''
  let transferMs = 0
  let fps = 0
  let measuredFrames = 0
  let measuredAt = performance.now()
  let calculatingVisible = false
  let fft: FftClient | undefined

  function statusText() {
    const duration = (recording.sampleCount / recording.sampleRate).toFixed(1)
    if (state === 'ready') return 'FFT ready\nTap to record'
    if (state === 'starting') return 'Starting microphone...'
    if (state === 'recording') return `Recording ${duration} s | ${fps.toFixed(1)} fps\nTap to stop`
    if (state === 'error') return errorMessage
    return `Recording closed: ${duration} s\nAnalyzing...`
  }

  const statusSender = new LatestFrameSender(async () => {
    if (disposed || page !== 'waveform') return
    const content = statusText()
    const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: textID, containerName: textName,
      contentOffset: 0, contentLength: content.length, content,
    }))
    if (!updated) throw new Error('Failed to update status text')
    status.textContent = content
  }, reportError)

  const imageSender = new LatestFrameSender(async () => {
    if (disposed || page !== 'waveform') return
    const key = `${session}:${recording.sampleCount}:${calculatingVisible}`
    if (key === lastImageKey) return
    const imageData = drawWaveform(waveformContext, recording, calculatingVisible)
    const sampleCount = recording.sampleCount
    const began = performance.now()
    const updated = await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: imageID, containerName: imageName, imageData,
    }))
    if (updated !== ImageRawDataUpdateResult.success) {
      throw new Error(`Failed to update waveform image: ${updated}`)
    }
    transferMs = performance.now() - began
    lastImageKey = key
    lastImageSamples = sampleCount
    sentFrames++
  }, error => {
    imageError = error
    reportError(error)
  })

  const indicator = new CalculatingIndicator(visible => {
    calculatingVisible = visible
    if (!disposed && page === 'waveform') void imageSender.request()
  }, {
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: id => window.clearInterval(id),
  })

  function stopMicrophone() {
    microphoneRequested = false
    microphoneStopError = undefined
    microphoneStop = bridge.audioControl(false).then(reply => {
      stopReply = reply
      // Simulator 0.9.5 returns false on close even when incoming PCM stops.
      console.log('[audio-control] stop requested; reply:', reply)
    }).catch(error => {
      microphoneStopError = error
      reportError(error)
    })
    return microphoneStop
  }

  async function drainWaveform() {
    await Promise.all([imageSender.whenIdle(), statusSender.whenIdle()])
  }

  async function restoreWaveformPage() {
    await drainWaveform()
    if (disposed) return
    if (page !== 'waveform') {
      const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(waveformPage()))
      if (!rebuilt) throw new Error('Failed to restore waveform page')
      page = 'waveform'
    }
    lastImageKey = ''
    waveformCanvas.hidden = false
    spectrumCanvas.hidden = true
  }

  async function showError(error: unknown) {
    if (disposed) return
    console.error(error instanceof Error ? error.message : String(error))
    recording.stop()
    indicator.stop()
    calculatingVisible = false
    state = 'switching'
    errorMessage = error instanceof RecordingTooShortError
      ? 'Recording too short (minimum 128 ms).\nTap to record again.'
      : 'Analysis or display failed.\nTap to record again.'
    try {
      await restoreWaveformPage()
      if (disposed) return
      state = 'error'
      await statusSender.request()
      await imageSender.request()
    } catch (displayError) {
      state = 'error'
      reportError(displayError)
    }
  }

  async function finishRecording() {
    // Close at the tap. No late PCM can alter the analysis or frozen waveform.
    recording.stop()
    state = 'calculating'
    const currentSession = session
    const samples = recording.copyRecording()
    const began = performance.now()
    console.log('[waveform] recording closed', JSON.stringify({ samples: samples.length, packets: recording.packetCount }))
    void stopMicrophone()
    imageError = undefined
    // Send the first visible message before starting the repeating timer.
    // A slow transfer must not keep whenIdle waiting on an endless blink queue.
    calculatingVisible = true
    await statusSender.request()
    await imageSender.request()
    if (imageError) throw imageError
    if (disposed) return
    if (samples.length < FFT_SIZE) throw new RecordingTooShortError()
    indicator.start()
    if (!fft) fft = new FftClient(new Worker(new URL('./fft.worker.ts', import.meta.url), { type: 'module' }))
    const spectrum = await fft.analyze(samples, recording.sampleRate, currentSession)
    if (disposed || currentSession !== session) return
    const plot = prepareSpectrum(spectrum)
    const tiles = drawSpectrum(spectrumContext, plot)
    indicator.stop()
    state = 'switching'
    await drainWaveform()
    if (disposed) return
    if (imageError) throw imageError

    const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 5,
      textObject: [new TextContainerProperty({
        containerID: textID, containerName: 'spectrum-input',
        xPosition: 0, yPosition: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT,
        paddingLength: 0, content: '', isEventCapture: 1, zOrderIndex: 0,
      })],
      imageObject: tiles.map((tile, index) => new ImageContainerProperty({
        containerID: 10 + index, containerName: `spectrum-${index}`,
        xPosition: tile.x, yPosition: tile.y,
        width: IMAGE_WIDTH, height: IMAGE_HEIGHT, zOrderIndex: index + 1,
      })),
    }))
    if (!rebuilt) throw new Error('Failed to create spectrum page')
    page = 'spectrum'
    for (let index = 0; index < tiles.length; index++) {
      if (disposed) return
      const updated = await bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: 10 + index, containerName: `spectrum-${index}`, imageData: tiles[index].pixels,
      }))
      if (updated !== ImageRawDataUpdateResult.success) throw new Error(`Failed to send spectrum tile ${index}`)
    }
    if (disposed) return
    state = 'spectrum'
    waveformCanvas.hidden = true
    spectrumCanvas.hidden = false
    status.textContent = 'Averaged RMS spectrum\nTap to record again'
    let peakBin = 0
    for (let k = 1; k < plot.dbValues.length; k++) {
      if (plot.dbValues[k] > plot.dbValues[peakBin]) peakBin = k
    }
    console.log('[fft] ready', JSON.stringify({
      session, samples: recording.sampleCount, frameCount: spectrum.frameCount,
      fftSize: spectrum.fftSize, hopSize: spectrum.hopSize,
      peakFrequency: peakBin * plot.binHz, peakDb: plot.dbValues[peakBin],
      yMin: plot.yMin, yMax: plot.yMax, elapsedMs: Math.round(performance.now() - began),
    }))
  }

  async function beginRecording() {
    state = 'starting'
    await microphoneStop
    if (microphoneStopError) {
      await stopMicrophone()
      if (microphoneStopError) throw microphoneStopError
    }
    if (disposed) return
    await restoreWaveformPage()
    if (disposed) return
    recording.start()
    session++
    afterStop = 0
    stopReply = null
    imageError = undefined
    fps = 0
    measuredFrames = sentFrames
    measuredAt = performance.now()
    await statusSender.request()
    await imageSender.request()
    if (imageError) throw imageError
    if (disposed) return
    microphoneRequested = true
    const opened = await bridge.audioControl(true)
    if (!opened) throw new Error('audioControl(true) failed; check microphone permission')
    if (disposed) return
    state = 'recording'
    console.log('[audio-control] started')
    void statusSender.request()
  }

  async function handleTap() {
    if (disposed || state === 'starting' || state === 'calculating' || state === 'switching') return
    try {
      if (state === 'recording') await finishRecording()
      else await beginRecording()
    } catch (error) {
      if (microphoneRequested) void stopMicrophone()
      // Recreate a failed worker on the next recording.
      fft?.dispose()
      fft = undefined
      await showError(error)
    }
  }

  const unsubscribe = bridge.onEvenHubEvent(event => {
    if (event.audioEvent) {
      const accepted = recording.appendPcm(event.audioEvent.audioPcm)
      if (!accepted && state !== 'ready' && state !== 'starting') afterStop++
    }
    const input = event.textEvent ?? event.sysEvent
    // Protobuf may omit CLICK_EVENT because its enum value is zero.
    if (input && (input.eventType ?? OsEventTypeList.CLICK_EVENT) === OsEventTypeList.CLICK_EVENT) {
      void handleTap()
    }
  })

  const imageTimer = window.setInterval(() => {
    if (state === 'recording' || state === 'starting') void imageSender.request()
  }, 200)
  const statusTimer = window.setInterval(() => {
    const now = performance.now()
    if (state === 'recording') fps = (sentFrames - measuredFrames) * 1000 / (now - measuredAt)
    measuredFrames = sentFrames
    measuredAt = now
    if (state !== 'ready') {
      console.log('[waveform-stats]', JSON.stringify({
        state, session, samples: recording.sampleCount, packets: recording.packetCount,
        windowSamples: Math.min(recording.sampleCount, recording.sampleRate * recording.windowSeconds),
        afterStop, stopReply, sentFrames, lastImageSamples,
        fps: Number(fps.toFixed(2)), transferMs: Number(transferMs.toFixed(2)),
      }))
      if (page === 'waveform' && state !== 'switching') void statusSender.request()
    }
  }, 1000)
  import.meta.hot?.dispose(() => {
    disposed = true
    recording.stop()
    indicator.stop()
    unsubscribe()
    window.clearInterval(imageTimer)
    window.clearInterval(statusTimer)
    imageSender.dispose()
    statusSender.dispose()
    fft?.dispose()
    void bridge.audioControl(false).catch(reportError)
  })
  await statusSender.request()
  await imageSender.request()
}

function reportError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  status.textContent = message
}

void start().catch(reportError)
