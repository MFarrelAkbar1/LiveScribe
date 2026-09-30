import { PCM_SAMPLE_RATE, type ChunkMeta } from '@shared/audio'

/** Batas atas ukuran chunk yang diterima dari renderer (60 detik PCM16 mono). */
const MAX_CHUNK_BYTES = PCM_SAMPLE_RATE * 2 * 60
const STREAMS = new Set(['mix', 'system', 'mic'])
const CUT_REASONS = new Set(['pause', 'max-length', 'flush'])

const isNonNegative = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** Validasi chunk dari renderer sebelum dipakai (renderer dianggap tidak tepercaya). */
export function assertValidChunk(meta: ChunkMeta, pcm: unknown): asserts pcm is ArrayBuffer {
  if (!(pcm instanceof ArrayBuffer) || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_CHUNK_BYTES) {
    throw new Error('Data PCM tidak valid')
  }
  if (!meta || !STREAMS.has(meta.stream) || !CUT_REASONS.has(meta.cutReason)) {
    throw new Error('Metadata chunk tidak valid')
  }
  if (![meta.seq, meta.startMs, meta.durationMs, meta.overlapMs, meta.speechMs].every(isNonNegative)) {
    throw new Error('Metadata chunk tidak valid')
  }
}
