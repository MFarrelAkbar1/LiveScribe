/**
 * Dedup di batas overlap.
 *
 * Chunk yang dipotong paksa ('max-length') di tengah ucapan diulang overlapMs (0,5 s) di
 * awal chunk berikutnya, sehingga 1–3 kata di akhir teks lama muncul lagi di awal teks baru.
 * Di sini ekor teks lama disejajarkan dengan kepala teks baru (toleran salah eja kecil), lalu
 * duplikatnya dibuang dari teks baru.
 *
 * Kasus kata terpotong di titik potong:
 * - teks lama berakhir "mengemb", teks baru "mengembangkan …" → kata lama dikoreksi (amendedPrev);
 * - teks baru diawali potongan "bangkan", teks lama "… mengembangkan" → potongan dibuang.
 */
import { normalizeWord, similarity, splitWords } from './normalize'

export interface DedupResult {
  text: string
  /** Teks lama dengan kata terakhir yang dilengkapi, atau null jika tidak berubah. */
  amendedPrev: string | null
  removed: string[]
}

/** Kecepatan bicara cepat ≈ 4 kata/detik; plus kelonggaran untuk kata terpotong. */
const WORDS_PER_SEC = 4
const WORD_SLACK = 2
const FUZZY_MIN_LEN = 4
const FUZZY_MIN_SIMILARITY = 0.8
const FRAGMENT_MIN_LEN = 2

export function dedupOverlap(prevText: string, curText: string, overlapMs: number): DedupResult {
  const unchanged: DedupResult = { text: curText.trim(), amendedPrev: null, removed: [] }
  if (overlapMs <= 0 || !prevText.trim()) return unchanged

  const prev = splitWords(prevText)
  const cur = splitWords(curText)
  // Token tanpa huruf/angka di awal ("…", "-") tidak ikut dibandingkan.
  let lead = 0
  while (lead < cur.length && !normalizeWord(cur[lead]!)) lead++
  const pn = prev.map(normalizeWord)
  const cn = cur.slice(lead).map(normalizeWord)

  const maxK = Math.min(Math.ceil((overlapMs / 1000) * WORDS_PER_SEC) + WORD_SLACK, pn.length, cn.length)
  for (let k = maxK; k >= 1; k--) {
    const match = alignTail(pn.slice(pn.length - k), cn.slice(0, k))
    if (!match) continue
    const removed = cur.slice(0, lead + k)
    const amendedPrev = match.amendLast ? [...prev.slice(0, prev.length - 1), cur[lead + k - 1]!].join(' ') : null
    return { text: cur.slice(lead + k).join(' '), amendedPrev, removed }
  }
  return unchanged
}

/** Cocokkan ekor teks lama dengan kepala teks baru, kata demi kata. */
function alignTail(tail: string[], head: string[]): { amendLast: boolean } | null {
  let amendLast = false
  for (let i = 0; i < tail.length; i++) {
    const a = tail[i]!
    const b = head[i]!
    if (wordsMatch(a, b)) continue
    // Kata terakhir teks lama terpotong: "mengemb" ⊂ "mengembangkan".
    if (i === tail.length - 1 && a.length >= FRAGMENT_MIN_LEN && b.length > a.length && b.startsWith(a)) {
      amendLast = true
      continue
    }
    // Kata pertama teks baru terpotong: "bangkan" ⊂ "mengembangkan".
    if (i === 0 && b.length >= FRAGMENT_MIN_LEN && a.length > b.length && a.endsWith(b)) continue
    return null
  }
  return { amendLast }
}

function wordsMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return Math.min(a.length, b.length) >= FUZZY_MIN_LEN && similarity(a, b) >= FUZZY_MIN_SIMILARITY
}
