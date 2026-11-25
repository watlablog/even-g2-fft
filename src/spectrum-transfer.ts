import type { SpectrumTile } from './spectrum.ts'

function equalPixels(left: Uint8Array | undefined, right: Uint8Array): boolean {
  if (!left || left.length !== right.length) return false
  for (let index = 0; index < right.length; index++) if (left[index] !== right[index]) return false
  return true
}

// The caller serializes frames. Cache only acknowledged tiles, including when
// a menu interrupts a frame; invalidation also discards in-flight old caches.
export class SpectrumTransfer {
  private pixels: Array<Uint8Array | undefined> = []
  private generation = 0

  constructor(sendTile: (index: number, pixels: Uint8Array) => Promise<void>) {
    this.sendTile = sendTile
  }

  private readonly sendTile: (index: number, pixels: Uint8Array) => Promise<void>

  invalidate() {
    this.pixels = []
    this.generation++
  }

  async send(tiles: readonly SpectrumTile[], canSend: () => boolean = () => true) {
    const generation = this.generation
    let sentTiles = 0
    for (let index = 0; index < tiles.length; index++) {
      if (generation !== this.generation || !canSend()) return { complete: false, sentTiles }
      const pixels = tiles[index].pixels
      if (equalPixels(this.pixels[index], pixels)) continue
      await this.sendTile(index, pixels)
      sentTiles++
      if (generation !== this.generation) return { complete: false, sentTiles }
      this.pixels[index] = pixels.slice()
    }
    return { complete: canSend(), sentTiles }
  }
}
