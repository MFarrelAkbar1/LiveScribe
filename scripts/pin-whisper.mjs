#!/usr/bin/env node
/**
 * Menghasilkan src/main/stt/pins.ts: versi whisper.cpp + SHA256 arsip, SHA256 setiap file
 * yang dipakai dari arsip, dan SHA256 model — semuanya di-pin di source code.
 *
 *   node scripts/pin-whisper.mjs [--dir <folder unduhan>]
 *
 * Untuk naik versi: ubah RELEASE_TAG / BUILD_TAG / MODEL_REVISION di bawah, jalankan script,
 * tinjau diff pins.ts, lalu tes GPU + CPU.
 *
 * Hash arsip dicocokkan dengan digest dari GitHub API; hash model dari metadata LFS
 * Hugging Face (dan dihitung ulang jika file model ada di --dir).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const RELEASE_TAG = 'v1.9.4'
/** Build nightly yang dirujuk rilis stabil di atas (asetnya ada di tag ini). */
const BUILD_TAG = 'b5130'
const MODEL_REPO = 'ggerganov/whisper.cpp'
const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const MODELS = { small: 'ggml-small.bin' }

const VARIANTS = {
  cpu: { asset: 'whisper-bin-x64.zip' },
  // Build 12.4 membawa cublas/cudart sendiri (build 11.8 tidak — butuh CUDA Toolkit terpasang).
  cuda: { asset: 'whisper-cublas-12.4.0-bin-x64.zip', minDriver: '527.41' }
}

/** File yang dibutuhkan whisper-server (+ backend ggml yang dimuat dinamis). */
const NEEDED = /^Release\/(whisper-server\.exe|whisper\.dll|ggml(-base|-cuda|-cpu-[a-z0-9]+)?\.dll|cudart64_\d+\.dll|cublas(Lt)?64_\d+\.dll)$/i
const TAR = 'C:\\Windows\\System32\\tar.exe'

const args = process.argv.slice(2)
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined
const dir = resolve(dirArg ?? join(tmpdir(), 'livescribe-pin'))
mkdirSync(dir, { recursive: true })

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'livescribe-pin' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function download(url, dest) {
  console.error(`  mengunduh ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function pinVariant(id, spec, release) {
  const asset = release.assets.find((a) => a.name === spec.asset)
  if (!asset) throw new Error(`Aset ${spec.asset} tidak ada di ${BUILD_TAG}`)
  const digest = asset.digest?.replace(/^sha256:/, '')
  if (!digest) throw new Error(`GitHub tidak memberi digest untuk ${spec.asset}`)

  const zip = join(dir, spec.asset)
  if (!existsSync(zip) || statSync(zip).size !== asset.size) await download(asset.browser_download_url, zip)
  const actual = await sha256(zip)
  if (actual !== digest) throw new Error(`SHA256 ${spec.asset} tidak cocok: ${actual} ≠ ${digest}`)
  console.error(`✓ ${spec.asset} ${actual}`)

  const entries = execFileSync(TAR, ['-tf', zip], { encoding: 'utf8', maxBuffer: 1 << 24 })
    .split(/\r?\n/)
    .filter((e) => NEEDED.test(e))
  if (!entries.some((e) => e.endsWith('whisper-server.exe'))) throw new Error(`whisper-server.exe tidak ada di ${spec.asset}`)

  const tmp = mkdtempSync(join(tmpdir(), `pin-${id}-`))
  try {
    execFileSync(TAR, ['-xf', zip, '-C', tmp, ...entries])
    const files = []
    for (const entry of entries.sort()) {
      const path = join(tmp, entry)
      files.push({ archivePath: entry, name: entry.split('/').pop(), size: statSync(path).size, sha256: await sha256(path) })
    }
    return {
      url: asset.browser_download_url,
      archiveName: spec.asset,
      size: asset.size,
      sha256: digest,
      ...(spec.minDriver ? { minDriver: spec.minDriver } : {}),
      files
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function pinModel(file) {
  const tree = await json(`https://huggingface.co/api/models/${MODEL_REPO}/tree/${MODEL_REVISION}`)
  const entry = tree.find((f) => f.path === file)
  if (!entry?.lfs?.oid) throw new Error(`${file} tidak ada di ${MODEL_REPO}@${MODEL_REVISION}`)
  const local = join(dir, file)
  if (existsSync(local)) {
    const actual = await sha256(local)
    if (actual !== entry.lfs.oid) throw new Error(`SHA256 ${file} lokal tidak cocok dengan LFS: ${actual}`)
    console.error(`✓ ${file} ${actual}`)
  }
  return {
    fileName: file,
    url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`,
    size: entry.size,
    sha256: entry.lfs.oid
  }
}

const release = await json(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${BUILD_TAG}`)
const stable = await json(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${RELEASE_TAG}`)
const binaries = {}
for (const [id, spec] of Object.entries(VARIANTS)) binaries[id] = await pinVariant(id, spec, release)
const models = {}
for (const [id, file] of Object.entries(MODELS)) models[id] = await pinModel(file)

const out = `/**
 * DIHASILKAN oleh scripts/pin-whisper.mjs — jangan diedit manual.
 * Sumber: github.com/ggml-org/whisper.cpp ${RELEASE_TAG} (${BUILD_TAG}), huggingface.co/${MODEL_REPO}@${MODEL_REVISION.slice(0, 10)}
 */
import type { BinaryPin, ModelPin } from './manifest'

export const WHISPER_RELEASE = ${JSON.stringify({ version: RELEASE_TAG, build: BUILD_TAG, commit: stable.target_commitish })} as const

export const BINARY_PINS: Record<'cpu' | 'cuda', BinaryPin> = ${JSON.stringify(binaries, null, 2)}

export const MODEL_PINS: Record<'small', ModelPin> = ${JSON.stringify(models, null, 2)}
`
const target = resolve(import.meta.dirname, '../src/main/stt/pins.ts')
writeFileSync(target, out)
console.error(`→ ${target}`)
