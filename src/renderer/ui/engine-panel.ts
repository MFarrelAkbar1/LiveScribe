import type { EngineStatus } from '@shared/stt'

export type EngineAction = 'retry' | 'cancel'

const mb = (bytes: number): string =>
  (bytes / 1_048_576).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function eta(remainingBytes: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0) return ''
  const s = Math.round(remainingBytes / bytesPerSec)
  if (s < 60) return ` · sisa ±${s} dtk`
  return ` · sisa ±${Math.round(s / 60)} mnt`
}

/** Nama GPU dipendekkan untuk badge: "NVIDIA GeForce RTX 4060 Laptop GPU" → "RTX 4060 Laptop". */
const shortGpu = (name: string): string =>
  name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').replace(/\s+GPU$/i, '')

/** Status engine: badge GPU/CPU di topbar + panel progres download/verifikasi. */
export class EnginePanel {
  onAction: ((action: EngineAction) => void) | null = null
  private action: EngineAction | null = null
  private readonly text: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly progress: HTMLElement
  private readonly fill: HTMLElement
  private readonly detail: HTMLElement

  constructor(
    private readonly root: HTMLElement,
    private readonly badge: HTMLElement
  ) {
    const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T
    this.text = q('#engine-text')
    this.button = q<HTMLButtonElement>('#engine-action')
    this.progress = q('#engine-progress')
    this.fill = q('.progress-fill')
    this.detail = q('#engine-detail')
    this.button.addEventListener('click', () => {
      if (this.action) this.onAction?.(this.action)
    })
  }

  render(s: EngineStatus): void {
    this.root.dataset.state = s.state
    this.renderBadge(s)

    const ready = s.state === 'ready'
    this.text.textContent = ready ? `Engine siap — ${s.device === 'gpu' ? 'GPU' : 'CPU'}: ${s.deviceName ?? ''}` : s.message

    const dl = s.download
    const busy = s.state === 'checking' || s.state === 'verifying' || s.state === 'starting'
    this.progress.hidden = !dl && !busy
    this.progress.classList.toggle('indeterminate', !dl && busy)
    this.fill.style.transform = dl ? `scaleX(${Math.min(1, dl.receivedBytes / Math.max(1, dl.totalBytes))})` : ''

    const details: string[] = []
    if (dl) {
      const pct = Math.floor((dl.receivedBytes / Math.max(1, dl.totalBytes)) * 100)
      const speed = dl.bytesPerSec > 0 ? ` · ${mb(dl.bytesPerSec)} MB/s` : ''
      details.push(
        `${dl.items > 1 ? `(${dl.item}/${dl.items}) ` : ''}${mb(dl.receivedBytes)} / ${mb(dl.totalBytes)} MB (${pct}%)` +
          speed +
          eta(dl.totalBytes - dl.receivedBytes, dl.bytesPerSec)
      )
    }
    if (s.fallbackReason) details.push(`Memakai CPU: ${s.fallbackReason}`)
    if (ready || s.state === 'error') details.push(`whisper.cpp ${s.engineVersion} · model ${s.model}`)
    this.detail.textContent = details.join('  ·  ')
    this.detail.classList.toggle('warn', Boolean(s.fallbackReason))

    this.action = dl ? 'cancel' : s.state === 'error' || s.state === 'cancelled' ? 'retry' : null
    this.button.hidden = !this.action
    this.button.textContent = dl ? 'Batalkan' : s.state === 'cancelled' ? 'Lanjutkan' : 'Coba lagi'
  }

  private renderBadge(s: EngineStatus): void {
    if (s.state === 'ready' && s.device) {
      this.badge.dataset.device = s.device
      this.badge.textContent = s.device === 'gpu' ? `GPU · ${shortGpu(s.deviceName ?? '')}` : 'CPU'
      this.badge.title = `Engine transkripsi aktif: ${s.deviceName ?? s.device}`
      return
    }
    this.badge.dataset.device = s.state === 'error' ? 'error' : 'none'
    this.badge.textContent =
      s.state === 'error' ? 'Engine: error' : s.state === 'downloading' ? 'Engine: mengunduh…' : 'Engine: memuat…'
    this.badge.title = s.message
  }
}
