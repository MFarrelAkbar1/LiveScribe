/**
 * Orkestrator engine transkripsi lokal (whisper.cpp).
 *
 *   checking ─► downloading ─► verifying ─► starting ─► ready
 *                  │ (cancel)                   │ CUDA gagal / tidak aktif
 *                  ▼                            ▼
 *              cancelled                 fallback ke build CPU
 *
 * Tidak mengimpor Electron: dipakai juga oleh scripts/bench-stt.ts di Node biasa.
 */
import { mkdir } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { PCM_SAMPLE_RATE, type ChunkMeta, type StreamId } from '@shared/audio'
import type {
  DownloadProgress,
  EngineStatus,
  FilterReason,
  GpuInfo,
  TranscribeRequest,
  TranscribeResult,
  TranscriptSegment
} from '@shared/stt'
import type { Language } from '@shared/types'
import { assertValidChunk } from '../chunk-validation'
import { encodeWav } from '../wav'
import { errorMessage, type FetchFn } from './download'
import { compareVersions, detectNvidiaGpu, missingVcRuntime, VC_REDIST_URL } from './gpu'
import {
  installModel,
  installVariant,
  isModelPresent,
  isVariantPresent,
  modelPath,
  serverExe,
  verifyModel,
  verifyVariant
} from './install'
import {
  BINARY_PINS,
  DEFAULT_MODEL,
  MODEL_PINS,
  VARIANT_LABELS,
  WHISPER_RELEASE,
  type BinaryVariant,
  type ModelId
} from './manifest'
import { dedupOverlap } from './text/dedup'
import { filterSegment } from './text/hallucination'
import { buildPrompt, CONTEXT_MAX_GAP_MS, CONTEXT_MAX_WORDS, INITIAL_PROMPTS } from './text/prompt'
import { normalizeText, splitWords } from './text/normalize'
import { ServerStartError, WhisperServer, type VerboseJson } from './whisper-server'

export type EnginePreference = 'auto' | 'cpu' | 'gpu'

export interface EngineOptions {
  /** Folder data engine, mis. %APPDATA%/LiveScribe/whisper. */
  root: string
  /** Dipakai untuk download (Electron: net.fetch agar ikut proxy sistem). */
  fetch: FetchFn
  onStatus?: (status: EngineStatus) => void
  preference?: EnginePreference
  model?: ModelId
  /** Log stderr whisper-server. */
  log?: (line: string) => void
  /** Diagnostik: respons mentah whisper per chunk (dipakai bench --verbose). */
  onRawResult?: (info: { meta: ChunkMeta; prompt: string; json: VerboseJson }) => void
}

interface StreamContext {
  /** Segmen terakhir yang tampil — acuan dedup overlap. */
  last: { id: string; text: string } | null
  /** Ekor transkrip untuk prompt konteks. */
  recentText: string
  /** Teks ter-normalisasi segmen terakhir (deteksi frasa yang berulang antar-chunk). */
  recentSegments: string[]
  lastEndMs: number
}

class NotReadyError extends Error {}

const LANGUAGES = new Set<Language>(['id', 'en', 'auto'])
const PROGRESS_INTERVAL_MS = 250
const MAX_AUTO_RESTARTS = 3
const AUTO_RESTART_WINDOW_MS = 5 * 60_000
const WAIT_READY_MS = 20_000
const GPU_THREADS = 4
const RECENT_SEGMENTS = 3

export class SttEngine {
  private status: EngineStatus
  private server: WhisperServer | null = null
  private preparing: Promise<void> | null = null
  private abort: AbortController | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private sessionId: string | null = null
  private readonly contexts = new Map<StreamId, StreamContext>()
  private readonly restarts: number[] = []
  private shuttingDown = false
  private readonly model: ModelId
  private readonly cpuThreads = Math.min(8, Math.max(2, Math.floor(availableParallelism() / 2)))

  constructor(private readonly opts: EngineOptions) {
    this.model = opts.model ?? DEFAULT_MODEL
    this.status = {
      state: 'checking',
      message: 'Memeriksa engine…',
      device: null,
      deviceName: null,
      gpu: null,
      fallbackReason: null,
      model: this.model,
      engineVersion: WHISPER_RELEASE.version,
      download: null
    }
  }

  getStatus(): EngineStatus {
    return this.status
  }

  /** Siapkan engine (download → verifikasi → start). Idempoten selama masih berjalan. */
  start(): Promise<void> {
    if (this.shuttingDown) return Promise.resolve()
    this.preparing ??= this.prepare().finally(() => (this.preparing = null))
    return this.preparing
  }

  cancelDownload(): void {
    this.abort?.abort(new Error('Download dibatalkan'))
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.cancelDownload()
    const server = this.server
    this.server = null
    await server?.stop()
  }

  transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    assertValidChunk(req.meta, req.pcm)
    if (!LANGUAGES.has(req.language)) throw new Error('Bahasa tidak valid')
    const enqueuedAt = performance.now()
    const job = this.queue.then(() => this.runJob(req, enqueuedAt))
    this.queue = job.catch(() => undefined)
    return job
  }

  // ─── persiapan ───────────────────────────────────────────────────────────

  private async prepare(): Promise<void> {
    await this.stopServer()
    this.abort = new AbortController()
    const { signal } = this.abort
    try {
      this.update({ state: 'checking', message: 'Memeriksa engine…', device: null, deviceName: null, download: null })
      const missingDll = await missingVcRuntime()
      if (missingDll.length) {
        throw new Error(
          `Microsoft Visual C++ Redistributable (x64) belum terpasang (${missingDll.join(', ')} tidak ditemukan). ` +
            `Pasang dari ${VC_REDIST_URL} lalu klik Coba lagi.`
        )
      }

      const gpu = await detectNvidiaGpu()
      const plan = this.planVariants(gpu)
      this.update({ gpu, fallbackReason: plan.fallbackReason })

      let fallbackReason = plan.fallbackReason
      for (const variant of plan.variants) {
        try {
          await this.ensureInstalled(variant, signal)
          await this.launch(variant, fallbackReason)
          return
        } catch (err) {
          if (signal.aborted || variant === 'cpu') throw err
          fallbackReason = `Engine CUDA gagal: ${errorMessage(err)}`
          console.warn('[stt]', fallbackReason)
          this.update({ fallbackReason })
        }
      }
    } catch (err) {
      if (signal.aborted) {
        this.update({ state: 'cancelled', message: 'Download dibatalkan. Klik Lanjutkan untuk melanjutkan.', download: null })
      } else {
        console.error('[stt] engine gagal disiapkan:', err)
        this.update({ state: 'error', message: errorMessage(err), download: null })
      }
    } finally {
      this.abort = null
    }
  }

  private planVariants(gpu: GpuInfo | null): { variants: BinaryVariant[]; fallbackReason: string | null } {
    const pref = this.opts.preference ?? 'auto'
    if (pref === 'cpu') return { variants: ['cpu'], fallbackReason: gpu ? 'Mode CPU dipaksa lewat pengaturan.' : null }
    if (!gpu) return { variants: ['cpu'], fallbackReason: null }
    const minDriver = BINARY_PINS.cuda.minDriver ?? ''
    if (compareVersions(gpu.driverVersion, minDriver) < 0) {
      return {
        variants: ['cpu'],
        fallbackReason: `Driver NVIDIA ${gpu.driverVersion} terlalu lama untuk CUDA 12 (minimal ${minDriver}).`
      }
    }
    return { variants: pref === 'gpu' ? ['cuda'] : ['cuda', 'cpu'], fallbackReason: null }
  }

  /** Unduh yang belum ada, lalu verifikasi SHA256 semua file sebelum dipakai. */
  private async ensureInstalled(variant: BinaryVariant, signal: AbortSignal): Promise<void> {
    const { root } = this.opts
    const modelPin = MODEL_PINS[this.model]
    const items: { label: string; size: number; run: (p: (n: number) => void) => Promise<void> }[] = []
    if (!(await isVariantPresent(root, variant))) {
      items.push({
        label: VARIANT_LABELS[variant],
        size: BINARY_PINS[variant].size,
        run: (onProgress) => installVariant(root, variant, { signal, fetch: this.opts.fetch, onProgress })
      })
    }
    if (!(await isModelPresent(root, this.model))) {
      items.push({
        label: `Model ${this.model}`,
        size: modelPin.size,
        run: (onProgress) => installModel(root, this.model, { signal, fetch: this.opts.fetch, onProgress })
      })
    }
    for (const [i, item] of items.entries()) {
      await item.run(this.progressReporter(item.label, item.size, i + 1, items.length))
    }

    this.update({ state: 'verifying', message: 'Memverifikasi checksum SHA256…', download: null })
    const [badFiles, modelOk] = await Promise.all([verifyVariant(root, variant), verifyModel(root, this.model)])
    if (badFiles.length || !modelOk) {
      // File rusak/diubah setelah terpasang → pasang ulang sekali dari sumber yang di-pin.
      const broken = [...badFiles, ...(modelOk ? [] : [modelPin.fileName])]
      console.warn('[stt] checksum tidak cocok, memasang ulang:', broken)
      if (badFiles.length) {
        await installVariant(root, variant, {
          signal,
          fetch: this.opts.fetch,
          onProgress: this.progressReporter(VARIANT_LABELS[variant], BINARY_PINS[variant].size, 1, 1)
        })
      }
      if (!modelOk) {
        await installModel(root, this.model, {
          signal,
          fetch: this.opts.fetch,
          onProgress: this.progressReporter(`Model ${this.model}`, modelPin.size, 1, 1)
        })
      }
      this.update({ state: 'verifying', message: 'Memverifikasi checksum SHA256…', download: null })
      const [again, modelAgain] = await Promise.all([verifyVariant(root, variant), verifyModel(root, this.model)])
      if (again.length || !modelAgain) throw new Error(`Checksum tetap tidak cocok: ${[...again].join(', ')}`)
    }
  }

  private progressReporter(label: string, total: number, item: number, items: number): (received: number) => void {
    let lastEmit = 0
    let rateBase = { at: performance.now(), bytes: -1 }
    let bytesPerSec = 0
    return (received) => {
      const now = performance.now()
      if (rateBase.bytes < 0) rateBase = { at: now, bytes: received }
      if (now - lastEmit < PROGRESS_INTERVAL_MS && received < total) return
      const dt = (now - rateBase.at) / 1000
      if (dt >= 1) {
        const instant = (received - rateBase.bytes) / dt
        bytesPerSec = bytesPerSec ? bytesPerSec * 0.6 + instant * 0.4 : instant
        rateBase = { at: now, bytes: received }
      }
      lastEmit = now
      const download: DownloadProgress = { label, receivedBytes: received, totalBytes: total, bytesPerSec, item, items }
      this.update({ state: 'downloading', message: `Mengunduh ${label}…`, download })
    }
  }

  private async launch(variant: BinaryVariant, fallbackReason: string | null): Promise<void> {
    const useGpu = variant === 'cuda'
    const threads = useGpu ? GPU_THREADS : this.cpuThreads
    this.update({
      state: 'starting',
      message: `Memuat model ${this.model} di ${useGpu ? 'GPU' : 'CPU'}…`,
      download: null,
      fallbackReason
    })
    const publicDir = join(this.opts.root, 'server-public')
    await mkdir(publicDir, { recursive: true })

    let server: WhisperServer
    try {
      server = await WhisperServer.start({
        exePath: serverExe(this.opts.root, variant),
        modelPath: modelPath(this.opts.root, this.model),
        threads,
        useGpu,
        publicDir,
        log: this.opts.log
      })
    } catch (err) {
      if (err instanceof ServerStartError) console.error('[stt] log whisper-server:\n' + err.logTail.join('\n'))
      throw err
    }

    if (useGpu && server.backend.device !== 'gpu') {
      await server.stop()
      throw new Error('backend CUDA tidak aktif (GPU tidak dikenali oleh whisper.cpp)')
    }
    if (this.shuttingDown) {
      await server.stop()
      return
    }

    // Warm-up: inisialisasi kernel CUDA / cache sebelum chunk pertama yang sebenarnya.
    await server
      .inference(encodeWav(new Uint8Array(PCM_SAMPLE_RATE * 2), PCM_SAMPLE_RATE), { language: 'en' }, 60_000)
      .catch((err: unknown) => console.warn('[stt] warm-up gagal:', err))

    server.onUnexpectedExit = (code) => this.onServerCrash(server, code)
    this.server = server
    console.info(`[stt] whisper-server pid ${server.pid} siap di 127.0.0.1:${server.port} (${server.backend.device})`)
    this.update({
      state: 'ready',
      message: 'Siap',
      device: server.backend.device,
      deviceName: server.backend.device === 'gpu' ? (server.backend.gpuName ?? this.status.gpu?.name ?? 'GPU NVIDIA') : `CPU · ${threads} thread`,
      download: null
    })
  }

  private onServerCrash(server: WhisperServer, code: number | null): void {
    if (this.server !== server || this.shuttingDown) return
    this.server = null
    const now = Date.now()
    while (this.restarts.length && now - this.restarts[0]! > AUTO_RESTART_WINDOW_MS) this.restarts.shift()
    const detail = `whisper-server berhenti tak terduga (kode ${code ?? '?'}).`
    console.error('[stt]', detail)
    if (this.restarts.length >= MAX_AUTO_RESTARTS) {
      this.update({ state: 'error', message: `${detail} Sudah ${MAX_AUTO_RESTARTS}× dimulai ulang; klik Coba lagi.` })
      return
    }
    this.restarts.push(now)
    this.update({ state: 'starting', message: `${detail} Memulai ulang…`, device: null, deviceName: null })
    void this.start()
  }

  private async stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    await server?.stop()
  }

  private update(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch }
    this.opts.onStatus?.(this.status)
  }

  // ─── transkripsi ─────────────────────────────────────────────────────────

  private async waitReady(): Promise<WhisperServer> {
    const deadline = performance.now() + WAIT_READY_MS
    // Tunggu hanya jika engine sedang start/restart (hitungan detik), bukan saat download.
    while (!this.server && this.preparing && performance.now() < deadline) {
      if (this.status.state === 'downloading' || this.status.state === 'cancelled') break
      await Promise.race([this.preparing, new Promise((r) => setTimeout(r, 250))])
    }
    if (!this.server) throw new NotReadyError(`Engine belum siap: ${this.status.message}`)
    return this.server
  }

  private async runJob(req: TranscribeRequest, enqueuedAt: number): Promise<TranscribeResult> {
    const server = await this.waitReady()
    const { meta, language } = req
    if (req.sessionId !== this.sessionId) {
      this.sessionId = req.sessionId
      this.contexts.clear()
    }
    const ctx = this.contexts.get(meta.stream) ?? { last: null, recentText: '', recentSegments: [], lastEndMs: -Infinity }
    this.contexts.set(meta.stream, ctx)

    const continuous = meta.startMs - ctx.lastEndMs <= CONTEXT_MAX_GAP_MS
    const prompt = buildPrompt(language, continuous ? ctx.recentText : '')
    const fields: Record<string, string> = {
      language,
      response_format: 'verbose_json',
      temperature: '0',
      temperature_inc: '0.2',
      suppress_nst: 'true',
      no_language_probabilities: 'true',
      // verbose_json menyalakan token timestamps secara default, dan itu membuat server
      // membungkus segmen tiap 60 karakter di batas TOKEN (memotong kata). Tidak kita pakai.
      token_timestamps: 'false'
    }
    if (prompt) fields['prompt'] = prompt

    const startedAt = performance.now()
    const json = await server.inference(
      encodeWav(new Uint8Array(req.pcm), PCM_SAMPLE_RATE),
      fields,
      Math.max(30_000, meta.durationMs * 10)
    )
    const inferenceMs = performance.now() - startedAt
    this.opts.onRawResult?.({ meta, prompt, json })

    return {
      ...this.postprocess(json, req, ctx),
      queueMs: startedAt - enqueuedAt,
      inferenceMs,
      device: server.backend.device,
      language: json.language ?? null
    }
  }

  private postprocess(
    json: VerboseJson,
    req: TranscribeRequest,
    ctx: StreamContext
  ): Pick<TranscribeResult, 'segments' | 'amended' | 'filtered'> {
    const { meta, language } = req
    const raw = (json.segments ?? []).filter((s) => s.text.trim())
    const filtered: { text: string; reason: FilterReason }[] = []
    const accepted: { startMs: number; endMs: number; text: string }[] = []
    for (const s of raw) {
      const out = filterSegment(
        { text: s.text, noSpeechProb: s.no_speech_prob ?? 0, avgLogprob: s.avg_logprob ?? 0 },
        {
          segmentCount: raw.length,
          initialPrompt: INITIAL_PROMPTS[language],
          chunkSpeechMs: meta.speechMs,
          recentSegments: ctx.recentSegments
        }
      )
      if (out.reason) {
        filtered.push({ text: out.text, reason: out.reason })
        continue
      }
      accepted.push({
        startMs: meta.startMs + Math.round((s.start ?? 0) * 1000),
        endMs: meta.startMs + Math.round((s.end ?? meta.durationMs / 1000) * 1000),
        text: out.text
      })
    }

    let amended: TranscribeResult['amended'] = null
    let dedupRemovedAll = false
    const first = accepted[0]
    if (first && meta.overlapMs > 0 && ctx.last) {
      const d = dedupOverlap(ctx.last.text, first.text, meta.overlapMs)
      if (d.removed.length) filtered.push({ text: d.removed.join(' '), reason: 'duplicate' })
      if (d.amendedPrev) {
        amended = { id: ctx.last.id, text: d.amendedPrev }
        ctx.last.text = d.amendedPrev
      }
      first.text = d.text
      if (!d.text) {
        accepted.shift()
        dedupRemovedAll = accepted.length === 0
      }
    }

    const segments: TranscriptSegment[] = accepted.map((a, i) => ({
      id: `${meta.stream}-${meta.seq}-${i}`,
      stream: meta.stream,
      ...a
    }))

    const last = segments.at(-1)
    // Chunk tanpa teks → overlap chunk berikutnya tidak punya pasangan; kecuali seluruhnya duplikat.
    if (last) ctx.last = { id: last.id, text: last.text }
    else if (!dedupRemovedAll) ctx.last = null
    ctx.recentSegments = [...ctx.recentSegments, ...segments.map((s) => normalizeText(s.text))].slice(-RECENT_SEGMENTS)
    const newText = segments.map((s) => s.text).join(' ')
    ctx.recentText = splitWords(`${ctx.recentText} ${newText}`).slice(-CONTEXT_MAX_WORDS).join(' ')
    ctx.lastEndMs = meta.startMs + meta.durationMs

    return { segments, amended, filtered }
  }
}

export { NotReadyError }
