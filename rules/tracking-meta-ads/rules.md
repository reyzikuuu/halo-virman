# META ADS HYBRID TRACKING SPECIFICATION & RULES
## Framework: Astro (SSR/Hybrid) + Cloudflare Pages + Google Sheets + Meta CAPI

---

### 1. ARSITEKTUR & PRINSIP FUNNEL
Sistem pelacakan ini dirancang untuk alur penjualan WhatsApp/Offline dengan eliminasi "Leads Sampah" (Ghost Clicks) menggunakan model verifikasi bertingkat:

1. **Top of Funnel (Web Load):**
   - Event: `PageView`
   - Trigger: Dimuat otomatis via Meta Pixel Browser di `Layout.astro`.
2. **Mid of Funnel (CTA Click):**
   - Event: `Contact`
   - Trigger: Pengunjung menekan tombol CTA WhatsApp di website.
   - Aksi: Browser menembak event `Contact` (Pixel), server Astro menembak event `Contact` (CAPI), metadata disimpan ke Google Sheets, dan user diarahkan ke `wa.me` dengan template pesan berisi `Ref Code` unik.
3. **Bottom of Funnel (Qualified Lead):**
   - Event: `Lead`
   - Trigger: Prospek benar-benar mengirim pesan ke WhatsApp dan direspons/diverifikasi admin.
   - Aksi: Admin mengisi nomor HP prospek di baris `Ref Code` terkait di Google Sheets, lalu mengubah status dropdown menjadi `Lead`. Google Apps Script otomatis mengirim event `Lead` ke Meta CAPI.
4. **Closing / Offline Conversion (Purchase):**
   - Event: `Purchase`
   - Trigger: Prospek mentransfer dana / transaksi selesai.
   - Aksi: Admin mengisi nominal harga di kolom `Order Value` di Google Sheets, lalu mengubah status dropdown menjadi `Purchase`. Google Apps Script otomatis mengirim event `Purchase` lengkap beserta nilai omzet (`value` & `currency: 'IDR'`) ke Meta CAPI.

---

### 2. STRATEGI CAMPAIGN & AD SET META ADS
1. **Fase Awal (Cold Start / Pixel Baru):**
   - **Campaign Objective:** `Leads` (atau `Sales` dengan setup manual).
   - **Ad Set Conversion Location:** `Website` (Bukan Messaging Apps).
   - **Ad Set Optimization Event:** Disetel ke `Lead`.
   - **Alasan:** Menghindari *Learning Limited* karena event `Lead` lebih cepat terkumpul dibanding `Purchase`.
2. **Fase Scaling (Pixel Matang):**
   - Beralih ke optimasi `Purchase` setelah terkumpul minimal 30–50 event `Purchase` via CAPI.
3. **Attribution Window:** Wajib disetel ke **7-day click or 1-day view**. Data offline purchase dari WA tetap diatribusikan ke iklan selama terjadi maksimal 7 hari sejak klik iklan.

---

### 3. TECHNICAL RULES UNTUK PENGEMBANGAN WEBSITE (ASTRO + CLOUDFLARE)

#### Rule 3.1: Server-Side Cookie Retention (`src/middleware.ts`)
- Mencegah hilangnya parameter klik akibat proteksi Safari ITP, Brave, dan ekstensi AdBlocker.
- Intersep request URL: jika parameter `fbclid` ditemukan, buat cookie `_fbc` dengan format:
  `fb.1.<timestamp_ms>.<fbclid>`
- Jika cookie `_fbp` belum ada, buat cookie `_fbp` dengan format:
  `fb.1.<timestamp_ms>.<random_int>`
- Atribut cookie wajib: `path: '/'`, `maxAge: 7776000` (90 hari), `secure: true`, `sameSite: 'lax'`, `httpOnly: false`.

#### Rule 3.2: Cloudflare Edge Execution & Runtime Env (Astro v6+ / @astrojs/cloudflare v14+)
- Set `export const prerender = false;` on API routes (`src/pages/api/track-contact.ts`).
- **STRICT RUNTIME COMPLIANCE:** DO NOT use `context.locals.runtime.ctx` or `context.locals.runtime.env` (deprecated and explicitly throws an Error in Astro v6).
- **Edge Non-blocking Tasks:** ALWAYS use `context.locals.cfContext.waitUntil(...)` for background execution when dispatching requests to Meta Graph API and Google Sheets Webhook, ensuring the client response returns immediately without killing the background tasks.
- **Local Dev Fallback:** If running in local Node dev mode where `context.locals.cfContext` is undefined, use `await` on the background tasks promise before returning the response.
- **Environment Variables Resolution:** Extract environment variables in order of priority:
  1. `context.locals.cfContext?.env?.[KEY]` (Cloudflare Worker production runtime)
  2. `process.env?.[KEY]` (Node environment)
  3. `import.meta.env?.[KEY]` (Astro build/Vite environment)
