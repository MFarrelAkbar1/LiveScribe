import type { LevelReading } from '../audio/capture'

const FLOOR_DB = -60
const PEAK_HOLD_MS = 1200
const PEAK_FALL_DB_PER_S = 20

/** Bar level horizontal: skala −60..0 dBFS, puncak ditahan sebentar lalu turun. */
export class LevelMeter {
  private readonly fill: HTMLElement
  private readonly peak: HTMLElement
  private readonly value: HTMLElement
  private peakDb = -Infinity
  private peakAt = 0
  private lastUpdate = performance.now()

  constructor(private readonly root: HTMLElement) {
    this.fill = root.querySelector<HTMLElement>('.meter-fill')!
    this.peak = root.querySelector<HTMLElement>('.meter-peak')!
    this.value = root.querySelector<HTMLElement>('.meter-value')!
    this.reset()
  }

  update(level: LevelReading | null): void {
    const now = performance.now()
    const dt = (now - this.lastUpdate) / 1000
    this.lastUpdate = now

    if (!level) {
      this.reset()
      return
    }
    this.root.classList.remove('inactive')

    if (level.peakDb >= this.peakDb) {
      this.peakDb = level.peakDb
      this.peakAt = now
    } else if (now - this.peakAt > PEAK_HOLD_MS) {
      this.peakDb -= PEAK_FALL_DB_PER_S * dt
    }

    this.fill.style.transform = `scaleX(${toFraction(level.rmsDb)})`
    this.peak.style.left = `${toFraction(this.peakDb) * 100}%`
    this.root.classList.toggle('clipping', level.peakDb > -1)
    this.value.textContent = Number.isFinite(level.rmsDb) ? `${level.rmsDb.toFixed(0)} dB` : '−∞ dB'
  }

  private reset(): void {
    this.peakDb = -Infinity
    this.fill.style.transform = 'scaleX(0)'
    this.peak.style.left = '0%'
    this.value.textContent = '—'
    this.root.classList.add('inactive')
    this.root.classList.remove('clipping')
  }
}

function toFraction(db: number): number {
  if (!Number.isFinite(db)) return 0
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}
