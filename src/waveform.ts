import type { RecordingBuffer } from './recording.ts'

export const IMAGE_WIDTH = 288
export const IMAGE_HEIGHT = 144
const LEFT = 28
const RIGHT = 279
const TOP = 10
const BOTTOM = 110
const PLOT_WIDTH = RIGHT - LEFT + 1

export function drawWaveform(
  context: CanvasRenderingContext2D,
  recording: RecordingBuffer,
  calculating = false,
): Uint8Array {
  context.fillStyle = '#000'
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  context.font = '10px monospace'
  context.textBaseline = 'middle'
  context.fillStyle = '#999'
  for (const amplitude of [-1, 0, 1]) {
    const y = Math.round(TOP + (1 - amplitude) * (BOTTOM - TOP) / 2)
    context.fillText(amplitude === 1 ? '+1' : String(amplitude), 2, y)
    // Dim grid lines distinguish the axes from waveform samples.
    context.fillRect(LEFT, y, PLOT_WIDTH, 1)
  }
  context.fillRect(LEFT, TOP, 1, BOTTOM - TOP + 1)
  context.fillRect(RIGHT, TOP, 1, BOTTOM - TOP + 1)
  for (let second = 0; second <= 5; second++) {
    const x = Math.round(LEFT + second * (PLOT_WIDTH - 1) / 5)
    context.fillRect(x, BOTTOM, 1, 4)
    context.textAlign = second === 0 ? 'left' : second === 5 ? 'right' : 'center'
    context.fillText(String(second), x, 123)
  }
  context.textAlign = 'center'
  context.fillText('Time[s]', (LEFT + RIGHT) / 2, 137)
  context.textAlign = 'left'

  const envelope = recording.columns(PLOT_WIDTH)
  context.fillStyle = '#fff'
  const yOf = (value: number) => Math.round(TOP + (1 - value) * (BOTTOM - TOP) / 2)
  for (let x = 0; x < PLOT_WIDTH; x++) {
    if (!envelope.present[x]) continue
    const top = yOf(envelope.maximum[x])
    const bottom = yOf(envelope.minimum[x])
    context.fillRect(LEFT + x, top, 1, bottom - top + 1)
  }

  if (calculating) {
    // Image origin is (144, 92), so (144, 52) is the screen center.
    context.fillStyle = '#000'
    context.fillRect(50, 36, 188, 32)
    context.fillStyle = '#fff'
    context.font = '18px monospace'
    context.textAlign = 'center'
    context.fillText('Calculating...', 144, 52)
    context.textAlign = 'left'
  }

  // Raw Gray8, one byte per pixel; the SDK handles transfer compression.
  const rgba = context.getImageData(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT).data
  const gray = new Uint8Array(IMAGE_WIDTH * IMAGE_HEIGHT)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]
  return gray
}
