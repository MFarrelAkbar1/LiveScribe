# LiveScribe

Aplikasi desktop Windows yang menangkap **audio sistem** (apa pun yang keluar dari speaker/headphone —
Zoom, YouTube, meeting, dll.) dan mentranskripsikannya ke teks secara hampir real-time.

> Status: **tahap 2 — pipeline PCM 16 kHz + chunking VAD.** Transkripsi (Whisper lokal) menyusul di tahap 3.

## Kebutuhan

- Windows 10/11 (jalankan di Windows native, **bukan** WSL)
- Node.js ≥ 22.12

## Instalasi & menjalankan

```powershell
npm install
npm run dev        # mode development (hot reload)
```

Jika `npm install` tidak mengunduh binary Electron (error *"Electron failed to install correctly"*):

```powershell
node node_modules\electron\install.js
```

Perintah lain:

| Perintah            | Fungsi                                  |
| ------------------- | --------------------------------------- |
| `npm run typecheck` | Cek tipe TypeScript (main + renderer)   |
| `npm test`          | Unit test (resampler, chunker)          |
| `npm run build`     | Typecheck + build ke `out/`             |
| `npm run preview`   | Jalankan hasil build                    |

## Tips penggunaan

- **Pakai headphone saat mikrofon aktif.** Kalau memakai speaker, suara dari speaker ikut tertangkap
  mikrofon sehingga audio sistem tertranskrip dua kali (dan kualitasnya turun).
- Yang ditangkap adalah perangkat output **default** Windows. Saat perangkat default berganti
  (colok/lepas headphone, Bluetooth, ganti di *Settings › System › Sound*), capture otomatis pindah
  ke perangkat baru dan muncul notifikasi kecil — tidak perlu menekan Start lagi.

## Pipeline audio

```
loopback (+ mic) ─► WebAudio downmix mono ─► AudioWorklet: resample → 16 kHz ─► Chunker (VAD) ─► chunk PCM16
```

- **Resample**: windowed-sinc (Blackman) dengan low-pass anti-aliasing, dijalankan di AudioWorklet
  (bukan ScriptProcessor). Tanpa geseran waktu, jadi timestamp transkrip akurat.
- **Chunking**: VAD energi (frame 20 ms, noise floor adaptif). Chunk dipotong di **jeda bicara**
  (≥ 500 ms). Kalimat panjang tanpa jeda dipotong paksa pada **≤ 5 detik** di titik paling senyap
  dalam 1,5 detik terakhir; bila titik itu masih berupa suara, chunk berikutnya diberi **overlap 0,5 detik**
  (dideduplikasi di tahap 3).
- **Anti-halusinasi (tahap 1 dari 2)**: chunk dengan suara < 300 ms atau RMS-suara < −48 dBFS
  **tidak dikirim** ke engine — Whisper cenderung "mengarang" teks dari hening/noise.
  Filter frasa halusinasi di output teks menyusul di tahap 3.

Semua ambang ada di `DEFAULT_CHUNKER_CONFIG` (`src/shared/audio.ts`).

### Mendengarkan chunk (debug)

Buka panel **Debug pipeline audio**, centang **Simpan chunk ke .wav**, lalu Start. Setiap chunk yang
dikirim disimpan ke `Documents\LiveScribe\debug-chunks\<sesi>\` dengan nama
`0003_mix_00m08.64s_max-length.wav` (nomor, aliran, posisi, alasan potong). Chunk yang dilewati
(hening/pelan) tampil abu-abu di daftar beserta alasannya.

## Arsitektur singkat

```
src/
├─ shared/     tipe, konstanta audio & kontrak IPC ter-typing (dipakai main + preload + renderer)
├─ main/       lifecycle, jendela, handler loopback (setDisplayMediaRequestHandler), permission, file I/O
├─ preload/    contextBridge → window.api (whitelist channel)
└─ renderer/
   ├─ audio/   capture (graf WebAudio, auto-restart perangkat), pcm-worklet, pipeline
   │  └─ dsp/  resampler & chunker (murni, tanpa DOM — di-unit-test)
   └─ ui/      level meter, log chunk, toast
```

Keamanan: `contextIsolation: true`, `sandbox: true`, tanpa `nodeIntegration`, CSP ketat, navigasi &
`window.open` diblokir, permission hanya `media` / `display-capture` / clipboard dari origin aplikasi,
IPC memvalidasi pengirim & payload.
