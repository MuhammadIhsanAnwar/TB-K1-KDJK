import { createClient } from '@ably/pubsub-device';
import QRCode from 'qrcode';

const appConfig = window.sharingApp ?? {};
const csrfMeta = document.querySelector('meta[name="csrf-token"]');
const state = {
    user: appConfig.user ?? null,
    room: null,
    ably: null,
    channel: null,
    onlineUsers: new Map(),
    messages: new Set(),
    transfers: new Map(),
    transferProgress: new Map(),
    files: new Map(),
    peers: new Map(),
    pendingCandidates: new Map(),
    selectedFile: null,
};

const el = (selector) => document.querySelector(selector);
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 16 * 1024;
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
let toastTimer;
let inviteCode = new URL(window.location.href).searchParams.get('room');

async function api(url, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set('Accept', 'application/json');
    headers.set('X-CSRF-TOKEN', csrfMeta?.content ?? appConfig.csrfToken ?? '');

    let body = options.body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }

    const response = await fetch(url, {
        ...options,
        body,
        headers,
        credentials: 'same-origin',
    });

    if (response.status === 204) {
        return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
        const validationMessage = payload?.errors
            ? Object.values(payload.errors).flat()[0]
            : null;
        const error = new Error(validationMessage || payload?.message || `Permintaan gagal (${response.status}).`);
        error.payload = payload;
        throw error;
    }

    return payload;
}

function showToast(message, isError = false) {
    const toast = el('#toast');
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function initializeApp() {
    if (!state.user) {
        showToast('Sesi tamu tidak tersedia. Muat ulang halaman.', true);
        return;
    }

    el('#top-user').textContent = state.user.name;
    void loadRecentRooms();
    if (inviteCode) {
        el('#room-code').value = inviteCode;
        void joinRoom(inviteCode);
        inviteCode = null;
    }
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ''
        : new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(date);
}

async function loadRecentRooms() {
    try {
        const result = await api('/api/rooms');
        renderRecentRooms(result.rooms ?? []);
    } catch (error) {
        showToast(error.message, true);
    }
}

function renderRecentRooms(rooms) {
    const container = el('#recent-rooms');
    container.replaceChildren();
    el('#room-count').textContent = String(rooms.length);

    if (!rooms.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'Room yang pernah kamu ikuti akan tampil di sini.';
        container.append(empty);
        return;
    }

    for (const room of rooms) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-room-button';
        button.addEventListener('click', () => void joinRoom(room.id));

        const icon = document.createElement('span');
        icon.className = 'recent-room-icon';
        icon.textContent = '▦';
        const copy = document.createElement('span');
        copy.className = 'recent-room-copy';
        const name = document.createElement('strong');
        name.textContent = room.name;
        const detail = document.createElement('small');
        detail.textContent = `${room.active_members_count} anggota · ${room.id}`;
        copy.append(name, detail);
        button.append(icon, copy);
        container.append(button);
    }
}

async function createRoom(event) {
    event.preventDefault();
    try {
        const result = await api('/api/rooms', {
            method: 'POST',
            body: { name: 'Room baru' },
        });
        await openRoom(result.room);
        await loadRecentRooms();
    } catch (error) {
        showToast(error.message, true);
    }
}

async function joinRoom(code) {
    const roomCode = String(code ?? '').trim().toUpperCase();
    if (!roomCode) return;

    try {
        const result = await api('/api/rooms/join', {
            method: 'POST',
            body: { room_id: roomCode },
        });
        await openRoom(result.room);
        await loadRecentRooms();
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomCode);
        window.history.replaceState({}, '', url);
    } catch (error) {
        showToast(error.message, true);
    }
}

