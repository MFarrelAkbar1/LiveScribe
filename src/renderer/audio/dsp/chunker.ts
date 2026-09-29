/**
 * Chunker berbasis VAD energi untuk PCM 16 kHz mono.
 *
 * Aturan pemotongan:
 * 1. Idle → aktif saat frame pertama yang terdeteksi suara (ditambah pre-roll).
 * 2. Aktif → dipotong di JEDA (hening ≥ pauseMs) setelah bicara ≥ minChunkMs; chunk pendek
 *    ("Ya.") tetap dikirim setelah hening yang lebih panjang (longPause).
 * 3. Jika mencapai maxChunkMs, dipotong PAKSA di titik paling senyap dalam cutSearchMs
 *    terakhir. Bila titik itu masih suara (kalimat panjang tanpa jeda), chunk berikutnya
 *    dimulai overlapMs lebih awal supaya kata di batas tidak hilang → dedup di tahap 3.
 * 4. Anti-halusinasi: chunk dengan suara < minSpeechMs atau RMS-suara < minChunkRmsDb
 *    tidak dikirim (onDrop), karena Whisper cenderung "mengarang" teks dari hening/noise.
 *
 * Deteksi suara: frame (default 20 ms) dianggap suara jika energinya melebihi
 * max(minSpeechDb, noiseFloor + noiseMarginDb). Noise floor turun cepat, naik lambat.
 */
import {
  PCM_SAMPLE_RATE,
  type ChunkCutReason,
  type ChunkDropReason,
  type ChunkerConfig,
  type ChunkMeta,
  type StreamId
} from '@shared/audio'

export interface ChunkerHandlers {
  onChunk(meta: ChunkMeta, pcm: Float32Array): void
  onDrop?(meta: ChunkMeta, reason: ChunkDropReason): void
}

interface Frame {
  samples: Float32Array
  sumSq: number
  peak: number
  db: number
  speech: boolean
}

const SILENT_DB = -100
const NOISE_FLOOR_MIN_DB = -90
/** Batas atas noise floor → ambang suara tidak pernah lebih dari −40+margin dBFS. */
const NOISE_FLOOR_MAX_DB = -40
const NOISE_FALL = 0.5
const NOISE_RISE = 0.002
/** Lebar jendela (frame) saat mencari titik potong paling senyap. */
const QUIET_WINDOW = 5

const toDb = (meanSq: number): number => (meanSq > 0 ? Math.max(SILENT_DB, 10 * Math.log10(meanSq)) : SILENT_DB)

export class Chunker {
  private readonly frameLen: number
  private readonly frameMs: number
  private readonly n: {
    pause: number
    longPause: number
    minChunk: number
    maxChunk: number
    cutSearch: number
    overlap: number
    preRoll: number
    postRoll: number
  }

  private readonly partial: Float32Array
  private partialLen = 0

  /** Frame yang masih disimpan; frames[0] ber-indeks absolut `firstFrame`. */
  private frames: Frame[] = []
  private firstFrame = 0
  private nextFrame = 0

  private active = false
  private chunkStart = 0
  private lastSpeech = -1
  private lastEnd = 0
  private seq = 0
  private noiseFloor = -70

  constructor(
    readonly stream: StreamId,
    private readonly config: ChunkerConfig,
    private readonly handlers: ChunkerHandlers
  ) {
    this.frameMs = config.frameMs
    this.frameLen = Math.round((PCM_SAMPLE_RATE * config.frameMs) / 1000)
    const frames = (ms: number): number => Math.max(1, Math.round(ms / config.frameMs))
    this.n = {
      pause: frames(config.pauseMs),
      longPause: frames(Math.max(config.pauseMs * 2, 1000)),
      minChunk: frames(config.minChunkMs),
      maxChunk: frames(config.maxChunkMs),
      cutSearch: frames(Math.min(config.cutSearchMs, config.maxChunkMs / 2)),
      overlap: config.overlapMs > 0 ? frames(config.overlapMs) : 0,
      preRoll: frames(config.preRollMs),
      postRoll: frames(config.postRollMs)
    }
    this.partial = new Float32Array(this.frameLen)
  }

  get noiseFloorDb(): number {
    return this.noiseFloor
  }

  get isActive(): boolean {
    return this.active
  }

