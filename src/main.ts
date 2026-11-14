import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { LatestFrameSender } from './latest-frame-sender.ts'
import { RecordingBuffer } from './recording.ts'
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
  </main>
`
const status = document.querySelector<HTMLPreElement>('#status')!
const canvas = document.querySelector<HTMLCanvasElement>('#waveform')!
const context = canvas.getContext('2d', { willReadFrequently: true })!

type AudioState = 'ready' | 'starting' | 'recording' | 'stopping' | 'stopped'

async function start() {
  const bridge = await waitForEvenAppBridge()
  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [new TextContainerProperty({
      containerID: textID,
      containerName: textName,
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 64,
      paddingLength: 8,
      isEventCapture: 1,
      content: 'FFT ready\nTap to record',
    })],
    imageObject: [new ImageContainerProperty({
      containerID: imageID,
      containerName: imageName,
      xPosition: 144,
      yPosition: 92,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    })],
  }))
  if (result !== StartUpPageCreateResult.success) {
    throw new Error(`Failed to create startup page: ${result}`)
  }

  let state: AudioState = 'ready'
  let session = 0
  let afterStop = 0
  let lastAudioAt: number | null = null
  let stopRequestedAt: number | null = null
  let stopReply: boolean | null = null
  let sentFrames = 0
  let lastImageSamples = -1
  let lastImageKey = ''
  let transferMs = 0
  let fps = 0
  let measuredFrames = 0
  let measuredAt = performance.now()

  function statusText() {
    const duration = (recording.sampleCount / recording.sampleRate).toFixed(1)
    if (state === 'ready') return 'FFT ready\nTap to record'
    if (state === 'starting') return 'Starting microphone...'
    if (state === 'recording') return `Recording ${duration} s | ${fps.toFixed(1)} fps\nTap to stop`
    if (state === 'stopping') return `Recording closed: ${duration} s\nStopping microphone...`
    return `Stopped: ${duration} s | Tap to record again\nStop reply: ${stopReply}`
  }

  const statusSender = new LatestFrameSender(async () => {
    const content = statusText()
    const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: textID, containerName: textName,
      contentOffset: 0, contentLength: content.length, content,
    }))
    if (!updated) throw new Error('Failed to update status text')
    status.textContent = content
  }, reportError)

  const imageSender = new LatestFrameSender(async () => {
    const key = `${session}:${recording.sampleCount}`
    if (key === lastImageKey) return
    // Draw at send time. No rendered frames or PCM snapshots queue up here.
    const imageData = drawWaveform(context, recording)
    const sampleCount = recording.sampleCount
    const began = performance.now()
    const updated = await bridge.updateImageRawData(new ImageRawDataUpdate({
      containerID: imageID,
      containerName: imageName,
      imageData,
    }))
    if (updated !== ImageRawDataUpdateResult.success) {
      throw new Error(`Failed to update waveform image: ${updated}`)
    }
    transferMs = performance.now() - began
    lastImageKey = key
    lastImageSamples = sampleCount
    sentFrames++
  }, reportError)

  async function toggleAudio() {
    if (state === 'starting' || state === 'stopping') return
    if (state === 'recording') {
      // Close the recording at the tap, before awaiting the host response.
      // Any trailing callbacks cannot alter either the full recording or the ring.
      recording.stop()
      state = 'stopping'
      stopRequestedAt = performance.now()
      console.log('[waveform] recording closed', JSON.stringify({
        samples: recording.sampleCount, packets: recording.packetCount,
      }))
      void imageSender.request() // Deliver the final snapshot after any in-flight image.
      void statusSender.request()
      stopReply = await bridge.audioControl(false)
      console.log('[audio-control] stop requested; reply:', stopReply)
    } else {
      recording.start()
      session++
      afterStop = 0
      lastAudioAt = stopRequestedAt = null
      stopReply = null
      fps = 0
      measuredFrames = sentFrames
      measuredAt = performance.now()
      state = 'starting'
      void statusSender.request()
      await imageSender.request()
      const opened = await bridge.audioControl(true)
      if (!opened) {
        recording.stop()
        state = 'ready'
        throw new Error('audioControl(true) failed; check microphone permission')
      }
      state = 'recording'
      console.log('[audio-control] started')
    }
    void statusSender.request()
  }

  const unsubscribe = bridge.onEvenHubEvent((event) => {
    if (event.audioEvent) {
      lastAudioAt = performance.now()
      const accepted = recording.appendPcm(event.audioEvent.audioPcm)
      if (!accepted && stopRequestedAt !== null) afterStop++
    }
    const input = event.textEvent ?? event.sysEvent
    // Protobuf may omit CLICK_EVENT because its enum value is zero.
    if (!input || (input.eventType ?? OsEventTypeList.CLICK_EVENT) !== OsEventTypeList.CLICK_EVENT) return
    void toggleAudio().catch(reportError)
  })

  const imageTimer = window.setInterval(() => {
    if (state === 'starting' || state === 'recording') void imageSender.request()
  }, 200)
  const statusTimer = window.setInterval(() => {
    const now = performance.now()
    // Simulator 0.9.5 returns false on close even when PCM stops.
    // Retain the reply and confirm cessation independently of that boolean.
    if (state === 'stopping' && stopReply !== null && stopRequestedAt !== null &&
        now - Math.max(stopRequestedAt, lastAudioAt ?? 0) >= 2000) {
      state = 'stopped'
    }
    if (state === 'recording') {
      fps = (sentFrames - measuredFrames) * 1000 / (now - measuredAt)
    }
    measuredFrames = sentFrames
    measuredAt = now
    if (state !== 'ready') {
      console.log('[waveform-stats]', JSON.stringify({
        state, session, samples: recording.sampleCount, packets: recording.packetCount,
        windowSamples: Math.min(recording.sampleCount, recording.sampleRate * recording.windowSeconds),
        afterStop, stopReply, sentFrames, lastImageSamples,
        fps: Number(fps.toFixed(2)), transferMs: Number(transferMs.toFixed(2)),
      }))
      void statusSender.request()
    }
  }, 1000)
  import.meta.hot?.dispose(() => {
    recording.stop()
    unsubscribe()
    window.clearInterval(imageTimer)
    window.clearInterval(statusTimer)
    imageSender.dispose()
    statusSender.dispose()
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