async function openRoom(room) {
    if (state.room?.id === room.id) return;
    if (state.room) await leaveRoom();

    state.room = room;
    state.onlineUsers.clear();
    state.messages.clear();
    state.transfers.clear();
    state.transferProgress.clear();
    state.files.clear();
    state.pendingCandidates.clear();
    el('#room-empty').hidden = true;
    el('#active-room').hidden = false;
    el('#active-room-name').textContent = room.name;
    el('#active-room-code').textContent = room.id;
    el('#chat-messages').replaceChildren();
    renderOnlineUsers();
    renderTransfers();
    setRoomStatus('Memuat riwayat room…', false);

    try {
        const history = await api(`/api/rooms/${encodeURIComponent(room.id)}/history`);
        for (const message of history.messages ?? []) addChatMessage(message);
        for (const transfer of history.transfers ?? []) state.transfers.set(transfer.id, transfer);
        renderTransfers();
        await connectRealtime(room);
        await loadRecentRooms();
    } catch (error) {
        setRoomStatus(`Realtime belum tersedia: ${error.message}`, false);
        showToast(error.message, true);
    }
}

async function connectRealtime(room) {
    const client = createClient({
        authUrl: `${window.location.origin}/api/rooms/${encodeURIComponent(room.id)}/ably-token`,
        authMethod: 'GET',
        autoConnect: true,
    });
    const channel = client.channels.get(`p2p:room:${room.id}`);
    state.ably = client;
    state.channel = channel;

    client.connection.on((change) => {
        if (change.current === 'connected') {
            setRoomStatus('Terhubung realtime · Presence aktif', true);
        } else if (['failed', 'suspended', 'closed'].includes(change.current)) {
            setRoomStatus('Realtime terputus. Chat tersimpan, tetapi pembaruan langsung mungkin tertunda.', false);
        }
    });

    await channel.attach();
    await Promise.all([
        channel.subscribe('chat.message', (message) => addChatMessage(message.data)),
        channel.subscribe('transfer.requested', (message) => receiveTransferRequest(message.data)),
        channel.subscribe('transfer.updated', (message) => receiveTransferUpdate(message.data)),
        channel.subscribe('signal', (message) => void handleSignal(message)),
        channel.presence.subscribe((member) => handlePresence(member)),
    ]);

    await channel.presence.enter({ name: state.user.name });
    const members = await channel.presence.get();
    for (const member of members) handlePresence(member);
}

function setRoomStatus(message, connected) {
    const status = el('#room-status');
    status.classList.toggle('is-connected', connected);
    status.lastElementChild.textContent = message;
}

function handlePresence(member) {
    if (!member?.clientId) return;
    const clientId = String(member.clientId);

    if (member.action === 'leave') {
        state.onlineUsers.delete(clientId);
    } else {
        state.onlineUsers.set(clientId, {
            id: clientId,
            name: member.data?.name || `Pengguna ${clientId}`,
        });
    }

    renderOnlineUsers();
}

function renderOnlineUsers() {
    const container = el('#online-members');
    container.replaceChildren();

    const users = [...state.onlineUsers.values()]
        .sort((left, right) => left.name.localeCompare(right.name));
    el('#online-count').textContent = String(users.length);

    if (!users.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'Menunggu pengguna bergabung…';
        container.append(empty);
    }

    const select = el('#recipient-select');
    const selected = select.value;
    select.replaceChildren(new Option('Pilih pengguna online', ''));

    for (const user of users) {
        const row = document.createElement('div');
        row.className = 'member-row';
        const avatar = document.createElement('span');
        avatar.className = `avatar${user.id === String(state.user.id) ? ' is-self' : ''}`;
        avatar.textContent = user.name.trim().charAt(0).toUpperCase() || '?';
        const copy = document.createElement('span');
        copy.className = 'member-copy';
        const name = document.createElement('strong');
        name.textContent = user.name;
        const role = document.createElement('small');
        role.textContent = user.id === String(state.user.id) ? 'Kamu · online' : 'Online';
        copy.append(name, role);
        row.append(avatar, copy);
        container.append(row);

        if (user.id !== String(state.user.id)) {
            select.add(new Option(user.name, user.id));
        }
    }

    if ([...select.options].some((option) => option.value === selected)) {
        select.value = selected;
    }
    updateFileButton();
}

