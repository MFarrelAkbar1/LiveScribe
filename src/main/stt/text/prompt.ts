import type { Language } from '@shared/types'
import { splitWords } from './normalize'

/**
 * Initial prompt per bahasa. Whisper meniru gaya prompt: ejaan, tanda baca, dan — yang
 * terpenting untuk mode Indonesia — istilah Inggris dibiarkan dalam ejaan Inggris
 * (meeting, deadline, di-share) alih-alih dipaksa jadi bahasa Indonesia.
 */
export const INITIAL_PROMPTS: Record<Language, string> = {
  id:
    'Oke, jadi di meeting hari ini kita bahas progress project sama timeline-nya. ' +
    'Nanti tolong di-share screen ya, terus deadline-nya kita follow up lewat email.',
  en: 'Okay, so in today’s meeting we’ll go over the project update and the timeline.',
  auto: ''
}

/** Konteks kalimat sebelumnya hanya dipakai jika chunk masih bersambung (jeda pendek). */
export const CONTEXT_MAX_GAP_MS = 3000
/** Batas kata konteks; whisper sendiri membatasi prompt ~224 token. */
export const CONTEXT_MAX_WORDS = 25

/**
 * Prompt = initial prompt + ekor transkrip sebelumnya. Konteks membantu kalimat yang
 * terpotong di tengah tetap nyambung (ejaan nama, istilah).
 */
export function buildPrompt(language: Language, previousText: string): string {
  const context = splitWords(previousText).slice(-CONTEXT_MAX_WORDS).join(' ')
  return [INITIAL_PROMPTS[language], context].filter(Boolean).join(' ')
}
