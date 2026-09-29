import { AudioCapture, CaptureError } from './audio/capture'
import { LevelMeter } from './ui/level-meter'

type RunState = 'idle' | 'starting' | 'running' | 'stopping'

/** Di bawah ini dianggap hening (≈ noise floor digital). */
const SILENCE_DB = -70
/** Lama hening sebelum muncul peringatan "tidak ada audio". */
const SILENCE_WARN_MS = 8000

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const toggleBtn = $<HTMLButtonElement>('toggle')
const micCheckbox = $<HTMLInputElement>('mic')
const statusPill = $('status')
const notice = $('notice')
const footer = $('footer')
const meters = {
  system: new LevelMeter($('meter-system')),
  mic: new LevelMeter($('meter-mic'))
}

let state: RunState = 'idle'
let capture: AudioCapture | null = null
let rafId = 0
let lastSoundAt = 0

function setState(next: RunState, label?: string): void {
  state = next
  statusPill.dataset.state = next
  statusPill.textContent =
    label ?? { idle: 'Siap', starting: 'Memulai…', running: 'Merekam', stopping: 'Berhenti…' }[next]
  toggleBtn.textContent = next === 'running' || next === 'stopping' ? 'Stop' : 'Start'
  toggleBtn.classList.toggle('stop', next === 'running')
  toggleBtn.disabled = next === 'starting' || next === 'stopping'
}

function showNotice(message: string, kind: 'warn' | 'error' = 'warn', reason?: 'silence'): void {
  notice.textContent = message
  notice.dataset.kind = kind
  if (reason) notice.dataset.reason = reason
  else delete notice.dataset.reason
  notice.hidden = false
}

function hideNotice(): void {
  notice.hidden = true
}

async function start(): Promise<void> {
  hideNotice()
  setState('starting')
  try {
    capture = await AudioCapture.start()
  } catch (err) {
    console.error(err)
    setState('idle', 'Gagal')
    statusPill.dataset.state = 'error'
    showNotice(err instanceof Error ? err.message : String(err), 'error')
    return
  }

  capture.onSourceEnded = (kind) => {
    if (kind === 'system') {
      void stop().then(() =>
        showNotice('Capture audio sistem terhenti (perangkat output berubah?). Tekan Start lagi.', 'error')
      )
    } else {
      micCheckbox.checked = false
      showNotice('Mikrofon terputus.')
    }
  }

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
  capture = null
  await c.stop()
  meters.system.update(null)
  meters.mic.update(null)
  if (notice.dataset.reason === 'silence') hideNotice()
  setState('idle')
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

function tick(): void {
  if (!capture) return
  const system = capture.getLevel('system')
  meters.system.update(system)
  meters.mic.update(capture.getLevel('mic'))

  const now = performance.now()
  if (system && system.rmsDb > SILENCE_DB) {
    lastSoundAt = now
    if (!notice.hidden && notice.dataset.reason === 'silence') hideNotice()
  } else if (now - lastSoundAt > SILENCE_WARN_MS && notice.hidden) {
    showNotice(
      'Belum ada audio sistem terdeteksi. Putar sesuatu (mis. video YouTube) dan cek volume / perangkat output default.',
      'warn',
      'silence'
    )
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

void window.api.invoke('app:get-info').then((info) => {
  footer.textContent = `LiveScribe v${info.version} · Electron ${info.electron}`
  if (info.platform !== 'win32') {
    showNotice('Capture audio loopback hanya didukung penuh di Windows.', 'error')
  }
})
