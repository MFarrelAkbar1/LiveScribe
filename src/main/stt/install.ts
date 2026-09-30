/**
 * Instalasi & verifikasi artefak engine di <root> (= %APPDATA%/LiveScribe/whisper):
 *
 *   bin/<build>-<varian>/   whisper-server.exe + DLL (datar, hanya file yang di-pin)
 *   models/ggml-small.bin
 *   downloads/*.part        unduhan yang bisa dilanjutkan
 *
 * Arsip diverifikasi SHA256-nya sebelum diekstrak; setiap file hasil ekstrak diverifikasi lagi
 * terhadap hash per-file yang di-pin, dan diverifikasi ulang setiap kali engine akan dijalankan.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloadVerified, fileSize, IntegrityError, sha256File, type FetchFn } from './download'
import { BINARY_PINS, MODEL_PINS, WHISPER_RELEASE, type BinaryVariant, type ModelId } from './manifest'

const execFileAsync = promisify(execFile)
/** bsdtar bawaan Windows 10+ (bisa membaca zip). `tar` di PATH bisa jadi GNU tar yang tidak bisa. */
const TAR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')

export const binDir = (root: string, variant: BinaryVariant): string =>
  join(root, 'bin', `${WHISPER_RELEASE.build}-${variant}`)
export const serverExe = (root: string, variant: BinaryVariant): string => join(binDir(root, variant), 'whisper-server.exe')
export const modelPath = (root: string, model: ModelId): string => join(root, 'models', MODEL_PINS[model].fileName)
const downloadsDir = (root: string): string => join(root, 'downloads')

export interface InstallProgress {
  signal: AbortSignal
  fetch: FetchFn
  onProgress: (receivedBytes: number) => void
}

/** Cek cepat (tanpa hash): semua file ada dengan ukuran yang benar. */
export async function isVariantPresent(root: string, variant: BinaryVariant): Promise<boolean> {
  const dir = binDir(root, variant)
  const sizes = await Promise.all(BINARY_PINS[variant].files.map((f) => fileSize(join(dir, f.name))))
  return sizes.every((size, i) => size === BINARY_PINS[variant].files[i]!.size)
}

export async function isModelPresent(root: string, model: ModelId): Promise<boolean> {
  return (await fileSize(modelPath(root, model))) === MODEL_PINS[model].size
}

/** Verifikasi SHA256 setiap file binary. Mengembalikan nama file yang tidak cocok/hilang. */
export async function verifyVariant(root: string, variant: BinaryVariant): Promise<string[]> {
  const dir = binDir(root, variant)
  const results = await Promise.all(
    BINARY_PINS[variant].files.map(async (f) => {
      try {
        return (await sha256File(join(dir, f.name))) === f.sha256 ? null : f.name
      } catch {
        return f.name
      }
    })
  )
  return results.filter((name): name is string => name !== null)
}

export async function verifyModel(root: string, model: ModelId): Promise<boolean> {
  try {
    return (await sha256File(modelPath(root, model))) === MODEL_PINS[model].sha256
  } catch {
    return false
  }
}

export async function installVariant(root: string, variant: BinaryVariant, p: InstallProgress): Promise<void> {
  const pin = BINARY_PINS[variant]
  await mkdir(downloadsDir(root), { recursive: true })
  const archive = join(downloadsDir(root), pin.archiveName)
  await downloadVerified({ url: pin.url, dest: archive, size: pin.size, sha256: pin.sha256, ...p })

  const final = binDir(root, variant)
  const staging = `${final}.staging`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    await execFileAsync(TAR, ['-xf', archive, '-C', staging, ...pin.files.map((f) => f.archivePath)], {
      windowsHide: true
    })
    for (const f of pin.files) {
      const extracted = join(staging, ...f.archivePath.split('/'))
      if ((await sha256File(extracted)) !== f.sha256) throw new IntegrityError(f.name, f.sha256, 'hasil ekstrak')
      if (f.archivePath !== f.name) await rename(extracted, join(staging, f.name))
    }
    for (const entry of await readdir(staging, { withFileTypes: true })) {
      if (entry.isDirectory()) await rm(join(staging, entry.name), { recursive: true, force: true })
    }
    await rm(final, { recursive: true, force: true })
    await rename(staging, final)
  } catch (err) {
    await rm(staging, { recursive: true, force: true })
    throw err
  }
  // Arsip CUDA ±670 MB — tidak perlu disimpan setelah terpasang.
  await rm(archive, { force: true })
  await removeOtherBuilds(root)
}

export async function installModel(root: string, model: ModelId, p: InstallProgress): Promise<void> {
  const pin = MODEL_PINS[model]
  await mkdir(join(root, 'models'), { recursive: true })
  await downloadVerified({ url: pin.url, dest: modelPath(root, model), size: pin.size, sha256: pin.sha256, ...p })
}

/** Hapus binary dari build whisper.cpp lama setelah naik versi. */
async function removeOtherBuilds(root: string): Promise<void> {
  const keep = new Set((Object.keys(BINARY_PINS) as BinaryVariant[]).map((v) => `${WHISPER_RELEASE.build}-${v}`))
  const entries = await readdir(join(root, 'bin')).catch(() => [])
  for (const name of entries) {
    if (!keep.has(name) && !name.endsWith('.staging')) await rm(join(root, 'bin', name), { recursive: true, force: true })
  }
}
