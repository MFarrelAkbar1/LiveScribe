/**
 * Artefak engine yang di-pin: versi whisper.cpp, arsip binary per varian (CPU / CUDA),
 * dan model. Nilai hash ada di pins.ts (dihasilkan scripts/pin-whisper.mjs).
 */
import { BINARY_PINS, MODEL_PINS, WHISPER_RELEASE } from './pins'

export interface PinnedFile {
  /** Path di dalam arsip, mis. "Release/whisper-server.exe". */
  archivePath: string
  /** Nama file setelah diekstrak (datar, tanpa folder). */
  name: string
  size: number
  sha256: string
}

export interface BinaryPin {
  url: string
  archiveName: string
  size: number
  sha256: string
  /** Versi driver NVIDIA minimum (khusus varian CUDA). */
  minDriver?: string
  files: PinnedFile[]
}

export interface ModelPin {
  fileName: string
  url: string
  size: number
  sha256: string
}

export type BinaryVariant = keyof typeof BINARY_PINS
export type ModelId = keyof typeof MODEL_PINS

export const DEFAULT_MODEL: ModelId = 'small'

export const VARIANT_LABELS: Record<BinaryVariant, string> = {
  cpu: 'Engine whisper.cpp (CPU)',
  cuda: 'Engine whisper.cpp (CUDA)'
}

export { BINARY_PINS, MODEL_PINS, WHISPER_RELEASE }
