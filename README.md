# LiveScribe

Aplikasi desktop Windows yang menangkap **audio sistem** (apa pun yang keluar dari speaker/headphone —
Zoom, YouTube, meeting, dll.) dan mentranskripsikannya ke teks secara hampir real-time.

> Status: **tahap 1 — capture loopback + level meter.** Transkripsi menyusul di tahap berikutnya.

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
| `npm run build`     | Typecheck + build ke `out/`             |
| `npm run preview`   | Jalankan hasil build                    |

## Tips penggunaan

- **Pakai headphone saat mikrofon aktif.** Kalau memakai speaker, suara dari speaker ikut tertangkap
  mikrofon sehingga audio sistem tertranskrip dua kali (dan kualitasnya turun).
- Yang ditangkap adalah perangkat output **default** Windows. Jika meter "Sistem" diam, cek
  *Settings › System › Sound › Output*.

## Arsitektur singkat

```
src/
├─ shared/     tipe & kontrak IPC ter-typing (dipakai main + preload + renderer)
├─ main/       lifecycle, jendela, handler loopback (setDisplayMediaRequestHandler), permission
├─ preload/    contextBridge → window.api (whitelist channel)
└─ renderer/   UI vanilla TS + graf WebAudio
```

Keamanan: `contextIsolation: true`, `sandbox: true`, tanpa `nodeIntegration`, CSP ketat, navigasi &
`window.open` diblokir, permission hanya `media` / `display-capture` / clipboard dari origin aplikasi.
