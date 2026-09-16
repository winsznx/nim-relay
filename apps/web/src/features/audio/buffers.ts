/**
 * Fetches and decodes audio files once, shares in-flight loads, and lets big buffers go when a
 * scene no longer needs them: a decoded minute of stereo music is ~20 MB, which matters inside a
 * mobile WebView. A file that fails to load resolves to null; the sound is simply skipped.
 */

type Fetcher = (url: string) => Promise<Response>

interface Entry {
  promise: Promise<AudioBuffer | null>
  buffer: AudioBuffer | null
}

export class BufferCache {
  private readonly entries = new Map<string, Entry>()
  private readonly warned = new Set<string>()

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly fetcher: Fetcher = url => fetch(url),
  ) {}

  /** The decoded buffer if it is ready. */
  get(url: string): AudioBuffer | null {
    return this.entries.get(url)?.buffer ?? null
  }

  load(url: string): Promise<AudioBuffer | null> {
    const existing = this.entries.get(url)
    if (existing) return existing.promise
    const entry: Entry = { promise: Promise.resolve(null), buffer: null }
    entry.promise = this.fetchAndDecode(url).then(
      buffer => {
        if (this.entries.get(url) === entry) entry.buffer = buffer
        return buffer
      },
      (error: unknown) => {
        if (this.entries.get(url) === entry) this.entries.delete(url)
        this.warn(url, error)
        return null
      },
    )
    this.entries.set(url, entry)
    return entry.promise
  }

  loadAll(urls: Iterable<string>): Promise<void> {
    return Promise.all([...urls].map(url => this.load(url))).then(() => undefined)
  }

  /** Forgets a decoded buffer; playing sources keep their own reference until they end. */
  release(url: string): void {
    this.entries.delete(url)
  }

  clear(): void {
    this.entries.clear()
  }

  private async fetchAndDecode(url: string): Promise<AudioBuffer> {
    const response = await this.fetcher(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return this.ctx.decodeAudioData(await response.arrayBuffer())
  }

  private warn(url: string, error: unknown): void {
    if (this.warned.has(url)) return
    this.warned.add(url)
    console.warn('Audio asset could not load', url, error)
  }
}

/** Copies rendered channels into an AudioBuffer (`sampleRate` may differ from the context's). */
export function toAudioBuffer(ctx: BaseAudioContext, channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(channels.length, channels[0]?.length ?? 1, sampleRate)
  channels.forEach((data, index) => buffer.getChannelData(index).set(data))
  return buffer
}
