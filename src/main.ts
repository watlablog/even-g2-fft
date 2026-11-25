import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { CalculatingIndicator } from './calculating.ts'
import { CursorMotion } from './cursor-motion.ts'
import { FFT_SIZE, RecordingTooShortError } from './fft.ts'
import type { AveragedSpectrum } from './fft.ts'
import { FftClient } from './fft-client.ts'
import { LatestFrameSender } from './latest-frame-sender.ts'
import { initializePage } from './page-lifecycle.ts'
import { RealtimeDisplay, RT_HOLD_MS } from './realtime-display.ts'
import { RealtimeAverage, RT_AVERAGE_WINDOW_MS } from './realtime-average.ts'
import { RealtimeAnalysis } from './realtime-analysis.ts'
import { RecordingBuffer, SAMPLE_RATE } from './recording.ts'
import { cursorReadout, prepareSpectrum, SpectrumRenderer, SCREEN_HEIGHT, SCREEN_WIDTH, SPECTRUM_READOUT } from './spectrum.ts'
import { CURSOR_MODE_ID, NORMAL_MODE_ID, PEAK_MODE_ID, RT_MODE_ID, SpectrumControls, hubInputType } from './spectrum-controls.ts'
import type { SpectrumMode } from './spectrum-controls.ts'
import type { SpectrumPlot } from './spectrum.ts'
import { SpectrumTransfer } from './spectrum-transfer.ts'
import { drawWaveform, IMAGE_HEIGHT, IMAGE_WIDTH } from './waveform.ts'
import './style.css'

const textID = 1
const textName = 'status'
const imageID = 2
const imageName = 'time-waveform'
const readoutID = 3
const readoutName = 'cursor-values'
const recording = new RecordingBuffer()

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <pre id="status" role="status">Connecting...</pre>
    <canvas id="waveform" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}"
      aria-label="Last five seconds of audio, amplitude minus one to plus one"></canvas>
    <canvas id="spectrum" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" hidden
      aria-label="RMS spectrum from zero to 3000 Hz in decibels"></canvas>
  </main>
