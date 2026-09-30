/**
 * Statistik latensi transkripsi per sesi.
 *
 * - End-to-end: chunk selesai dipotong di renderer → hasil teks diterima renderer
 *   (antrean + WAV + HTTP ke whisper-server + pasca-proses + IPC).
 * - Inferensi: durasi request /inference saja (diukur di main).
 */
const ms = (v: number): string => `${Math.round(v).toLocaleString('id-ID')} ms`

export class LatencyStats {
  private count = 0
  private totalE2e = 0
  private totalInference = 0
  private last = 0
  private max = 0
  private pending = 0
  private failed = 0

  constructor(private readonly el: HTMLElement) {}

  reset(): void {
    this.count = this.totalE2e = this.totalInference = this.last = this.max = this.pending = this.failed = 0
    this.render()
  }

  begin(): void {
    this.pending++
    this.render()
  }

  record(e2eMs: number, inferenceMs: number): void {
    this.pending--
    this.count++
    this.totalE2e += e2eMs
    this.totalInference += inferenceMs
    this.last = e2eMs
    this.max = Math.max(this.max, e2eMs)
    this.render()
  }

  fail(): void {
    this.pending--
    this.failed++
    this.render()
  }

  private render(): void {
    if (!this.count && !this.pending && !this.failed) {
      this.el.textContent = ''
      return
    }
    const parts: string[] = []
    if (this.count) {
      parts.push(
        `Latensi rata-rata ${ms(this.totalE2e / this.count)} (n=${this.count})`,
        `inferensi ${ms(this.totalInference / this.count)}`,
        `terakhir ${ms(this.last)}`,
        `maks ${ms(this.max)}`
      )
    }
    parts.push(`antrean ${this.pending}`)
    if (this.failed) parts.push(`gagal ${this.failed}`)
    this.el.textContent = parts.join(' · ')
  }
}
