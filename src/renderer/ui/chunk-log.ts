import type { ChunkCutReason, ChunkDropReason, ChunkMeta } from '@shared/audio'
import { formatClock } from '@shared/format'

const MAX_ROWS = 60

const CUT_LABEL: Record<ChunkCutReason, string> = {
  pause: 'jeda',
  'max-length': 'maks',
  flush: 'stop'
}

const DROP_LABEL: Record<ChunkDropReason, string> = {
  'no-speech': 'dilewati: hampir tanpa suara',
  'too-quiet': 'dilewati: terlalu pelan'
}

const sec = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`
const db = (v: number): string => (Number.isFinite(v) ? `${v.toFixed(0)} dB` : '−∞ dB')

/** Panel debug: daftar chunk terbaru + statistik. */
export class ChunkLog {
  private sent = 0
  private dropped = 0
  private saved = 0

  constructor(
    private readonly list: HTMLElement,
    private readonly stats: HTMLElement
  ) {}

  reset(): void {
    this.sent = this.dropped = this.saved = 0
    this.list.replaceChildren()
    this.renderStats(null)
  }

  addChunk(meta: ChunkMeta): void {
    this.sent++
    this.addRow(meta, null)
  }

  addDrop(meta: ChunkMeta, reason: ChunkDropReason): void {
    this.dropped++
    this.addRow(meta, reason)
  }

  markSaved(): void {
    this.saved++
  }

  renderStats(noiseFloorDb: number | null): void {
    const parts = [`Dikirim ${this.sent}`, `Dilewati ${this.dropped}`]
    if (noiseFloorDb !== null) parts.push(`Noise floor ${db(noiseFloorDb)}`)
    if (this.saved) parts.push(`WAV tersimpan ${this.saved}`)
    this.stats.textContent = parts.join(' · ')
  }

  private addRow(meta: ChunkMeta, drop: ChunkDropReason | null): void {
    const li = document.createElement('li')
    if (drop) li.classList.add('dropped')
    const speechPct = Math.round((meta.speechMs / meta.durationMs) * 100)
    const cells = [
      `#${String(meta.seq).padStart(4, '0')}`,
      formatClock(meta.startMs),
      sec(meta.durationMs),
      CUT_LABEL[meta.cutReason] + (meta.overlapMs ? ` +${sec(meta.overlapMs)} overlap` : ''),
      db(meta.rmsDb),
      `suara ${speechPct}%`,
      drop ? DROP_LABEL[drop] : ''
    ]
    for (const text of cells) {
      const span = document.createElement('span')
      span.textContent = text
      li.append(span)
    }
    this.list.prepend(li)
    while (this.list.childElementCount > MAX_ROWS) this.list.lastElementChild?.remove()
  }
}