`
const status = document.querySelector<HTMLPreElement>('#status')!
const waveformCanvas = document.querySelector<HTMLCanvasElement>('#waveform')!
const spectrumCanvas = document.querySelector<HTMLCanvasElement>('#spectrum')!
const waveformContext = waveformCanvas.getContext('2d', { willReadFrequently: true })!
const spectrumContext = spectrumCanvas.getContext('2d', { willReadFrequently: true })!

type AppState = 'ready' | 'starting' | 'recording' | 'calculating' | 'switching' | 'spectrum' | 'realtime' | 'error'

function waveformPage() {
  return {
    containerTotalNum: 2,
    menuObject: new MenuContainerProperty({ menuItems: [new MenuItemProperty({ itemID: RT_MODE_ID, itemName: 'RT mode' })] }),
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

function spectrumPage(tiles: ReturnType<SpectrumRenderer['render']>) {
  return {
    containerTotalNum: 6,
    menuObject: new MenuContainerProperty({
      menuItems: [
        new MenuItemProperty({ itemID: CURSOR_MODE_ID, itemName: 'Cursor mode' }),
        new MenuItemProperty({ itemID: NORMAL_MODE_ID, itemName: 'Normal mode' }),
        new MenuItemProperty({ itemID: PEAK_MODE_ID, itemName: 'Peak mode' }),
        new MenuItemProperty({ itemID: RT_MODE_ID, itemName: 'RT mode' }),
      ],
    }),
    textObject: [new TextContainerProperty({
      containerID: textID, containerName: 'spectrum-input',
      xPosition: 0, yPosition: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT,
      paddingLength: 0, content: '', isEventCapture: 1, zOrderIndex: 0,
    }), new TextContainerProperty({
      containerID: readoutID, containerName: readoutName,
      xPosition: SPECTRUM_READOUT.x, yPosition: SPECTRUM_READOUT.y,
      width: SPECTRUM_READOUT.width, height: SPECTRUM_READOUT.height,
      paddingLength: 0, content: ' ', isEventCapture: 0, zOrderIndex: 5,
    })],
    imageObject: tiles.map((tile, index) => new ImageContainerProperty({
      containerID: 10 + index, containerName: `spectrum-${index}`,
      xPosition: tile.x, yPosition: tile.y,
      width: IMAGE_WIDTH, height: IMAGE_HEIGHT, zOrderIndex: index + 1,
    })),
  }
}

interface SpectrumSource {
  spectrum: AveragedSpectrum
  sequence: number
}

interface SpectrumFrame extends SpectrumSource {
  plot: SpectrumPlot
  renderer: SpectrumRenderer
}

interface RealtimeSession {
  phase: 'starting' | 'running' | 'stopping' | 'paused' | 'resuming' | 'exiting'
  revision: number
  latest?: SpectrumSource
  committed?: SpectrumFrame
  placeholder: SpectrumFrame
  previous?: AveragedSpectrum
  previousPlot?: SpectrumPlot
  display: RealtimeDisplay
  average: RealtimeAverage
  analysis: RealtimeAnalysis
  worker: FftClient
  lastKey: string
  exitTo?: SpectrumMode
}

async function start() {
  const bridge = await waitForEvenAppBridge()
  const startup = await initializePage(bridge, new CreateStartUpPageContainer(waveformPage()))
  console.log('[page-startup]', startup)

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
  const controls = new SpectrumControls()
  let currentSpectrum: AveragedSpectrum | undefined
  let realtime: RealtimeSession | undefined
  let lastSpectrumKey = ''
  let spectrumRenderer: SpectrumRenderer | undefined
  let lastReadout = ' '
  let presentedCursorBin: number | undefined
  let lastScrollDirection: -1 | 1 | undefined
  const cursorMotion = new CursorMotion(() => { void spectrumSender.request() })

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

  const spectrumTransfer = new SpectrumTransfer(async (index, pixels) => {
    const updated = await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: 10 + index, containerName: `spectrum-${index}`, imageData: pixels,
    }))
    if (updated !== ImageRawDataUpdateResult.success) throw new Error(`Failed to send spectrum tile ${index}`)
  })

  const spectrumSender = new LatestFrameSender(async () => {
    if (realtime) { await sendRealtime(); return }
    const view = controls.spectrum
    if (disposed || page !== 'spectrum' || state !== 'spectrum' || controls.isOverlayOpen || !view || !spectrumRenderer) return
    const { plot, mode, cursorBin: targetBin, peakBin, revision } = view
    const cursor = mode === 'cursor' ? cursorMotion.frame ?? { bin: targetBin, moving: false }
      : mode === 'peak' && view.peaks.length ? { bin: targetBin, moving: false } : undefined
    const cursorBin = cursor?.bin ?? targetBin
    const key = `${session}:${revision}:${mode}:${cursor?.bin ?? ''}:${cursor?.moving ?? false}`
    if (key === lastSpectrumKey) return
    const began = performance.now()
    const tiles = spectrumRenderer.render(cursor, mode === 'peak')
    const canSend = () => !disposed && page === 'spectrum' && state === 'spectrum' && !controls.isOverlayOpen
    const sent = await spectrumTransfer.send(tiles, canSend)
    if (!sent.complete || !canSend()) return
    const readout = cursorReadout(plot, cursorBin)
    const content = mode === 'peak'
      ? view.peaks.length ? `Top ${view.peakIndex + 1}/${view.peaks.length}\n${readout.frequencyLabel}\n${readout.amplitudeLabel}` : 'No peaks'
      : cursor ? `${readout.frequencyLabel}\n${readout.amplitudeLabel}` : ' '
    if (content !== lastReadout) {
      const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: readoutID, containerName: readoutName, content,
      }))
      if (!updated) throw new Error('Failed to update cursor readout')
      lastReadout = content
    }
    if (!canSend()) return
    lastSpectrumKey = key
    presentedCursorBin = cursor?.bin
    status.textContent = mode === 'peak' ? `Peak mode\n${content}` : mode === 'cursor'
      ? `Cursor mode\n${readout.frequencyLabel} | ${readout.amplitudeLabel}`
      : 'Normal mode\nTap to record again'
    console.log('[spectrum-view]', JSON.stringify({
      session, revision, mode, cursorBin, targetBin, peakBin, peakRank: view.peakIndex + 1, peakCount: view.peaks.length, moving: cursor?.moving ?? false,
      frequencyHz: readout.frequencyHz, amplitudeDb: readout.amplitudeDb,
      sentTiles: sent.sentTiles, transferMs: Number((performance.now() - began).toFixed(1)),
    }))
  }, error => { void showError(error) })

  function makeFrame(spectrum: AveragedSpectrum, sequence: number, plot = prepareSpectrum(spectrum)): SpectrumFrame {
    return { spectrum, plot, renderer: new SpectrumRenderer(spectrumContext, plot), sequence }
  }

  async function updateReadout(content: string) {
    if (content === lastReadout) return
    const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: readoutID, containerName: readoutName, content,
    }))
    if (!updated) throw new Error('Failed to update spectrum readout')
    lastReadout = content
  }

  async function sendRealtime() {
    const rt = realtime
    if (!rt || disposed || page !== 'spectrum' || controls.isOverlayOpen ||
        (rt.phase !== 'running' && rt.phase !== 'paused')) return
    const source = rt.latest ?? rt.committed ?? rt.placeholder
    const revision = rt.revision
    const key = `${revision}:${rt.phase}:${source.sequence}`
    if (rt.lastKey === key) return
    if (rt.phase === 'running' && !rt.display.canPresent) {
      rt.display.request()
      return
    }
    // Render only the latest selected result, after its display hold has expired.
    const frame = source === rt.committed ? rt.committed : source === rt.placeholder ? rt.placeholder
      : makeFrame(source.spectrum, source.sequence, rt.display.prepare(source.spectrum))
    const canSend = () => !disposed && realtime === rt && revision === rt.revision && !controls.isOverlayOpen
    const began = performance.now()
    const sent = await spectrumTransfer.send(frame.renderer.render(undefined, true), canSend)
    if (!sent.complete || !canSend()) return
    const caption = rt.phase === 'paused' ? 'RT paused' : frame.sequence > 0 ? 'RT mode' : 'Waiting for audio...'
    await updateReadout(caption)
    if (!canSend()) return
    if (frame.sequence > 0) {
      const isNewFrame = frame.sequence > (rt.committed?.sequence ?? 0)
      rt.committed = frame
      if (rt.phase === 'running' && isNewFrame) rt.display.presented(frame.plot)
    }
    rt.lastKey = key
    status.textContent = `${caption}\n${rt.phase === 'paused' ? 'Tap to resume' : 'Tap to pause'} | Long press: Normal mode`
    console.log('[rt-view]', JSON.stringify({
      session, sequence: frame.sequence, phase: rt.phase, frameCount: frame.spectrum.frameCount,
      averageWindowMs: RT_AVERAGE_WINDOW_MS,
      hopSize: frame.spectrum.hopSize, sentTiles: sent.sentTiles, holdMs: RT_HOLD_MS,
      yMin: frame.plot.yMin, yMax: frame.plot.yMax, maxDb: Math.max(...frame.plot.dbValues),
      transferMs: Number((performance.now() - began).toFixed(1)),
      inputFrames: rt.analysis.completedFrames, replacedFrames: rt.analysis.replacedFrames,
    }))
  }

  async function ensureMicrophoneStopped() {
    await microphoneStop
    if (microphoneStopError) {
      await stopMicrophone()
      if (microphoneStopError) throw microphoneStopError
    }
  }

  async function beginRealtime() {
    if (disposed || realtime) return
    const previous = currentSpectrum
    const previousPlot = controls.spectrum?.plot
    const silent: AveragedSpectrum = {
      sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, hopSize: FFT_SIZE,
      frameCount: 1, meanPower: new Float64Array(FFT_SIZE / 2 + 1),
    }
    const worker = new FftClient(new Worker(new URL('./fft.worker.ts', import.meta.url), { type: 'module' }))
    const rtSession = ++session
    const rt: RealtimeSession = {
      phase: 'starting', revision: 0, lastKey: '', previous, previousPlot,
      average: new RealtimeAverage(),
      placeholder: makeFrame(previous ?? silent, 0, previousPlot), worker,
      display: new RealtimeDisplay(() => { if (realtime === rt && !disposed && !controls.isOverlayOpen) void spectrumSender.request() }),
      analysis: new RealtimeAnalysis(
        samples => worker.analyzeFrame(samples, SAMPLE_RATE, rtSession),
        (spectrum, sequence) => {
          if (disposed || realtime !== rt || rt.exitTo) return
          rt.latest = { spectrum: rt.average.push(spectrum, sequence), sequence }
          rt.display.request()
        },
        error => { void failRealtime(error).catch(reportError) },
      ),
    }
    realtime = rt
    state = 'realtime'
    cursorMotion.clear()
    // Release the previous recording's PCM; live audio never enters RecordingBuffer.
    recording.start()
    recording.stop()
    await ensureMicrophoneStopped()
    await Promise.all([drainWaveform(), spectrumSender.whenIdle()])
    if (disposed || realtime !== rt) return
    if (page !== 'spectrum') {
      const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(spectrumPage(rt.placeholder.renderer.render(undefined, true))))
      if (!rebuilt) throw new Error('Failed to create RT page')
      page = 'spectrum'
    }
    spectrumTransfer.invalidate()
    lastReadout = ' '
    waveformCanvas.hidden = true
    spectrumCanvas.hidden = false
    if (rt.exitTo) {
      rt.phase = 'paused'
      await finishRealtime(rt.exitTo)
      return
    }
    rt.analysis.resume()
    microphoneRequested = true
    const opened = await bridge.audioControl(true)
    if (!opened) throw new Error('audioControl(true) failed; check microphone permission')
    if (disposed || realtime !== rt) return
    rt.phase = 'running'
    if (rt.exitTo) await finishRealtime(rt.exitTo)
    else void spectrumSender.request()
  }

  async function toggleRealtime() {
    const rt = realtime
    if (!rt || disposed) return
    if (rt.phase === 'running') {
      rt.phase = 'stopping'
      rt.display.cancel()
      rt.revision++
      rt.latest = rt.committed
      rt.analysis.pause()
      rt.average.clear()
      await Promise.all([stopMicrophone(), spectrumSender.whenIdle()])
      if (microphoneStopError) throw microphoneStopError
      if (disposed || realtime !== rt) return
      rt.phase = 'paused'
      if (rt.committed) {
        const frozen = rt.committed
        const plot = rt.display.fitPausedUpper(frozen.plot)
        if (plot !== frozen.plot) rt.committed = makeFrame(frozen.spectrum, frozen.sequence, plot)
        rt.latest = rt.committed
      }
      if (rt.exitTo) { await finishRealtime(rt.exitTo); return }
      // A hold already shows the committed pixels. If a frame was interrupted,
      // the acknowledged tile cache identifies only the tiles to restore.
      rt.lastKey = ''
      void spectrumSender.request()
    } else if (rt.phase === 'paused') {
      rt.phase = 'resuming'
      rt.average.clear()
      rt.display.resetTiming()
      rt.revision++
      await ensureMicrophoneStopped()
      if (disposed || realtime !== rt) return
      if (!rt.exitTo) {
        rt.analysis.resume()
        microphoneRequested = true
        const opened = await bridge.audioControl(true)
        if (!opened) throw new Error('audioControl(true) failed; check microphone permission')
      }
      if (disposed || realtime !== rt) return
      rt.phase = 'running'
      if (rt.exitTo) await finishRealtime(rt.exitTo)
      else { rt.lastKey = ''; void spectrumSender.request() }
    }
  }

  async function finishRealtime(mode: SpectrumMode) {
    const rt = realtime
    if (!rt || disposed || rt.phase === 'exiting') return
    rt.exitTo = mode
    rt.display.cancel()
    rt.analysis.pause()
    rt.revision++
    rt.latest = rt.committed
    if (rt.phase === 'starting' || rt.phase === 'resuming' || rt.phase === 'stopping') return
    const frozen = rt.committed?.spectrum ?? rt.previous
    const frozenPlot = rt.committed?.plot ?? rt.previousPlot
    rt.phase = 'exiting'
    rt.analysis.dispose()
    rt.average.clear()
    rt.display.dispose()
    rt.worker.dispose()
    await Promise.all([microphoneRequested ? stopMicrophone() : microphoneStop, spectrumSender.whenIdle()])
    if (disposed || realtime !== rt) return
    realtime = undefined
    if (frozen) await presentFrozenSpectrum(frozen, mode, frozenPlot)
    else {
      await restoreWaveformPage()
      state = 'ready'
      await statusSender.request()
      await imageSender.request()
    }
    if (microphoneStopError) reportError(microphoneStopError)
  }

  async function presentFrozenSpectrum(spectrum: AveragedSpectrum, mode: SpectrumMode, plot?: SpectrumPlot) {
    const frame = makeFrame(spectrum, 0, plot)
    currentSpectrum = spectrum
    controls.setSpectrum(frame.plot, spectrum.meanPower)
    controls.selectMode(mode)
    spectrumRenderer = frame.renderer
    spectrumTransfer.invalidate()
    lastSpectrumKey = ''
    presentedCursorBin = undefined
    lastScrollDirection = undefined
    if (mode === 'cursor') cursorMotion.setPosition(controls.spectrum!.cursorBin)
    if (page !== 'spectrum') {
      const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(spectrumPage(frame.renderer.render())))
      if (!rebuilt) throw new Error('Failed to restore spectrum page')
      page = 'spectrum'
      lastReadout = ' '
    }
    state = 'spectrum'
    waveformCanvas.hidden = true
    spectrumCanvas.hidden = false
    await spectrumSender.request()
  }

  async function failRealtime(error: unknown) {
    const rt = realtime
    if (!rt || rt.phase === 'exiting' || disposed) return
    rt.phase = 'exiting'
    rt.revision++
    rt.analysis.dispose()
    rt.average.clear()
    rt.display.dispose()
    rt.worker.dispose()
    const frozen = rt.committed?.spectrum ?? rt.previous
    const frozenPlot = rt.committed?.plot ?? rt.previousPlot
    await Promise.all([stopMicrophone(), spectrumSender.whenIdle()])
    if (disposed || realtime !== rt) return
    realtime = undefined
    try {
      if (frozen) await presentFrozenSpectrum(frozen, 'normal', frozenPlot)
      else {
        await restoreWaveformPage()
        state = 'error'
        errorMessage = 'RT failed.\nTap to record again.'
        await statusSender.request()
        await imageSender.request()
      }
    } finally { reportError(error) }
  }

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
    currentSpectrum = undefined
    cursorMotion.clear()
    await Promise.all([drainWaveform(), spectrumSender.whenIdle()])
    if (disposed) return
    if (page !== 'waveform') {
      const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(waveformPage()))
      if (!rebuilt) throw new Error('Failed to restore waveform page')
      page = 'waveform'
    }
    lastImageKey = ''
    lastSpectrumKey = ''
    spectrumTransfer.invalidate()
    spectrumRenderer = undefined
    presentedCursorBin = undefined
    lastScrollDirection = undefined
    controls.clearSpectrum()
    waveformCanvas.hidden = false
    spectrumCanvas.hidden = true
  }

  async function showError(error: unknown) {
    if (disposed) return
    console.error(error instanceof Error ? error.message : String(error))
    if (realtime) {
      try { await failRealtime(error) } catch (displayError) { reportError(displayError) }
      return
    }
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
    currentSpectrum = spectrum
    const plot = prepareSpectrum(spectrum)
    controls.setSpectrum(plot, spectrum.meanPower)
    cursorMotion.clear()
    spectrumRenderer = new SpectrumRenderer(spectrumContext, plot)
    const tiles = spectrumRenderer.render()
    indicator.stop()
    state = 'switching'
    await drainWaveform()
    if (disposed) return
    if (imageError) throw imageError

    const rebuilt = await bridge.rebuildPageContainer(new RebuildPageContainer(spectrumPage(tiles)))
    if (!rebuilt) throw new Error('Failed to create spectrum page')
    page = 'spectrum'
    spectrumTransfer.invalidate()
    lastReadout = ' '
    presentedCursorBin = undefined
    lastScrollDirection = undefined
    const initial = await spectrumTransfer.send(tiles, () => !disposed && page === 'spectrum' && !controls.isOverlayOpen)
    if (disposed) return
    state = 'spectrum'
    waveformCanvas.hidden = true
    spectrumCanvas.hidden = false
    lastSpectrumKey = initial.complete ? `${session}:0:normal::false` : ''
    if (!initial.complete && !controls.isOverlayOpen) void spectrumSender.request()
    status.textContent = 'Normal mode\nTap to record again'
    const peakBin = controls.spectrum!.peakBin
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
    if (realtime || disposed || state === 'starting' || state === 'calculating' || state === 'switching') return
    if (state === 'spectrum' && controls.spectrum?.mode === 'cursor') return
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
      try {
        if (realtime) realtime.analysis.appendPcm(event.audioEvent.audioPcm)
        else {
          const accepted = recording.appendPcm(event.audioEvent.audioPcm)
          if (!accepted && state !== 'ready' && state !== 'starting') afterStop++
        }
      } catch (error) { void showError(error) }
    }
    const type = hubInputType(event)
    const menuID = event.menuItemClickEvent?.itemID
    if (type !== undefined || menuID !== undefined) {
      console.log('[mode-input]', JSON.stringify({ type, menuID, state, rtPhase: realtime?.phase, overlay: controls.isOverlayOpen }))
    }
    if (menuID === RT_MODE_ID && !realtime && (state === 'ready' || state === 'error' || state === 'spectrum')) {
      void beginRealtime().catch(showError)
      return
    }
    if (realtime) {
      controls.handleEvent(event, false)
      if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT || type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
        realtime.revision++
        realtime.display.resetTiming()
        realtime.lastKey = ''
        spectrumTransfer.invalidate()
        if (!controls.isOverlayOpen) void spectrumSender.request()
      } else if (menuID === NORMAL_MODE_ID || menuID === CURSOR_MODE_ID || menuID === PEAK_MODE_ID) {
        if (menuID === NORMAL_MODE_ID || realtime.committed) {
          const mode = menuID === CURSOR_MODE_ID ? 'cursor' : menuID === PEAK_MODE_ID ? 'peak' : 'normal'
          void finishRealtime(mode).catch(showError)
        }
      } else if (!event.menuItemClickEvent && !controls.isOverlayOpen) {
        if (type === OsEventTypeList.LONG_PRESS_EVENT) void finishRealtime('normal').catch(showError)
        else if (type === OsEventTypeList.CLICK_EVENT) void toggleRealtime().catch(showError)
      }
      return
    }
    const direction = type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : type === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : undefined
    const cursorActive = state === 'spectrum' && controls.spectrum?.mode === 'cursor' && !controls.isOverlayOpen
    // Cancel unseen interpolation on reversal or snapping, so precision input
    // acts on the acknowledged on-screen position rather than a future target.
    if (cursorActive && presentedCursorBin !== undefined &&
        (type === OsEventTypeList.DOUBLE_CLICK_EVENT || (direction !== undefined && lastScrollDirection !== undefined && direction !== lastScrollDirection))) {
      controls.rebaseCursor(presentedCursorBin)
      cursorMotion.setPosition(presentedCursorBin)
    }
    const action = controls.handleEvent(event, state === 'spectrum')
    const view = state === 'spectrum' ? controls.spectrum : undefined
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT || type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {
      spectrumTransfer.invalidate()
      lastSpectrumKey = ''
      lastScrollDirection = undefined
      if (view?.mode === 'cursor') cursorMotion.setPosition(view.cursorBin)
      else cursorMotion.clear()
    } else if (view?.mode === 'cursor' && !controls.isOverlayOpen && direction !== undefined) {
      lastScrollDirection = direction
      cursorMotion.moveTo(view.cursorBin)
    } else if (view?.mode === 'cursor' && (event.menuItemClickEvent || type === OsEventTypeList.DOUBLE_CLICK_EVENT)) {
      lastScrollDirection = undefined
      cursorMotion.setPosition(view.cursorBin)
    } else if (view?.mode !== 'cursor') {
      lastScrollDirection = undefined
      cursorMotion.clear()
    }
    if (action === 'tap') void handleTap()
    else if (action === 'redraw') void spectrumSender.request()
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
      if (page === 'waveform' && state !== 'switching' && state !== 'realtime') void statusSender.request()
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
    spectrumSender.dispose()
    cursorMotion.clear()
    realtime?.analysis.dispose()
    realtime?.average.clear()
    realtime?.display.dispose()
    realtime?.worker.dispose()
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
