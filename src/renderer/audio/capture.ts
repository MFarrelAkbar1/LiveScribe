import type { AudioSourceKind } from '@shared/types'

/**
 * Graf audio untuk capture:
 *
 *   system (loopback) ─► MediaStreamSource ─► Analyser ─► bus[system] ─┐
 *                                                                        ├─► mixBus ─► sink (gain 0) ─► destination
 *   mic (opsional)    ─► MediaStreamSource ─► Analyser ─► bus[mic]    ─┘
 *
 * AudioPipeline menambahkan cabang mixBus (atau bus[kind]) ─► PCM worklet ─► sink.
 *
 * - `bus[kind]` bersifat permanen selama sesi: saat perangkat berganti, hanya rantai
 *   MediaStreamSource→Analyser yang diganti. Pipeline yang tersambung ke bus (mode
 *   "separate") atau ke mixBus (mode "mix") tidak perlu disambung ulang.
 * - `sink` wajib ada: Chromium hanya memproses node yang (akhirnya) ditarik oleh
 *   `destination`. AnalyserNode yang punya output tidak lagi di-pull otomatis, sehingga
 *   tanpa sink semua sampel bernilai 0. Gain 0 → tidak ada suara yang keluar / feedback.
 *
 * Perangkat default dipantau (event `devicechange`). Jika output default berganti
 * (colok/lepas headphone, Bluetooth), loopback di-restart otomatis ke perangkat baru;
 * begitu juga mic jika input default berganti. Track yang mati sendiri dicoba ulang.
 */

export interface LevelReading {
  /** RMS dalam dBFS (−∞..0). */
  rmsDb: number
  /** Puncak absolut dalam dBFS. */
  peakDb: number
}

export type CaptureEvent =
  | { type: 'reconnecting'; source: AudioSourceKind }
  | { type: 'device-switched'; source: AudioSourceKind; device: string | null }
  /** Gagal pulih; capture tetap berjalan (hening) dan dicoba lagi saat ada perubahan perangkat. */
  | { type: 'source-lost'; source: AudioSourceKind; message: string }

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

interface DefaultDevices {
  output: string | null
  input: string | null
}

const DEVICE_CHANGE_DEBOUNCE_MS = 600
const RETRY_DELAYS_MS = [500, 1500, 3000]