function addChatMessage(message) {
    if (!message?.id || state.messages.has(String(message.id))) return;
    state.messages.add(String(message.id));
    const list = el('#chat-messages');
    list.querySelector('.chat-empty')?.remove();

    const own = String(message.user_id) === String(state.user.id);
    const row = document.createElement('article');
    row.className = `chat-message${own ? ' is-own' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.textContent = own ? 'Kamu' : message.user_name;
    const time = document.createElement('span');
    time.textContent = formatTime(message.created_at);
    meta.append(name, time);
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message.body;
    row.append(meta, bubble);
    list.append(row);
    list.scrollTop = list.scrollHeight;
}

async function sendChat(event) {
    event.preventDefault();
    if (!state.room) return;
    const input = el('#chat-input');
    const body = input.value.trim();
    if (!body) return;

    try {
        const result = await api(`/api/rooms/${encodeURIComponent(state.room.id)}/messages`, {
            method: 'POST',
            body: {
                client_message_id: crypto.randomUUID(),
                body,
            },
        });
        addChatMessage(result.message ?? result.chat_message);
        if (result.saved) showToast(result.message, true);
        input.value = '';
    } catch (error) {
        if (error.payload?.saved && error.payload.chat_message) {
            addChatMessage(error.payload.chat_message);
            input.value = '';
        }
        showToast(error.message, true);
    }
}

function onFileSelection(event) {
    const file = event.currentTarget.files?.[0] ?? null;
    state.selectedFile = file;
    if (file && file.size > MAX_FILE_SIZE) {
        state.selectedFile = null;
        event.currentTarget.value = '';
        showToast('Ukuran file melebihi batas 100 MB.', true);
    }

    el('#selected-file-name').textContent = state.selectedFile?.name ?? 'Pilih file untuk dikirim';
    el('#selected-file-size').textContent = state.selectedFile
        ? `${formatBytes(state.selectedFile.size)}${state.selectedFile.type ? ` · ${state.selectedFile.type}` : ''}`
        : 'File akan dikirim langsung ke browser penerima.';
    updateFileButton();
}

function updateFileButton() {
    el('#send-file-button').disabled = !state.selectedFile || !el('#recipient-select').value;
}

async function requestFileTransfer(event) {
    event.preventDefault();
    if (!state.room || !state.selectedFile) return;

    const recipientId = el('#recipient-select').value;
    if (!recipientId) {
        showToast('Pilih pengguna online terlebih dahulu.', true);
        return;
    }

    const file = state.selectedFile;
    try {
        const result = await api(`/api/rooms/${encodeURIComponent(state.room.id)}/transfers`, {
            method: 'POST',
            body: {
                client_transfer_id: crypto.randomUUID(),
                receiver_id: Number(recipientId),
                file_name: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_size: file.size,
            },
        });
        const transfer = result.transfer;
        state.transfers.set(transfer.id, transfer);
        state.files.set(transfer.id, file);
        state.transferProgress.set(transfer.id, { percent: 0, direction: 'Mengirim' });
        renderTransfers();
        state.selectedFile = null;
        el('#file-input').value = '';
        el('#selected-file-name').textContent = 'Pilih file untuk dikirim';
        el('#selected-file-size').textContent = 'File akan dikirim langsung ke browser penerima.';
        updateFileButton();
    } catch (error) {
        if (error.payload?.saved && error.payload.transfer) {
            state.transfers.set(error.payload.transfer.id, error.payload.transfer);
            state.files.set(error.payload.transfer.id, file);
            renderTransfers();
        }
        showToast(error.message, true);
    }
}

function receiveTransferRequest(transfer) {
    if (!transfer?.id) return;
    state.transfers.set(transfer.id, transfer);
    renderTransfers();
    if (String(transfer.receiver_id) === String(state.user.id)) {
        showToast(`${transfer.sender_name} meminta mengirim ${transfer.file_name}.`);
    }
}

function receiveTransferUpdate(transfer) {
    if (!transfer?.id) return;
    state.transfers.set(transfer.id, transfer);
    renderTransfers();

    if (transfer.status === 'accepted' && String(transfer.sender_id) === String(state.user.id)) {
        const file = state.files.get(transfer.id);
        if (file && !state.peers.has(transfer.id)) {
            void startOffer(transfer, file);
        } else if (!state.peers.has(transfer.id)) {
            showToast(`Permintaan ${transfer.file_name} diterima, tetapi file perlu dipilih ulang.`, true);
        }
    }

    if (['declined', 'cancelled', 'failed', 'completed'].includes(transfer.status)) {
        closePeer(transfer.id);
    }
}

function statusLabel(transfer) {
    const progress = state.transferProgress.get(transfer.id);
    if (progress) return `${progress.direction} ${progress.percent}%`;
    return ({
        pending: String(transfer.receiver_id) === String(state.user.id) ? 'Perlu persetujuan' : 'Menunggu persetujuan',
        accepted: 'Membangun koneksi P2P',
        declined: 'Ditolak',
        cancelled: 'Dibatalkan',
        completed: 'Selesai',
        failed: 'Gagal',
    })[transfer.status] ?? transfer.status;
}

function renderTransfers() {
    const container = el('#transfers-list');
    container.replaceChildren();
    const transfers = [...state.transfers.values()];

    if (!transfers.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'Belum ada aktivitas transfer di room ini.';
        container.append(empty);
        return;
    }

    for (const transfer of transfers) {
        const row = document.createElement('article');
        row.className = 'transfer-item';
        const main = document.createElement('div');
        main.className = 'transfer-main';
        const icon = document.createElement('span');
        icon.className = 'transfer-file-icon';
        icon.textContent = '↥';
        const copy = document.createElement('div');
        copy.className = 'transfer-copy';
        const fileName = document.createElement('strong');
        fileName.textContent = transfer.file_name;
        const isSender = String(transfer.sender_id) === String(state.user.id);
        const detail = document.createElement('small');
        detail.textContent = `${isSender ? 'Kepada' : 'Dari'} ${isSender ? transfer.receiver_name : transfer.sender_name} · ${formatBytes(transfer.file_size)}`;
        copy.append(fileName, detail);

        const progress = state.transferProgress.get(transfer.id);
        if (progress) {
            const bar = document.createElement('span');
            bar.className = 'transfer-progress';
            const fill = document.createElement('span');
            fill.style.width = `${progress.percent}%`;
            bar.append(fill);
            copy.append(bar);
        }
        main.append(icon, copy);

        const actions = document.createElement('div');
        actions.className = 'transfer-controls';
        const status = document.createElement('span');
        status.className = 'transfer-state';
        if (transfer.status === 'completed') status.classList.add('is-success');
        if (['declined', 'cancelled', 'failed'].includes(transfer.status)) status.classList.add('is-error');
        status.textContent = statusLabel(transfer);
        actions.append(status);

        if (transfer.status === 'pending' && String(transfer.receiver_id) === String(state.user.id)) {
            actions.append(
                actionButton('Terima', 'accept', transfer.id, true),
                actionButton('Tolak', 'decline', transfer.id, false),
            );
        } else if (['pending', 'accepted'].includes(transfer.status)) {
            actions.append(actionButton('Batalkan', 'cancel', transfer.id, false));
        }

        const download = state.transferProgress.get(transfer.id)?.downloadUrl;
        if (download) {
            const link = document.createElement('a');
            link.className = 'button button-outline button-small';
            link.href = download;
            link.download = state.transferProgress.get(transfer.id).downloadName;
            link.textContent = 'Unduh';
            actions.append(link);
        }

        row.append(main, actions);
        container.append(row);
    }
}

function actionButton(label, action, transferId, primary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button button-small ${primary ? 'button-primary' : 'button-outline'}`;
    button.textContent = label;
    button.addEventListener('click', () => void updateTransfer(transferId, action));
    return button;
}

