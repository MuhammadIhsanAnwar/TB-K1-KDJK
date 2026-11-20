<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f7fb">
    <title>Ruang — berbagi langsung</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <div class="page-shell">
        <header class="topbar">
            <a class="brand" href="/" aria-label="Ruang - beranda">
                <span class="brand-mark" aria-hidden="true">R</span>
                <span>ruang<span class="brand-dot">.</span></span>
            </a>
            <div class="topbar-meta">
                <span class="secure-pill"><span class="secure-dot"></span> Transfer langsung antar browser</span>
                <span id="top-user" class="top-user"></span>
            </div>
        </header>

        <main>
            <section id="workspace" class="workspace">
                <div class="welcome-row">
                    <div>
                        <span class="eyebrow">RUANG KOLABORASI</span>
                        <h1>Semua yang kamu bagikan,<br><span>tetap di antara kalian.</span></h1>
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
                            <span class="action-icon create-icon">＋</span>
                            <div class="action-copy">
                                <strong>Buat room baru</strong>
                                <span>Undang teman dengan kode unik.</span>
                            </div>
                            <button class="button button-primary button-small" type="submit">Buat</button>
                        </form>

                        <form id="join-room-form" class="join-form">
                            <label for="room-code">Punya kode room?</label>
                            <div class="join-input-row">
                                <input id="room-code" name="room_id" type="text" maxlength="45" autocomplete="off" placeholder="Masukkan kode room 12 karakter" required>
                                <button class="button button-outline button-small" type="submit">Gabung</button>
                            </div>
                        </form>

                        <div class="recent-heading"><span>Room terakhir</span><span class="recent-count" id="room-count">0</span></div>
                        <div id="recent-rooms" class="recent-rooms">
                            <p class="empty-note">Room yang pernah kamu ikuti di browser ini akan tampil di sini.</p>
                        </div>
                    </aside>

                    <section class="room-panel">
                        <div id="room-empty" class="room-empty">
                            <div class="empty-illustration" aria-hidden="true">
                                <span class="empty-window window-back"></span>
                                <span class="empty-window window-front"><i>↗</i></span>
                                <span class="empty-spark spark-one">✦</span>
                                <span class="empty-spark spark-two">✦</span>
                            </div>
                            <span class="eyebrow">BELUM ADA ROOM AKTIF</span>
                            <h2>Siap berbagi?</h2>
                            <p>Buat room baru atau gabung dengan kode undangan untuk mulai ngobrol dan mengirim file.</p>
                        </div>

                        <div id="active-room" class="active-room" hidden>
                            <div class="room-header">
                                <div class="room-title-block">
                                    <span class="room-live"><span></span> ROOM AKTIF</span>
                                    <h2 id="active-room-name">Room</h2>
                                    <span class="room-code">Kode <strong id="active-room-code"></strong></span>
                                </div>
                                <div class="room-actions">
                                    <button id="copy-invite" class="button button-outline button-small" type="button" disabled>⧉ <span>Salin undangan</span></button>
                                    <button id="show-qr" class="button button-outline button-small" type="button" disabled>▦ <span>QR</span></button>
                                    <button id="leave-room" class="button button-quiet button-small" type="button">Keluar room</button>
                                </div>
                            </div>

                            <div id="room-status" class="room-status" aria-live="polite">
                                <span class="status-pulse"></span>
                                <span>Menyiapkan koneksi P2P…</span>
                            </div>

                            <div class="room-content">
                                <aside class="members-panel">
                                    <div class="section-heading">
                                        <div><span class="eyebrow">HADIR DI ROOM</span><h3>Orang-orang</h3></div>
                                        <span id="online-count" class="online-count">0</span>
                                    </div>
                                    <div id="online-members" class="online-members"></div>
                                    <div class="peer-note">
                                        <span class="peer-note-icon">⌁</span>
                                        <p>Pesan dan file dikirim langsung antar-browser. Hanya peserta dengan IP publik sama yang dapat terhubung; firewall/NAT masih dapat menghalangi P2P.</p>
                                    </div>
                                </aside>

                                <div class="conversation-panel">
                                    <div class="section-heading conversation-heading">
                                        <div><span class="eyebrow">PESAN ROOM</span><h3>Percakapan</h3></div>
                                        <span class="chat-encryption">P2P LANGSUNG</span>
                                    </div>
                                    <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
                                        <div class="chat-empty">Belum ada pesan. Sapa temanmu dulu 👋</div>
                                    </div>
                                    <p class="chat-local-note">Pesan dikirim P2P; riwayat hanya tersimpan lokal di browser ini.</p>
                                    <form id="chat-form" class="chat-form">
                                        <input id="chat-input" name="body" type="text" maxlength="2000" autocomplete="off" placeholder="Tulis pesan..." required>
                                        <button class="send-button" type="submit" aria-label="Kirim pesan">↑</button>
                                    </form>
                                </div>
                            </div>

                            <section class="transfer-section">
                                <div class="section-heading transfer-heading">
                                    <div><span class="eyebrow">P2P FILE SHARING</span><h3>Kirim file langsung</h3></div>
                                    <span class="transfer-limit">Maks. 100 MB · tidak diunggah ke server</span>
                                </div>
                                <form id="send-file-form" class="send-file-form">
                                    <label class="file-picker" for="file-input">
                                        <span class="file-picker-icon">↥</span>
                                        <span><strong id="selected-file-name">Pilih file untuk dikirim</strong><small id="selected-file-size">File akan dikirim langsung ke browser penerima.</small></span>
                                        <span class="file-picker-browse">Pilih file</span>
                                    </label>
                                    <input id="file-input" type="file" hidden>
                                    <label class="recipient-picker">
                                        <span>Kirim kepada</span>
                                        <select id="recipient-select" required multiple size="4"></select>
                                        <small id="recipient-status">Pilih satu atau beberapa pengguna online. Setiap penerima akan diminta menerima atau menolak.</small>
                                    </label>
                                    <button id="send-file-button" class="button button-primary" type="submit" disabled>Kirim file <span>→</span></button>
                                </form>
                                <div id="transfers-list" class="transfers-list">
                                    <p class="empty-note">Belum ada aktivitas transfer di room ini.</p>
                                </div>
                            </section>
                        </div>
                    </section>
                </div>
            </section>
        </main>

        <footer class="page-footer">
            <span>ruang<span class="brand-dot">.</span> <span>Berbagi langsung, tetap privat.</span></span>
            <span class="footer-tech">WebRTC <i>·</i> Ably Realtime <i>·</i> HTTPS</span>
        </footer>
    </div>

    <dialog id="qr-dialog" class="qr-dialog">
        <div class="qr-dialog-card">
            <button id="close-qr" class="dialog-close" type="button" aria-label="Tutup">×</button>
            <span class="eyebrow">UNDANG TEMAN</span>
            <h2>Pindai untuk bergabung</h2>
            <canvas id="qr-canvas" width="240" height="240"></canvas>
            <p id="qr-room-code" class="qr-room-code"></p>
        </div>
    </dialog>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>

</body>
</html>
