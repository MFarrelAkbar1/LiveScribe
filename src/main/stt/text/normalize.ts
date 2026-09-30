/** Utilitas teks murni (tanpa Node/Electron) untuk filter halusinasi & dedup. */

/** Bentuk pembanding: huruf kecil, tanpa tanda baca/diakritik, spasi tunggal. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const normalizeWord = (word: string): string => normalizeText(word).replace(/ /g, '')

/** Pecah teks menjadi kata apa adanya (tanda baca tetap menempel). */
export const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

/** 1 = identik, 0 = sama sekali berbeda. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len
}