async function updateTransfer(transferId, action) {
    try {
        const result = await api(`/api/transfers/${encodeURIComponent(transferId)}/${action}`, {
            method: 'POST',
            body: {},
        });
        state.transfers.set(transferId, result.transfer);
        renderTransfers();
        if (action === 'accept') showToast('Permintaan diterima. Menunggu koneksi langsung…');
        if (action === 'decline') showToast('Permintaan file ditolak.');
        if (action === 'cancel') closePeer(transferId);
    } catch (error) {
        if (error.payload?.saved && error.payload.transfer) {
            state.transfers.set(transferId, error.payload.transfer);
            renderTransfers();
        }
        showToast(error.message, true);
    }
}

function setTransferProgress(transferId, progress) {
    state.transferProgress.set(transferId, {
        ...state.transferProgress.get(transferId),
        ...progress,
    });
    renderTransfers();
}

function sendSignal(transfer, to, type, payload) {
    if (!state.channel) return Promise.reject(new Error('Channel realtime belum terhubung.'));
    return state.channel.publish('signal', {
        transfer_id: transfer.id,
        to: String(to),
        type,
        payload,
    });
}

function makePeer(transfer, initiator, file = null) {
    if (state.peers.has(transfer.id)) return state.peers.get(transfer.id);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = {
        pc,
        channel: null,
        transfer,
        initiator,
        file,
        chunks: [],
        receivedBytes: 0,
        receivingStarted: false,
        finished: false,
    };
    state.peers.set(transfer.id, peer);

    pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
            void sendSignal(transfer, initiator ? transfer.receiver_id : transfer.sender_id, 'candidate', {
                candidate: event.candidate.toJSON(),
            }).catch((error) => showToast(error.message, true));
        }
    });

    pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
            setTransferProgress(transfer.id, { percent: 0, direction: initiator ? 'Mengirim' : 'Menerima' });
        } else if (pc.connectionState === 'failed') {
            void markTransferFailed(transfer.id, 'Koneksi P2P gagal.');
        }
    });

    if (initiator) {
        const channel = pc.createDataChannel('file', { ordered: true });
        bindDataChannel(peer, channel);
    } else {
        pc.addEventListener('datachannel', (event) => bindDataChannel(peer, event.channel));
    }

    return peer;
}

