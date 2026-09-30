import { DEFAULT_CHUNKER_CONFIG, type ChunkMeta } from '@shared/audio'
import { sessionIdFromDate } from '@shared/format'
import type { FilterReason, TranscribeResult } from '@shared/stt'
import type { Language } from '@shared/types'
import { AudioCapture, CaptureError, type CaptureEvent } from './audio/capture'
import { floatToInt16 } from './audio/dsp/pcm'
import { AudioPipeline } from './audio/pipeline'
import { ChunkLog } from './ui/chunk-log'
import { EnginePanel } from './ui/engine-panel'
import { LatencyStats } from './ui/latency-stats'
import { LevelMeter } from './ui/level-meter'
import { Toaster } from './ui/toast'
import { TranscriptView } from './ui/transcript-view'

type RunState = 'idle' | 'starting' | 'running' | 'stopping'

/** Di bawah ini dianggap hening (≈ noise floor digital). */
const SILENCE_DB = -70
/** Lama hening sebelum muncul peringatan "tidak ada audio". */
const SILENCE_WARN_MS = 8000
const STATS_INTERVAL_MS = 250
const LANGUAGE_KEY = 'livescribe.language'

const FILTER_LABEL: Record<FilterReason, string> = {
  'non-speech': 'bukan ucapan',
  blocklist: 'frasa halusinasi',
  'weak-phrase': 'frasa meragukan',
  'no-speech-prob': 'tanpa ucapan',
  repetition: 'pengulangan',
  'prompt-echo': 'gema prompt',
  duplicate: 'duplikat overlap'
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const toggleBtn = $<HTMLButtonElement>('toggle')
const micCheckbox = $<HTMLInputElement>('mic')
const languageSelect = $<HTMLSelectElement>('language')
const saveWavCheckbox = $<HTMLInputElement>('save-wav')
const openChunksBtn = $<HTMLButtonElement>('open-chunks')
const statusPill = $('status')
const notice = $('notice')
const footer = $('footer')
const meters = {
  system: new LevelMeter($('meter-system')),
  mic: new LevelMeter($('meter-mic'))
}
const chunkLog = new ChunkLog($('chunk-log'), $('chunk-stats'))
const toaster = new Toaster($('toasts'))
const enginePanel = new EnginePanel($('engine'), $('engine-badge'))
const transcript = new TranscriptView(
  $('transcript'),
  $('transcript-list'),
  $('transcript').querySelector('.placeholder') as HTMLElement
)
const latency = new LatencyStats($('stt-stats'))

let state: RunState = 'idle'
let capture: AudioCapture | null = null
let pipeline: AudioPipeline | null = null
let sessionId: string | null = null
let rafId = 0
let lastSoundAt = 0
let lastStatsAt = 0
let saveErrorShown = false

function setState(next: RunState, label?: string): void {
  state = next
  statusPill.dataset.state = next
  statusPill.textContent =
    label ?? { idle: 'Siap', starting: 'Memulai…', running: 'Merekam', stopping: 'Berhenti…' }[next]
  toggleBtn.textContent = next === 'running' || next === 'stopping' ? 'Stop' : 'Start'
  toggleBtn.classList.toggle('stop', next === 'running')
  toggleBtn.disabled = next === 'starting' || next === 'stopping'
}

function showNotice(message: string, kind: 'warn' | 'error' = 'warn', reason?: 'silence' | 'device'): void {
  notice.textContent = message
  notice.dataset.kind = kind
  if (reason) notice.dataset.reason = reason
  else delete notice.dataset.reason
  notice.hidden = false
}

function hideNotice(reason?: 'silence' | 'device'): void {
  if (reason && notice.dataset.reason !== reason) return
  notice.hidden = true
}

async function start(): Promise<void> {
  hideNotice()
  setState('starting')
  const id = sessionIdFromDate(new Date())
  let c: AudioCapture | null = null
  try {
    c = await AudioCapture.start()
    c.onEvent = onCaptureEvent
    pipeline = await AudioPipeline.create(c, 'mix', DEFAULT_CHUNKER_CONFIG, {
      onChunk: (meta, pcm) => onChunk(id, meta, pcm),
      onDrop: (meta, reason) => chunkLog.addDrop(meta, reason)
    })
  } catch (err) {
    console.error(err)
    await c?.stop()
    setState('idle', 'Gagal')
    statusPill.dataset.state = 'error'
    showNotice(err instanceof Error ? err.message : String(err), 'error')
    return
  }

  capture = c
  sessionId = id
  saveErrorShown = false
  chunkLog.reset()
  transcript.reset()
  latency.reset()
  setState('running')
  lastSoundAt = performance.now()
  if (micCheckbox.checked) await applyMic(true)
  rafId = requestAnimationFrame(tick)
}

async function stop(): Promise<void> {
  if (!capture) return
  setState('stopping')
  cancelAnimationFrame(rafId)
  const c = capture
  const p = pipeline
  capture = null
  pipeline = null
  await p?.stop() // flush kalimat terakhir sebelum AudioContext ditutup
  await c.stop()
  meters.system.update(null)
  meters.mic.update(null)
  hideNotice('silence')
  hideNotice('device')
  chunkLog.renderStats(null)
  setState('idle')
}

function onChunk(id: string, meta: ChunkMeta, pcm: Float32Array): void {
  chunkLog.addChunk(meta)
  const pcm16 = floatToInt16(pcm)
  transcribe(id, meta, pcm16.buffer)
  if (!saveWavCheckbox.checked) return
  window.api
    .invoke('debug:save-chunk', { sessionId: id, meta, pcm: pcm16.buffer })
    .then(() => chunkLog.markSaved())
    .catch((err: unknown) => {
      console.error('Gagal menyimpan chunk', err)
      if (!saveErrorShown) showNotice(`Gagal menyimpan chunk .wav: ${String(err)}`, 'error')
      saveErrorShown = true
    })
}

function transcribe(id: string, meta: ChunkMeta, pcm: ArrayBuffer): void {
  const sentAt = performance.now()
  latency.begin()
  window.api
    .invoke('stt:transcribe', { sessionId: id, meta, pcm, language: languageSelect.value as Language })
    .then((res) => {
      const e2eMs = performance.now() - sentAt
      latency.record(e2eMs, res.inferenceMs)
      chunkLog.setOutcome(meta, describeOutcome(res, e2eMs), {
        title: res.filtered.map((f) => `${FILTER_LABEL[f.reason]}: ${f.text}`).join('\n')
      })
      if (id !== sessionId) return // hasil sesi lama yang datang terlambat
      transcript.add(res.segments)
      if (res.amended) transcript.amend(res.amended.id, res.amended.text)
    })
    .catch((err: unknown) => {
      latency.fail()
      chunkLog.setOutcome(meta, `gagal: ${ipcErrorMessage(err)}`, { failed: true })
    })
}

function describeOutcome(res: TranscribeResult, e2eMs: number): string {
  const parts = [`${Math.round(e2eMs)} ms`, `${res.segments.length} segmen`]
  const reasons = new Set(res.filtered.map((f) => FILTER_LABEL[f.reason]))
  if (reasons.size) parts.push(`dibuang: ${[...reasons].join(', ')}`)
  return parts.join(' · ')
}

/** "Error invoking remote method 'x': Error: pesan" → "pesan" */
const ipcErrorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')

function onCaptureEvent(event: CaptureEvent): void {
  const label = event.source === 'mic' ? 'Mikrofon' : 'Audio sistem'
  switch (event.type) {
    case 'reconnecting':
      statusPill.textContent = 'Menyambung ulang…'
      break
    case 'device-switched':
      statusPill.textContent = 'Merekam'
      hideNotice('device')
      toaster.show(`${label} dialihkan ke ${event.device ?? 'perangkat default'}.`)
      break
    case 'source-lost':
      statusPill.textContent = 'Merekam'
      showNotice(
        `${label} terputus: ${event.message} Akan dicoba lagi otomatis saat perangkat audio berubah.`,
        'error',
        'device'
      )
      break
  }
}

async function applyMic(enabled: boolean): Promise<void> {
  if (!capture) return
  micCheckbox.disabled = true
  try {
    await capture.setMicEnabled(enabled)
  } catch (err) {
    micCheckbox.checked = false
    showNotice(err instanceof CaptureError ? err.message : String(err), 'error')
  } finally {
    micCheckbox.disabled = false
  }
}

function tick(now: number): void {
  if (!capture) return
  const system = capture.getLevel('system')
  meters.system.update(system)
  meters.mic.update(capture.getLevel('mic'))

  if (system && system.rmsDb > SILENCE_DB) {
    lastSoundAt = now
    hideNotice('silence')
  } else if (now - lastSoundAt > SILENCE_WARN_MS && notice.hidden) {
    showNotice(
      'Belum ada audio sistem terdeteksi. Putar sesuatu (mis. video YouTube) dan cek volume / perangkat output default.',
      'warn',
      'silence'
    )
  }

  if (now - lastStatsAt > STATS_INTERVAL_MS) {
    lastStatsAt = now
    chunkLog.renderStats(pipeline?.noiseFloorDb('mix') ?? null)
  }
  rafId = requestAnimationFrame(tick)
}

toggleBtn.addEventListener('click', () => {
  if (state === 'idle') void start()
  else if (state === 'running') void stop()
})

micCheckbox.addEventListener('change', () => {
  if (state === 'running') void applyMic(micCheckbox.checked)
})

languageSelect.addEventListener('change', () => {
  try {
    localStorage.setItem(LANGUAGE_KEY, languageSelect.value)
  } catch {
    // penyimpanan tidak tersedia — pilihan hanya berlaku sesi ini
  }
})

enginePanel.onAction = (action) => {
  void window.api.invoke(action === 'cancel' ? 'stt:cancel-download' : 'stt:retry')
}
window.api.on('stt:status', (status) => enginePanel.render(status))
void window.api.invoke('stt:get-status').then((status) => enginePanel.render(status))

try {
  const saved = localStorage.getItem(LANGUAGE_KEY)
  if (saved === 'id' || saved === 'en' || saved === 'auto') languageSelect.value = saved
} catch {
  // abaikan
}

openChunksBtn.addEventListener('click', () => {
  window.api.invoke('debug:open-chunk-folder', sessionId ?? undefined).catch((err: unknown) => {
    showNotice(`Tidak bisa membuka folder: ${String(err)}`, 'error')
  })
})

chunkLog.renderStats(null)

void window.api.invoke('app:get-info').then((info) => {
  footer.textContent = `LiveScribe v${info.version} · Electron ${info.electron}`
  if (info.platform !== 'win32') {
    showNotice('Capture audio loopback hanya didukung penuh di Windows.', 'error')
  }
})
