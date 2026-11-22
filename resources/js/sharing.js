import { createClient } from '@ably/pubsub-device';
import QRCode from 'qrcode';

const LOCAL_USER_KEY = 'sharing-user-v1';
const LOCAL_ROOMS_KEY = 'sharing-rooms-v1';
let localStorageAvailable = true;

function loadOrCreateLocalUser() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(LOCAL_USER_KEY) ?? 'null');
        if (
            saved
            && /^[0-9a-f-]{36}$/i.test(saved.id)
            && typeof saved.name === 'string'
            && saved.name.length > 0
        ) return saved;
    } catch {
        localStorageAvailable = false;
    }

    const user = {
        id: crypto.randomUUID(),
        name: `Tamu-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    };
    try {
        window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
    } catch {
        localStorageAvailable = false;
    }
    return user;
}

function normalizeUsername(value) {
    return value.trim().replace(/\s+/g, ' ');
}

function saveUsername(value) {
    const name = normalizeUsername(value);

    if (!name) {
        throw new Error('Username tidak boleh kosong.');
    }

    if (name.length < 3 || name.length > 20) {
        throw new Error('Username harus terdiri dari 3 sampai 20 karakter.');
    }

    if (/[\u0000-\u001F\u007F]/.test(name)) {
        throw new Error('Username mengandung karakter yang tidak valid.');
    }

    const updatedUser = {
        ...state.user,
        name,
    };

    try {
        window.localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(updatedUser));
    } catch {
        localStorageAvailable = false;
        throw new Error('Username tidak dapat disimpan di browser.');
    }

    state.user.name = name;
    el('#top-user').textContent = name;

    return name;
}

const state = {
    user: loadOrCreateLocalUser(),
    room: null,
    ably: null,
    channel: null,
    onlineUsers: new Map(),
    messages: new Set(),
    messageHistory: [],
    pendingChatMessage: null,
    chatMessageSending: false,
    transfers: new Map(),
    transferProgress: new Map(),
    files: new Map(),
    peers: new Map(),
    pendingCandidates: new Map(),
    chatPeers: new Map(),
    chatCandidates: new Map(),
    blockedNetworkPeers: new Set(),
    networkFingerprint: null,
    publicIp: null,
    presenceEntered: false,
    selectedFile: null,
    transferSubmitting: false,
    pendingTransferRequest: null,
    privateAbly: null,
    privateChannel: null,
    privateNetworkFingerprint: null,
    privateOnlineUsers: new Map(),
    privateChatPeers: new Map(),
    privateChatCandidates: new Map(),
    selectedPrivateUser: null,
    privateMessageHistory: [],
    privateMessages: new Set(),
    privateSelectedFile: null,
    privateFileTransfers: new Map(),
    voiceRecorder: null,
    voiceNoteUrls: new Map(),
    incomingVoiceNotes: new Map(),
    call: null,
};

const el = (selector) => document.querySelector(selector);
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const CHUNK_SIZE = 16 * 1024;
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_VOICE_NOTE_SECONDS = 120;
const MIN_VOICE_NOTE_SECONDS = 1;
const MAX_VOICE_NOTE_SIZE = 3 * 1024 * 1024;
const VOICE_NOTE_CHUNK_SIZE = 12 * 1024;
const VOICE_NOTE_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];
const CALL_RING_TIMEOUT = 30 * 1000;
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7Z" fill="currentColor" stroke="none"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" stroke="none"/></svg>';
let toastTimer;
let voiceRecorderStarting = false;
let activeVoiceAudio = null;
let ringtone = null;
let inviteCode = new URL(window.location.href).searchParams.get('room');
let inviteProof = new URL(window.location.href).searchParams.get('proof');
let inviteRoomName = new URL(window.location.href).searchParams.get('room_name');

async function api(url, options = {}) {
    const headers = new Headers(options.headers ?? {});
    headers.set('Accept', 'application/json');

    let body = options.body;
    if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }

    const response = await fetch(url, {
        ...options,
        body,
        headers,
        credentials: 'omit',
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
        error.status = response.status;
        throw error;
    }

    return payload;
}

async function loadPublicIp() {
    try {
        const network = await api('/api/network');

        if (
            typeof network.client_ip !== 'string'
            || typeof network.network_fingerprint !== 'string'
            || network.network_fingerprint.length !== 64
        ) {
            throw new Error('Identitas jaringan tidak valid.');
        }

        state.publicIp = network.client_ip;
        el('#public-ip').textContent = `IP publik kamu: ${state.publicIp}`;

        await connectPrivateNetwork(network.network_fingerprint);
    } catch (error) {
        el('#public-ip').textContent = 'IP publik belum dapat diperiksa.';
        el('#private-online-users').textContent =
            'Pengguna satu jaringan belum dapat dimuat.';
        console.error('Koneksi chat pribadi gagal:', error);
    }
}
async function connectPrivateNetwork(fingerprint) {
    if (
        state.privateChannel
        && state.privateNetworkFingerprint === fingerprint
    ) return;

    state.privateAbly?.close();

    state.privateAbly = null;
    state.privateChannel = null;
    state.privateNetworkFingerprint = fingerprint;
    state.privateOnlineUsers.clear();

    renderPrivateOnlineUsers();

    const tokenUrl = new URL(
        '/api/network/ably-token',
        window.location.origin,
    );

    tokenUrl.searchParams.set('client_id', state.user.id);

    const client = createClient({
        authUrl: tokenUrl.toString(),
        authMethod: 'GET',
        autoConnect: true,
    });

    const channel = client.channels.get(`p2p:network:${fingerprint}`);

    state.privateAbly = client;
    state.privateChannel = channel;

    await channel.attach();

    await Promise.all([
        channel.subscribe('signal', (message) => {
            void handlePrivateSignal(message);
        }),
        channel.presence.subscribe((member) => {
            handlePrivatePresence(member);
        }),
    ]);

    const members = await channel.presence.get();

    for (const member of members) {
        handlePrivatePresence(member);
    }

    await channel.presence.enter({
        name: state.user.name,
    });

    const updatedMembers = await channel.presence.get();

    for (const member of updatedMembers) {
        handlePrivatePresence(member);
    }
}

function handlePrivatePresence(member) {
    if (!member?.clientId) return;

    const identity = parseRoomClientId(member.clientId);
    if (!identity) return;

    const userId = identity.userId;

    if (userId === String(state.user.id)) return;

    if (
        member.action === 'leave'
        || identity.fingerprint !== state.privateNetworkFingerprint
    ) {
        const leavingName = state.privateOnlineUsers.get(userId)?.name;

        state.privateOnlineUsers.delete(userId);
        closePrivateChatPeer(userId);

        if (state.call?.peerId === userId) {
            endCall(`${leavingName ?? 'Pengguna'} terputus. Panggilan berakhir.`, false);
        }

        if (state.voiceRecorder?.targetUserId === userId) {
            void finishVoiceRecording(false);
        }

        if (state.selectedPrivateUser?.id === userId) {
            state.selectedPrivateUser = null;
            el('#private-chat-panel').hidden = true;
        }
    } else {
        state.privateOnlineUsers.set(userId, {
            id: userId,
            name: member.data?.name || `Pengguna ${userId}`,
            ipAddress: identity.ipAddress,
        });
    }

    renderPrivateOnlineUsers();
}

function renderPrivateOnlineUsers() {
    const list = el('#private-online-users');
    const count = el('#private-online-count');

    if (!list || !count) return;

    const users = [...state.privateOnlineUsers.values()]
        .sort((a, b) => a.name.localeCompare(b.name));

    count.textContent = String(users.length);
    list.replaceChildren();

    if (!users.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent =
            'Belum ada pengguna lain yang online di IP publik yang sama.';

        list.append(empty);
        return;
    }

    for (const user of users) {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = 'private-user-button';
        button.classList.toggle(
            'is-selected',
            state.selectedPrivateUser?.id === user.id,
        );

        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.textContent = user.name.slice(0, 1).toUpperCase();

        const copy = document.createElement('span');
        copy.className = 'member-copy';

        const name = document.createElement('strong');
        name.textContent = user.name;

        const status = document.createElement('small');
        status.textContent =
            state.privateChatPeers.get(user.id)?.channel?.readyState === 'open'
                ? 'Chat terhubung'
                : 'Online';

        copy.append(name, status);
        button.append(avatar, copy);

        button.addEventListener('click', () => {
            void selectPrivateUser(user);
        });

        list.append(button);
    }
}


function showPrivateChatView() {
    if (el('#private-chat-panel').hidden) {
        state.privatePreviousView = {
            roomEmptyHidden: el('#room-empty').hidden,
            activeRoomHidden: el('#active-room').hidden,
        };
    }

    el('#room-empty').hidden = true;
    el('#active-room').hidden = true;
    el('#private-chat-panel').hidden = false;
}

function restorePreviousChatView() {
    const previous = state.privatePreviousView;

    if (state.voiceRecorder?.context === 'private') {
        void finishVoiceRecording(false);
    }

    el('#private-chat-panel').hidden = true;

    el('#room-empty').hidden =
        previous?.roomEmptyHidden ?? false;

    el('#active-room').hidden =
        previous?.activeRoomHidden ?? true;

    state.privatePreviousView = null;
}


async function selectPrivateUser(user) {
    if (state.voiceRecorder) {
        await finishVoiceRecording(false);
    }

    state.selectedPrivateUser = user;

    showPrivateChatView();

    el('#private-chat-title').textContent = user.name;
    el('#private-chat-status').textContent = 'Menghubungkan...';

    renderPrivateOnlineUsers();
    renderCallButtons();
    loadPrivateMessages(user.id);
    renderPrivateFileTransfers();

    try {
        const existing = state.privateChatPeers.get(user.id);

        if (existing?.channel?.readyState === 'open') {
            el('#private-chat-status').textContent = 'P2P terhubung';
            return;
        }

        if (String(state.user.id) < String(user.id)) {
            await startPrivateChatOffer(user);
        } else {
            await sendPrivateSignal(user.id, 'private-chat-invite', {});
        }
    } catch (error) {
        console.error('Gagal membuka chat pribadi:', error);

        el('#private-chat-status').textContent =
            'Gagal menghubungkan. Coba lagi.';

        showToast(`Chat pribadi gagal: ${error.message}`, true);
    }
}

function privateConversationKey(userId) {
    return `sharing-private-chat:${[
        String(state.user.id),
        String(userId),
    ].sort().join(':')}`;
}

function loadPrivateMessages(userId) {
    state.privateMessages.clear();
    state.privateMessageHistory = [];

    const list = el('#private-chat-messages');
    list.replaceChildren();

    try {
        const saved = JSON.parse(
            localStorage.getItem(privateConversationKey(userId)) ?? '[]'
        );

        if (Array.isArray(saved)) {
            state.privateMessageHistory = saved.slice(-100);

            for (const message of state.privateMessageHistory) {
                state.privateMessages.add(String(message.id));
                renderPrivateMessage(message);
            }
        }
    } catch {
        showToast('Riwayat chat pribadi tidak dapat dibaca.', true);
    }

    if (!state.privateMessageHistory.length) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.textContent = 'Belum ada pesan pribadi. Mulai percakapan.';
        list.append(empty);
    }
}

function savePrivateMessages() {
    if (!state.selectedPrivateUser) return;

    try {
        localStorage.setItem(
            privateConversationKey(state.selectedPrivateUser.id),
            JSON.stringify(state.privateMessageHistory.slice(-100)),
        );
    } catch {
        showToast('Riwayat chat pribadi tidak dapat disimpan.', true);
    }
}

function renderPrivateMessage(message) {
    const list = el('#private-chat-messages');
    list.querySelector('.chat-empty')?.remove();

    const own = String(message.user_id) === String(state.user.id);

    const row = document.createElement('article');
    row.className = `chat-message${own ? ' is-own' : ''}`;

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const name = document.createElement('strong');
    name.textContent = own ? 'Kamu' : (message.user_name || 'Pengguna');

    const time = document.createElement('span');
    time.textContent = formatTime(message.created_at);

    meta.append(name, time);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    renderMessageContent(bubble, message);

    row.append(meta, bubble);
    list.append(row);
    list.scrollTop = list.scrollHeight;
}

function addPrivateMessage(message, fromUserId) {
    if (
        !message?.id
        || String(message.user_id) !== String(fromUserId)
        || typeof message.body !== 'string'
        || message.body.length > 2000
        || state.privateMessages.has(String(message.id))
    ) return;

    state.privateMessages.add(String(message.id));

    if (state.selectedPrivateUser?.id === String(fromUserId)) {
        state.privateMessageHistory.push(message);
        state.privateMessageHistory =
            state.privateMessageHistory.slice(-100);

        renderPrivateMessage(message);
        savePrivateMessages();
    } else {
        try {
            const key = privateConversationKey(fromUserId);
            const history = JSON.parse(localStorage.getItem(key) ?? '[]');
            const next = Array.isArray(history) ? history : [];

            next.push(message);
            localStorage.setItem(key, JSON.stringify(next.slice(-100)));
        } catch {
            showToast('Pesan masuk, tetapi riwayat lokal gagal disimpan.', true);
        }
    }
}

function makePrivateChatPeer(user, initiator) {
    const userId = String(user.id);
    const existing = state.privateChatPeers.get(userId);

    if (existing) return existing;

    const peer = {
        user,
        pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }),
        channel: null,
        fileChannel: null,
        initiator,
        offering: false,
        receivingPrivateFile: null,
    };

    state.privateChatPeers.set(userId, peer);

    peer.pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate) return;

        void sendPrivateSignal(userId, 'private-chat-candidate', {
            candidate: event.candidate.toJSON(),
        }).catch((error) => showToast(error.message, true));
    });

    peer.pc.addEventListener('datachannel', (event) => {
        if (event.channel.label === 'private-chat') {
            bindPrivateChatChannel(userId, event.channel);
        }

        if (event.channel.label === 'private-file') {
            bindPrivateFileChannel(userId, event.channel);
        }
    });

    peer.pc.addEventListener('connectionstatechange', () => {
        if (peer.pc.connectionState === 'failed') {
            closePrivateChatPeer(userId);

            if (state.selectedPrivateUser?.id === userId) {
                el('#private-chat-status').textContent =
                    'Koneksi gagal. Coba pilih pengguna lagi.';
            }
        }
    });

    if (initiator) {
        bindPrivateChatChannel(
            userId,
            peer.pc.createDataChannel('private-chat', { ordered: true }),
        );

        bindPrivateFileChannel(
            userId,
            peer.pc.createDataChannel('private-file', { ordered: true }),
        );
    }

    return peer;
}

function bindPrivateChatChannel(userId, channel) {
    const peer = state.privateChatPeers.get(String(userId));

    if (!peer || channel.label !== 'private-chat') return;

    peer.channel = channel;

    channel.addEventListener('message', (event) => {
        let frame;

        try {
            frame = JSON.parse(event.data);
        } catch {
            return;
        }

       if (frame.type === 'private.chat.message') {
            addPrivateMessage(frame.message, String(userId));
        }

        if (frame.type?.startsWith('voice.')) {
            receiveVoiceNoteFrame('private', String(userId), frame, (message) => {
                addPrivateMessage(message, String(userId));
            });
        }

        if (frame.type?.startsWith('private.file.')) {
            handlePrivateFileControl(String(userId), frame);
        }
    });

    channel.addEventListener('open', () => {
        renderPrivateOnlineUsers();

        if (state.selectedPrivateUser?.id === String(userId)) {
            el('#private-chat-status').textContent = 'P2P terhubung';
        }
    });

    channel.addEventListener('close', renderPrivateOnlineUsers);
}

function bindPrivateFileChannel(userId, channel) {
    const peer = state.privateChatPeers.get(String(userId));

    if (!peer || channel.label !== 'private-file') return;

    peer.fileChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;

    channel.addEventListener('message', (event) => {
        void receivePrivateFileData(peer, event.data);
    });

    channel.addEventListener('error', () => {
        showToast('Koneksi transfer file pribadi mengalami error.', true);
    });
}

function handlePrivateFileControl(userId, frame) {
    const transfer = frame.transfer;
    const peer = state.privateChatPeers.get(userId);

    if (frame.type === 'private.file.request') {
        if (
            !transfer?.id
            || typeof transfer.file_name !== 'string'
            || transfer.file_name.length > 255
            || !Number.isSafeInteger(transfer.file_size)
            || transfer.file_size < 1
            || transfer.file_size > MAX_FILE_SIZE
            || typeof transfer.mime_type !== 'string'
        ) return;

        if (state.privateFileTransfers.has(transfer.id)) return;

        state.privateFileTransfers.set(transfer.id, {
            ...transfer,
            senderId: userId,
            receiverId: String(state.user.id),
            direction: 'incoming',
            status: 'pending',
            percent: 0,
            chunks: [],
            receivedBytes: 0,
        });

        renderPrivateFileTransfers();
        showToast(`${transfer.file_name} meminta izin untuk dikirim.`);
        return;
    }

    if (frame.type === 'private.file.response') {
        const current = state.privateFileTransfers.get(frame.transferId);

        if (
            !current
            || current.direction !== 'outgoing'
            || current.receiverId !== userId
            || current.status !== 'pending'
        ) return;

        if (frame.accepted !== true) {
            current.status = 'declined';
            renderPrivateFileTransfers();
            showToast('Penerima menolak file.');
            return;
        }

        current.status = 'accepted';
        renderPrivateFileTransfers();

        if (peer) {
            void sendPrivateFile(peer, current);
        }

        return;
    }

    if (frame.type === 'private.file.complete') {
        const current = state.privateFileTransfers.get(frame.transferId);

        if (!current || current.direction !== 'outgoing') return;

        current.status = 'completed';
        current.percent = 100;
        renderPrivateFileTransfers();
        showToast('File berhasil diterima pengguna tujuan.');
    }
}

function onPrivateFileSelection(event) {
    const file = event.currentTarget.files?.[0] ?? null;

    if (file && file.size > MAX_FILE_SIZE) {
        event.currentTarget.value = '';
        state.privateSelectedFile = null;
        el('#private-file-selected').textContent =
            'Ukuran file maksimal 100 MB.';
        showToast('Ukuran file melebihi batas 100 MB.', true);
        return;
    }

    state.privateSelectedFile = file;

    el('#private-file-selected').textContent = file
        ? `${file.name} (${formatBytes(file.size)})`
        : 'Belum ada file yang dipilih.';
}

function sendPrivateFileRequest() {
    const user = state.selectedPrivateUser;
    const file = state.privateSelectedFile;

    if (!user || !file) {
        showToast('Pilih file terlebih dahulu.', true);
        return;
    }

    const peer = state.privateChatPeers.get(String(user.id));

    if (peer?.channel?.readyState !== 'open') {
        showToast('Koneksi chat pribadi belum siap.', true);
        return;
    }

    const transfer = {
        id: crypto.randomUUID(),
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        senderId: String(state.user.id),
        receiverId: String(user.id),
        direction: 'outgoing',
        status: 'pending',
        percent: 0,
        file,
    };

    try {
        peer.channel.send(JSON.stringify({
            type: 'private.file.request',
            transfer: {
                id: transfer.id,
                file_name: transfer.file_name,
                file_size: transfer.file_size,
                mime_type: transfer.mime_type,
            },
        }));

        state.privateFileTransfers.set(transfer.id, transfer);
        state.privateSelectedFile = null;

        el('#private-file-input').value = '';
        el('#private-file-selected').textContent =
            'Belum ada file yang dipilih.';

        renderPrivateFileTransfers();
        showToast('Permintaan pengiriman file berhasil dikirim.');
    } catch (error) {
        showToast(`Permintaan file gagal: ${error.message}`, true);
    }
}

function respondPrivateFile(transferId, accepted) {
    const transfer = state.privateFileTransfers.get(transferId);

    if (
        !transfer
        || transfer.direction !== 'incoming'
        || transfer.status !== 'pending'
    ) return;

    const peer = state.privateChatPeers.get(transfer.senderId);

    if (peer?.channel?.readyState !== 'open') {
        showToast('Koneksi chat pengirim terputus.', true);
        return;
    }

    try {
        peer.channel.send(JSON.stringify({
            type: 'private.file.response',
            transferId,
            accepted,
        }));

        transfer.status = accepted ? 'accepted' : 'declined';
        renderPrivateFileTransfers();

        if (accepted) {
            showToast('Kamu menerima permintaan file.');
        } else {
            showToast('Permintaan file ditolak.');
        }
    } catch (error) {
        showToast(`Gagal mengirim respons: ${error.message}`, true);
    }
}

function waitForPrivateFileChannel(channel) {
    if (channel.readyState === 'open') {
        return Promise.resolve();
    }

    if (channel.readyState === 'closed') {
        return Promise.reject(new Error('Koneksi file sudah terputus.'));
    }

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            channel.removeEventListener('open', onOpen);
            channel.removeEventListener('close', onClose);
        };

        const onOpen = () => {
            cleanup();
            resolve();
        };

        const onClose = () => {
            cleanup();
            reject(new Error('Koneksi file terputus.'));
        };

        channel.addEventListener('open', onOpen, { once: true });
        channel.addEventListener('close', onClose, { once: true });
    });
}

async function sendPrivateFile(peer, transfer) {
    const channel = peer.fileChannel;
    const file = transfer.file;

    if (!channel || !file) {
        transfer.status = 'failed';
        renderPrivateFileTransfers();
        showToast('Data file atau koneksi file tidak tersedia.', true);
        return;
    }

    try {
        await waitForPrivateFileChannel(channel);

        channel.send(JSON.stringify({
            type: 'start',
            transferId: transfer.id,
            fileName: transfer.file_name,
            fileSize: transfer.file_size,
            mimeType: transfer.mime_type,
        }));

        let sent = 0;

        while (sent < file.size) {
            if (channel.readyState !== 'open') {
                throw new Error('Koneksi transfer terputus.');
            }

            if (channel.bufferedAmount > 1024 * 1024) {
                await waitForBufferedAmount(channel);
            }

            const chunk = await file.slice(
                sent,
                sent + CHUNK_SIZE,
            ).arrayBuffer();

            channel.send(chunk);
            sent += chunk.byteLength;

            transfer.percent = Math.min(
                99,
                Math.floor((sent / file.size) * 100),
            );

            renderPrivateFileTransfers();
        }

        channel.send(JSON.stringify({
            type: 'end',
            transferId: transfer.id,
        }));

        transfer.status = 'sent';
        transfer.percent = 100;

        renderPrivateFileTransfers();
        showToast('File selesai dikirim. Menunggu konfirmasi penerima.');
    } catch (error) {
        transfer.status = 'failed';
        renderPrivateFileTransfers();
        showToast(`Transfer file gagal: ${error.message}`, true);
    }
}

async function receivePrivateFileData(peer, data) {
    if (typeof data === 'string') {
        let frame;

        try {
            frame = JSON.parse(data);
        } catch {
            showToast('Metadata file pribadi tidak valid.', true);
            return;
        }

        if (frame.type === 'start') {
            const transfer = state.privateFileTransfers.get(frame.transferId);

            if (
                !transfer
                || transfer.direction !== 'incoming'
                || transfer.status !== 'accepted'
                || frame.fileSize !== transfer.file_size
                || frame.fileName !== transfer.file_name
            ) {
                showToast('Data file tidak sesuai permintaan.', true);
                return;
            }

            transfer.chunks = [];
            transfer.receivedBytes = 0;
            peer.receivingPrivateFile = transfer.id;

            renderPrivateFileTransfers();
            return;
        }

        if (frame.type === 'end') {
            const transfer = state.privateFileTransfers.get(frame.transferId);

            if (
                !transfer
                || peer.receivingPrivateFile !== transfer.id
                || transfer.receivedBytes !== transfer.file_size
            ) {
                showToast('Ukuran file yang diterima tidak sesuai.', true);
                return;
            }

            const blob = new Blob(transfer.chunks, {
                type: transfer.mime_type,
            });

            transfer.downloadUrl = URL.createObjectURL(blob);
            transfer.downloadName = transfer.file_name;
            transfer.status = 'completed';
            transfer.percent = 100;

            peer.receivingPrivateFile = null;

            renderPrivateFileTransfers();

            if (peer.channel?.readyState === 'open') {
                peer.channel.send(JSON.stringify({
                    type: 'private.file.complete',
                    transferId: transfer.id,
                }));
            }

            showToast(`File ${transfer.file_name} berhasil diterima.`);
        }

        return;
    }

    if (!(data instanceof ArrayBuffer)) return;

    const transferId = peer.receivingPrivateFile;
    const transfer = transferId
        ? state.privateFileTransfers.get(transferId)
        : null;

    if (!transfer || transfer.status !== 'accepted') return;

    if (
        data.byteLength > CHUNK_SIZE
        || transfer.receivedBytes + data.byteLength > transfer.file_size
    ) {
        transfer.status = 'failed';
        peer.receivingPrivateFile = null;
        renderPrivateFileTransfers();
        showToast('Ukuran potongan file tidak valid.', true);
        return;
    }

    transfer.chunks.push(data);
    transfer.receivedBytes += data.byteLength;

    transfer.percent = Math.min(
        99,
        Math.floor((transfer.receivedBytes / transfer.file_size) * 100),
    );

    renderPrivateFileTransfers();
}

function renderPrivateFileTransfers() {
    const container = el('#private-file-transfers');

    if (!container) return;

    container.replaceChildren();

    const transfers = [...state.privateFileTransfers.values()]
        .filter((transfer) => (
            transfer.senderId === String(state.selectedPrivateUser?.id)
            || transfer.receiverId === String(state.selectedPrivateUser?.id)
        ));

    if (!transfers.length) {
        const empty = document.createElement('p');
        empty.className = 'private-file-empty';
        empty.textContent = 'Belum ada transfer file.';
        container.append(empty);
        return;
    }

    for (const transfer of transfers) {
        const item = document.createElement('article');
        item.className = 'private-file-item';

        const info = document.createElement('div');
        info.className = 'private-file-info';

        const name = document.createElement('strong');
        name.textContent = transfer.file_name;

        const details = document.createElement('small');
        details.textContent =
            `${formatBytes(transfer.file_size)} · ${privateFileStatus(transfer)}`;

        const progress = document.createElement('div');
        progress.className = 'transfer-progress';

        const bar = document.createElement('span');
        bar.style.width = `${transfer.percent || 0}%`;
        progress.append(bar);

        info.append(name, details, progress);
        item.append(info);

        if (
            transfer.direction === 'incoming'
            && transfer.status === 'pending'
        ) {
            const controls = document.createElement('div');
            controls.className = 'private-file-controls';

            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = 'button button-small private-file-accept';
            accept.textContent = 'Terima';
            accept.addEventListener('click', () => {
                respondPrivateFile(transfer.id, true);
            });

            const decline = document.createElement('button');
            decline.type = 'button';
            decline.className = 'button button-outline button-small';
            decline.textContent = 'Tolak';
            decline.addEventListener('click', () => {
                respondPrivateFile(transfer.id, false);
            });

            controls.append(accept, decline);
            item.append(controls);
        }

        if (transfer.downloadUrl && transfer.status === 'completed') {
            const download = document.createElement('a');
            download.href = transfer.downloadUrl;
            download.download = transfer.downloadName;
            download.className = 'private-file-download';
            download.textContent = 'Unduh file';
            item.append(download);
        }

        container.append(item);
    }
}

function privateFileStatus(transfer) {
    const labels = {
        pending: transfer.direction === 'incoming'
            ? 'Menunggu keputusanmu'
            : 'Menunggu penerima',
        accepted: 'Diterima, memulai transfer',
        sent: 'Terkirim, menunggu konfirmasi',
        completed: 'Selesai',
        declined: 'Ditolak',
        failed: 'Gagal',
    };

    return labels[transfer.status] || transfer.status;
}

function closePrivateChatPeer(userId) {
    const peer = state.privateChatPeers.get(String(userId));

    if (!peer) return;

    peer.channel?.close();
    peer.pc.close();

    state.privateChatPeers.delete(String(userId));
    state.privateChatCandidates.delete(String(userId));
    discardIncomingVoiceNotes('private', userId);

    renderPrivateOnlineUsers();
}

async function startPrivateChatOffer(user) {
    const peer = makePrivateChatPeer(user, true);

    if (!peer.initiator || peer.offering || peer.pc.localDescription) {
        return;
    }

    peer.offering = true;

    try {
        const offer = await peer.pc.createOffer();

        await peer.pc.setLocalDescription(offer);

        await sendPrivateSignal(user.id, 'private-chat-offer', {
            description: peer.pc.localDescription,
        });
    } catch (error) {
        closePrivateChatPeer(user.id);
        showToast(`Chat pribadi gagal dimulai: ${error.message}`, true);
    }
}

async function sendPrivateSignal(to, type, payload) {
    if (!state.privateChannel) {
        throw new Error('Koneksi jaringan untuk chat pribadi belum tersedia.');
    }

    return state.privateChannel.publish('signal', {
        scope: 'private-chat',
        to: String(to),
        type,
        payload,
    });
}

async function handlePrivateSignal(message) {
    const signal = message?.data;
    const identity = parseRoomClientId(message?.clientId);
    const from = identity?.userId;

    if (
        !signal
        || !['private-chat', 'call'].includes(signal.scope)
        || !identity
        || identity.fingerprint !== state.privateNetworkFingerprint
        || signal.to !== String(state.user.id)
        || from === String(state.user.id)
    ) return;

    const user = state.privateOnlineUsers.get(from);

    if (!user) return;

    if (signal.scope === 'call') {
        await handleCallSignal(from, user, signal);
        return;
    }

    try {
        let peer = state.privateChatPeers.get(from);

        if (signal.type === 'private-chat-invite') {
            if (String(state.user.id) < from && !peer?.pc.localDescription) {
                await startPrivateChatOffer(user);
            }
            return;
        }

        if (signal.type === 'private-chat-offer') {
            if (from > String(state.user.id) || peer?.pc.remoteDescription) {
                return;
            }

        if (!peer) {
            peer = makePrivateChatPeer(user, false);
        }

        if (peer.pc.remoteDescription) return;

        await peer.pc.setRemoteDescription(signal.payload.description);
        await drainPrivateChatCandidates(from, peer);

        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);

        await sendPrivateSignal(from, 'private-chat-answer', {
            description: peer.pc.localDescription,
        });

        if (!state.selectedPrivateUser) {
        state.selectedPrivateUser = user;

        showPrivateChatView();

        el('#private-chat-title').textContent = user.name;
        el('#private-chat-status').textContent = 'Menghubungkan...';

        renderPrivateOnlineUsers();
        loadPrivateMessages(user.id);
    }

        } else if (signal.type === 'private-chat-answer') {
            if (!peer?.initiator || peer.pc.remoteDescription) return;

            await peer.pc.setRemoteDescription(signal.payload.description);
            await drainPrivateChatCandidates(from, peer);
        } else if (signal.type === 'private-chat-candidate') {
            const candidate = signal.payload?.candidate;

            if (!candidate) return;

            if (!peer || !peer.pc.remoteDescription) {
                const candidates =
                    state.privateChatCandidates.get(from) ?? [];

                candidates.push(candidate);
                state.privateChatCandidates.set(from, candidates);
            } else {
                await peer.pc.addIceCandidate(candidate);
            }
        }
    } catch (error) {
        closePrivateChatPeer(from);
        showToast(`Signaling chat pribadi gagal: ${error.message}`, true);
    }
}

async function drainPrivateChatCandidates(userId, peer) {
    const candidates =
        state.privateChatCandidates.get(String(userId)) ?? [];

    state.privateChatCandidates.delete(String(userId));

    for (const candidate of candidates) {
        await peer.pc.addIceCandidate(candidate);
    }
}

async function sendPrivateChat(event) {
    event.preventDefault();

    const user = state.selectedPrivateUser;

    if (!user) return;

    const peer = state.privateChatPeers.get(user.id);

    if (peer?.channel?.readyState !== 'open') {
        showToast('Koneksi P2P belum siap. Tunggu sebentar.', true);
        return;
    }

    const input = el('#private-chat-input');
    const body = input.value.trim();

    if (!body) return;

    const message = {
        id: crypto.randomUUID(),
        user_id: state.user.id,
        user_name: state.user.name,
        body,
        created_at: new Date().toISOString(),
    };

    try {
        peer.channel.send(JSON.stringify({
            type: 'private.chat.message',
            message,
        }));

        if (!state.privateMessages.has(message.id)) {
            state.privateMessages.add(message.id);
            state.privateMessageHistory.push(message);
            state.privateMessageHistory =
                state.privateMessageHistory.slice(-100);

            renderPrivateMessage(message);
            savePrivateMessages();
        }

        input.value = '';
    } catch (error) {
        showToast(`Pesan pribadi gagal dikirim: ${error.message}`, true);
    }
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function ensureMediaSupport() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        const error = new Error('Mikrofon dan kamera hanya bisa dipakai lewat HTTPS atau localhost.');
        error.name = 'InsecureContextError';
        throw error;
    }
}

function mediaErrorMessage(error, device) {
    if (error?.name === 'InsecureContextError') return error.message;

    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
        return `Izin ${device} ditolak. Izinkan akses ${device} di pengaturan browser.`;
    }

    if (['NotFoundError', 'OverconstrainedError'].includes(error?.name)) {
        return `${capitalize(device)} tidak ditemukan di perangkat ini.`;
    }

    if (error?.name === 'NotReadableError') {
        return `${capitalize(device)} sedang dipakai aplikasi lain.`;
    }

    return `${capitalize(device)} tidak dapat diakses: ${error?.message ?? 'kesalahan tidak dikenal'}.`;
}

function stopMediaStream(stream) {
    for (const track of stream?.getTracks() ?? []) {
        track.stop();
    }
}

function bytesToBase64(bytes) {
    let binary = '';

    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }

    return btoa(binary);
}

function base64ToBytes(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function voiceNoteChannels(context, targetUserId) {
    if (context === 'room') {
        if (!state.room) {
            throw new Error('Kamu belum berada di room.');
        }

        const recipientIds = [...state.onlineUsers.keys()]
            .filter((userId) => userId !== String(state.user.id));

        if (!recipientIds.length) {
            throw new Error('Tidak ada pengguna online di room untuk menerima voice note.');
        }

        const channels = recipientIds.map((userId) => state.chatPeers.get(userId)?.channel);

        if (channels.some((channel) => channel?.readyState !== 'open')) {
            throw new Error('Koneksi P2P ke semua peserta belum siap. Coba lagi sebentar.');
        }

        return channels;
    }

    const channel = state.privateChatPeers.get(String(targetUserId))?.channel;

    if (!targetUserId || channel?.readyState !== 'open') {
        throw new Error('Koneksi chat pribadi belum siap.');
    }

    return [channel];
}

function renderVoiceRecorder(context, recording) {
    const form = el(context === 'room' ? '#chat-form' : '#private-chat-form');

    form.classList.toggle('is-recording', recording);
    el(`#${context}-voice-recorder`).hidden = !recording;
    el(`#${context}-voice-timer`).textContent = '0:00';

    if (recording) {
        el(`#${context}-voice-send`).focus();
    }
}

