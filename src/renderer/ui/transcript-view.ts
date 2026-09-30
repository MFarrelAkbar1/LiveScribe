import { formatClock } from '@shared/format'
import type { TranscriptSegment } from '@shared/stt'

/** Jarak (px) dari dasar yang masih dianggap "mengikuti" transkrip terbaru. */
const STICKY_PX = 48

/** Transkrip sederhana: satu baris per segmen dengan timestamp (UI lengkap di tahap 4). */
export class TranscriptView {
  private readonly rows = new Map<string, HTMLElement>()

  constructor(
    private readonly scroller: HTMLElement,
    private readonly list: HTMLElement,
    private readonly placeholder: HTMLElement
  ) {}

  reset(): void {
    this.rows.clear()
    this.list.replaceChildren()
    this.placeholder.hidden = false
  }

  add(segments: TranscriptSegment[]): void {
    if (!segments.length) return
    const follow = this.isAtBottom()
    for (const seg of segments) {
      const li = document.createElement('li')
      const time = document.createElement('time')
      time.textContent = formatClock(seg.startMs)
      const text = document.createElement('span')
      text.className = 'text'
      text.textContent = seg.text
      li.append(time, text)
      this.list.append(li)
      this.rows.set(seg.id, text)
    }
    this.placeholder.hidden = true
    if (follow) this.scroller.scrollTop = this.scroller.scrollHeight
  }

  /** Koreksi teks segmen yang sudah tampil (kata terpotong di batas chunk). */
  amend(id: string, text: string): void {
    const el = this.rows.get(id)
    if (el) el.textContent = text
  }

  private isAtBottom(): boolean {
    const s = this.scroller
    return s.scrollHeight - s.scrollTop - s.clientHeight < STICKY_PX
  }
}