  push(samples: Float32Array): void {
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(this.frameLen - this.partialLen, samples.length - offset)
      this.partial.set(samples.subarray(offset, offset + take), this.partialLen)
      this.partialLen += take
      offset += take
      if (this.partialLen === this.frameLen) {
        this.addFrame(this.partial.slice())
        this.partialLen = 0
      }
    }
  }

  /** Kirim sisa chunk yang sedang berjalan (dipanggil saat Stop). */
  flush(): void {
    if (this.active) this.emit(this.chunkStart, this.nextFrame, 'flush')
    this.active = false
    this.dropBefore(this.nextFrame)
    this.partialLen = 0
  }

  private addFrame(samples: Float32Array): void {
    let sumSq = 0
    let peak = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]!
      sumSq += v * v
      const a = v < 0 ? -v : v
      if (a > peak) peak = a
    }
    const db = toDb(sumSq / samples.length)
    const threshold = Math.max(this.config.minSpeechDb, this.noiseFloor + this.config.noiseMarginDb)
    const speech = db > threshold
    this.updateNoiseFloor(db)

    const idx = this.nextFrame++
    this.frames.push({ samples, sumSq, peak, db, speech })

    if (!this.active) {
      if (speech) {
        this.active = true
        this.chunkStart = Math.max(this.firstFrame, this.lastEnd, idx - this.n.preRoll)
        this.lastSpeech = idx
      } else {
        this.keepPreRoll()
      }
      return
    }

    if (speech) this.lastSpeech = idx
    const silenceRun = idx - this.lastSpeech
    const speechSpan = this.lastSpeech + 1 - this.chunkStart

    if (silenceRun >= this.n.pause && (speechSpan >= this.n.minChunk || silenceRun >= this.n.longPause)) {
      const end = Math.min(this.lastSpeech + 1 + this.n.postRoll, idx + 1)
      this.emit(this.chunkStart, end, 'pause')
      this.active = false
      this.keepPreRoll()
      return
    }

    if (idx + 1 - this.chunkStart >= this.n.maxChunk) this.forceCut(idx)
  }

  private forceCut(idx: number): void {
    // Cari pusat jendela QUIET_WINDOW frame dengan energi rata-rata terendah.
    const half = QUIET_WINDOW >> 1
    const from = Math.max(this.chunkStart + this.n.minChunk, idx + 1 - this.n.cutSearch) + half
    const to = idx - half
    let cut = idx
    let best = Infinity
    for (let c = from; c <= to; c++) {
      let sum = 0
      for (let k = c - half; k <= c + half; k++) sum += this.frameAt(k).db
      if (sum < best) {
        best = sum
        cut = c
      }
    }

    const end = cut + 1
    const quiet = !this.frameAt(cut).speech
    const overlap = quiet ? 0 : this.n.overlap
    this.emit(this.chunkStart, end, 'max-length')

    this.chunkStart = end - overlap
    if (this.lastSpeech < end) {
      // Sisa setelah titik potong hanya hening → kembali idle.
      this.active = false
      this.keepPreRoll()
    } else {
      this.dropBefore(this.chunkStart)
    }
  }

  private emit(start: number, end: number, cutReason: ChunkCutReason): void {
    const count = end - start
    if (count <= 0) return
    const pcm = new Float32Array(count * this.frameLen)
    let peak = 0
    let speechSq = 0
    let speechFrames = 0
    for (let i = 0; i < count; i++) {
      const f = this.frameAt(start + i)
      pcm.set(f.samples, i * this.frameLen)
      if (f.peak > peak) peak = f.peak
      if (f.speech) {
        speechSq += f.sumSq
        speechFrames++
      }
    }

    const meta: ChunkMeta = {
      stream: this.stream,
      seq: ++this.seq,
      startMs: start * this.frameMs,
      durationMs: count * this.frameMs,
      overlapMs: start < this.lastEnd ? (this.lastEnd - start) * this.frameMs : 0,
      cutReason,
      speechMs: speechFrames * this.frameMs,
      // RMS hanya dari frame suara: chunk berisi jeda panjang tidak dianggap "terlalu pelan".
      rmsDb: speechFrames > 0 ? toDb(speechSq / (speechFrames * this.frameLen)) : -Infinity,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity
    }
    this.lastEnd = end

    if (meta.speechMs < this.config.minSpeechMs) this.handlers.onDrop?.(meta, 'no-speech')
    else if (meta.rmsDb < this.config.minChunkRmsDb) this.handlers.onDrop?.(meta, 'too-quiet')
    else this.handlers.onChunk(meta, pcm)
  }

  private updateNoiseFloor(db: number): void {
    const rate = db < this.noiseFloor ? NOISE_FALL : NOISE_RISE
    this.noiseFloor += (db - this.noiseFloor) * rate
    this.noiseFloor = Math.min(NOISE_FLOOR_MAX_DB, Math.max(NOISE_FLOOR_MIN_DB, this.noiseFloor))
  }

  private frameAt(abs: number): Frame {
    const f = this.frames[abs - this.firstFrame]
    if (!f) throw new RangeError(`Frame ${abs} sudah dibuang (first=${this.firstFrame})`)
    return f
  }

  private keepPreRoll(): void {
    this.dropBefore(this.nextFrame - this.n.preRoll)
  }

  private dropBefore(abs: number): void {
    const remove = Math.min(this.frames.length, abs - this.firstFrame)
    if (remove <= 0) return
    this.frames.splice(0, remove)
    this.firstFrame += remove
  }
}