async function startVoiceRecording(context) {
    if (state.voiceRecorder || voiceRecorderStarting) return;

    const targetUserId = context === 'private'
        ? state.selectedPrivateUser?.id ?? null
        : null;

    try {
        voiceNoteChannels(context, targetUserId);
    } catch (error) {
        showToast(error.message, true);
        return;
    }

    if (!window.MediaRecorder) {
        showToast('Browser ini belum mendukung rekaman suara.', true);
        return;
    }

    voiceRecorderStarting = true;
    let stream;

    try {
        ensureMediaSupport();
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
        });
    } catch (error) {
        showToast(mediaErrorMessage(error, 'mikrofon'), true);
        return;
    } finally {
        voiceRecorderStarting = false;
    }

    const contextChanged = context === 'room'
        ? !state.room
        : state.selectedPrivateUser?.id !== targetUserId;

    if (state.voiceRecorder || contextChanged) {
        stopMediaStream(stream);
        return;
    }

    const mimeType = VOICE_NOTE_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    let recorder;

    try {
        recorder = new MediaRecorder(stream, {
            ...(mimeType ? { mimeType } : {}),
            audioBitsPerSecond: 32000,
        });
    } catch (error) {
        stopMediaStream(stream);
        showToast(`Rekaman suara tidak dapat dimulai: ${error.message}`, true);
        return;
    }

    const session = {
        context,
        targetUserId,
        recorder,
        stream,
        chunks: [],
        startedAt: performance.now(),
        timer: null,
        stopping: false,
    };

    recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
    });

    recorder.start();
    state.voiceRecorder = session;

    session.timer = window.setInterval(() => {
        const elapsed = (performance.now() - session.startedAt) / 1000;

        el(`#${context}-voice-timer`).textContent = formatDuration(elapsed);

        if (elapsed >= MAX_VOICE_NOTE_SECONDS) {
            void finishVoiceRecording(true);
        }
    }, 250);

    renderVoiceRecorder(context, true);
}

