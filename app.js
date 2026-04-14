// 全局状态
let peer = null;
let conn = null;
let isHost = false;
let receivedFiles = new Map();

// DOM 元素
let elements = {};

function initElements() {
    elements = {
        status: document.getElementById('status'),
        statusText: document.querySelector('.status-text'),
        waitingPanel: document.getElementById('waiting-panel'),
        transferPanel: document.getElementById('transfer-panel'),
        qrcode: document.getElementById('qrcode'),
        roomDisplay: document.getElementById('room-display'),
        resetBtn: document.getElementById('reset-btn'),
        disconnectBtn: document.getElementById('disconnect-btn'),
        dropZone: document.getElementById('drop-zone'),
        fileList: document.getElementById('file-list'),
        fileInput: document.getElementById('file-input')
    };
}

// ========== 工具函数 ==========

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function showNotification(message, type = 'info') {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function updateStatus(state, text) {
    elements.status.className = 'status-bar';
    if (state !== 'idle') elements.status.classList.add(state);
    elements.statusText.textContent = text;
}

function showTransferPanel() {
    elements.waitingPanel.classList.add('hidden');
    elements.transferPanel.classList.remove('hidden');
}

function showWaitingPanel() {
    elements.waitingPanel.classList.remove('hidden');
    elements.transferPanel.classList.add('hidden');
}

// ========== 二维码绘制 ==========

function drawQRCode(text) {
    const canvas = elements.qrcode;
    const ctx = canvas.getContext('2d');

    try {
        const qr = qrcode(0, 'L');
        qr.addData(text);
        qr.make();

        const moduleCount = qr.getModuleCount();
        const maxCanvasWidth = 200;
        const margin = 4;
        const moduleSize = Math.floor(maxCanvasWidth / (moduleCount + margin * 2));
        const actualModuleSize = Math.max(4, Math.min(10, moduleSize));
        const totalSize = (moduleCount + margin * 2) * actualModuleSize;

        canvas.width = totalSize;
        canvas.height = totalSize + 30;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(
                        (col + margin) * actualModuleSize,
                        (row + margin) * actualModuleSize,
                        actualModuleSize,
                        actualModuleSize
                    );
                }
            }
        }

        ctx.fillStyle = '#666666';
        ctx.font = 'bold 16px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('扫码连接', canvas.width / 2, totalSize + 20);
    } catch (error) {
        console.error('二维码生成失败:', error);
    }
}

// ========== 核心逻辑 ==========

function initApp() {
    initElements();
    setupEventListeners();

    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
        // 加入方
        isHost = false;
        connectToHost(roomId);
    } else {
        // 发起方
        isHost = true;
        createHostRoom();
    }
}

function createHostRoom() {
    updateStatus('ready', '生成房间中...');
    
    // 使用 PeerJS 公共信令服务器（免费，仅用于握手）
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    peer = new Peer({
            host: "119.29.37.11",
            port: 9000,
            path: "/myapp",
            secure: true,
        });

    peer.on('open', (id) => {
        console.log('房间已创建:', id);
        elements.roomDisplay.textContent = `房间码: ${id}`;
        
        // 生成扫码链接
        const baseUrl = window.location.origin + window.location.pathname;
        const shareUrl = `${baseUrl}?room=${id}`;
        drawQRCode(shareUrl);
        
        updateStatus('ready', '等待扫码连接...');
    });

    // 监听连接请求
    peer.on('connection', (connection) => {
        console.log('设备已接入');
        conn = connection;
        setupConnection();
    });

    peer.on('error', (err) => {
        console.error('Peer 错误:', err);
        updateStatus('error', '创建失败，请重试');
    });
}

function connectToHost(roomId) {
    updateStatus('connecting', '正在连接...');
    
    peer = new Peer({
            host: "119.29.37.11",
            port: 9000,
            path: "/myapp",
            secure: true,
        });

    peer.on('open', () => {
        console.log('已就绪，发起连接:', roomId);
        conn = peer.connect(roomId, {
            reliable: true
        });
        setupConnection();
    });

    peer.on('error', (err) => {
        console.error('Peer 错误:', err);
        updateStatus('error', '连接失败，请检查网络或房间码');
    });
}

function setupConnection() {
    conn.on('open', () => {
        console.log('数据通道已打开');
        updateStatus('connected', '已连接');
        showTransferPanel();
        showNotification('连接成功！开始传输文件', 'success');
    });

    conn.on('data', handleMessage);

    conn.on('close', () => {
        console.log('连接已断开');
        updateStatus('disconnected', '已断开');
        showWaitingPanel();
        showNotification('连接已断开', 'info');
        if (peer) peer.destroy();
    });

    conn.on('error', (err) => {
        console.error('通道错误:', err);
        updateStatus('error', '传输异常');
    });
}

// ========== 文件处理 ==========

