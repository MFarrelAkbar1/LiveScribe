/**
 * Konstanta & tipe pipeline audio yang dipakai renderer (produsen chunk) dan main
 * (konsumen: engine transkripsi, debug .wav).
 */
import type { AudioSourceKind } from './types'

/** Format PCM yang dikirim ke engine STT: 16 kHz, mono, Int16 little-endian. */
export const PCM_SAMPLE_RATE = 16_000

/**
 * Aliran audio yang dipotong-potong. 'mix' = semua sumber dijumlahkan (mode sekarang);
 * 'system' / 'mic' = aliran per-sumber untuk mode "separate" (label Sistem/Saya).
 */
export type StreamId = 'mix' | AudioSourceKind

export type ChunkCutReason =
  /** Dipotong di jeda bicara â€” tidak perlu overlap. */
  | 'pause'
  /** Mencapai durasi maksimum â€” dipotong di titik paling senyap, dengan overlap. */
  | 'max-length'
  /** Capture dihentikan. */
  | 'flush'

/** Alasan chunk tidak dikirim ke engine (anti-halusinasi). */
export type ChunkDropReason = 'no-speech' | 'too-quiet'

export interface ChunkerConfig {
  /** Panjang frame analisis VAD. */
  frameMs: number
  /** Ambang minimum (dBFS) agar frame dianggap suara, apa pun noise floor-nya. */
  minSpeechDb: number
  /** Frame dianggap suara bila > noiseFloor + margin. */
  noiseMarginDb: number
  /** Jeda (hening) minimal untuk memotong chunk. */
  pauseMs: number
  /** Chunk tidak dipotong di jeda sebelum mencapai durasi ini (hindari chunk terlalu pendek). */
  minChunkMs: number
  /** Durasi maksimum chunk; di sini chunk dipaksa dipotong. */
  maxChunkMs: number
  /** Saat dipaksa potong, cari titik paling senyap dalam jendela terakhir sepanjang ini. */
  cutSearchMs: number
  /** Overlap antar chunk saat dipotong paksa ('max-length'). */
  overlapMs: number
  /** Audio sebelum onset bicara yang ikut dimasukkan. */
  preRollMs: number
  /** Audio hening setelah bicara yang ikut dimasukkan. */
  postRollMs: number
  /** Anti-halusinasi: chunk dengan total frame suara di bawah ini tidak dikirim. */
  minSpeechMs: number
  /** Anti-halusinasi: chunk dengan RMS rata-rata di bawah ini tidak dikirim. */
  minChunkRmsDb: number
}

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  frameMs: 20,
  minSpeechDb: -50,
  noiseMarginDb: 10,
  pauseMs: 500,
  minChunkMs: 1200,
  maxChunkMs: 5000,
  cutSearchMs: 1500,
  overlapMs: 500,
  preRollMs: 200,
  postRollMs: 240,
  minSpeechMs: 300,
  minChunkRmsDb: -48
}

/** Metadata chunk (tanpa PCM) â€” dipakai untuk log, debug, dan dedup overlap di tahap 3. */
export interface ChunkMeta {
  stream: StreamId
  /** Nomor urut per aliran, mulai 1. */
  seq: number
  /** Posisi awal chunk (ms sejak capture dimulai) â€” dasar timestamp transkrip/SRT. */
  startMs: number
  durationMs: number
  /** Berapa ms di awal chunk ini yang juga ada di akhir chunk sebelumnya (0 jika dipotong di jeda). */
  overlapMs: number
  cutReason: ChunkCutReason
  /** Total durasi frame yang terdeteksi suara. */
  speechMs: number
  rmsDb: number
  peakDb: number
}