async function finishVoiceRecording(send) {
    const session = state.voiceRecorder;

    if (!session || session.stopping) return;

    session.stopping = true;
    window.clearInterval(session.timer);

    const duration = Math.min(
        (performance.now() - session.startedAt) / 1000,
        MAX_VOICE_NOTE_SECONDS,
    );

    if (session.recorder.state !== 'inactive') {
        await new Promise((resolve) => {
            session.recorder.addEventListener('stop', resolve, { once: true });
            session.recorder.stop();
        });
    }

    stopMediaStream(session.stream);
    state.voiceRecorder = null;
    renderVoiceRecorder(session.context, false);

    if (!send) return;

    if (duration < MIN_VOICE_NOTE_SECONDS) {
        showToast('Voice note terlalu pendek, minimal 1 detik.', true);
        return;
    }

    const blob = new Blob(session.chunks, {
        type: session.recorder.mimeType || session.chunks[0]?.type || 'audio/webm',
    });

    if (!blob.size) {
        showToast('Rekaman kosong. Periksa mikrofonmu lalu coba lagi.', true);
        return;
    }

    if (blob.size > MAX_VOICE_NOTE_SIZE) {
        showToast('Voice note terlalu besar untuk dikirim.', true);
        return;
    }

    await sendVoiceNote(session, blob, duration);
}

