
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#ffffff">
    <title>NonovShare — berbagi file langsung</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <div id="page-loader" class="page-loader">
        <div class="loader-content">
            <div class="loader-logo" aria-hidden="true">N</div>
            <h2>NonovShare</h2>
            <p>Menyiapkan koneksi berbagi...</p>
            <div class="loader-progress">
                <div class="loader-progress-bar"></div>
            </div>
        </div>
    </div>

    <div class="page-shell">
        <header class="topbar">
            <a class="brand" href="/" aria-label="NonovShare - beranda">
                <span class="brand-mark" aria-hidden="true">N</span>
                <span>NonovShare</span>
            </a>

            <div class="topbar-meta">
                <span class="secure-pill">
                    <span class="secure-dot"></span>
                    Transfer langsung antar browser
                </span>

                <button
                    id="top-user"
                    class="top-user"
                    type="button"
                    title="Ubah username"
                    aria-label="Ubah username"
                ></button>
            </div>
        </header>

        <main>
            <section id="workspace" class="workspace">
                <div class="welcome-row">
                    <div>
                        <span class="eyebrow">BERBAGI LANGSUNG</span>
                        <h1>Kirim file tanpa<br><span>unggah ke cloud.</span></h1>
                    </div>

                    <div class="network-card" id="network-card" aria-live="polite">
                        <span id="network-icon" class="network-icon">⌁</span>
                        <div>
                            <strong id="network-title">Memeriksa jaringan</strong>
                            <span id="network-detail">Pemeriksaan tidak menghalangi kamu masuk room.</span>
                            <span id="public-ip">IP publik sedang diperiksa...</span>
                        </div>
                        <span id="network-indicator" class="network-indicator"></span>
                    </div>
                </div>

                <div class="main-grid">
                    <aside class="room-sidebar">
                        <div class="sidebar-heading">
                            <div>
                                <span class="eyebrow">RUANGMU</span>
                                <h2>Tempat berbagi</h2>
                            </div>
                            <span class="sidebar-icon">▦</span>
                        </div>

                        <form id="create-room-form" class="room-action-card">
                            <div class="room-create-heading">
                                <span class="action-icon create-icon">＋</span>
                                <div class="action-copy">
                                    <strong>Buat room baru</strong>
                                    <span>Atur nama sebelum mengundang teman.</span>
                                </div>
                            </div>

                            <label class="room-name-field" for="room-name">
                                <span>Nama room</span>
                                <input
                                    id="room-name"
                                    name="room_name"
                                    type="text"
                                    maxlength="40"
                                    autocomplete="off"
                                    placeholder="Contoh: NonovShare1"
                                    required
                                >
                            </label>

                            <button class="button button-primary room-create-button" type="submit">
                                Buat room
                            </button>
                        </form>

                        <form id="join-room-form" class="join-form">
                            <label for="room-code">Punya kode room?</label>
                            <div class="join-input-row">
                                <input
                                    id="room-code"
                                    name="room_id"
                                    type="text"
                                    maxlength="45"
                                    autocomplete="off"
                                    placeholder="Masukkan kode room 12 karakter"
                                    required
                                >
                                <button class="button button-outline button-small" type="submit">
                                    Gabung
                                </button>
                            </div>
                        </form>

                        <div class="recent-heading">
                            <span>Room terakhir</span>
                            <span class="recent-count" id="room-count">0</span>
                        </div>

                        <div id="recent-rooms" class="recent-rooms">
                            <p class="empty-note">
                                Sesi yang pernah kamu ikuti di browser ini akan tampil di sini.
                            </p>
                        </div>

                        <div class="recent-heading private-users-heading">
                            <span>Pengguna satu jaringan</span>
                            <span class="recent-count" id="private-online-count">0</span>
                        </div>

                        <div id="private-online-users" class="private-online-users">
                            <p class="empty-note">Memeriksa pengguna online...</p>
                        </div>
                    </aside>

                    <section class="room-panel">
                        <div id="room-empty" class="room-empty">
                            <div class="empty-illustration" aria-hidden="true">
                                <span>↗</span>
                            </div>
                            <span class="eyebrow">BELUM ADA ROOM AKTIF</span>
                            <h2>Siap berbagi?</h2>
                            <p>
                                Buat sesi atau gabung dengan kode undangan untuk mengirim
                                pesan dan file antar-browser.
                            </p>
                        </div>

                        <div id="active-room" class="active-room" hidden>
                            <div class="room-header">
                                <div class="room-title-block">
                                    <span class="room-live">
                                        <span></span> ROOM AKTIF
                                    </span>
                                    <h2 id="active-room-name">Room</h2>
                                    <span class="room-code">
                                        Kode <strong id="active-room-code"></strong>
                                    </span>
                                </div>

                                <div class="room-actions">
                                    <button
                                        id="copy-invite"
                                        class="button button-outline button-small"
                                        type="button"
                                        disabled
                                    >
                                        ⧉ <span>Salin undangan</span>
                                    </button>

                                    <button
                                        id="show-qr"
                                        class="button button-outline button-small"
                                        type="button"
                                        disabled
                                    >
                                        ▦ <span>QR</span>
                                    </button>

                                    <button
                                        id="leave-room"
                                        class="button button-quiet button-small"
                                        type="button"
                                    >
                                        Keluar room
                                    </button>
                                </div>
                            </div>

                            <div id="room-status" class="room-status" aria-live="polite">
                                <span class="status-pulse"></span>
                                <span>Menyiapkan koneksi P2P…</span>
                            </div>

                            <div class="room-content">
                                <aside class="members-panel">
                                    <div class="section-heading">
                                        <div>
                                            <span class="eyebrow">HADIR DI ROOM</span>
                                            <h3>Orang-orang</h3>
                                        </div>
                                        <span id="online-count" class="online-count">0</span>
                                    </div>

                                    <div id="online-members" class="online-members"></div>

                                    <div class="peer-note">
                                        <span class="peer-note-icon">⌁</span>
                                        <p>
                                            Pesan dan file dikirim langsung antar-browser.
                                            Hanya peserta dengan IP publik sama yang dapat
                                            terhubung. Firewall/NAT masih dapat menghalangi P2P.
                                        </p>
                                    </div>
                                </aside>

                                <div class="conversation-panel">
                                    <div class="section-heading conversation-heading">
                                        <div>
                                            <span class="eyebrow">PESAN ROOM</span>
                                            <h3>Percakapan</h3>
                                        </div>
                                        <span class="chat-encryption">P2P LANGSUNG</span>
                                    </div>

                                    <div
                                        id="chat-messages"
                                        class="chat-messages"
                                        role="log"
                                        aria-live="polite"
                                        aria-relevant="additions"
                                    >
                                        <div class="chat-empty">
                                            Belum ada pesan. Sapa temanmu dulu 👋
                                        </div>
                                    </div>

                                    <p class="chat-local-note">
                                        Pesan dikirim P2P. Riwayat hanya tersimpan lokal di browser ini.
                                    </p>

                                    <form id="chat-form" class="chat-form">
                                        <input
                                            id="chat-input"
                                            name="body"
                                            type="text"
                                            maxlength="2000"
                                            autocomplete="off"
                                            placeholder="Tulis pesan..."
                                            required
                                        >
                                        <button
                                            id="room-voice-button"
                                            class="voice-button"
                                            type="button"
                                            aria-label="Rekam voice note"
                                            title="Rekam voice note"
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>
                                        </button>
                                        <div id="room-voice-recorder" class="voice-recorder" hidden>
                                            <span class="voice-recorder-dot" aria-hidden="true"></span>
                                            <span id="room-voice-timer" class="voice-recorder-time">0:00</span>
                                            <span class="voice-recorder-hint">Merekam · maks. 2 menit</span>
                                            <button id="room-voice-cancel" class="button button-quiet button-small" type="button">Batal</button>
                                            <button id="room-voice-send" class="button button-primary button-small" type="button">Kirim</button>
                                        </div>
                                        <button
                                            class="send-button"
                                            type="submit"
                                            aria-label="Kirim pesan"
                                        >
                                            ↑
                                        </button>
                                    </form>
                                </div>
                            </div>

                            <section class="transfer-section">
                                <div class="section-heading transfer-heading">
                                    <div>
                                        <span class="eyebrow">P2P FILE SHARING</span>
                                        <h3>Kirim file langsung</h3>
                                    </div>
                                    <span class="transfer-limit">
                                        Maks. 100 MB · tidak diunggah ke server
                                    </span>
                                </div>

                                <form id="send-file-form" class="send-file-form">
                                    <label class="file-picker" for="file-input">
                                        <span class="file-picker-icon">↥</span>
                                        <span>
                                            <strong id="selected-file-name">
                                                Pilih file untuk dikirim
                                            </strong>
                                            <small id="selected-file-size">
                                                File akan dikirim langsung ke browser penerima.
                                            </small>
                                        </span>
                                        <span class="file-picker-browse">Pilih file</span>
                                    </label>

                                    <input id="file-input" type="file" hidden>

                                    <div class="recipient-picker">
                                        <span>Kirim kepada</span>

                                        <div class="recipient-actions">
                                            <button
                                                type="button"
                                                id="select-all-recipients"
                                                class="button button-outline"
                                            >
                                                Pilih Semua
                                            </button>
                                        </div>

                                        <select
                                            id="recipient-select"
                                            required
                                            multiple
                                            size="4"
                                        ></select>

                                        <small id="recipient-count">
                                            0 penerima dipilih
                                        </small>

                                        <small id="recipient-status">
                                            Pilih penerima atau gunakan tombol Pilih Semua.
                                        </small>
                                    </div>

                                    <button
                                        id="send-file-button"
                                        class="button button-primary"
                                        type="submit"
                                        disabled
                                    >
                                        Kirim file <span>→</span>
                                    </button>
                                </form>

                                <div id="transfers-list" class="transfers-list">
                                    <p class="empty-note">
                                        Belum ada aktivitas transfer di room ini.
                                    </p>
                                </div>
                            </section>
                        </div>

                        <!-- CHAT PRIBADI BERADA DI LUAR ACTIVE ROOM -->
                        <section id="private-chat-panel" class="private-chat-panel" hidden>
                            <div class="private-chat-header">
                                <div>
                                    <span class="eyebrow">
                                        CHAT PRIBADI · SATU IP PUBLIK
                                    </span>
                                    <h2 id="private-chat-title">Percakapan pribadi</h2>
                                    <span id="private-chat-status">
                                        Menunggu koneksi P2P
                                    </span>
                                </div>

                                <div class="private-chat-actions">
                                    <button
                                        id="private-voice-call"
                                        class="button button-outline button-small call-start-button"
                                        type="button"
                                        title="Panggilan suara"
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>
                                        <span>Telepon</span>
                                    </button>

                                    <button
                                        id="private-video-call"
                                        class="button button-outline button-small call-start-button"
                                        type="button"
                                        title="Video call"
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/></svg>
                                        <span>Video</span>
                                    </button>

                                    <button
                                        id="close-private-chat"
                                        class="button button-outline button-small"
                                        type="button"
                                    >
                                        Tutup chat
                                    </button>
                                </div>
                            </div>

                            <div
                                id="private-chat-messages"
                                class="chat-messages private-chat-messages"
                                role="log"
                                aria-live="polite"
                            >
                                <div class="chat-empty">
                                    Belum ada pesan pribadi. Mulai percakapan.
                                </div>
                            </div>

                            <p class="chat-local-note">
                            Pesan dan file dikirim langsung melalui WebRTC.
                            Riwayat pesan tersimpan di browser ini.
                        </p>

                        <div class="private-file-section">
                            <div class="private-file-heading">
                                <strong>Berbagi file pribadi</strong>
                                <span>Maksimal 100 MB</span>
                            </div>

                            <div class="private-file-picker">
                                <input
                                    id="private-file-input"
                                    type="file"
                                    hidden
                                >

                                <label for="private-file-input" class="button button-outline button-small">
                                    Pilih file
                                </label>

                                <span id="private-file-selected">
                                    Belum ada file yang dipilih.
                                </span>

                                <button
                                    id="private-send-file"
                                    type="button"
                                    class="button button-small private-file-send"
                                >
                                    Kirim file
                                </button>
                            </div>

                            <div
                                id="private-file-transfers"
                                class="private-file-transfers"
                            >
                                <p class="private-file-empty">Belum ada transfer file.</p>
                            </div>
                        </div>

                            <form id="private-chat-form" class="chat-form">
                                <input
                                    id="private-chat-input"
                                    name="body"
                                    type="text"
                                    maxlength="2000"
                                    autocomplete="off"
                                    placeholder="Tulis pesan pribadi..."
                                    required
                                >

                                <button
                                    id="private-voice-button"
                                    class="voice-button"
                                    type="button"
                                    aria-label="Rekam voice note"
                                    title="Rekam voice note"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>
                                </button>

                                <div id="private-voice-recorder" class="voice-recorder" hidden>
                                    <span class="voice-recorder-dot" aria-hidden="true"></span>
                                    <span id="private-voice-timer" class="voice-recorder-time">0:00</span>
                                    <span class="voice-recorder-hint">Merekam · maks. 2 menit</span>
                                    <button id="private-voice-cancel" class="button button-quiet button-small" type="button">Batal</button>
                                    <button id="private-voice-send" class="button button-primary button-small" type="button">Kirim</button>
                                </div>

                                <button
                                    class="send-button"
                                    type="submit"
                                    aria-label="Kirim pesan pribadi"
                                >
                                    ↑
                                </button>
                            </form>
                        </section>
                    </section>
                </div>
            </section>
        </main>

        <footer class="page-footer">
            <span>
                NonovShare
                <span>Berbagi file langsung, tanpa unggah ke cloud.</span>
            </span>
            <span class="footer-tech">
                WebRTC <i>·</i> Ably Realtime <i>·</i> HTTPS
            </span>
        </footer>
    </div>

    <dialog id="qr-dialog" class="qr-dialog">
        <div class="qr-dialog-card">
            <button
                id="close-qr"
                class="dialog-close"
                type="button"
                aria-label="Tutup"
            >
                ×
            </button>

            <span class="eyebrow">UNDANG TEMAN</span>
            <h2>Pindai untuk bergabung</h2>
            <canvas id="qr-canvas" width="240" height="240"></canvas>
            <p id="qr-room-code" class="qr-room-code"></p>
        </div>
    </dialog>

    <dialog id="username-dialog" class="qr-dialog">
        <div class="qr-dialog-card username-dialog-card">
            <button
                id="close-username"
                class="dialog-close"
                type="button"
                aria-label="Tutup"
            >
                ×
            </button>

            <span class="eyebrow">PROFIL PENGGUNA</span>
            <h2>Ubah Username</h2>

            <form id="username-form" class="username-form">
                <label for="username-input">Username baru</label>

                <input
                    id="username-input"
                    type="text"
                    minlength="3"
                    maxlength="20"
                    autocomplete="nickname"
                    placeholder="Masukkan username"
                    required
                >

                <p id="username-error" class="username-error" aria-live="polite"></p>

                <div class="username-actions">
                    <button
                        id="cancel-username"
                        class="button button-outline"
                        type="button"
                    >
                        Batal
                    </button>

                    <button class="button button-primary" type="submit">
                        Simpan
                    </button>
                </div>
            </form>
        </div>
    </dialog>

    <dialog id="call-dialog" class="call-dialog" aria-labelledby="call-peer-name">
        <div class="call-stage">
            <video id="call-remote-video" class="call-remote-video" autoplay playsinline muted hidden></video>

            <div class="call-identity">
                <span id="call-avatar" class="call-avatar" aria-hidden="true"></span>
                <h2 id="call-peer-name">Panggilan</h2>
                <p id="call-status" aria-live="polite">Menghubungkan…</p>
            </div>

            <video id="call-local-video" class="call-local-video" autoplay playsinline muted hidden></video>
        </div>

        <audio id="call-remote-audio" autoplay></audio>

        <div id="call-incoming-controls" class="call-controls" hidden>
            <span class="call-action">
                <button id="call-decline" class="call-control is-danger" type="button" aria-label="Tolak panggilan">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(135 12 12)" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>
                </button>
                Tolak
            </span>
            <span class="call-action">
                <button id="call-accept" class="call-control is-accept" type="button" aria-label="Terima panggilan">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
</body>
</html>
