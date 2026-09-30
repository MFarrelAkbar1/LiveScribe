/**
 * Filter halusinasi Whisper — tahap 2 dari 2 (tahap 1: chunker tidak mengirim chunk hening).
 *
 * Whisper dilatih dari subtitle internet, sehingga pada musik/noise/hening ia cenderung
 * "mengarang" kalimat penutup video ("Terima kasih telah menonton", "Subtitle oleh …")
 * atau terjebak mengulang frasa yang sama.
 */
import { deflateRawSync } from 'node:zlib'
import type { FilterReason } from '@shared/stt'
import { normalizeText, normalizeWord, splitWords } from './normalize'

export interface RawSegment {
  text: string
  /** Probabilitas token <|nospeech|> dari whisper. */
  noSpeechProb: number
  avgLogprob: number
}

export interface FilterContext {
  /** Jumlah segmen dalam chunk ini (frasa "lemah" hanya dibuang jika berdiri sendiri). */
  segmentCount: number
  /** Initial prompt statis — whisper kadang mengulang prompt saat audio tidak jelas. */
  initialPrompt: string
  /** Total durasi frame "suara" (VAD energi) di chunk ini. */
  chunkSpeechMs: number
  /** Teks (ter-normalisasi) beberapa segmen terakhir yang lolos di aliran yang sama. */
  recentSegments: readonly string[]
}

export type FilterOutcome = { text: string; reason: null } | { text: string; reason: FilterReason }

/** Penanda non-ucapan: [MUSIK], (tertawa), ♪ …, *batuk*. */
const NON_SPEECH = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫♩♬🎵🎶]+/gu

/**
 * Seluruh segmen hanya terdiri dari frasa-frasa ini → buang. Termasuk varian Melayu
 * ("kerana", "sila langgan"): data latih whisper untuk bahasa Indonesia banyak tercampur Melayu.
 */
const FULL_PATTERNS = [
  /terima kasih (?:banyak )?(?:telah|sudah|atas|untuk|karena|kerana)? ?(?:menonton|mendengarkan|menyaksikan|nonton)(?: video ini| sampai habis)?/,
  /sampai jumpa (?:lagi )?(?:di|pada) (?:video|episode|konten) (?:berikutnya|selanjutnya|yang akan datang)/,
  /jangan lupa (?:untuk )?(?:like|subscribe|share|komen|comment|follow|langgan)(?: [\p{L}\p{N} ]*)?/u,
  /(?:silakan|silahkan|sila|ayo|yuk|mohon) (?:like|subscribe|share|langgan|kongsi)(?: [\p{L}\p{N} ]*)?/u,
  /selamat menonton/,
  /(?:thanks|thank you)(?: so much| very much)? for (?:watching|listening)(?: [\p{L}\p{N} ]*)?/u,
  /(?:please )?(?:like(?: and| share and)? )?subscribe(?: to (?:my|our|the) channel)?/,
  /see you (?:in the )?next (?:time|video|episode)/
]
const FULL_MATCH = new RegExp(`^(?:(?:${FULL_PATTERNS.map((r) => r.source).join('|')}) ?)+$`, 'u')

/** Muncul di mana pun dalam segmen → buang seluruh segmen (kredit subtitle). */
const CONTAINS_MATCH =
  /\bamara org\b|\b(?:subtitles?|sub|teks|terjemahan|diterjemahkan|disadur|transcribed|transcription|captions?|captioning) (?:oleh|by)\b|\bqtss\b/u

/** Frasa pendek yang sah diucapkan, tapi juga halusinasi favorit whisper — buang hanya jika meragukan. */
const WEAK_MATCH = /^(?:terima kasih(?: banyak)?|makasih|thank you(?: very much| so much)?|thanks|you|bye(?: bye)?)$/
const WEAK_NO_SPEECH_PROB = 0.3
const WEAK_AVG_LOGPROB = -0.8
/**
 * "Terima kasih" diucapkan ±0,7 s. Jika chunk berisi > 2 s "suara" (musik, tepuk tangan,
 * keramaian) tapi transkripnya hanya frasa lemah, hampir pasti halusinasi. whisper.cpp tidak
 * bisa diandalkan di sini: no_speech_prob-nya sering 0 dan logprob-nya tinggi.
 */