async function sendVoiceNote(session, blob, duration) {
    let channels;

    try {
        channels = voiceNoteChannels(session.context, session.targetUserId);
    } catch (error) {
        showToast(`Voice note belum terkirim: ${error.message}`, true);
        return;
    }

    const message = {
        id: crypto.randomUUID(),
        user_id: state.user.id,
        user_name: state.user.name,
        body: '',
        kind: 'voice',
        voice: {
            duration: Math.round(duration * 10) / 10,
            mime_type: blob.type.slice(0, 100),
            size: blob.size,
        },
        created_at: new Date().toISOString(),
    };

    const bytes = new Uint8Array(await blob.arrayBuffer());

    try {
        for (const channel of channels) {
            sendVoiceNoteFrames(channel, message, bytes);
        }
    } catch (error) {
        showToast(`Voice note gagal dikirim: ${error.message}`, true);
        return;
    }

    state.voiceNoteUrls.set(message.id, URL.createObjectURL(blob));

    if (session.context === 'room') {
        addChatMessage(message);
    } else {
        storeOwnPrivateMessage(message, session.targetUserId);
    }
}

function sendVoiceNoteFrames(channel, message, bytes) {
    channel.send(JSON.stringify({ type: 'voice.start', message }));

    for (let offset = 0; offset < bytes.length; offset += VOICE_NOTE_CHUNK_SIZE) {
        channel.send(JSON.stringify({
            type: 'voice.chunk',
            id: message.id,
            data: bytesToBase64(bytes.subarray(offset, offset + VOICE_NOTE_CHUNK_SIZE)),
        }));
    }

    channel.send(JSON.stringify({ type: 'voice.end', id: message.id }));
}

function storeOwnPrivateMessage(message, userId) {
    if (state.selectedPrivateUser?.id === String(userId)) {
        if (state.privateMessages.has(message.id)) return;

        state.privateMessages.add(message.id);
        state.privateMessageHistory.push(message);
        state.privateMessageHistory = state.privateMessageHistory.slice(-100);

        renderPrivateMessage(message);
        savePrivateMessages();
        return;
    }

    try {
        const key = privateConversationKey(userId);
        const history = JSON.parse(localStorage.getItem(key) ?? '[]');
        const next = Array.isArray(history) ? history : [];

        next.push(message);
        localStorage.setItem(key, JSON.stringify(next.slice(-100)));
    } catch {
        showToast('Voice note terkirim, tetapi riwayat lokal gagal disimpan.', true);
    }
}

function isValidVoiceNoteMessage(message, fromUserId) {
    const voice = message?.voice;

    return typeof message?.id === 'string'
        && /^[0-9a-f-]{36}$/i.test(message.id)
        && String(message.user_id) === fromUserId
        && typeof message.user_name === 'string'
        && message.user_name.length <= 40
        && typeof message.created_at === 'string'
        && message.kind === 'voice'
        && message.body === ''
        && typeof voice?.mime_type === 'string'
        && voice.mime_type.length <= 100
        && /^audio\/[a-z0-9.+-]+(;[\w=.,+ -]*)?$/i.test(voice.mime_type)
        && Number.isSafeInteger(voice.size)
        && voice.size > 0
        && voice.size <= MAX_VOICE_NOTE_SIZE
        && Number.isFinite(voice.duration)
        && voice.duration > 0
        && voice.duration <= MAX_VOICE_NOTE_SECONDS + 1;
}

function receiveVoiceNoteFrame(context, fromUserId, frame, deliver) {
    const prefix = `${context}:${fromUserId}:`;

    if (frame.type === 'voice.start') {
        const message = frame.message;

        if (!isValidVoiceNoteMessage(message, fromUserId)) return;

        const key = `${prefix}${message.id}`;
        const inProgress = [...state.incomingVoiceNotes.keys()]
            .filter((pendingKey) => pendingKey.startsWith(prefix))
            .length;

        if (
            inProgress >= 2
            || state.incomingVoiceNotes.has(key)
            || state.voiceNoteUrls.has(message.id)
        ) return;

        state.incomingVoiceNotes.set(key, { message, chunks: [], receivedBytes: 0 });
        return;
    }

    if (typeof frame.id !== 'string') return;

    const key = `${prefix}${frame.id}`;
    const incoming = state.incomingVoiceNotes.get(key);

    if (!incoming) return;

    if (frame.type === 'voice.chunk') {
        let bytes = null;

        if (
            typeof frame.data === 'string'
            && frame.data.length <= Math.ceil(VOICE_NOTE_CHUNK_SIZE / 3) * 4
        ) {
            try {
                bytes = base64ToBytes(frame.data);
            } catch {
                bytes = null;
            }
        }

        if (!bytes || incoming.receivedBytes + bytes.length > incoming.message.voice.size) {
            state.incomingVoiceNotes.delete(key);
            showToast('Voice note yang diterima rusak dan diabaikan.', true);
            return;
        }

        incoming.chunks.push(bytes);
        incoming.receivedBytes += bytes.length;
        return;
    }

    if (frame.type === 'voice.end') {
        state.incomingVoiceNotes.delete(key);

        if (incoming.receivedBytes !== incoming.message.voice.size) {
            showToast('Voice note yang diterima tidak lengkap.', true);
            return;
        }

        const blob = new Blob(incoming.chunks, { type: incoming.message.voice.mime_type });

        state.voiceNoteUrls.set(incoming.message.id, URL.createObjectURL(blob));
        deliver(incoming.message);
    }
}

function discardIncomingVoiceNotes(context, userId) {
    const prefix = `${context}:${userId}:`;

    for (const key of [...state.incomingVoiceNotes.keys()]) {
        if (key.startsWith(prefix)) state.incomingVoiceNotes.delete(key);
    }
}

function renderMessageContent(bubble, message) {
    if (message.kind !== 'voice') {
        bubble.textContent = message.body;
        return;
    }

    bubble.classList.add('is-voice');

    const url = state.voiceNoteUrls.get(String(message.id));

    if (!url) {
        const note = document.createElement('span');
        note.className = 'voice-unavailable';
        note.textContent = `Voice note ${formatDuration(message.voice?.duration)} · tidak tersedia lagi setelah halaman dimuat ulang`;
        bubble.append(note);
        return;
    }

    bubble.append(createVoiceNotePlayer(url, Number(message.voice?.duration) || 0));
}

