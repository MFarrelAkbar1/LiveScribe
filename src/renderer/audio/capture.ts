import type { AudioSourceKind } from '@shared/types'

/**
 * Graf audio untuk capture:
 *
 *   system (loopback) ─► MediaStreamSource ─► Analyser ─┐
 *                                                        ├─► mixBus ─► sink (gain 0) ─► destination
 *   mic (opsional)    ─► MediaStreamSource ─► Analyser ─┘
 *
 * Setiap sumber punya node sendiri (`getSourceNode`) sehingga mode "separate"
 * (label Saya/Sistem) cukup menyambungkan pipeline PCM ke node per-sumber,
 * bukan ke mixBus.
 *
 * `sink` wajib ada: Chromium hanya memproses node yang (akhirnya) ditarik oleh
 * `destination`. AnalyserNode yang punya output tidak lagi di-pull otomatis, sehingga
 * tanpa sink semua sampel bernilai 0. Gain 0 → tidak ada suara yang keluar / feedback.
 */

export interface LevelReading {
  /** RMS dalam dBFS (−∞..0). */
  rmsDb: number
  /** Puncak absolut dalam dBFS. */
  peakDb: number
}

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly source: AudioSourceKind,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'CaptureError'
  }
}

interface SourceChain {
  stream: MediaStream
  node: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  buffer: Float32Array<ArrayBuffer>
}

const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity)

export class AudioCapture {
  readonly ctx: AudioContext
  /** Titik penjumlahan semua sumber — tempat pipeline PCM disambungkan di mode "mix". */
  readonly mixBus: GainNode
  /** Node bisu yang tersambung ke destination; semua cabang yang harus diproses berakhir di sini. */
  readonly sink: GainNode
  /** Dipanggil jika track berhenti sendiri (device dicabut, dll). */
  onSourceEnded: ((kind: AudioSourceKind) => void) | null = null

  private readonly sources = new Map<AudioSourceKind, SourceChain>()
  private closed = false

  private constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.mixBus = new GainNode(this.ctx, { gain: 1 })
    this.sink = new GainNode(this.ctx, { gain: 0 })
    this.mixBus.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  /** Mulai capture audio sistem; mic ditambahkan terpisah via `setMicEnabled`. */
  static async start(): Promise<AudioCapture> {
    const capture = new AudioCapture()
    try {
      await capture.ctx.resume()
      await capture.addSource('system', await getSystemAudioStream())
      return capture
    } catch (err) {
      await capture.stop()
      throw err
    }
  }

  /** Nyalakan/matikan mikrofon saat capture berjalan. */
  async setMicEnabled(enabled: boolean): Promise<void> {
    if (enabled === this.sources.has('mic')) return
    if (!enabled) {
      this.removeSource('mic')
      return
    }
    const stream = await getMicStream()
    if (this.closed) {
      stopStream(stream)
      return
    }
    await this.addSource('mic', stream)
  }

  hasSource(kind: AudioSourceKind): boolean {
    return this.sources.has(kind)
  }

  /** Node per-sumber, untuk mode "separate". */
  getSourceNode(kind: AudioSourceKind): AudioNode | null {
    return this.sources.get(kind)?.analyser ?? null
  }

  getLevel(kind: AudioSourceKind): LevelReading | null {
    const chain = this.sources.get(kind)
    if (!chain) return null
    const buf = chain.buffer
    chain.analyser.getFloatTimeDomainData(buf)
    let sumSq = 0
    let peak = 0
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]!
      sumSq += v * v
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    return { rmsDb: toDb(Math.sqrt(sumSq / buf.length)), peakDb: toDb(peak) }
  }

  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const kind of [...this.sources.keys()]) this.removeSource(kind)
    this.mixBus.disconnect()
    this.sink.disconnect()
    await this.ctx.close().catch(() => undefined)
  }

  private async addSource(kind: AudioSourceKind, stream: MediaStream): Promise<void> {
    const node = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream })
    const analyser = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0 })
    node.connect(analyser)
    analyser.connect(this.mixBus)
    this.sources.set(kind, {
      stream,
      node,
      analyser,
      buffer: new Float32Array(analyser.fftSize)
    })
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.sources.get(kind)?.stream !== stream) return
        this.removeSource(kind)
        this.onSourceEnded?.(kind)
      })
    }
  }

  private removeSource(kind: AudioSourceKind): void {
    const chain = this.sources.get(kind)
    if (!chain) return
    this.sources.delete(kind)
    chain.node.disconnect()
    chain.analyser.disconnect()
    stopStream(chain.stream)
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

async function getSystemAudioStream(): Promise<MediaStream> {
  let stream: MediaStream
  try {
    // Main process menjawab ini dengan { video: layar, audio: 'loopback' } (lihat main/capture.ts).
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    })
  } catch (err) {
    throw new CaptureError(describeMediaError(err, 'system'), 'system', { cause: err })
  }
  // Video hanya syarat Chromium — buang secepatnya.
  for (const track of stream.getVideoTracks()) {
    track.stop()
    stream.removeTrack(track)
  }
  if (stream.getAudioTracks().length === 0) {
    stopStream(stream)
    throw new CaptureError(
      'Audio loopback tidak tersedia. Pastikan ada perangkat output audio yang aktif (speaker/headphone).',
      'system'
    )
  }
  return stream
}

async function getMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    })
  } catch (err) {
    throw new CaptureError(describeMediaError(err, 'mic'), 'mic', { cause: err })
  }
}

function describeMediaError(err: unknown, kind: AudioSourceKind): string {
  const label = kind === 'mic' ? 'mikrofon' : 'audio sistem'
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
      return kind === 'mic'
        ? 'Akses mikrofon ditolak. Buka Windows Settings › Privacy & security › Microphone, lalu izinkan aplikasi desktop.'
        : 'Akses capture audio sistem ditolak.'
    case 'NotFoundError':
      return kind === 'mic' ? 'Mikrofon tidak ditemukan.' : 'Tidak ada perangkat output audio yang ditemukan.'
    case 'NotReadableError':
      return `Perangkat ${label} sedang dipakai aplikasi lain atau tidak bisa dibuka.`
    case 'AbortError':
      return `Capture ${label} dibatalkan.`
    default:
      return `Gagal memulai capture ${label}: ${err instanceof Error ? err.message : String(err)}`
  }
}
