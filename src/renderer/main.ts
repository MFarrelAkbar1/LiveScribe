import { DEFAULT_CHUNKER_CONFIG, type ChunkMeta } from '@shared/audio'
import { sessionIdFromDate } from '@shared/format'
import { AudioCapture, CaptureError, type CaptureEvent } from './audio/capture'
import { floatToInt16 } from './audio/dsp/pcm'
import { AudioPipeline } from './audio/pipeline'
import { ChunkLog } from './ui/chunk-log'
import { LevelMeter } from './ui/level-meter'
import { Toaster } from './ui/toast'

type RunState = 'idle' | 'starting' | 'running' | 'stopping'

/** Di bawah ini dianggap hening (≈ noise floor digital). */
const SILENCE_DB = -70
/** Lama hening sebelum muncul peringatan "tidak ada audio". */
const SILENCE_WARN_MS = 8000
const STATS_INTERVAL_MS = 250

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const toggleBtn = $<HTMLButtonElement>('toggle')
const micCheckbox = $<HTMLInputElement>('mic')
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
  // Tahap 3: chunk dikirim ke engine transkripsi di sini.
  if (!saveWavCheckbox.checked) return
  const pcm16 = floatToInt16(pcm)
  window.api
    .invoke('debug:save-chunk', { sessionId: id, meta, pcm: pcm16.buffer })
    .then(() => chunkLog.markSaved())
    .catch((err: unknown) => {
      console.error('Gagal menyimpan chunk', err)
      if (!saveErrorShown) showNotice(`Gagal menyimpan chunk .wav: ${String(err)}`, 'error')
      saveErrorShown = true
    })
}

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