function createVoiceNotePlayer(url, duration) {
    const player = document.createElement('div');
    player.className = 'voice-player';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'voice-play';

    const track = document.createElement('span');
    track.className = 'voice-track';

    const progress = document.createElement('span');
    progress.className = 'voice-progress';
    track.append(progress);

    const time = document.createElement('span');
    time.className = 'voice-time';
    time.textContent = formatDuration(duration);

    const audio = new Audio(url);
    audio.preload = 'metadata';

    const showPaused = () => {
        button.innerHTML = PLAY_ICON;
        button.setAttribute('aria-label', 'Putar voice note');
    };

    showPaused();

    audio.addEventListener('play', () => {
        button.innerHTML = PAUSE_ICON;
        button.setAttribute('aria-label', 'Jeda voice note');
    });

    audio.addEventListener('pause', showPaused);

    audio.addEventListener('timeupdate', () => {
        // Rekaman WebM dari MediaRecorder sering tidak punya durasi, jadi pakai durasi rekaman sebagai cadangan.
        const total = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : duration;

        progress.style.width = `${total ? Math.min(100, (audio.currentTime / total) * 100) : 0}%`;
        time.textContent = formatDuration(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
        progress.style.width = '0%';
        time.textContent = formatDuration(duration);
        showPaused();
    });

    button.addEventListener('click', () => {
        if (!audio.paused) {
            audio.pause();
            return;
        }

        if (activeVoiceAudio && activeVoiceAudio !== audio) {
            activeVoiceAudio.pause();
        }

        activeVoiceAudio = audio;
        audio.play().catch(() => {
            showToast('Browser ini tidak dapat memutar format voice note tersebut.', true);
        });
    });

    player.append(button, track, time);

    return player;
}

function renderCallButtons() {
    const available = Boolean(state.selectedPrivateUser) && !state.call;

    el('#private-voice-call').disabled = !available;
    el('#private-video-call').disabled = !available;
}

function createCallState({ id, kind, direction, status, peerId, peerName }) {
    return {
        id,
        kind,
        direction,
        status,
        peerId,
        peerName,
        pc: null,
        localStream: null,
        remoteStream: null,
        pendingCandidates: [],
        micMuted: false,
        cameraOff: false,
        remoteMicMuted: false,
        remoteCameraOff: false,
        unstable: false,
        timeoutTimer: null,
        durationTimer: null,
        connectedAt: null,
    };
}

function sendCallSignal(call, type, payload = {}) {
    if (!state.privateChannel) {
        return Promise.reject(new Error('Koneksi signaling belum tersedia.'));
    }

    return state.privateChannel.publish('signal', {
        scope: 'call',
        to: String(call.peerId),
        type,
        payload: { ...payload, callId: call.id },
    });
}

function callDeviceLabel(kind) {
    return kind === 'video' ? 'kamera dan mikrofon' : 'mikrofon';
}

async function getCallMedia(kind) {
    ensureMediaSupport();

    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

    if (kind === 'audio') {
        return navigator.mediaDevices.getUserMedia({ audio });
    }

    try {
        return await navigator.mediaDevices.getUserMedia({
            audio,
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
    } catch (error) {
        if (!['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(error?.name)) {
            throw error;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        showToast('Kamera tidak tersedia. Panggilan berjalan dengan suara saja.', true);

        return stream;
    }
}

function setCallTimeout(call, delay, message) {
    window.clearTimeout(call.timeoutTimer);
    call.timeoutTimer = window.setTimeout(() => {
        if (state.call === call && call.status !== 'active') {
            endCall(message, true, true);
        }
    }, delay);
}

async function startCall(kind) {
    const user = state.selectedPrivateUser;

    if (!user || state.call) return;

    if (!state.privateOnlineUsers.has(user.id)) {
        showToast(`${user.name} sedang offline.`, true);
        return;
    }

    const call = createCallState({
        id: crypto.randomUUID(),
        kind,
        direction: 'outgoing',
        status: 'preparing',
        peerId: user.id,
        peerName: user.name,
    });

    state.call = call;
    renderCallButtons();

    try {
        call.localStream = await getCallMedia(kind);
    } catch (error) {
        endCall(mediaErrorMessage(error, callDeviceLabel(kind)), false, true);
        return;
    }

    if (state.call !== call) {
        stopMediaStream(call.localStream);
        return;
    }

    call.status = 'calling';
    openCallDialog();

    try {
        await sendCallSignal(call, 'call-invite', { kind });
    } catch (error) {
        endCall(`Panggilan gagal dimulai: ${error.message}`, false, true);
        return;
    }

    setCallTimeout(call, CALL_RING_TIMEOUT, `${user.name} tidak menjawab.`);
}

async function acceptIncomingCall() {
    const call = state.call;

    if (!call || call.direction !== 'incoming' || call.status !== 'ringing') return;

    stopRingtone();
    window.clearTimeout(call.timeoutTimer);
    call.status = 'connecting';
    renderCallDialog();

    try {
        call.localStream = await getCallMedia(call.kind);
    } catch (error) {
        if (state.call === call) {
            void sendCallSignal(call, 'call-reject', { reason: 'media' }).catch(() => {});
            endCall(mediaErrorMessage(error, callDeviceLabel(call.kind)), false, true);
        }
        return;
    }

    if (state.call !== call) {
        stopMediaStream(call.localStream);
        return;
    }

    try {
        createCallPeer(call);
        await sendCallSignal(call, 'call-accept');
    } catch (error) {
        endCall(`Panggilan gagal tersambung: ${error.message}`, true, true);
        return;
    }

    renderCallDialog();
    setCallTimeout(call, 20 * 1000, 'Panggilan gagal tersambung. Coba lagi.');
}

function declineIncomingCall() {
    const call = state.call;

    if (!call || call.direction !== 'incoming' || call.status !== 'ringing') return;

    void sendCallSignal(call, 'call-reject').catch(() => {});
    endCall('Panggilan ditolak.');
}

function hangUpCall() {
    const call = state.call;

    if (!call) return;

    if (call.direction === 'incoming' && call.status === 'ringing') {
        declineIncomingCall();
        return;
    }

    const duration = call.connectedAt
        ? ` · ${formatDuration((Date.now() - call.connectedAt) / 1000)}`
        : '';

    endCall(call.connectedAt ? `Panggilan selesai${duration}.` : 'Panggilan dibatalkan.', true);
}

function endCall(message = null, notifyPeer = false, isError = false) {
    const call = state.call;

    if (!call) return;

    state.call = null;

    if (notifyPeer) {
        void sendCallSignal(call, 'call-end').catch(() => {});
    }

    window.clearTimeout(call.timeoutTimer);
    window.clearInterval(call.durationTimer);
    stopRingtone();
    call.pc?.close();
    stopMediaStream(call.localStream);

    el('#call-remote-video').srcObject = null;
    el('#call-local-video').srcObject = null;
    el('#call-remote-audio').srcObject = null;

    const dialog = el('#call-dialog');

    if (dialog.open) dialog.close();

    renderCallButtons();

    if (message) showToast(message, isError);
}

function createCallPeer(call) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    call.pc = pc;

    for (const track of call.localStream.getTracks()) {
        pc.addTrack(track, call.localStream);
    }

    if (
        call.kind === 'video'
        && call.direction === 'outgoing'
        && !call.localStream.getVideoTracks().length
    ) {
        pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate || state.call !== call) return;

        void sendCallSignal(call, 'call-candidate', {
            candidate: event.candidate.toJSON(),
        }).catch(() => {});
    });

    pc.addEventListener('track', (event) => {
        if (state.call !== call) return;

        const [stream] = event.streams;

        if (stream) {
            call.remoteStream = stream;
        } else {
            call.remoteStream ??= new MediaStream();
            call.remoteStream.addTrack(event.track);
        }

        for (const type of ['mute', 'unmute', 'ended']) {
            event.track.addEventListener(type, () => {
                if (state.call === call) renderCallDialog();
            });
        }

        attachRemoteStream(call);
        renderCallDialog();
    });

    pc.addEventListener('connectionstatechange', () => {
        if (state.call !== call) return;

        if (pc.connectionState === 'connected') {
            call.unstable = false;
            markCallConnected(call);
            renderCallDialog();
        } else if (pc.connectionState === 'disconnected') {
            call.unstable = true;
            renderCallDialog();
        } else if (pc.connectionState === 'failed') {
            endCall('Koneksi panggilan terputus.', true, true);
        }
    });

    return pc;
}

function attachRemoteStream(call) {
    const audio = el('#call-remote-audio');
    const video = el('#call-remote-video');

    if (audio.srcObject !== call.remoteStream) {
        audio.srcObject = call.remoteStream;
        void audio.play().catch(() => {});
    }

    if (call.kind === 'video' && video.srcObject !== call.remoteStream) {
        video.srcObject = call.remoteStream;
        void video.play().catch(() => {});
    }
}

function markCallConnected(call) {
    window.clearTimeout(call.timeoutTimer);

    if (call.connectedAt) return;

    call.status = 'active';
    call.connectedAt = Date.now();
    call.durationTimer = window.setInterval(() => {
        if (state.call === call) {
            el('#call-status').textContent = callStatusText(call);
        }
    }, 1000);
}

async function drainCallCandidates(call) {
    for (const candidate of call.pendingCandidates.splice(0)) {
        await call.pc.addIceCandidate(candidate);
    }
}

async function handleCallSignal(from, user, signal) {
    const payload = signal.payload ?? {};
    const callId = payload.callId;

    if (typeof callId !== 'string' || !/^[0-9a-f-]{36}$/i.test(callId)) return;

    if (signal.type === 'call-invite') {
        if (!['audio', 'video'].includes(payload.kind)) return;

        if (state.call) {
            if (state.call.id !== callId) {
                void sendCallSignal({ id: callId, peerId: from }, 'call-busy').catch(() => {});
            }
            return;
        }

        const call = createCallState({
            id: callId,
            kind: payload.kind,
            direction: 'incoming',
            status: 'ringing',
            peerId: from,
            peerName: user.name,
        });

        state.call = call;
        renderCallButtons();
        openCallDialog();
        startRingtone();
        navigator.vibrate?.([400, 200, 400]);

        call.timeoutTimer = window.setTimeout(() => {
            if (state.call === call && call.status === 'ringing') {
                endCall(`Panggilan tak terjawab dari ${call.peerName}.`);
            }
        }, CALL_RING_TIMEOUT + 5000);
        return;
    }

    const call = state.call;

    if (!call || call.id !== callId || call.peerId !== from) return;

    try {
        if (signal.type === 'call-busy' && call.status === 'calling') {
            endCall(`${call.peerName} sedang dalam panggilan lain.`);
        } else if (signal.type === 'call-reject' && call.status === 'calling') {
            endCall(payload.reason === 'media'
                ? `${call.peerName} tidak dapat memakai mikrofon atau kamera.`
                : `${call.peerName} menolak panggilan.`);
        } else if (signal.type === 'call-end') {
            endCall(call.status === 'ringing'
                ? `Panggilan tak terjawab dari ${call.peerName}.`
                : `${call.peerName} mengakhiri panggilan.`);
        } else if (
            signal.type === 'call-accept'
            && call.direction === 'outgoing'
            && call.status === 'calling'
        ) {
            call.status = 'connecting';
            renderCallDialog();

            const pc = createCallPeer(call);
            const offer = await pc.createOffer();

            await pc.setLocalDescription(offer);
            await sendCallSignal(call, 'call-offer', { description: pc.localDescription });
            setCallTimeout(call, 20 * 1000, 'Panggilan gagal tersambung. Coba lagi.');
        } else if (
            signal.type === 'call-offer'
            && call.direction === 'incoming'
            && call.pc
            && !call.pc.remoteDescription
        ) {
            await call.pc.setRemoteDescription(payload.description);
            await drainCallCandidates(call);

            const answer = await call.pc.createAnswer();

            await call.pc.setLocalDescription(answer);
            await sendCallSignal(call, 'call-answer', { description: call.pc.localDescription });
        } else if (
            signal.type === 'call-answer'
            && call.direction === 'outgoing'
            && call.pc
            && !call.pc.remoteDescription
        ) {
            await call.pc.setRemoteDescription(payload.description);
            await drainCallCandidates(call);
        } else if (signal.type === 'call-candidate' && payload.candidate) {
            if (call.pc?.remoteDescription) {
                await call.pc.addIceCandidate(payload.candidate);
            } else if (call.pendingCandidates.length < 100) {
                call.pendingCandidates.push(payload.candidate);
            }
        } else if (signal.type === 'call-media') {
            call.remoteMicMuted = payload.micMuted === true;
            call.remoteCameraOff = payload.cameraOff === true;
            renderCallDialog();
        }
    } catch (error) {
        if (state.call === call) {
            endCall(`Panggilan gagal tersambung: ${error.message}`, true, true);
        }
    }
}

function callStatusText(call) {
    const kindLabel = call.kind === 'video' ? 'Video call' : 'Panggilan suara';

    if (call.status === 'preparing') return 'Menyiapkan perangkat…';
    if (call.status === 'calling') return `${kindLabel} · Memanggil…`;
    if (call.status === 'ringing') return `${kindLabel} masuk`;
    if (call.status === 'connecting') return 'Menghubungkan…';
    if (call.unstable) return 'Koneksi tidak stabil, mencoba menyambung…';

    const parts = [formatDuration((Date.now() - call.connectedAt) / 1000)];

    if (call.remoteMicMuted) {
        parts.push(`mikrofon ${call.peerName} mati`);
    }

    return parts.join(' · ');
}

function openCallDialog() {
    const dialog = el('#call-dialog');

    renderCallDialog();

    if (!dialog.open) dialog.showModal();
}

function renderCallDialog() {
    const call = state.call;

    if (!call) return;

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
    el('#top-user').textContent = state.user.name;
    if (!localStorageAvailable) {
        showToast('Penyimpanan lokal browser tidak tersedia; identitas dan room terakhir tidak tersimpan.', true);
    }
    void loadRecentRooms();
    void loadPublicIp();
    if (inviteCode) {
        el('#room-code').value = inviteProof ? `${inviteCode}.${inviteProof}` : inviteCode;
        void joinRoom({
        id: inviteCode,
        proof: inviteProof,
        name: inviteRoomName
    });

    inviteCode = null;
    inviteProof = null;
    inviteRoomName = null;
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

function readRecentRooms() {
    try {
        const rooms = JSON.parse(window.localStorage.getItem(LOCAL_ROOMS_KEY) ?? '[]');
        return Array.isArray(rooms)
            ? rooms.filter((room) => (
                /^[A-Z0-9]{12}$/.test(room?.id)
                && typeof room.name === 'string'
                && (room.proof == null || /^[a-f0-9]{32}$/i.test(room.proof))
            )).slice(0, 20)
            : [];
    } catch {
        localStorageAvailable = false;
        return [];
    }
}

function saveRecentRooms(rooms) {
    try {
        window.localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(rooms.slice(0, 20)));
    } catch {
        localStorageAvailable = false;
        showToast('Room terakhir tidak dapat disimpan di browser ini.', true);
    }
}

function rememberRoom(room) {
    const rooms = readRecentRooms().filter((recent) => recent.id !== room.id);
    rooms.unshift({ id: room.id, name: room.name, proof: room.proof ?? null });
    saveRecentRooms(rooms);
    renderRecentRooms(rooms);
}

function removeRecentRoom(roomId) {
    const rooms = readRecentRooms().filter((room) => room.id !== roomId);
    saveRecentRooms(rooms);
    renderRecentRooms(rooms);
    try {
        window.localStorage.removeItem(localHistoryKey(roomId));
    } catch {
        showToast('Riwayat room tidak dapat dihapus dari browser ini.', true);
    }
}

function generateRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return [...bytes].map((byte) => alphabet[byte & 31]).join('');
}

function normalizeRoomName(value) {
    if (typeof value !== 'string') return null;

    const name = value.trim().replace(/\s+/g, ' ');

    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
        return null;
    }

    return name;
}

function suggestedRoomName() {
    const prefix = 'NonovShare';

    const highestNumber = readRecentRooms().reduce((highest, room) => {
        const match = room.name.match(/^NonovShare(\d+)$/i);

        return match
            ? Math.max(highest, Number(match[1]))
            : highest;
    }, 0);

    return `${prefix}${highestNumber + 1}`;
}

function updateRoomUrl(room) {
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.id);
    if (room.proof) {
        url.searchParams.set('proof', room.proof);
    } else {
        url.searchParams.delete('proof');
    }
    url.searchParams.set('room_name', room.name);
    window.history.replaceState({}, '', url);
}

