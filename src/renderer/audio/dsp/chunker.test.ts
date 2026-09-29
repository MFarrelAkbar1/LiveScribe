import { describe, expect, it } from 'vitest'
import { DEFAULT_CHUNKER_CONFIG, PCM_SAMPLE_RATE, type ChunkDropReason, type ChunkMeta } from '@shared/audio'
import { Chunker } from './chunker'

const RATE = PCM_SAMPLE_RATE

/** Segmen sinyal: amplitudo sinus 300 Hz (0 = hening digital) selama `ms`. */
type Segment = [amp: number, ms: number]

function signal(...segments: Segment[]): Float32Array {
  const total = segments.reduce((s, [, ms]) => s + (ms * RATE) / 1000, 0)
  const out = new Float32Array(total)
  let i = 0
  for (const [amp, ms] of segments) {
    const n = (ms * RATE) / 1000
    for (let k = 0; k < n; k++, i++) out[i] = amp * Math.sin((2 * Math.PI * 300 * i) / RATE)
  }
  return out
}

/** Amplitudo sinus untuk RMS tertentu dalam dBFS. */
const amp = (db: number): number => Math.SQRT2 * 10 ** (db / 20)
const SPEECH = amp(-20)

function run(input: Float32Array, block = 1600, config = DEFAULT_CHUNKER_CONFIG) {
  const chunks: { meta: ChunkMeta; pcm: Float32Array }[] = []
  const drops: { meta: ChunkMeta; reason: ChunkDropReason }[] = []
  const chunker = new Chunker('mix', config, {
    onChunk: (meta, pcm) => chunks.push({ meta, pcm }),
    onDrop: (meta, reason) => drops.push({ meta, reason })
  })
  for (let i = 0; i < input.length; i += block) chunker.push(input.subarray(i, i + block))
  chunker.flush()
  return { chunks, drops }
}

describe('Chunker', () => {
  it('hening saja → tidak ada chunk sama sekali', () => {
    const { chunks, drops } = run(signal([0, 10_000]))
    expect(chunks).toHaveLength(0)
    expect(drops).toHaveLength(0)
  })

  it('satu kalimat lalu jeda → satu chunk "pause" dengan pre/post-roll', () => {
    const { chunks } = run(signal([0, 1000], [SPEECH, 2000], [0, 2000]))
    expect(chunks).toHaveLength(1)
    const { meta, pcm } = chunks[0]!
    expect(meta.cutReason).toBe('pause')
    expect(meta.startMs).toBe(1000 - DEFAULT_CHUNKER_CONFIG.preRollMs)
    expect(meta.durationMs).toBe(DEFAULT_CHUNKER_CONFIG.preRollMs + 2000 + DEFAULT_CHUNKER_CONFIG.postRollMs)
    expect(meta.overlapMs).toBe(0)
    expect(meta.speechMs).toBe(2000)
    expect(meta.rmsDb).toBeCloseTo(-20, 0)
    expect(pcm.length).toBe((meta.durationMs * RATE) / 1000)
  })

  it('bicara tanpa jeda → dipotong ≤ maxChunk, overlap 0,5 s, cakupan kontinu', () => {
    const { chunks } = run(signal([SPEECH, 12_000], [0, 1500]))
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const { meta } of chunks) expect(meta.durationMs).toBeLessThanOrEqual(DEFAULT_CHUNKER_CONFIG.maxChunkMs)
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!.meta
      const cur = chunks[i]!.meta
      expect(prev.cutReason).toBe('max-length')
      expect(cur.overlapMs).toBe(DEFAULT_CHUNKER_CONFIG.overlapMs)
      expect(cur.startMs).toBe(prev.startMs + prev.durationMs - cur.overlapMs)
    }
    const last = chunks.at(-1)!.meta
    expect(last.startMs + last.durationMs).toBeGreaterThanOrEqual(12_000)
  })

  it('dipaksa potong → memilih jeda pendek di dekat batas, tanpa overlap', () => {
    // Jeda 200 ms (< pauseMs) di detik 4,0 — di dalam jendela pencarian titik potong.
    const { chunks } = run(signal([SPEECH, 4000], [0, 200], [SPEECH, 2500], [0, 1500]))
    expect(chunks).toHaveLength(2)
    const [a, b] = [chunks[0]!.meta, chunks[1]!.meta]
    expect(a.cutReason).toBe('max-length')
    expect(a.startMs + a.durationMs).toBeGreaterThan(4000)
    expect(a.startMs + a.durationMs).toBeLessThanOrEqual(4200)
    expect(b.overlapMs).toBe(0)
  })

  it('bunyi klik singkat → dibuang sebagai "no-speech" (anti-halusinasi)', () => {
    const { chunks, drops } = run(signal([0, 1000], [amp(-10), 60], [0, 3000]))
    expect(chunks).toHaveLength(0)
    expect(drops).toHaveLength(1)
    expect(drops[0]!.reason).toBe('no-speech')
  })

  it('suara di bawah ambang → tidak dianggap suara', () => {
    const { chunks, drops } = run(signal([amp(-60), 8000]))
    expect(chunks).toHaveLength(0)
    expect(drops).toHaveLength(0)
  })

  it('suara pelan di atas ambang VAD tapi di bawah minChunkRmsDb → dibuang "too-quiet"', () => {
    const { chunks, drops } = run(signal([0, 500], [amp(-49), 2000], [0, 2000]))
    expect(chunks).toHaveLength(0)
    expect(drops.map((d) => d.reason)).toEqual(['too-quiet'])
  })

  it('flush saat Stop mengirim kalimat yang sedang berjalan', () => {
    const { chunks } = run(signal([0, 500], [SPEECH, 1500]))
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.meta.cutReason).toBe('flush')
  })

  it('hasil sama untuk ukuran blok berbeda', () => {
    const input = signal([0, 700], [SPEECH, 6300], [0, 600], [SPEECH, 1800], [0, 2000])
    const a = run(input, 1600).chunks.map((c) => c.meta)
    const b = run(input, 128).chunks.map((c) => c.meta)
    const c = run(input, 4999).chunks.map((c) => c.meta)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})