async function startOffer(transfer, file) {
    if (!file || state.peers.has(transfer.id)) return;
    const peer = makePeer(transfer, true, file);

    try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        await sendSignal(transfer, transfer.receiver_id, 'offer', {
            description: peer.pc.localDescription,
        });
    } catch (error) {
        await markTransferFailed(transfer.id, `Tidak dapat membuat koneksi: ${error.message}`);
    }
}

async function handleSignal(message) {
    const signal = message?.data;
    const transfer = state.transfers.get(signal?.transfer_id);
    const from = String(message?.clientId ?? '');
    if (!signal || !transfer || signal.to !== String(state.user.id)) return;
    if (transfer.status !== 'accepted') return;

    const currentIsSender = String(transfer.sender_id) === String(state.user.id);
    const expectedPeer = currentIsSender ? String(transfer.receiver_id) : String(transfer.sender_id);
    if (!expectedPeer || from !== expectedPeer) return;

    try {
        if (signal.type === 'offer') {
            if (currentIsSender || from !== String(transfer.sender_id)) return;
            const peer = makePeer(transfer, false);
            await peer.pc.setRemoteDescription(signal.payload.description);
            await drainCandidates(transfer.id, peer);
            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            await sendSignal(transfer, transfer.sender_id, 'answer', {
                description: peer.pc.localDescription,
            });
        } else if (signal.type === 'answer') {
            if (!currentIsSender || from !== String(transfer.receiver_id)) return;
            const peer = state.peers.get(transfer.id);
            if (!peer || peer.pc.remoteDescription) return;
            await peer.pc.setRemoteDescription(signal.payload.description);
            await drainCandidates(transfer.id, peer);
        } else if (signal.type === 'candidate') {
            const peer = state.peers.get(transfer.id);
            if (!peer || !peer.pc.remoteDescription) {
                const pending = state.pendingCandidates.get(transfer.id) ?? [];
                pending.push(signal.payload.candidate);
                state.pendingCandidates.set(transfer.id, pending);
            } else {
                await peer.pc.addIceCandidate(signal.payload.candidate);
            }
        }
    } catch (error) {
        await markTransferFailed(transfer.id, `Signaling WebRTC gagal: ${error.message}`);
    }
}