function loadRecentRooms() {
    renderRecentRooms(readRecentRooms());
}

function renderRecentRooms(rooms) {
    const container = el('#recent-rooms');
    container.replaceChildren();
    el('#room-count').textContent = String(rooms.length);

    if (!rooms.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-note';
        empty.textContent = 'Room yang pernah kamu ikuti di browser ini akan tampil di sini.';
        container.append(empty);
        return;
    }

    for (const room of rooms) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'recent-room-button';
        button.addEventListener('click', () => void joinRoom(room));

        const icon = document.createElement('span');
        icon.className = 'recent-room-icon';
        icon.textContent = '▦';
        const copy = document.createElement('span');
        copy.className = 'recent-room-copy';
        const name = document.createElement('strong');
        name.textContent = room.name;
        const detail = document.createElement('small');
        detail.textContent = `Kode undangan · ${room.id}`;
        copy.append(name, detail);
        button.append(icon, copy);
        container.append(button);
    }
}

async function createRoom(event) {
    event.preventDefault();

    const name = normalizeRoomName(el('#room-name').value);

    if (!name) {
        showToast('Nama room wajib diisi dan maksimal 40 karakter.', true);
        el('#room-name').focus();
        return;
    }

    try {
        const id = generateRoomCode();

        const invitation = await requestRoomProof(id, name);

        const room = {
            id,
            name,
            proof: invitation.room_proof
        };

        rememberRoom(room);
        await openRoom(room, true);

        if (state.room?.id === room.id) {
            updateRoomUrl(room);
            el('#room-name').value = suggestedRoomName();
        }
    } catch (error) {
        showToast(error.message, true);
    }
}

async function requestRoomProof(roomId, roomName = null) {
    const body = {
        room_id: roomId,
    };

    if (roomName !== null) {
        body.room_name = roomName;
    }

    const invitation = await api('/api/rooms/invitation', {
        method: 'POST',
        body,
    });

    if (
        typeof invitation.room_proof !== 'string'
        || !/^[a-f0-9]{32}$/i.test(invitation.room_proof)
    ) {
        throw new Error('Bukti undangan room tidak valid.');
    }

    return invitation;
}

async function joinRoom(invitation) {
    const rawCode = typeof invitation === 'object' && invitation !== null
        ? String(invitation.id ?? '')
        : String(invitation ?? '').trim();
    const parts = rawCode.split('.');
    const roomCode = parts[0].toUpperCase();
    const savedRoom = readRecentRooms().find((recent) => recent.id === roomCode);
    const proof = typeof invitation === 'object' && invitation !== null
        ? invitation.proof ?? null
        : parts[1] ?? null;
    if (!roomCode) return;
    if (!/^[A-Z0-9]{12}$/.test(roomCode)) {
        showToast('Kode room harus terdiri dari 12 huruf atau angka.', true);
        return;
    }
    if (proof !== null && (typeof proof !== 'string' || !/^[a-f0-9]{32}$/i.test(proof))) {
        showToast('Bukti undangan tidak valid.', true);
        return;
    }

    try {
        const serverInvitation = proof === null
    ? await requestRoomProof(roomCode)
    : null;

    const roomProof = proof?.toLowerCase()
        ?? serverInvitation.room_proof;

    const invitedName = typeof invitation === 'object' && invitation !== null
        ? normalizeRoomName(invitation.name)
        : null;

    const serverRoomName = normalizeRoomName(serverInvitation?.room_name);

    const room = {
        id: roomCode,
        name: serverRoomName
            ?? invitedName
            ?? savedRoom?.name
            ?? `NonovShare-${roomCode.slice(-4)}`,
        proof: roomProof,
    };
        rememberRoom(room);
        await openRoom(room);
        if (state.room?.id === roomCode) updateRoomUrl(room);
    } catch (error) {
        showToast(error.message, true);
    }
}

async function openRoom(room, allowEmpty = false) {
    showPublicRoomView();

    if (state.room?.id === room.id && state.room?.proof === room.proof) return;
    if (state.room) await leaveRoom();

    state.room = room;
    state.onlineUsers.clear();
    state.messages.clear();
    state.messageHistory = [];
    state.pendingChatMessage = null;
    state.chatMessageSending = false;
    state.transfers.clear();
    state.transferProgress.clear();
    state.files.clear();
    state.pendingCandidates.clear();
    state.chatCandidates.clear();
    state.blockedNetworkPeers.clear();
    state.networkFingerprint = null;
    state.presenceEntered = false;
    state.pendingTransferRequest = null;
    state.chatPeers.clear();
    el('#recipient-select').replaceChildren();
    el('#room-empty').hidden = true;
    el('#active-room').hidden = false;
    el('#copy-invite').disabled = true;
    el('#show-qr').disabled = true;
    el('#active-room-name').textContent = room.name;
    el('#active-room-code').textContent = room.id;
    el('#chat-messages').replaceChildren();
    loadLocalMessages(room.id);
    renderOnlineUsers();
    renderTransfers();
    setRoomStatus('Memeriksa jaringan dan menyiapkan P2P…', false);

    try {
        await connectRealtime(room, allowEmpty);
        await loadRecentRooms();
        el('#copy-invite').disabled = false;
        el('#show-qr').disabled = false;
    } catch (error) {
        if (error.status === 422) {
            await leaveRoom();
            removeRecentRoom(room.id);
            showToast(error.message, true);
            return;
        }
        if (error.status === 404) {
            await leaveRoom();
            removeRecentRoom(room.id);
            showToast('Room tidak ditemukan atau jaringanmu berbeda dari pembuat room.', true);
            return;
        }
        setRoomStatus(`Realtime belum tersedia: ${error.message}`, false);
        showToast(error.message, true);
    }
}

function showPublicRoomView() {
    const privatePanel = el('#private-chat-panel');
    const activeRoom = el('#active-room');
    const roomEmpty = el('#room-empty');

    if (privatePanel) privatePanel.hidden = true;

    const hasRoom = Boolean(state.room);

    if (activeRoom) activeRoom.hidden = !hasRoom;
    if (roomEmpty) roomEmpty.hidden = hasRoom;

    state.selectedPrivateUser = null;
    state.privatePreviousView = null;
}

async function connectRealtime(room, allowEmpty) {
    if (!room.proof) {
        const error = new Error('Undangan room tidak lengkap. Gunakan tautan undangan atau kode lengkap ROOMID.PROOF.');
        error.status = 422;
        throw error;
    }

    const networkUrl = new URL(
        `/api/rooms/${encodeURIComponent(room.id)}/network`,
        window.location.origin,
    );
    if (room.proof) networkUrl.searchParams.set('proof', room.proof);
    const network = await api(networkUrl.toString());
    if (typeof network.network_fingerprint !== 'string' || network.network_fingerprint.length !== 64) {
        throw new Error('Fingerprint jaringan tidak valid.');
    }
    if (typeof network.client_ip !== 'string') {
        throw new Error('Alamat IP publik tidak valid.');
    }
    state.networkFingerprint = network.network_fingerprint;
    state.publicIp = network.client_ip;
    el('#public-ip').textContent = `IP publik kamu: ${state.publicIp}`;
    const tokenUrl = new URL(
        `/api/rooms/${encodeURIComponent(room.id)}/ably-token`,
        window.location.origin,
    );
    tokenUrl.searchParams.set('client_id', state.user.id);
    if (room.proof) tokenUrl.searchParams.set('room_proof', room.proof);
    const client = createClient({
        authUrl: tokenUrl.toString(),
        authMethod: 'GET',
        autoConnect: true,
    });
    const channelName = `p2p:room:${room.id}${room.proof ? `:${room.proof}` : ''}`;
    const channel = client.channels.get(channelName);
    state.ably = client;
    state.channel = channel;

    client.connection.on((change) => {
        if (change.current === 'connected') {
            setRoomStatus('Signaling siap · Menghubungkan P2P', true);
        } else if (['failed', 'suspended', 'closed'].includes(change.current)) {
            setRoomStatus('Signaling terputus. Koneksi P2P baru mungkin tidak dapat dibuat.', false);
        }
    });

    await channel.attach();
    await Promise.all([
        channel.subscribe('signal', (message) => void handleSignal(message)),
        channel.presence.subscribe((member) => handlePresence(member)),
    ]);

    const existingMembers = await channel.presence.get();
    if (!allowEmpty && !hasOtherSameNetworkMember(existingMembers)) {
        const error = new Error('Room tidak ditemukan atau jaringanmu berbeda dari pembuat room.');
        error.status = 404;
        throw error;
    }
    for (const member of existingMembers) handlePresence(member);
    await channel.presence.enter({ name: state.user.name });
    state.presenceEntered = true;
    const members = await channel.presence.get();
    if (!allowEmpty && !hasOtherSameNetworkMember(members)) {
        const error = new Error('Room tidak ditemukan atau jaringanmu berbeda dari pembuat room.');
        error.status = 404;
        throw error;
    }
    for (const member of members) handlePresence(member);
}

function hasOtherSameNetworkMember(members) {
    return members.some((member) => {
        const identity = parseRoomClientId(member.clientId);
        return identity
            && identity.userId !== String(state.user.id)
            && identity.fingerprint === state.networkFingerprint;
    });
}

function setRoomStatus(message, connected) {
    const status = el('#room-status');
    status.classList.toggle('is-connected', connected);
    status.lastElementChild.textContent = message;
}

function parseRoomClientId(clientId) {
    const match = /^([0-9a-f-]{36}):([a-f0-9]{64})(?::([A-Za-z0-9_-]+))?$/i.exec(String(clientId ?? ''));
    if (!match) return null;

    try {
        let ipAddress = null;
        if (match[3]) {
            const encodedIp = match[3].replace(/-/g, '+').replace(/_/g, '/');
            ipAddress = atob(encodedIp.padEnd(Math.ceil(encodedIp.length / 4) * 4, '='));
            if (!/^[0-9a-f:.]+$/i.test(ipAddress)) return null;
        }
        return {
            userId: match[1],
            fingerprint: match[2].toLowerCase(),
            ipAddress,
        };
    } catch {
        return null;
    }
}