const toDb = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity)
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class AudioCapture {
  readonly ctx: AudioContext
  /** Titik penjumlahan semua sumber — tempat pipeline PCM disambungkan di mode "mix". */
  readonly mixBus: GainNode
  /** Node bisu yang tersambung ke destination; semua cabang yang harus diproses berakhir di sini. */
  readonly sink: GainNode
  onEvent: ((event: CaptureEvent) => void) | null = null

  private readonly buses: Record<AudioSourceKind, GainNode>
  private readonly sources = new Map<AudioSourceKind, SourceChain>()
  /** Sumber yang diminta aktif (termasuk yang sedang terputus & menunggu pulih). */
  private readonly wanted = new Set<AudioSourceKind>()
  private readonly restarting = new Map<AudioSourceKind, Promise<void>>()
  private defaults: DefaultDevices = { output: null, input: null }
  private deviceTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  private constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    this.mixBus = new GainNode(this.ctx, { gain: 1 })
    this.sink = new GainNode(this.ctx, { gain: 0 })
    this.buses = { system: new GainNode(this.ctx), mic: new GainNode(this.ctx) }
    this.buses.system.connect(this.mixBus)
    this.buses.mic.connect(this.mixBus)
    this.mixBus.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  /** Mulai capture audio sistem; mic ditambahkan terpisah via `setMicEnabled`. */
  static async start(): Promise<AudioCapture> {
    const capture = new AudioCapture()
    try {
      await capture.ctx.resume()
      capture.defaults = await readDefaultDevices()
      capture.addSource('system', await getSystemAudioStream())
      capture.wanted.add('system')
      navigator.mediaDevices.addEventListener('devicechange', capture.onDeviceChange)
      return capture
    } catch (err) {
      await capture.stop()
      throw err
    }
  }

  /** Nyalakan/matikan mikrofon saat capture berjalan. */
  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.wanted.delete('mic')
      this.removeSource('mic')
      return
    }
    if (this.wanted.has('mic')) return
    const stream = await getMicStream()
    if (this.closed) {
      stopStream(stream)
      return
    }
    this.wanted.add('mic')
    this.addSource('mic', stream)
  }

  hasSource(kind: AudioSourceKind): boolean {
    return this.sources.has(kind)
  }

  /** Bus per-sumber yang stabil selama sesi — titik sambung pipeline untuk mode "separate". */
  getSourceBus(kind: AudioSourceKind): AudioNode {
    return this.buses[kind]
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
    clearTimeout(this.deviceTimer)
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange)
    this.wanted.clear()
    for (const kind of [...this.sources.keys()]) this.removeSource(kind)
    this.mixBus.disconnect()
    this.sink.disconnect()
    await this.ctx.close().catch(() => undefined)
  }

  private readonly onDeviceChange = (): void => {
    clearTimeout(this.deviceTimer)
    this.deviceTimer = setTimeout(() => void this.checkDefaults(), DEVICE_CHANGE_DEBOUNCE_MS)
  }

  private async checkDefaults(): Promise<void> {
    if (this.closed) return
    const next = await readDefaultDevices()
    const prev = this.defaults
    this.defaults = next
    for (const kind of this.wanted) {
      const changed = kind === 'system' ? next.output !== prev.output : next.input !== prev.input
      // Sumber yang sempat hilang juga dicoba lagi pada setiap perubahan perangkat.
      if (changed || !this.sources.has(kind)) void this.restart(kind)
    }
  }

  /** Ganti rantai sumber dengan stream baru di perangkat default saat ini (dengan retry). */
  private restart(kind: AudioSourceKind): Promise<void> {
    const running = this.restarting.get(kind)
    if (running) return running
    const task = (async () => {
      this.onEvent?.({ type: 'reconnecting', source: kind })
      let lastError: unknown
      for (const wait of [0, ...RETRY_DELAYS_MS]) {
        if (wait) await delay(wait)
        if (this.closed || !this.wanted.has(kind)) return
        try {
          const stream = kind === 'system' ? await getSystemAudioStream() : await getMicStream()
          if (this.closed || !this.wanted.has(kind)) {
            stopStream(stream)
            return
          }
          this.removeSource(kind)
          this.addSource(kind, stream)
          const device = kind === 'system' ? this.defaults.output : this.defaults.input
          this.onEvent?.({ type: 'device-switched', source: kind, device })
          return
        } catch (err) {
          lastError = err
        }
      }
      this.removeSource(kind)
      this.onEvent?.({
        type: 'source-lost',
        source: kind,
        message: lastError instanceof Error ? lastError.message : String(lastError)
      })
    })().finally(() => this.restarting.delete(kind))
    this.restarting.set(kind, task)
    return task
  }

  private addSource(kind: AudioSourceKind, stream: MediaStream): void {
    const node = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream })
    const analyser = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0 })
    node.connect(analyser)
    analyser.connect(this.buses[kind])
    this.sources.set(kind, { stream, node, analyser, buffer: new Float32Array(analyser.fftSize) })
    for (const track of stream.getAudioTracks()) {
      // `ended` hanya terpicu jika track mati bukan karena kita (device dicabut, driver reset).
      track.addEventListener('ended', () => {
        if (this.sources.get(kind)?.stream === stream) void this.restart(kind)
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

/** Nama perangkat default Windows ("Default - Headphone (Realtek)" → "Headphone (Realtek)"). */
async function readDefaultDevices(): Promise<DefaultDevices> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const label = (kind: MediaDeviceKind): string | null => {
      const d = devices.find((x) => x.kind === kind && x.deviceId === 'default')
      return d ? d.label.replace(/^Default\s*-\s*/i, '') || 'default' : null
    }
    return { output: label('audiooutput'), input: label('audioinput') }
  } catch {
    return { output: null, input: null }
  }
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