- **Visitor Context:** Extract real visitor IP from `request.headers.get('cf-connecting-ip')` (with fallback to `x-forwarded-for`) and User-Agent from `request.headers.get('user-agent')`.
- **Identifiers:** Read `_fbc`, `_fbp`, and `_gclid` from both cookies and request body fallback.

#### Rule 3.3: Komponen Tombol WhatsApp (`WhatsAppCTA.astro`)
- Mengenerate `refCode` acak (misal: `#REFA1`) dan `eventId` unik (misal: `contact_<timestamp>_<random>`).
- Memicu Pixel Browser: `fbq('track', 'Contact', {}, { eventID: eventId })`.
- Mengirim payload ke `/api/track-contact` (`refCode`, `eventId`, `fbc`, `fbp`, `sourceUrl`).
- Format pesan redirect WhatsApp: menyamarkan kode referensi sebagai kode voucher/diskon agar tidak dihapus pengguna:
  `Halo Admin, saya mau ambil Promo Diskon via Website. (Mohon jangan hapus Kode Kupon: #REFA1 agar promo berlaku)`

---

### 4. TECHNICAL RULES UNTUK GOOGLE SHEETS & APPS SCRIPT

#### Rule 4.1: Struktur Kolom Spreadsheet (Baris 1)
- Kolom A: `Timestamp` (Waktu klik dibuat)
- Kolom B: `Ref Code` (Kode unik pencocokan)
- Kolom C: `Phone` (Nomor WA prospek - Format Plain Text `@`)
- Kolom D: `FBC` (Click ID)
- Kolom E: `FBP` (Browser ID)
- Kolom F: `Client IP` (IP publik pengunjung dari Cloudflare)
- Kolom G: `User Agent` (Spesifikasi browser/perangkat)
- Kolom H: `Source URL` (Landing page asal)
- Kolom I: `Status` (Dropdown: `Contact`, `Lead`, `Purchase`)
- Kolom J: `Order Value` (Nominal closing - Format Number `#,##0`)
- Kolom K: `Meta Log` (Status pengiriman API dari Meta)

#### Rule 4.2: Normalisasi Nomor Telepon & Hashing
- Meta melarang pengiriman data nomor telepon mentah.
- Nomor telepon wajib dinormalisasi otomatis ke standar internasional:
  - Hilangkan karakter non-angka (`\D`).
  - Ubah awalan `08` atau `8` menjadi `628...`.
- Hash nomor hasil normalisasi menggunakan algoritma **SHA-256** ke dalam 64 karakter heksadesimal sebelum dikirimkan ke parameter `user_data.ph`.

#### Rule 4.3: Larangan Simple Trigger `onEdit`
- DILARANG menggunakan fungsi `onEdit(e)` sederhana karena Google membatasi otorisasi `UrlFetchApp.fetch()` pada simple triggers.
- Buat fungsi bernama kustom (contoh: `handleStatusEdit(e)`).
- Pasang fungsi tersebut sebagai **Installable Trigger** di menu Triggers Apps Script:
  - *Choose which function to run:* `handleStatusEdit`
  - *Select event source:* `From spreadsheet`
  - *Select event type:* `On edit`

#### Rule 4.4: Deploy Webhook Apps Script
- Deploy sebagai **Web App**.
- *Execute as:* **Me (akun Anda)**.
- *Who has access:* **Anyone** (Siapa saja, agar endpoint Astro Cloudflare dapat melakukan HTTP POST).

---

### 5. ATURAN PENGUJIAN & VERIFIKASI (TESTING)
1. Selalu uji alur menggunakan parameter simulasi `?fbclid=IwAR_test_12345` pada URL website.
2. Gunakan `test_event_code` dari tab **Test Events** Meta Events Manager di endpoint Astro dan Apps Script selama masa uji coba.
3. Event dinyatakan valid jika:
   - Event `Contact` menghasilkan status **Deduplicated** antara Browser dan Server.
   - Event `Lead` dan `Purchase` berhasil diterima dari sumber **Server** dengan skor pencocokan parameter identitas (EMQ) hijau.
4. Hapus `test_event_code` dari kode sebelum kampanye iklan berbayar diaktifkan.