async function drainCandidates(transferId, peer) {
    const candidates = state.pendingCandidates.get(transferId) ?? [];
    state.pendingCandidates.delete(transferId);
    for (const candidate of candidates) {
        await peer.pc.addIceCandidate(candidate);
    }
}

function bindDataChannel(peer, channel) {
    peer.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.addEventListener('open', () => {
        if (peer.initiator) void sendFile(peer);
    });
    channel.addEventListener('message', (event) => void receiveFileData(peer, event.data));
    channel.addEventListener('error', () => {
        void markTransferFailed(peer.transfer.id, 'DataChannel mengalami error.');
    });
}

async function sendFile(peer) {
    const { file, transfer, channel } = peer;
    if (!file || !channel || channel.readyState !== 'open') return;

    try {
        channel.send(JSON.stringify({
            type: 'start',
            transferId: transfer.id,
            fileName: transfer.file_name,
            fileSize: transfer.file_size,
            mimeType: transfer.mime_type,
        }));

        let sent = 0;
        while (sent < file.size) {
            if (channel.readyState !== 'open' || peer.finished) {
                throw new Error('Koneksi transfer terputus.');
            }
            if (channel.bufferedAmount > 1024 * 1024) {
                await waitForBufferedAmount(channel);
            }
            const chunk = await file.slice(sent, sent + CHUNK_SIZE).arrayBuffer();
            channel.send(chunk);
            sent += chunk.byteLength;
            setTransferProgress(transfer.id, {
                direction: 'Mengirim',
                percent: Math.min(99, Math.floor((sent / file.size) * 100)),
            });
        }

        channel.send(JSON.stringify({ type: 'end', transferId: transfer.id }));
        peer.finished = true;
        setTransferProgress(transfer.id, { direction: 'Menunggu penerima', percent: 100 });
    } catch (error) {
        await markTransferFailed(transfer.id, error.message);
    }
}

function waitForBufferedAmount(channel) {
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            channel.removeEventListener('bufferedamountlow', onLow);
            channel.removeEventListener('close', onClose);
        };
        const onLow = () => {
            cleanup();
            resolve();
        };
        const onClose = () => {
            cleanup();
            reject(new Error('Koneksi transfer terputus.'));
        };
        channel.addEventListener('bufferedamountlow', onLow, { once: true });
        channel.addEventListener('close', onClose, { once: true });
    });
}

