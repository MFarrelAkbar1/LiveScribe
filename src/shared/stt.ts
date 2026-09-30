/**
 * Tipe engine transkripsi (whisper.cpp lokal) yang dipakai main (produsen status/hasil)
 * dan renderer (tampilan). Tanpa import Node/DOM.
 */
import type { ChunkMeta, StreamId } from './audio'
import type { Language } from './types'

export const LANGUAGE_LABELS: Record<Language, string> = {
  id: 'Indonesia',
  en: 'English',
  auto: 'Auto'
}

export type EngineDevice = 'gpu' | 'cpu'

export interface GpuInfo {
  name: string
  driverVersion: string
  memoryMb: number | null
}

export type EngineState =
  /** Deteksi GPU & cek file yang sudah terpasang. */
  | 'checking'
  | 'downloading'
  /** Cek SHA256 binary + model sebelum dijalankan. */
  | 'verifying'
  /** whisper-server sedang memuat model. */
  | 'starting'
  | 'ready'
  | 'error'
  /** Download dibatalkan pengguna. */
  | 'cancelled'

export interface DownloadProgress {
  /** "Engine whisper.cpp (CUDA)", "Model small", … */
  label: string
  receivedBytes: number
  totalBytes: number
  bytesPerSec: number
  /** Urutan item yang sedang diunduh (1-based) dari total item yang perlu diunduh. */
  item: number
  items: number
}

export interface EngineStatus {
  state: EngineState
  message: string
  /** Perangkat yang benar-benar dipakai whisper-server (null jika belum jalan). */
  device: EngineDevice | null
  /** "NVIDIA GeForce RTX 4060 Laptop GPU" atau "CPU · 8 thread". */
  deviceName: string | null
  /** GPU NVIDIA yang terdeteksi di sistem (meski akhirnya tidak dipakai). */
  gpu: GpuInfo | null
  /** Alasan jatuh ke CPU padahal GPU NVIDIA terdeteksi. */
  fallbackReason: string | null
  model: string
  /** Versi whisper.cpp yang di-pin, mis. "v1.9.4". */
  engineVersion: string
  download: DownloadProgress | null
}

export interface TranscribeRequest {
  sessionId: string
  meta: ChunkMeta
  /** PCM Int16 little-endian, 16 kHz mono. */
  pcm: ArrayBuffer
  language: Language
}

export interface TranscriptSegment {
  /** Unik per sesi: `<stream>-<seq>-<index>`. */
  id: string
  stream: StreamId
  /** Posisi absolut sejak capture dimulai. */
  startMs: number
  endMs: number
  text: string
}

export type FilterReason =
  | 'non-speech'
  | 'blocklist'
  | 'weak-phrase'
  | 'no-speech-prob'
  | 'repetition'
  | 'prompt-echo'
  | 'duplicate'

export interface TranscribeResult {
  segments: TranscriptSegment[]
  /** Segmen sebelumnya yang teksnya dikoreksi (kata terpotong di batas overlap). */
  amended: { id: string; text: string } | null
  /** Teks yang dibuang filter halusinasi / dedup (untuk panel debug). */
  filtered: { text: string; reason: FilterReason }[]
  /** Waktu tunggu di antrean engine. */
  queueMs: number
  /** Waktu request HTTP ke whisper-server (encode + decode). */
  inferenceMs: number
  device: EngineDevice
  /** Bahasa yang dipakai/terdeteksi whisper ("indonesian", "english", …). */
  language: string | null
}
