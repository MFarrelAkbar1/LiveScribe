import { describe, expect, it } from 'vitest'
import { collapseRepeats, filterSegment, stripNonSpeech, type RawSegment } from './hallucination'
import { INITIAL_PROMPTS } from './prompt'

const seg = (text: string, noSpeechProb = 0.01, avgLogprob = -0.3): RawSegment => ({ text, noSpeechProb, avgLogprob })
const ctx = { segmentCount: 1, initialPrompt: INITIAL_PROMPTS.id, chunkSpeechMs: 900, recentSegments: [] as string[] }
const reason = (s: RawSegment, c = ctx) => filterSegment(s, c).reason

describe('filterSegment', () => {
  it('meloloskan ucapan biasa, termasuk campuran Indo-Inggris', () => {
    const out = filterSegment(seg(' Jadi deadline-nya kita majuin ke hari Jumat, oke?'), ctx)
    expect(out).toEqual({ text: 'Jadi deadline-nya kita majuin ke hari Jumat, oke?', reason: null })
  })

  it('membuang penanda non-ucapan', () => {
    expect(reason(seg(' [MUSIK]'))).toBe('non-speech')
    expect(reason(seg('(tertawa) ♪♪'))).toBe('non-speech')
    expect(filterSegment(seg('[musik] Selamat pagi semua.'), ctx)).toEqual({ text: 'Selamat pagi semua.', reason: null })
  })

  it('membuang kalimat penutup video khas halusinasi', () => {
    for (const text of [
      'Terima kasih telah menonton!',
      'Terima kasih sudah menonton video ini.',
      'Sampai jumpa di video berikutnya.',
      'Jangan lupa like, share, dan subscribe ya!',
      'Thanks for watching!',
      'Thank you for watching. Please subscribe.',
      'Terima kasih telah menonton. Sampai jumpa di video selanjutnya.',
      'Terima kasih kerana menonton.',
      'Jangan lupa like, share dan langgan.'
    ]) {
      expect(reason(seg(text)), text).toBe('blocklist')
    }
  })

  it('membuang kredit subtitle di mana pun posisinya', () => {
    expect(reason(seg('Subtitle oleh QTSS'))).toBe('blocklist')
    expect(reason(seg('Subtitles by the Amara.org community'))).toBe('blocklist')
    expect(reason(seg('Diterjemahkan oleh: Budi'))).toBe('blocklist')
  })

  it('tidak membuang kalimat sah yang hanya mirip', () => {
    expect(reason(seg('Terima kasih atas presentasinya, Pak.'))).toBeNull()
    expect(reason(seg('Kita subscribe ke layanan cloud yang baru.'))).toBeNull()
  })

  it('frasa lemah hanya dibuang jika berdiri sendiri dan meragukan', () => {
    expect(reason(seg('Terima kasih.', 0.5))).toBe('weak-phrase')
    expect(reason(seg('Thank you.', 0.05, -1.2))).toBe('weak-phrase')
    expect(reason(seg('Terima kasih.', 0.02, -0.2))).toBeNull()
    expect(reason(seg('Terima kasih.', 0.5), { ...ctx, segmentCount: 2 })).toBeNull()
  })

  it('frasa lemah pada chunk panjang penuh "suara" (musik/tepuk tangan) dibuang', () => {
    expect(reason(seg('Terima kasih.', 0, -0.3), { ...ctx, chunkSpeechMs: 4200 })).toBe('weak-phrase')
    expect(reason(seg('Terima kasih.', 0, -0.3), { ...ctx, chunkSpeechMs: 800 })).toBeNull()
  })

  it('membuang segmen no-speech yang tidak yakin', () => {
    expect(reason(seg('Hmm, mungkin.', 0.8, -1.5))).toBe('no-speech-prob')
    expect(reason(seg('Hmm, mungkin.', 0.8, -0.4))).toBeNull()
  })

  it('merapikan pengulangan beruntun dan membuang loop parah', () => {
    expect(filterSegment(seg('dan dan dan dan dan kita lanjut'), ctx).text).toBe('dan kita lanjut')
    const loop = Array.from({ length: 12 }, () => 'Saya tidak tahu apa yang terjadi.').join(' ')
    expect(filterSegment(seg(loop), ctx)).toEqual({ text: 'Saya tidak tahu apa yang terjadi.', reason: null })
    const noisy = 'hahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahahaha'
    expect(reason(seg(noisy))).toBe('repetition')
  })

  it('membuang frasa pendek yang berulang persis dari chunk sebelumnya (musik/latar)', () => {
    const recentSegments = ['video di bawah ini']
    expect(reason(seg('Video di bawah ini.'), { ...ctx, chunkSpeechMs: 4000, recentSegments })).toBe('repetition')
    // Jawaban singkat yang diulang setelah jeda (chunk pendek) tetap lolos.
    expect(reason(seg('Ya.'), { ...ctx, chunkSpeechMs: 400, recentSegments: ['ya'] })).toBeNull()
    // Kalimat berbeda tetap lolos.
    expect(reason(seg('Video di bawah ini bagus.'), { ...ctx, chunkSpeechMs: 4000, recentSegments })).toBeNull()
  })

  it('membuang gema initial prompt', () => {
    expect(reason(seg('Nanti tolong di-share screen ya.'))).toBe('prompt-echo')
    expect(reason(seg('Tolong share screen.'), { ...ctx, initialPrompt: '' })).toBeNull()
  })
})

describe('collapseRepeats', () => {
  it('membiarkan pengulangan wajar', () => {
    expect(collapseRepeats('ya ya ya betul')).toBe('ya ya ya betul')
    expect(collapseRepeats('oke oke, siap')).toBe('oke oke, siap')
  })

  it('merapikan n-gram yang berulang lebih dari dua kali', () => {
    expect(collapseRepeats('satu dua satu dua satu dua tiga')).toBe('satu dua tiga')
  })
})

describe('stripNonSpeech', () => {
  it('membuang semua jenis penanda', () => {
    expect(stripNonSpeech('*batuk* Oke [tepuk tangan] lanjut ♪')).toBe('Oke lanjut')
  })
})
