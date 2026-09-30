# LiveScribe

Aplikasi desktop Windows yang menangkap **audio sistem** (apa pun yang keluar dari speaker/headphone —
Zoom, YouTube, meeting, dll.) dan mentranskripsikannya ke teks secara hampir real-time.

> Status: **tahap 3 — transkripsi lokal dengan whisper.cpp (GPU CUDA / CPU).** UI lengkap menyusul di tahap 4.

## Kebutuhan

- Windows 10/11 x64 (jalankan di Windows native, **bukan** WSL)
- Node.js ≥ 22.12
- [Microsoft Visual C++ Redistributable 2015–2022 (x64)](https://aka.ms/vs/17/release/vc_redist.x64.exe) —
  dibutuhkan binary whisper.cpp; aplikasi memberi tahu jika belum terpasang
- Opsional: GPU NVIDIA dengan driver ≥ 527.41 (CUDA 12) — tanpa GPU, engine berjalan di CPU

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
| `npm test`          | Unit test (resampler, chunker, filter teks, dedup) |
| `npm run build`     | Typecheck + build ke `out/`             |
| `npm run preview`   | Jalankan hasil build                    |
| `npm run bench:stt -- <file.wav>` | Benchmark engine dengan file WAV 16 kHz mono (lihat di bawah) |
| `npm run pin:whisper` | Hasilkan ulang hash yang di-pin (`src/main/stt/pins.ts`) saat naik versi |

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
  (dideduplikasi oleh engine, lihat di bawah).
- **Anti-halusinasi (tahap 1 dari 2)**: chunk dengan suara < 300 ms atau RMS-suara < −48 dBFS
  **tidak dikirim** ke engine — Whisper cenderung "mengarang" teks dari hening/noise.
  Filter frasa halusinasi di output teks ada di engine (tahap 3).

Semua ambang ada di `DEFAULT_CHUNKER_CONFIG` (`src/shared/audio.ts`).

### Mendengarkan chunk (debug)

Buka panel **Debug pipeline audio**, centang **Simpan chunk ke .wav**, lalu Start. Setiap chunk yang
dikirim disimpan ke `Documents\LiveScribe\debug-chunks\<sesi>\` dengan nama
`0003_mix_00m08.64s_max-length.wav` (nomor, aliran, posisi, alasan potong). Chunk yang dilewati
(hening/pelan) tampil abu-abu di daftar beserta alasannya.

## Engine transkripsi (tahap 3)

```
chunk PCM16 ─IPC─► SttEngine (antrean FIFO) ─HTTP 127.0.0.1─► whisper-server.exe ─► filter halusinasi ─► dedup overlap ─► UI
```

- **whisper.cpp `whisper-server.exe` sebagai child process.** Model dimuat **sekali** saat engine start;
  tiap chunk hanya request `/inference` (WAV di memori). Server hanya bind ke **127.0.0.1** dengan
  **port acak** dari OS. Saat aplikasi ditutup, server dimatikan dan ditunggu sampai keluar. Jika
  Electron crash atau di-kill, Windows ikut mematikan server (libuv memasukkan child ke Job Object
  `KILL_ON_JOB_CLOSE`), jadi tidak ada proses yatim. Jika server crash, engine restart otomatis
  (maksimal 3× per 5 menit).
- **Download otomatis + progress bar** saat pertama kali jalan, ke `%APPDATA%\LiveScribe\whisper\`:
  binary [whisper.cpp v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4) (build `b5130`)
  dan model `ggml-small.bin` (revisi Hugging Face di-pin). Download bisa dibatalkan dan **dilanjutkan**
  (HTTP Range), lewat network stack Chromium (ikut proxy sistem).
- **Verifikasi SHA256**: arsip dicek terhadap hash yang di-pin sebelum diekstrak; hanya file yang
  dibutuhkan yang diekstrak, masing-masing dicek terhadap hash per-file yang di-pin; model dicek saat
  diunduh. **Setiap kali engine start, semua file dicek ulang** sebelum dijalankan. File rusak/diubah
  → dipasang ulang otomatis dari sumber yang di-pin. Semua hash ada di `src/main/stt/pins.ts`.
- **GPU/CPU**: GPU NVIDIA dideteksi lewat `nvidia-smi`. Jika ada (dan driver ≥ 527.41), dipakai build
  **CUDA 12.4** (±675 MB, membawa cuBLAS sendiri); jika tidak, build **CPU** (±9 MB). Jika CUDA gagal
  start atau whisper.cpp tidak mengaktifkan backend CUDA, engine otomatis **fallback ke CPU** dan
  alasannya ditampilkan. Engine yang benar-benar aktif dibaca dari log whisper-server dan tampil di
  badge **GPU · …** / **CPU** di pojok atas. (Build CUDA 11.8 sengaja tidak dipakai: arsipnya tidak
  menyertakan `cublas64_11.dll`, sehingga diam-diam jatuh ke CPU tanpa CUDA Toolkit.)
  Untuk tes: `LIVESCRIBE_ENGINE=cpu` (atau `gpu`) memaksa varian tertentu.
- **Bahasa**: Indonesia / English / Auto (dropdown, diingat). Mode Indonesia memakai *initial prompt*
  campuran Indo-Inggris ("meeting", "deadline-nya", "di-share") supaya istilah Inggris tidak
  dipaksa jadi ejaan Indonesia. Ekor transkrip sebelumnya ikut jadi konteks jika chunk bersambung.
- **Anti-halusinasi (tahap 2 dari 2)** — `src/main/stt/text/hallucination.ts`:
  penanda non-ucapan (`[MUSIK]`, `(tertawa)`, `♪`), frasa penutup video ("Terima kasih telah/kerana
  menonton", "Subtitle oleh …", "Thanks for watching"), frasa pendek meragukan ("Terima kasih.",
  "Thank you.") pada chunk yang penuh suara/musik, frasa identik yang berulang antar-chunk,
  loop pengulangan (rasio kompresi), dan gema initial prompt. `no_speech_prob` dari whisper.cpp
  tidak bisa diandalkan (sering 0), jadi heuristik memakai data VAD chunker.
- **Dedup overlap** — `src/main/stt/text/dedup.ts`: kata di awal chunk yang mengulang ekor chunk
  sebelumnya (overlap 0,5 s) dibuang, toleran salah eja kecil; kata yang terpotong di titik potong
  dilengkapi (segmen sebelumnya dikoreksi di UI).

Panel debug menampilkan latensi tiap chunk dan apa yang dibuang filter (arahkan kursor untuk teksnya).

### Latensi di mesin pengembangan

i7-13700HX + RTX 4060 Laptop (8 GB), model small, bahasa Indonesia. *Latensi per chunk* = chunk
selesai dipotong → teks diterima UI (antrean + inferensi + pasca-proses + IPC). Chunk rata-rata ±3,7–4,4 s.

| Skenario (audio Indonesia)                                  | Engine | Rata-rata | p50    | p95      | Maks     |
| ----------------------------------------------------------- | ------ | --------- | ------ | -------- | -------- |
| Aplikasi, loopback, Wikipedia lisan 3 mnt (n=35)            | GPU    | 444 ms    | —      | —        | 671 ms   |
| Aplikasi, loopback, podcast percakapan 4 mnt (n=45)         | GPU    | 613 ms    | —      | —        | 1.157 ms |
| Bench real-time 1×, Wikipedia lisan 5 mnt (n=77)            | GPU    | 321 ms    | 336 ms | 451 ms   | 477 ms   |
| Bench real-time 1×, Wikipedia lisan 3 mnt (n=46), 8 thread  | CPU    | 2.352 ms  | 2.271 ms | 3.113 ms | 3.524 ms |

Catatan: GPU laptop turun ke P8 saat idle di antara chunk; jika chunk dikirim beruntun latensinya
±100–200 ms. Pencilan hingga beberapa detik bisa terjadi saat whisper melakukan *temperature
fallback* pada audio sulit (musik, suara bertumpuk).

### Benchmark sendiri

```powershell
npm run bench:stt -- rekaman.wav --language id --realtime --out transkrip.txt
npm run bench:stt -- rekaman.wav --engine cpu --limit 60 --verbose
```

File harus WAV 16 kHz mono PCM16. Memakai `Chunker` dan `SttEngine` yang sama dengan aplikasi (tanpa
capture & IPC). Default memproses chunk satu per satu (latensi murni); `--realtime` mengumpankan
audio secepat aslinya; `--verbose` menampilkan segmen mentah whisper (`no_speech_prob`, `avg_logprob`).

## Arsitektur singkat

```
src/
├─ shared/     tipe, konstanta audio & kontrak IPC ter-typing (dipakai main + preload + renderer)
├─ main/       lifecycle, jendela, handler loopback (setDisplayMediaRequestHandler), permission, file I/O
│  └─ stt/     engine: download + verifikasi (pins.ts), deteksi GPU, whisper-server, antrean
│     └─ text/ filter halusinasi, dedup overlap, prompt (murni — di-unit-test)
├─ preload/    contextBridge → window.api (whitelist channel)
└─ renderer/
   ├─ audio/   capture (graf WebAudio, auto-restart perangkat), pcm-worklet, pipeline
   │  └─ dsp/  resampler & chunker (murni, tanpa DOM — di-unit-test)
   └─ ui/      level meter, log chunk, toast, panel engine, transkrip, statistik latensi
```

Keamanan: `contextIsolation: true`, `sandbox: true`, tanpa `nodeIntegration`, CSP ketat, navigasi &
`window.open` diblokir, permission hanya `media` / `display-capture` / clipboard dari origin aplikasi,
IPC memvalidasi pengirim & payload.