async function receiveFileData(peer, data) {
    const transfer = peer.transfer;
    if (typeof data === 'string') {
        let frame;
        try {
            frame = JSON.parse(data);
        } catch {
            await markTransferFailed(transfer.id, 'Data transfer tidak valid.');
            return;
        }

        if (frame.transferId !== transfer.id) {
            await markTransferFailed(transfer.id, 'ID transfer tidak sesuai.');
            return;
        }

        if (frame.type === 'start') {
            if (
                peer.initiator
                || frame.fileSize !== transfer.file_size
                || frame.fileName !== transfer.file_name
            ) {
                await markTransferFailed(transfer.id, 'Metadata file tidak sesuai permintaan.');
                return;
            }
            peer.receivingStarted = true;
            setTransferProgress(transfer.id, { direction: 'Menerima', percent: 0 });
        } else if (frame.type === 'end') {
            if (!peer.receivingStarted || peer.receivedBytes !== transfer.file_size) {
                await markTransferFailed(transfer.id, 'Ukuran file hasil transfer tidak sesuai.');
                return;
            }
            peer.finished = true;
            await completeReceivedFile(peer);
        }
        return;
    }

    if (!(data instanceof ArrayBuffer) || !peer.receivingStarted || peer.initiator) {
        await markTransferFailed(transfer.id, 'Chunk file tidak diharapkan.');
        return;
    }

    if (data.byteLength > CHUNK_SIZE || peer.receivedBytes + data.byteLength > transfer.file_size) {
        await markTransferFailed(transfer.id, 'Ukuran chunk melewati batas.');
        return;
    }

    peer.chunks.push(data);
    peer.receivedBytes += data.byteLength;
    setTransferProgress(transfer.id, {
        direction: 'Menerima',
        percent: Math.min(99, Math.floor((peer.receivedBytes / transfer.file_size) * 100)),
    });
}

