# Bot Meta API v2.0

Bot otomasi jadwal konten Facebook Business dengan sistem keamanan Bearer token berbasis MySQL.

---

## 📁 Struktur Folder

```
bot-meta/
├── index.js                      ← Entry point server
│
├── .env.example                  ← Template konfigurasi (salin ke .env)
├── .gitignore
│
├── config/
│   └── app.config.js             ← Konfigurasi path & ekstensi file
│
├── database/
│   ├── setup.sql                 ← Script buat DB, user, tabel MySQL
│   ├── db.js                     ← Koneksi pool MySQL
│   └── token.service.js          ← Semua query: token, sesi, log
│
├── middleware/
│   ├── auth.middleware.js        ← Validasi Bearer token (semua endpoint)
│   ├── session.guard.js          ← Cek token boleh akses sessionName
│   └── admin.guard.js            ← Pastikan role=admin
│
├── admin/
│   └── admin.routes.js           ← CRUD token, assign sesi, access log
│
├── helpers/
│   ├── session.helper.js         ← Manajemen folder sesi browser
│   ├── file.helper.js            ← Deteksi tipe file
│   └── validation.helper.js      ← Validasi input task
│
├── services/
│   ├── task.service.js           ← Inti otomasi Playwright
│   ├── queue.service.js          ← Antrian global FIFO
│   └── asset.service.js          ← Verifikasi assetId ke Facebook
│
└── routes/
    ├── auth.routes.js            ← /login-meta, /login-cookies
    ├── session.routes.js         ← /check-session, /list-sessions
    ├── schedule.routes.js        ← /schedule
    ├── asset.routes.js           ← /check-asset, /check-business
    ├── post.routes.js            ← /check-posts
    └── status.routes.js          ← /status
```

---

## 🚀 Setup Awal

### 1. Install dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Setup MySQL
```bash
mysql -u root -p < database/setup.sql
```

### 3. Konfigurasi .env
```bash
cp .env.example .env
# Edit .env sesuai konfigurasi MySQL kamu
```

### 4. Jalankan server
```bash
npm start
```

---

## 🔐 Sistem Keamanan

### Lapisan Keamanan
```
Request masuk
    ↓
[authMiddleware]   → Cek Bearer token: ada? valid? aktif? belum expired?
    ↓
[adminGuard]       → Khusus /admin/*: pastikan role=admin
    ↓
[sessionGuard]     → Cek token boleh akses sessionName yang diminta
    ↓
Route Handler
```

### Role Token
| Role | Akses |
|------|-------|
| `client` | Hanya sesi yang sudah di-assign oleh admin |
| `admin` | Semua sesi + endpoint /admin/* |

### Response Error Keamanan
| Kondisi | HTTP Code | Status |
|---------|-----------|--------|
| Tidak ada token | 401 | Unauthorized |
| Token tidak ditemukan | 401 | Unauthorized |
| Token dinonaktifkan | 401 | Unauthorized |
| Token expired | 401 | Unauthorized (+ info tanggal expired) |
| Akses sesi tidak diizinkan | 403 | Forbidden |
| Bukan role admin | 403 | Forbidden |

---

## 📡 Endpoint API

### Header Wajib (semua endpoint)
```
Authorization: Bearer <token_kamu>
```

### Endpoint Utama (semua role)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/login-meta` | Login manual — buka browser |
| POST | `/login-cookies` | Login via cookies |
| GET | `/check-session` | Cek status & login sesi |
| GET | `/list-sessions` | Daftar semua sesi |
| POST | `/schedule` | Jadwalkan batch konten |
| GET | `/status` | Status antrian real-time |
| POST | `/check-asset` | Verifikasi assetId |
| POST | `/check-posts` | Scrape konten terjadwal |
| POST | `/check-business` | Deteksi semua page |

### Endpoint Admin (`role=admin`)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/admin/tokens` | Buat token baru |
| GET | `/admin/tokens` | List semua token |
| GET | `/admin/tokens/:id` | Detail + sesi token |
| PATCH | `/admin/tokens/:id` | Edit token |
| DELETE | `/admin/tokens/:id` | Hapus token |
| POST | `/admin/tokens/:id/sessions` | Assign sesi ke token |
| DELETE | `/admin/tokens/:id/sessions` | Cabut sesi dari token |
| GET | `/admin/tokens/:id/sessions` | List sesi token |
| GET | `/admin/logs` | Lihat access log |

---

## 📝 Contoh Penggunaan

### Buat token client baru (admin)
```json
POST /admin/tokens
Authorization: Bearer admin-secret-change-this-immediately

{
  "client_name": "Reseller Jakarta",
  "role": "client",
  "expired_at": "2026-12-31 23:59:59"
}
```

### Assign sesi ke token (admin)
```json
POST /admin/tokens/2/sessions
Authorization: Bearer <admin_token>

{
  "sessions": ["akun_1", "akun_2", "akun_3"]
}
```

### Jadwalkan konten (client)
```json
POST /schedule
Authorization: Bearer <client_token>

{
  "sessionName": "akun_1",
  "tasks": [
    {
      "assetId": "123456789",
      "filePath": "/path/ke/video.mp4",
      "caption": "Caption konten ini",
      "date": "28/02/2026",
      "hour": "10"
    }
  ]
}
```

### Nonaktifkan token (admin)
```json
PATCH /admin/tokens/2
Authorization: Bearer <admin_token>

{ "is_active": 0 }
```

### Lihat log akses terakhir (admin)
```
GET /admin/logs?status_code=403&limit=50
Authorization: Bearer <admin_token>
```

---

## ⚠️ Penting Setelah Setup

1. **Ganti token admin default** di tabel `tokens` sebelum production
2. **Simpan .env** di luar repo Git (sudah ada di .gitignore)
3. **Ganti password MySQL** di `setup.sql` sebelum dijalankan