async function handleMessage(data) {
    if (typeof data === 'string') {
        try {
            const metadata = JSON.parse(data);
            if (metadata.type === 'file-start') {
                receivedFiles.set(metadata.fileId, {
                    ...metadata,
                    chunks: [],
                    received: 0
                });
                addFileToList(metadata, 'receiving');
            } else if (metadata.type === 'file-end') {
                const fileInfo = receivedFiles.get(metadata.fileId);
                if (fileInfo) {
                    const blob = new Blob(fileInfo.chunks);
                    downloadFile(blob, fileInfo.name);
                    updateFileStatus(metadata.fileId, 'done');
                    receivedFiles.delete(metadata.fileId);
                }
            }
        } catch (e) { /* 忽略 */ }
    } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        // PeerJS 可能会自动转换类型
        const buffer = data instanceof ArrayBuffer ? data : data.buffer;
        const view = new DataView(buffer);
        const fileIdBytes = new Uint8Array(buffer, 0, 36);
        const fileId = new TextDecoder().decode(fileIdBytes);
        const chunkData = buffer.slice(36);

        const fileInfo = receivedFiles.get(fileId);
        if (fileInfo) {
            fileInfo.chunks.push(chunkData);
            fileInfo.received += chunkData.byteLength;
            updateFileProgress(fileId, fileInfo.received / fileInfo.size);
        }
    }
}

async function sendFiles(files) {
    if (!conn || !conn.open) {
        showNotification('未建立连接', 'error');
        return;
    }

    for (const file of files) {
        const fileId = crypto.randomUUID();
        addFileToList({ fileId, name: file.name, size: file.size }, 'sending');

        try {
            conn.send(JSON.stringify({
                type: 'file-start',
                fileId: fileId,
                name: file.name,
                size: file.size
            }));

            const chunkSize = 16384;
            let offset = 0;

            while (offset < file.size) {
                const chunk = file.slice(offset, offset + chunkSize);
                const buffer = await chunk.arrayBuffer();

                const fileIdBytes = new TextEncoder().encode(fileId);
                const message = new Uint8Array(fileIdBytes.length + buffer.byteLength);
                message.set(fileIdBytes);
                message.set(new Uint8Array(buffer), fileIdBytes.length);

                conn.send(message.buffer);
                offset += chunkSize;

                updateFileProgress(fileId, offset / file.size);
                // 简单限流防止缓冲区溢出
                if (offset % (chunkSize * 10) === 0) {
                    await new Promise(r => setTimeout(r, 10));
                }
            }

            conn.send(JSON.stringify({ type: 'file-end', fileId: fileId }));
            updateFileStatus(fileId, 'done');
        } catch (error) {
            console.error('发送失败:', error);
            updateFileStatus(fileId, 'error');
        }
    }
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`已保存: ${filename}`, 'success');
}

// ========== UI 操作 ==========

function addFileToList({ fileId, name, size }, direction) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.id = `file-${fileId}`;

    const icon = direction === 'sending' ? '📤' : '📥';
    item.innerHTML = `
        <span class="file-icon">${icon}</span>
        <div class="file-info">
            <div class="file-name">${name}</div>
            <div class="file-size">${formatFileSize(size)}</div>
            <div class="file-progress"><div class="file-progress-bar" style="width: 0%"></div></div>
        </div>
        <span class="file-status sending">传输中</span>
    `;
    elements.fileList.prepend(item);
}

function updateFileProgress(fileId, progress) {
    const item = document.getElementById(`file-${fileId}`);
    if (item) item.querySelector('.file-progress-bar').style.width = `${progress * 100}%`;
}

function updateFileStatus(fileId, status) {
    const item = document.getElementById(`file-${fileId}`);
    if (item) {
        const statusEl = item.querySelector('.file-status');
        statusEl.className = `file-status ${status}`;
        if (status === 'done') {
            statusEl.textContent = '✓';
            item.querySelector('.file-progress-bar').style.background = 'var(--success)';
        } else if (status === 'error') {
            statusEl.textContent = '✗';
        }
    }
}

// ========== 事件监听 ==========

function setupEventListeners() {
    elements.resetBtn.addEventListener('click', () => {
        if (peer) peer.destroy();
        location.reload();
    });

    elements.disconnectBtn.addEventListener('click', () => {
        if (conn) conn.close();
        if (peer) peer.destroy();
        showWaitingPanel();
        updateStatus('disconnected', '已断开');
    });

    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) sendFiles(e.target.files);
    });

    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('dragover');
    });

    elements.dropZone.addEventListener('dragleave', () => {
        elements.dropZone.classList.remove('dragover');
    });

    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) sendFiles(e.dataTransfer.files);
    });

    elements.dropZone.addEventListener('click', (e) => {
        if (e.target === elements.fileInput || e.target.closest('label')) return;
        elements.fileInput.click();
    });
}

// 启动
initApp();
