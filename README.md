# TB-K1-KDJK — Berbagi File P2P

Aplikasi berbagi file dan chat per-room berbasis Laravel tanpa akun. Room code dan identitas tamu dibuat di browser, sedangkan daftar room serta riwayat chat disimpan hanya di `localStorage` browser tersebut. Pesan, permintaan transfer, dan isi file dikirim langsung antar-browser melalui WebRTC; server tidak menyimpan room, anggota, pesan, metadata transfer, atau file. Ably hanya dipakai untuk presence sementara dan signaling WebRTC. Setiap penerima file menyetujui atau menolak secara terpisah.

## Kebutuhan

- PHP 8.3+ dengan ekstensi Laravel yang diperlukan, Composer, dan Node.js/npm.
- Database MySQL/MariaDB hanya diperlukan sekali untuk menjalankan migration penghapusan data/tabel lama; aplikasi P2P tidak memakai database saat runtime.
- API key Ably untuk fitur realtime dengan kapabilitas `publish`, `subscribe`, dan `presence` pada channel `p2p:room:*`.
- HTTPS untuk penggunaan di hosting dan WebRTC.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env`, lalu isi `ABLY_API_KEY`. Format key Ably adalah `nama-key:secret`. Koneksi database hanya diperlukan bila menjalankan migration pembersihan lama.
2. Pasang dependency dan buat application key:

   ```sh
   composer install
   php artisan key:generate
   npm ci
   npm run build
   ```

3. Jika database lama masih berisi data aplikasi, jalankan migration pembersihan satu kali, lalu server:

   ```sh
   php artisan migrate
   php artisan serve
   ```

4. Buka `http://127.0.0.1:8000`; room bisa langsung dibuat atau diikuti tanpa akun. Halaman `/migrate` menggunakan `MIGRATE_ADMIN_PIN`.

## Konfigurasi hosting cPanel

1. Pilih PHP 8.3 atau lebih baru. Siapkan database lama hanya untuk menjalankan migration pembersihan; setelah itu aplikasi tidak membaca/menulis tabel aplikasi.
2. Arahkan document root domain/subdomain ke folder proyek `public` (jangan arahkan ke root proyek). Aktifkan HTTPS dan pastikan `storage` serta `bootstrap/cache` dapat ditulis oleh PHP.
3. Siapkan `.env` di server; jangan unggah atau commit file `.env` ke repository. Minimal, atur:

   ```dotenv
   APP_ENV=production
   APP_DEBUG=false
   APP_URL=https://domain-anda
   APP_KEY=base64:...
   # Database hanya dibutuhkan saat migration pembersihan pertama.
   DB_CONNECTION=mysql
   DB_HOST=...
   DB_PORT=3306
   DB_DATABASE=...
   DB_USERNAME=...
   DB_PASSWORD=...
   SESSION_DRIVER=file
   CACHE_STORE=file
   CACHE_LIMITER=file
   QUEUE_CONNECTION=sync
   ABLY_API_KEY=nama-key:secret
   TRUSTED_PROXIES=
   MIGRATE_ADMIN_PIN=<PIN-admin>
   ```

   Buat `APP_KEY` sekali menggunakan `php artisan key:generate`; jangan menggantinya setelah aplikasi digunakan. Simpan secret Ably di `.env` server, bukan di variabel `VITE_*` atau kode browser.
4. Jalankan `composer install --no-dev --optimize-autoloader`, `npm ci`, dan `npm run build` (build aset dapat dilakukan lokal lalu unggah folder `public/build`). Jika tersedia terminal cPanel, jalankan `php artisan config:cache` setelah konfigurasi selesai.
5. Atur PIN hanya di `.env` server (jangan commit file ini), lalu buka `https://domain-anda/migrate`, masukkan PIN, dan pilih perintah. Tidak perlu mengatur `APP_ENV=production`; akses dari luar server hanya menerima HTTPS. Jika config Laravel dicache, jalankan `php artisan config:clear` setelah mengubah `.env`. PIN delapan digit mudah ditebak, jadi batasi URL dengan proteksi/IP allowlist cPanel dan jangan gunakan melalui HTTP.

   Perintah yang tersedia dibatasi ke `migrate`, `db:seed`, `optimize`, `optimize:clear`, `cache:clear`, `config:clear`, `route:clear`, dan `view:clear`. Tidak ada input perintah atau argumen bebas.

## Batasan dan pengaturan

- Batas default ukuran file 100 MiB. Room dan anggota hanya ada selama browser terhubung ke presence; room terakhir disimpan lokal di browser.
- Migration `drop_database_backed_p2p_state` menghapus permanen tabel lama `rooms`, `room_members`, `chat_messages`, `file_transfers`, `users`, dan tabel sesi/token terkait. Aplikasi tidak memerlukannya setelah migration.
- Saat peserta terakhir menekan **Keluar room**, aplikasi memeriksa Ably Presence; jika tidak ada peserta tersisa, kode room dan riwayat lokal dihapus dari browser tersebut. Presence room otomatis berakhir saat semua peserta terputus. Karena tidak ada penyimpanan pusat, riwayat lokal pada perangkat lain yang sedang offline tidak dapat dihapus jarak jauh.
- Isi file hanya berada di memori browser selama transfer. Pesan dan permintaan file tidak ditulis ke database.
- Peserta hanya dapat bertukar pesan/file jika fingerprint HMAC dari IP publik yang dilihat server sama. IP mentah tidak dibagikan atau disimpan. Port tidak dibandingkan: port sumber klien dapat berubah karena NAT/proxy dan kesamaan port tidak membuktikan satu jaringan lokal. Kesamaan IP publik juga bukan bukti mutlak satu LAN (misalnya VPN atau NAT bersama).
- Jika hosting berada di belakang reverse proxy, isi `TRUSTED_PROXIES` dengan alamat/CIDR proxy tepercaya yang dipisahkan koma agar Laravel membaca IP klien yang benar. Jangan percaya header proxy dari sumber yang tidak tepercaya.
- Koneksi WebRTC menggunakan STUN tanpa TURN. NAT/firewall tertentu dapat menghalangi koneksi langsung; pesan dan transfer tidak memiliki fallback database/server sehingga perlu koneksi P2P aktif.
- Tes dan build frontend:

  ```sh
  php artisan test
  npm run build
  ```
