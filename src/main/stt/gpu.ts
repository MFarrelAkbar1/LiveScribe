import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GpuInfo } from '@shared/stt'

const execFileAsync = promisify(execFile)
const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')

/** nvidia-smi terpasang bersama driver NVIDIA (DCH: System32; driver lama: NVSMI). */
const NVIDIA_SMI = [
  join(system32, 'nvidia-smi.exe'),
  join(process.env['ProgramW6432'] ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
]

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/** GPU NVIDIA pertama beserta versi driver, atau null jika tidak ada. */
export async function detectNvidiaGpu(): Promise<GpuInfo | null> {
  for (const smi of NVIDIA_SMI) {
    if (!(await exists(smi))) continue
    try {
      const { stdout } = await execFileAsync(
        smi,
        ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
        { timeout: 8000, windowsHide: true }
      )
      const [name, driverVersion, memory] = (stdout.split(/\r?\n/)[0] ?? '').split(',').map((s) => s.trim())
      if (name) return { name, driverVersion: driverVersion ?? '', memoryMb: Number(memory) || null }
    } catch (err) {
      console.warn('[gpu] nvidia-smi gagal:', err)
    }
  }
  // Driver ada tapi nvidia-smi tidak bisa dipakai — tetap coba CUDA; whisper-server yang memastikan.
  if (await exists(join(system32, 'nvcuda.dll'))) return { name: 'GPU NVIDIA', driverVersion: '', memoryMb: null }
  return null
}

/** "551.61" vs "527.41" → positif jika a lebih baru. Versi kosong dianggap memenuhi. */
export function compareVersions(a: string, b: string): number {
  if (!a || !b) return 0
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** DLL Visual C++ 2015–2022 Redistributable yang dibutuhkan binary whisper.cpp. */
const VC_RUNTIME = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll']
export const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

export async function missingVcRuntime(): Promise<string[]> {
  const found = await Promise.all(VC_RUNTIME.map((dll) => exists(join(system32, dll))))
  return VC_RUNTIME.filter((_, i) => !found[i])
}
