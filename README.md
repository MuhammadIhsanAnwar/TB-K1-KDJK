# TB-K1-KDJK — Berbagi File P2P

Aplikasi berbagi file dan chat per-room berbasis Laravel. Chat dan metadata transfer disimpan di MySQL; isi file dikirim langsung antar-browser melalui WebRTC dan tidak diunggah atau disimpan oleh server. Ably digunakan untuk presence, chat realtime, serta signaling WebRTC.

## Kebutuhan

- PHP 8.3+ dengan ekstensi Laravel yang diperlukan, Composer, dan MySQL/MariaDB.
- Node.js dan npm untuk membangun aset frontend.
- API key Ably untuk fitur realtime.
- HTTPS untuk penggunaan di hosting dan WebRTC.

## Menjalankan secara lokal

1. Salin `.env.example` menjadi `.env`, lalu isi koneksi MySQL dan `ABLY_API_KEY`. Format key Ably adalah `nama-key:secret`.
2. Pasang dependency dan buat application key:

   ```sh
   composer install
   php artisan key:generate
   npm ci
   npm run build
   ```

3. Jalankan migrasi dan server:

   ```sh
   php artisan migrate
   php artisan serve
   ```

4. Buka `http://127.0.0.1:8000`. Untuk halaman migrasi lokal, isi `MIGRATE_ADMIN_PIN` di `.env`, kemudian buka `/migrate`.

## Konfigurasi hosting cPanel

1. Pilih PHP 8.3 atau lebih baru dan siapkan database MySQL/MariaDB beserta user database.
2. Arahkan document root domain/subdomain ke folder proyek `public` (jangan arahkan ke root proyek). Aktifkan HTTPS dan pastikan `storage` serta `bootstrap/cache` dapat ditulis oleh PHP.
3. Siapkan `.env` di server; jangan unggah atau commit file `.env` ke repository. Minimal, atur:

   ```dotenv
   APP_ENV=production
   APP_DEBUG=false
   APP_URL=https://domain-anda
   APP_KEY=base64:...
   DB_CONNECTION=mysql
   DB_HOST=...
   DB_PORT=3306
   DB_DATABASE=...
   DB_USERNAME=...
   DB_PASSWORD=...
   SESSION_DRIVER=file
   CACHE_STORE=file
   QUEUE_CONNECTION=sync
   ABLY_API_KEY=nama-key:secret
   ```

   Buat `APP_KEY` sekali menggunakan `php artisan key:generate`; jangan menggantinya setelah aplikasi digunakan. Simpan secret Ably di `.env` server, bukan di variabel `VITE_*` atau kode browser.
4. Jalankan `composer install --no-dev --optimize-autoloader`, `npm ci`, dan `npm run build` (build aset dapat dilakukan lokal lalu unggah folder `public/build`). Jika tersedia terminal cPanel, jalankan `php artisan config:cache` setelah konfigurasi selesai.
5. Untuk menjalankan migrasi tanpa akses terminal, aktifkan sementara:

   ```dotenv
   MIGRATE_REMOTE_ENABLED=true
   MIGRATE_ADMIN_SECRET=<secret-acak-minimal-64-karakter>
   ```

   Buat secret dengan `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"`. Setelah konfigurasi diterapkan, buka `https://domain-anda/migrate`, masukkan secret, lalu jalankan migrasi. Mode hosting mensyaratkan `APP_ENV=production`, HTTPS, `APP_KEY`, dan secret kuat; PIN lokal bukan kredensial hosting. Setelah migrasi berhasil, nonaktifkan `MIGRATE_REMOTE_ENABLED` dan hapus/rotasi secret.

## Batasan dan pengaturan

- Batas default ukuran file 100 MiB dan maksimal 8 anggota per room. Nilainya dapat diubah melalui `SHARING_MAX_FILE_SIZE` (byte) dan `ROOM_MAX_MEMBERS`.
- Isi file hanya berada di memori browser selama transfer. Database menyimpan metadata transfer dan riwayat chat.
- Koneksi WebRTC menggunakan STUN tanpa TURN. NAT/firewall tertentu dapat menghalangi koneksi langsung; room dan chat tetap dapat digunakan.
- Tes dan build frontend:

  ```sh
  php artisan test
  npm run build
  ```