function handlePresence(member) {
    if (!member?.clientId) return;
    const identity = parseRoomClientId(member.clientId);
    if (!identity) return;
    const clientId = identity.userId;

    if (member.action === 'leave') {
        state.onlineUsers.delete(clientId);
        state.blockedNetworkPeers.delete(clientId);
        closeChatPeer(clientId);
    } else if (identity.fingerprint !== state.networkFingerprint) {
        state.onlineUsers.delete(clientId);
        closeChatPeer(clientId);
        if (!state.blockedNetworkPeers.has(clientId)) {
            state.blockedNetworkPeers.add(clientId);
            showToast(`${member.data?.name || 'Pengguna'} memakai IP publik berbeda; koneksi room dibatasi.`, true);
        }
    } else {
        const user = {
            id: clientId,
            name: member.data?.name || `Pengguna ${clientId}`,
            ipAddress: identity.ipAddress,
        };
        state.blockedNetworkPeers.delete(clientId);
        state.onlineUsers.set(clientId, user);
        if (
            state.presenceEntered
            && clientId !== String(state.user.id)
            && String(state.user.id) < clientId
        ) {
            void startChatOffer(user);
        }
    }

    renderOnlineUsers();
}

function chatSignalId() {
    return `chat:${state.room?.id ?? ''}`;
}

function makeChatPeer(user, initiator) {
    const userId = String(user.id);
    const existing = state.chatPeers.get(userId);
    if (existing) return existing;

    const peer = {
        user,
        pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }),
        channel: null,
        initiator,
        offering: false,
    };
    state.chatPeers.set(userId, peer);

    peer.pc.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
            void sendSignal({ id: chatSignalId() }, userId, 'chat-candidate', {
                candidate: event.candidate.toJSON(),
            }).catch((error) => showToast(error.message, true));
        }
    });
    peer.pc.addEventListener('datachannel', (event) => {
        if (event.channel.label === 'room-chat') bindChatChannel(userId, event.channel);
    });
    peer.pc.addEventListener('connectionstatechange', () => {
        if (peer.pc.connectionState === 'failed') {
            closeChatPeer(userId);
            showToast(`Koneksi P2P ke ${user.name} gagal.`, true);
        }
    });

    if (initiator) {
        bindChatChannel(userId, peer.pc.createDataChannel('room-chat', { ordered: true }));
    }

    return peer;
}

function bindChatChannel(userId, channel) {
    const peer = state.chatPeers.get(String(userId));
    if (!peer || channel.label !== 'room-chat') return;
    peer.channel = channel;
    channel.addEventListener('message', (event) => {
        void handlePeerMessage(String(userId), event.data);
    });
    channel.addEventListener('open', () => {
        setRoomStatus(`P2P terhubung · ${peer.user.name}`, true);
        updateFileButton();
        void flushPendingChatMessage();
    });
    channel.addEventListener('error', () => showToast('Koneksi pesan P2P mengalami error.', true));
    channel.addEventListener('close', updateFileButton);
}

function closeChatPeer(userId) {
    const peer = state.chatPeers.get(String(userId));
    if (!peer) return;
    peer.channel?.close();
    peer.pc.close();
    state.chatPeers.delete(String(userId));
    state.chatCandidates.delete(String(userId));
    updateFileButton();
}

async function startChatOffer(user) {
    const peer = makeChatPeer(user, true);
    if (!peer.initiator || peer.offering || peer.pc.localDescription) return;
    peer.offering = true;

    try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        await sendSignal({ id: chatSignalId() }, user.id, 'chat-offer', {
            description: peer.pc.localDescription,
        });
    } catch (error) {
        closeChatPeer(user.id);
        showToast(`Tidak dapat memulai P2P ke ${user.name}: ${error.message}`, true);
    }
}

async function handleChatSignal(from, signal) {
    const user = state.onlineUsers.get(from);
    if (!user || signal.to !== String(state.user.id) || from === String(state.user.id)) return;

    let peer = state.chatPeers.get(from);
    if (signal.type === 'chat-offer') {
        if (from >= String(state.user.id)) return;
        if (peer?.pc.remoteDescription) return;
        peer = makeChatPeer(user, false);
        await peer.pc.setRemoteDescription(signal.payload.description);
        await drainChatCandidates(from, peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await sendSignal({ id: chatSignalId() }, from, 'chat-answer', {
            description: peer.pc.localDescription,
        });
    } else if (signal.type === 'chat-answer') {
        if (!peer?.initiator || peer.pc.remoteDescription) return;
        await peer.pc.setRemoteDescription(signal.payload.description);
        await drainChatCandidates(from, peer);
    } else if (signal.type === 'chat-candidate') {
        const candidate = signal.payload?.candidate;
        if (!candidate) return;
        if (!peer || !peer.pc.remoteDescription) {
            const candidates = state.chatCandidates.get(from) ?? [];
            candidates.push(candidate);
            state.chatCandidates.set(from, candidates);
        } else {
            await peer.pc.addIceCandidate(candidate);
        }
    }
}

async function drainChatCandidates(userId, peer) {
    const candidates = state.chatCandidates.get(String(userId)) ?? [];
    state.chatCandidates.delete(String(userId));
    for (const candidate of candidates) {
        await peer.pc.addIceCandidate(candidate);
    }
}

async function handlePeerMessage(fromUserId, rawData) {
    let frame;
    try {
        frame = JSON.parse(rawData);
    } catch {
        showToast('Data P2P tidak valid dan diabaikan.', true);
        return;
    }

    if (frame.type === 'chat.message') {
        const message = frame.message;
        if (
            !message?.id
            || String(message.user_id) !== fromUserId
            || typeof message.user_name !== 'string'
            || typeof message.body !== 'string'
            || message.body.length > 2000
        ) return;
        addChatMessage(message);
        return;
    }

    if (frame.type === 'transfer.request') {
        const transfer = frame.transfer;
        if (
            transfer?.room_id !== state.room?.id
            || String(transfer.sender_id) !== fromUserId
            || String(transfer.receiver_id) !== String(state.user.id)
            || typeof transfer.file_name !== 'string'
            || transfer.file_name.length < 1
            || transfer.file_name.length > 255
            || typeof transfer.mime_type !== 'string'
            || !Number.isSafeInteger(transfer.file_size)
            || transfer.file_size < 1
            || transfer.file_size > MAX_FILE_SIZE
        ) return;
        receiveTransferRequest(transfer);
        return;
    }

    if (frame.type === 'transfer.update') {
        const transfer = frame.transfer;
        const current = state.transfers.get(transfer?.id);
        if (
            !current
            || (String(current.sender_id) !== fromUserId && String(current.receiver_id) !== fromUserId)
            || String(current.sender_id) !== String(transfer.sender_id)
            || String(current.receiver_id) !== String(transfer.receiver_id)
            || !['accepted', 'declined', 'cancelled', 'failed', 'completed'].includes(transfer.status)
        ) return;
        receiveTransferUpdate(transfer);
    }
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
    const selected = new Set([...select.selectedOptions].map((option) => option.value));
    select.replaceChildren();

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
        const ipAddress = document.createElement('small');
        ipAddress.className = 'member-ip';
        ipAddress.textContent = `IP publik · ${user.ipAddress ?? 'belum tersedia'}`;
        copy.append(name, role, ipAddress);
        row.append(avatar, copy);
        container.append(row);

        if (user.id !== String(state.user.id)) {
            const option = new Option(user.name, user.id);
            option.selected = selected.has(user.id);
            select.add(option);
        }
    }
    updateRecipientSelectionControls();
    updateFileButton();
}

function updateRecipientSelectionControls() {
    const select = el('#recipient-select');
    const button = el('#select-all-recipients');
    const count = el('#recipient-count');

    const selectedCount = select.selectedOptions.length;
    const totalCount = select.options.length;

    button.disabled = totalCount === 0;
    button.textContent = totalCount > 0
        && selectedCount === totalCount
        ? 'Batalkan pilihan'
        : 'Pilih semua';

    count.textContent =
        `${selectedCount} dari ${totalCount} dipilih`;
}

function toggleAllRecipients() {
    const select = el('#recipient-select');

    const shouldSelectAll =
        [...select.options].some(option => !option.selected);

    for (const option of select.options) {
        option.selected = shouldSelectAll;
    }

    state.pendingTransferRequest = null;

    updateRecipientSelectionControls();
    updateFileButton();
}