const WEAK_MAX_SPEECH_MS = 2000

/** Aturan OpenAI: segmen "diam" bila no_speech tinggi DAN model tidak yakin dengan teksnya. */
const NO_SPEECH_PROB = 0.6
const NO_SPEECH_LOGPROB = -1

/**
 * Frasa pendek yang identik dengan segmen barusan, dari chunk yang penuh "suara" — pola khas
 * whisper pada musik/latar ramai ("Video di bawah ini." di tiga chunk berturut-turut).
 */
const REPEAT_MAX_WORDS = 8
const REPEAT_MIN_SPEECH_MS = 2000

const COMPRESSION_RATIO_MAX = 2.4
const COMPRESSION_MIN_CHARS = 60

export function stripNonSpeech(text: string): string {
  return text.replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Pengulangan beruntun (loop decoder): n-gram yang berulang lebih dari batas disisakan satu.
 * "ya ya ya" (3×) dibiarkan — wajar dalam percakapan.
 */
export function collapseRepeats(text: string): string {
  const words = splitWords(text)
  const norm = words.map(normalizeWord)
  for (let n = 1; n <= 8; n++) {
    const maxReps = n === 1 ? 3 : 2
    let i = 0
    while (i + n * (maxReps + 1) <= words.length) {
      let reps = 1
      while (i + (reps + 1) * n <= words.length && sameRun(norm, i, i + reps * n, n)) reps++
      if (reps > maxReps) {
        words.splice(i + n, (reps - 1) * n)
        norm.splice(i + n, (reps - 1) * n)
      }
      i++
    }
  }
  return words.join(' ')
}

function sameRun(norm: string[], a: number, b: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (norm[a + k] !== norm[b + k] || !norm[a + k]) return false
  return true
}

/** Rasio kompresi gzip-style seperti di openai/whisper; teks yang berulang-ulang terkompresi sangat baik. */
export function compressionRatio(text: string): number {
  const bytes = Buffer.from(text, 'utf8')
  return bytes.length / Math.max(1, deflateRawSync(bytes).length)
}

export function filterSegment(seg: RawSegment, ctx: FilterContext): FilterOutcome {
  const raw = seg.text.trim()
  const text = stripNonSpeech(raw)
  const norm = normalizeText(text)
  if (!norm) return { text: raw, reason: 'non-speech' }
  if (FULL_MATCH.test(norm) || CONTAINS_MATCH.test(norm)) return { text, reason: 'blocklist' }
  if (
    ctx.segmentCount === 1 &&
    WEAK_MATCH.test(norm) &&
    (seg.noSpeechProb > WEAK_NO_SPEECH_PROB ||
      seg.avgLogprob < WEAK_AVG_LOGPROB ||
      ctx.chunkSpeechMs > WEAK_MAX_SPEECH_MS)
  ) {
    return { text, reason: 'weak-phrase' }
  }
  if (seg.noSpeechProb > NO_SPEECH_PROB && seg.avgLogprob < NO_SPEECH_LOGPROB) {
    return { text, reason: 'no-speech-prob' }
  }

  if (
    ctx.chunkSpeechMs > REPEAT_MIN_SPEECH_MS &&
    norm.split(' ').length <= REPEAT_MAX_WORDS &&
    ctx.recentSegments.includes(norm)
  ) {
    return { text, reason: 'repetition' }
  }

  const collapsed = collapseRepeats(text)
  if (collapsed.length >= COMPRESSION_MIN_CHARS && compressionRatio(collapsed) > COMPRESSION_RATIO_MAX) {
    return { text, reason: 'repetition' }
  }

  const prompt = normalizeText(ctx.initialPrompt)
  if (prompt && norm.split(' ').length >= 3 && prompt.includes(norm)) return { text, reason: 'prompt-echo' }

  return { text: collapsed, reason: null }
}