async function completeReceivedFile(peer) {
    const transfer = peer.transfer;
    const blob = new Blob(peer.chunks, { type: transfer.mime_type || 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(blob);
    const safeName = transfer.file_name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '') || 'file';
    setTransferProgress(transfer.id, {
        direction: 'Selesai',
        percent: 100,
        downloadUrl,
        downloadName: safeName,
    });
    await updateTransfer(transfer.id, 'complete');
    showToast(`File ${safeName} selesai diterima.`);
}

async function markTransferFailed(transferId, message) {
    const transfer = state.transfers.get(transferId);
    if (!transfer || ['completed', 'failed', 'cancelled', 'declined'].includes(transfer.status)) return;
    state.transferProgress.set(transferId, { direction: 'Gagal', percent: 0 });
    renderTransfers();
    showToast(message, true);

    await updateTransfer(transferId, 'fail');
    closePeer(transferId);
}

function closePeer(transferId) {
    const peer = state.peers.get(transferId);
    if (!peer) return;
    peer.finished = true;
    try {
        peer.channel?.close();
        peer.pc.close();
    } finally {
        state.peers.delete(transferId);
        state.pendingCandidates.delete(transferId);
        state.files.delete(transferId);
    }
}

async function copyInvite() {
    if (!state.room) return;
    const invite = new URL(window.location.href);
    invite.searchParams.set('room', state.room.id);
    try {
        await navigator.clipboard.writeText(invite.toString());
        showToast('Tautan undangan disalin.');
    } catch {
        showToast(invite.toString());
    }
}

async function showQrCode() {
    if (!state.room) return;
    const invite = new URL(window.location.href);
    invite.searchParams.set('room', state.room.id);
    try {
        await QRCode.toCanvas(el('#qr-canvas'), invite.toString(), {
            width: 240,
            margin: 1,
            color: { dark: '#17233c', light: '#ffffff' },
        });
        el('#qr-room-code').textContent = state.room.id;
        el('#qr-dialog').showModal();
    } catch (error) {
        showToast(`QR tidak dapat dibuat: ${error.message}`, true);
    }
}

async function leaveRoom() {
    const room = state.room;
    if (!room) return;

    for (const transferId of [...state.peers.keys()]) closePeer(transferId);
    try {
        await state.channel?.presence.leave();
    } catch {
        // The connection may already be closed; Ably removes the presence member after disconnect.
    }
    state.ably?.close();
    state.channel = null;
    state.ably = null;

    try {
        await api(`/api/rooms/${encodeURIComponent(room.id)}/leave`, { method: 'POST', body: {} });
    } catch (error) {
        showToast(error.message, true);
    }

    for (const progress of state.transferProgress.values()) {
        if (progress.downloadUrl) URL.revokeObjectURL(progress.downloadUrl);
    }
    state.room = null;
    state.onlineUsers.clear();
    state.transfers.clear();
    state.transferProgress.clear();
    state.files.clear();
    state.pendingCandidates.clear();
    el('#active-room').hidden = true;
    el('#room-empty').hidden = false;
    el('#online-members').replaceChildren();
    el('#chat-messages').replaceChildren();
    el('#transfers-list').replaceChildren();
}

async function inspectNetwork() {
    const title = el('#network-title');
    const detail = el('#network-detail');
    const indicator = el('#network-indicator');

    if (!navigator.onLine) {
        title.textContent = 'Browser melaporkan offline';
        detail.textContent = 'Kamu tetap dapat membuka room; fitur realtime menunggu koneksi.';
        indicator.className = 'network-indicator is-warn';
        return;
    }

    if (!window.RTCPeerConnection) {
        title.textContent = 'WebRTC tidak tersedia';
        detail.textContent = 'Gunakan browser modern. Kamu tetap dapat masuk room dan menggunakan chat.';
        indicator.className = 'network-indicator is-warn';
        return;
    }

    const candidateTypes = new Set();
    let peer;
    try {
        peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peer.createDataChannel('network-check');
        peer.addEventListener('icecandidate', (event) => {
            const candidate = event.candidate?.candidate ?? '';
            const match = candidate.match(/\btyp (host|srflx|relay)\b/);
            if (match) candidateTypes.add(match[1]);
        });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await Promise.race([
            new Promise((resolve) => {
                if (peer.iceGatheringState === 'complete') resolve();
                else peer.addEventListener('icegatheringstatechange', () => {
                    if (peer.iceGatheringState === 'complete') resolve();
                }, { once: true });
            }),
            new Promise((resolve) => window.setTimeout(resolve, 3500)),
        ]);
    } catch {
        title.textContent = 'Jaringan belum dapat dipastikan';
        detail.textContent = 'Tes indikatif gagal; kamu tetap bisa masuk room.';
        indicator.className = 'network-indicator is-warn';
        peer?.close();
        return;
    }

    peer?.close();
    title.textContent = 'Jaringan browser terdeteksi';
    if (candidateTypes.has('srflx')) {
        detail.textContent = 'STUN merespons. Koneksi ke peer baru diuji saat transfer dimulai.';
        indicator.className = 'network-indicator is-good';
    } else if (candidateTypes.has('host')) {
        detail.textContent = 'Kandidat lokal tersedia; jalur antarperangkat belum dapat dipastikan.';
        indicator.className = 'network-indicator is-warn';
    } else {
        detail.textContent = 'Kandidat belum terdeteksi. Tes ini tidak menghalangi room.';
        indicator.className = 'network-indicator is-warn';
    }
}

function bindEvents() {
    el('#create-room-form').addEventListener('submit', (event) => void createRoom(event));
    el('#join-room-form').addEventListener('submit', (event) => {
        event.preventDefault();
        void joinRoom(el('#room-code').value);
    });
    el('#chat-form').addEventListener('submit', (event) => void sendChat(event));
    el('#file-input').addEventListener('change', onFileSelection);
    el('#send-file-form').addEventListener('submit', (event) => void requestFileTransfer(event));
    el('#recipient-select').addEventListener('change', updateFileButton);
    el('#copy-invite').addEventListener('click', () => void copyInvite());
    el('#show-qr').addEventListener('click', () => void showQrCode());
    el('#close-qr').addEventListener('click', () => el('#qr-dialog').close());
    el('#leave-room').addEventListener('click', () => void leaveRoom());
    el('#qr-dialog').addEventListener('click', (event) => {
        if (event.target === el('#qr-dialog')) el('#qr-dialog').close();
    });
    window.addEventListener('online', () => void inspectNetwork());
    window.addEventListener('offline', () => {
        el('#network-title').textContent = 'Browser melaporkan offline';
        el('#network-detail').textContent = 'Room tetap terbuka; realtime menunggu koneksi.';
        el('#network-indicator').className = 'network-indicator is-warn';
    });
}

bindEvents();
initializeApp();
void inspectNetwork();