function addChatMessage(message) {
    if (
        !message?.id
        || typeof message.body !== 'string'
        || state.messages.has(String(message.id))
    ) return;
    state.messages.add(String(message.id));
    state.messageHistory.push(message);
    state.messageHistory = state.messageHistory.slice(-100);
    const list = el('#chat-messages');
    list.querySelector('.chat-empty')?.remove();

    const own = String(message.user_id) === String(state.user.id);
    const row = document.createElement('article');
    row.className = `chat-message${own ? ' is-own' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const name = document.createElement('strong');
    name.textContent = own ? 'Kamu' : (message.user_name || 'Pengguna room');
    const time = document.createElement('span');
    time.textContent = formatTime(message.created_at);
    meta.append(name, time);
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = message.body;
    row.append(meta, bubble);
    list.append(row);
    list.scrollTop = list.scrollHeight;
    saveLocalMessages();
}

function localHistoryKey(roomId = state.room?.id) {
    return `sharing-chat:${roomId}:${state.user.id}`;
}

function loadLocalMessages(roomId) {
    try {
        const messages = JSON.parse(window.localStorage.getItem(localHistoryKey(roomId)) ?? '[]');
        if (Array.isArray(messages)) {
            for (const message of messages.slice(-100)) addChatMessage(message);
        }
    } catch {
        showToast('Riwayat lokal browser tidak dapat dibaca.', true);
    }
}

function saveLocalMessages() {
    if (!state.room) return;
    try {
        window.localStorage.setItem(localHistoryKey(), JSON.stringify(state.messageHistory));
    } catch {
        showToast('Riwayat pesan tidak dapat disimpan di browser ini.', true);
    }
}

async function sendChat(event) {
    event.preventDefault();
    if (!state.room) return;
    const input = el('#chat-input');
    const body = input.value.trim();
    if (!body) return;

    const recipientIds = [...state.onlineUsers.keys()]
        .filter((userId) => userId !== String(state.user.id));
    if (!recipientIds.length) {
        showToast('Tidak ada pengguna online satu IP publik untuk menerima pesan.', true);
        return;
    }

    if (state.pendingChatMessage && state.pendingChatMessage.body !== body) {
        showToast('Pesan sebelumnya masih menunggu koneksi P2P. Kirim pesan itu terlebih dahulu.', true);
        return;
    }

    if (!state.pendingChatMessage) {
        const message = {
            id: crypto.randomUUID(),
            user_id: state.user.id,
            user_name: state.user.name,
            body,
            created_at: new Date().toISOString(),
        };
        state.pendingChatMessage = { body, message };
    }

    if (!await flushPendingChatMessage()) {
        showToast('Koneksi P2P sedang disiapkan; pesan akan dikirim otomatis saat semua pengguna siap.');
    }
}

async function flushPendingChatMessage() {
    const pending = state.pendingChatMessage;
    if (!pending || state.chatMessageSending || !state.room) return false;

    const recipientIds = [...state.onlineUsers.keys()]
        .filter((userId) => userId !== String(state.user.id));
    if (!recipientIds.length) return false;

    const recipients = recipientIds.map((userId) => state.chatPeers.get(userId));
    if (recipients.some((peer) => peer?.channel?.readyState !== 'open')) return false;

    state.chatMessageSending = true;
    try {
        const frame = JSON.stringify({ type: 'chat.message', message: pending.message });
        for (const peer of recipients) peer.channel.send(frame);
        addChatMessage(pending.message);
        state.pendingChatMessage = null;
        if (el('#chat-input').value.trim() === pending.body) {
            el('#chat-input').value = '';
        }
        return true;
    } catch (error) {
        showToast(`Pesan belum terkirim: ${error.message}. Pesan akan dicoba lagi saat koneksi siap.`, true);
        return false;
    } finally {
        state.chatMessageSending = false;
    }
}

function onFileSelection(event) {
    const file = event.currentTarget.files?.[0] ?? null;
    state.selectedFile = file;
    state.pendingTransferRequest = null;
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
    const recipientIds = [...el('#recipient-select').selectedOptions].map((option) => option.value);
    const hasRecipients = recipientIds.length > 0;
    const allConnected = hasRecipients && recipientIds.every((userId) => (
        state.chatPeers.get(userId)?.channel?.readyState === 'open'
    ));
    el('#send-file-button').disabled = !state.selectedFile || !allConnected || state.transferSubmitting;
    el('#recipient-status').textContent = !hasRecipients
    ? 'Pilih satu orang, beberapa orang, atau pilih semua. Setiap penerima harus menerima atau menolak file.'
    : allConnected
        ? `${recipientIds.length} penerima siap. Masing-masing akan diminta menerima atau menolak file.`
        : 'Menyiapkan koneksi P2P ke penerima yang dipilih...';
    updateRecipientSelectionControls();
}

async function requestFileTransfer(event) {
    event.preventDefault();
    if (!state.room || !state.selectedFile) return;

    const selectedRecipientIds = [...el('#recipient-select').selectedOptions]
        .map((option) => option.value)
        .filter(Boolean);
    if (!selectedRecipientIds.length) {
        showToast('Pilih pengguna online terlebih dahulu.', true);
        return;
    }

    const file = state.selectedFile;
    const request = state.pendingTransferRequest ?? {
        file,
        transfers: selectedRecipientIds.map((receiverId) => {
            const recipient = state.onlineUsers.get(receiverId);
            return {
                id: crypto.randomUUID(),
                room_id: state.room.id,
                sender_id: state.user.id,
                sender_name: state.user.name,
                receiver_id: receiverId,
                receiver_name: recipient.name,
                file_name: file.name,
                mime_type: file.type || 'application/octet-stream',
                file_size: file.size,
                status: 'pending',
                created_at: new Date().toISOString(),
            };
        }),
    };
    const recipients = request.transfers
        .map((transfer) => state.chatPeers.get(String(transfer.receiver_id)));
    if (recipients.some((peer) => peer?.channel?.readyState !== 'open')) {
        showToast('Koneksi P2P sedang disiapkan. Tunggu sampai status koneksi siap sebelum mengirim.', true);
        return;
    }

    state.pendingTransferRequest = request;
    state.transferSubmitting = true;
    updateFileButton();

    try {
        for (let index = 0; index < request.transfers.length; index += 1) {
            const transfer = request.transfers[index];
            state.transfers.set(transfer.id, transfer);
            state.files.set(transfer.id, request.file);
            state.transferProgress.set(transfer.id, { percent: 0, direction: 'Mengirim' });
            recipients[index].channel.send(JSON.stringify({ type: 'transfer.request', transfer }));
        }
        renderTransfers();
        state.pendingTransferRequest = null;
        state.selectedFile = null;
        el('#file-input').value = '';
        el('#selected-file-name').textContent = 'Pilih file untuk dikirim';
        el('#selected-file-size').textContent = 'File akan dikirim langsung ke browser penerima.';
    } catch (error) {
        showToast(`Permintaan P2P belum terkirim ke semua penerima: ${error.message}`, true);
    } finally {
        state.transferSubmitting = false;
        updateFileButton();
    }
}

function receiveTransferRequest(transfer) {
    if (
        !transfer?.id
        || String(transfer.receiver_id) !== String(state.user.id)
        || state.transfers.has(transfer.id)
    ) return;
    state.transfers.set(transfer.id, transfer);
    renderTransfers();
    showToast(`${transfer.sender_name} meminta mengirim ${transfer.file_name}.`);
}

function receiveTransferUpdate(transfer) {
    const current = state.transfers.get(transfer?.id);
    if (
        !current
        || String(current.sender_id) !== String(transfer.sender_id)
        || String(current.receiver_id) !== String(transfer.receiver_id)
    ) return;
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

function sendPeerMessage(userId, frame) {
    const channel = state.chatPeers.get(String(userId))?.channel;
    if (!channel || channel.readyState !== 'open') {
        throw new Error('Koneksi P2P ke pengguna terputus.');
    }
    channel.send(JSON.stringify(frame));
}

async function updateTransfer(transferId, action) {
    const transfer = state.transfers.get(transferId);
    if (!transfer) return;

    const isSender = String(transfer.sender_id) === String(state.user.id);
    const isReceiver = String(transfer.receiver_id) === String(state.user.id);
    const allowed = {
        accept: isReceiver && transfer.status === 'pending',
        decline: isReceiver && transfer.status === 'pending',
        cancel: (isSender || isReceiver) && ['pending', 'accepted'].includes(transfer.status),
        complete: (isSender || isReceiver) && transfer.status === 'accepted',
        fail: (isSender || isReceiver) && transfer.status === 'accepted',
    };
    const statuses = {
        accept: 'accepted',
        decline: 'declined',
        cancel: 'cancelled',
        complete: 'completed',
        fail: 'failed',
    };
    if (!allowed[action]) return;

    const updated = { ...transfer, status: statuses[action] };
    const peerId = isSender ? transfer.receiver_id : transfer.sender_id;
    try {
        sendPeerMessage(peerId, { type: 'transfer.update', transfer: updated });
    } catch (error) {
        showToast(error.message, true);
        return;
    }

    state.transfers.set(transferId, updated);
    renderTransfers();
    if (action === 'accept') showToast('Permintaan diterima. Menunggu koneksi langsung…');
    if (action === 'decline') showToast('Permintaan file ditolak.');
    if (['cancel', 'complete', 'fail'].includes(action)) closePeer(transferId);
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
    const identity = parseRoomClientId(message?.clientId);
    const from = identity?.userId;
    if (
        !signal
        || !identity
        || identity.fingerprint !== state.networkFingerprint
        || signal.to !== String(state.user.id)
    ) return;

    if (signal.transfer_id === chatSignalId()) {
        try {
            await handleChatSignal(from, signal);
        } catch (error) {
            closeChatPeer(from);
            showToast(`Signaling chat P2P gagal: ${error.message}`, true);
        }
        return;
    }

    const transfer = state.transfers.get(signal.transfer_id);
    if (!transfer) return;
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
    if (state.room.proof) invite.searchParams.set('proof', state.room.proof);
    else invite.searchParams.delete('proof');
    invite.searchParams.set('room_name', state.room.name);
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
    if (state.room.proof) invite.searchParams.set('proof', state.room.proof);
    else invite.searchParams.delete('proof');
    invite.searchParams.set('room_name', state.room.name);
    try {
        await QRCode.toCanvas(el('#qr-canvas'), invite.toString(), {
            width: 240,
            margin: 1,
            color: { dark: '#17233c', light: '#ffffff' },
        });
        el('#qr-room-code').textContent =
        `${state.room.name} · ${state.room.id}`;
        el('#qr-dialog').showModal();
    } catch (error) {
        showToast(`QR tidak dapat dibuat: ${error.message}`, true);
    }
}

async function leaveRoom() {
    const room = state.room;
    if (!room) return;

    for (const transferId of [...state.peers.keys()]) closePeer(transferId);
    for (const userId of [...state.chatPeers.keys()]) closeChatPeer(userId);
    const channel = state.channel;
    let roomIsEmpty = false;
    try {
        await channel?.presence.leave();
        if (channel) {
            roomIsEmpty = (await channel.presence.get()).length === 0;
        }
    } catch {
        // The connection may already be closed; Ably removes the presence member after disconnect.
    }
    if (roomIsEmpty) removeRecentRoom(room.id);
    state.ably?.close();
    state.channel = null;
    state.ably = null;

    for (const progress of state.transferProgress.values()) {
        if (progress.downloadUrl) URL.revokeObjectURL(progress.downloadUrl);
    }
    state.room = null;
    state.onlineUsers.clear();
    state.blockedNetworkPeers.clear();
    state.networkFingerprint = null;
    state.presenceEntered = false;
    state.pendingChatMessage = null;
    state.chatMessageSending = false;
    state.transfers.clear();
    state.transferProgress.clear();
    state.files.clear();
    state.pendingCandidates.clear();
    state.chatCandidates.clear();
    state.pendingTransferRequest = null;
    el('#active-room').hidden = true;
    el('#copy-invite').disabled = true;
    el('#show-qr').disabled = true;
    el('#room-empty').hidden = false;
    el('#online-members').replaceChildren();
    el('#chat-messages').replaceChildren();
    el('#transfers-list').replaceChildren();
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('proof');
    window.history.replaceState({}, '', url);
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


async function handleUsernameSubmit(event) {
    event.preventDefault();

    const errorElement = el('#username-error');
    errorElement.textContent = '';

    let name;

    try {
        name = saveUsername(el('#username-input').value);
    } catch (error) {
        errorElement.textContent = error.message;
        return;
    }

    const currentUser = state.onlineUsers.get(String(state.user.id));

    if (currentUser) {
        currentUser.name = name;
        state.onlineUsers.set(String(state.user.id), currentUser);
        renderOnlineUsers();
    }

    el('#username-dialog').close();

    let roomUpdateFailed = false;
    let privateUpdateFailed = false;

    if (state.channel && state.presenceEntered) {
        try {
            await state.channel.presence.update({ name });
        } catch {
            roomUpdateFailed = true;
        }
    }

    if (state.privateChannel) {
        try {
            await state.privateChannel.presence.update({ name });
        } catch {
            privateUpdateFailed = true;
        }
    }

    if (roomUpdateFailed || privateUpdateFailed) {
        showToast(
            'Username tersimpan, tetapi pembaruan nama pada sebagian koneksi gagal.',
            true,
        );
    } else {
        showToast('Username berhasil diperbarui.');
    }
}


function bindEvents() {
    const roomNameInput = el('#room-name');
    if (roomNameInput) {
        roomNameInput.value = suggestedRoomName();
    }
    el('#create-room-form').addEventListener('submit', (event) => void createRoom(event));
    el('#join-room-form').addEventListener('submit', (event) => {
        event.preventDefault();
        void joinRoom(el('#room-code').value);
    });
    el('#chat-form').addEventListener('submit', (event) => void sendChat(event));
    el('#private-chat-form').addEventListener(
    'submit',
    (event) => void sendPrivateChat(event)
    );
    el('#private-file-input').addEventListener(
    'change',
    onPrivateFileSelection,
    );

    el('#private-send-file').addEventListener(
        'click',
        sendPrivateFileRequest,
    );

    el('#close-private-chat').addEventListener('click', () => {
    state.selectedPrivateUser = null;

    restorePreviousChatView();
    renderPrivateOnlineUsers();
    });
        el('#file-input').addEventListener('change', onFileSelection);
    el('#send-file-form').addEventListener('submit', (event) => void requestFileTransfer(event));
    el('#recipient-select').addEventListener('change', () => {
    state.pendingTransferRequest = null;
    updateRecipientSelectionControls();
    updateFileButton();
    });

    el('#select-all-recipients').addEventListener('click', () => {
    const select = el('#recipient-select');

    const shouldSelectAll = [...select.options].some(
        option => !option.selected
    );

    for (const option of select.options) {
        option.selected = shouldSelectAll;
    }

    state.pendingTransferRequest = null;
    updateRecipientSelectionControls();
    updateFileButton();
    });

    el('#copy-invite').addEventListener('click', () => void copyInvite());
    el('#show-qr').addEventListener('click', () => void showQrCode());
    el('#top-user').addEventListener('click', () => {
    el('#username-input').value = state.user.name;
    el('#username-error').textContent = '';
    el('#username-dialog').showModal();
    el('#username-input').focus();
    });

    el('#close-username').addEventListener('click', () => {
        el('#username-dialog').close();
    });

    el('#cancel-username').addEventListener('click', () => {
        el('#username-dialog').close();
    });

    el('#username-form').addEventListener('submit', (event) => {
        void handleUsernameSubmit(event);
    });

    el('#username-dialog').addEventListener('click', (event) => {
        if (event.target === el('#username-dialog')) {
            el('#username-dialog').close();
        }
    });
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
    window.addEventListener('storage', (event) => {
        if (event.key === LOCAL_ROOMS_KEY) loadRecentRooms();
    });
}

bindEvents();
initializeApp();
void inspectNetwork();
