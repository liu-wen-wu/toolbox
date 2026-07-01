<script setup>
useHead({ title: '文件互传 & 消息' })

const { copy: copyText, copied } = useCopy()

// ===== Configuration =====
const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.miwifi.com' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
}
const CHUNK_SIZE = 16384

// ===== State =====
const ws = ref(null)
const wsState = ref('disconnected')
const wsText = ref('未连接')
const myPeerId = ref(null)
const currentRoom = ref(null)
const roomCode = ref('')
const roomBadgeText = ref('')
const statusText = ref('等待连接...')
const statusState = ref('disconnected')
const roomError = ref('')
const chatMessages = ref([])
const chatInput = ref('')
const messageContainer = ref(null)
const fileProgress = ref({ show: false, name: '', pct: 0 })
const sharedFiles = ref([])
const previewTitle = ref('')
const previewContent = ref('')
const showPreview = ref(false)
const showChat = ref(false)
const showShared = ref(false)
const showStatus = ref(false)
const onlineCount = ref(0)
const showOnlineTag = ref(false)
const controlsDisabled = ref(true)
const chatDisabled = ref(true)
const roomPeers = ref([]) // peer IDs in current room (from signaling)

let p2pPeers = {} // { peerId: { pc, dc, state } }
let pendingCandidates = {}
let pendingSendFile = null
let receivingFiles = {}
let sharedFileIdCounter = 0
let wsRetries = 0
const MAX_WS_RETRIES = 5

// ===== WebSocket ====
function connectSignaling() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  wsState.value = 'connecting'
  wsText.value = '正在连接信令服务器...'
  controlsDisabled.value = true

  const socket = new WebSocket(`${protocol}//${location.host}/ws`)
  ws.value = socket

  socket.onopen = () => {
    wsRetries = 0
    wsState.value = 'connected'
    wsText.value = '信令服务器已连接 ✓'
    controlsDisabled.value = false
    roomError.value = ''
  }

  socket.onmessage = (e) => {
    try { handleSignaling(JSON.parse(e.data)) }
    catch (err) { console.error('[WS] Parse error:', err) }
  }

  socket.onclose = () => {
    wsState.value = 'disconnected'
    wsText.value = '信令服务器已断开'
    controlsDisabled.value = true
    if (wsRetries < MAX_WS_RETRIES) {
      wsRetries++
      const delay = Math.min(1000 * Math.pow(2, wsRetries), 10000)
      wsState.value = 'connecting'
      wsText.value = `正在重连... (${wsRetries}/${MAX_WS_RETRIES})`
      setTimeout(connectSignaling, delay)
    } else {
      wsState.value = 'error'
      wsText.value = '无法连接信令服务器'
      roomError.value = '无法连接信令服务器，请刷新页面重试'
    }
  }
}

function handleSignaling(msg) {
  switch (msg.type) {
    case 'room-created':
      myPeerId.value = msg.peerId
      currentRoom.value = msg.room
      roomCode.value = msg.room
      roomBadgeText.value = '#' + msg.room
      statusText.value = `等待其他人加入... (你 #${msg.peerId})`
      statusState.value = 'waiting'
      showStatus.value = true
      chatDisabled.value = false
      updateOnline()
      break

    case 'joined':
      myPeerId.value = msg.peerId
      currentRoom.value = msg.room
      roomBadgeText.value = '#' + msg.room
      statusText.value = '已加入频道'
      statusState.value = 'connecting'
      showStatus.value = true
      chatDisabled.value = false
      addSystemMsg(`🔗 已加入频道 #${msg.room} (Peer #${msg.peerId})`)
      roomPeers.value = msg.peers?.map(p => p.id) || []
      if (msg.peers?.length) {
        for (const p of msg.peers) initiatePeerConnection(p.id)
      }
      updateOnline()
      break

    case 'peer-joined':
      addSystemMsg(`📥 新成员 #${msg.peerId} 加入了频道`)
      if (!roomPeers.value.includes(msg.peerId)) {
        roomPeers.value = [...roomPeers.value, msg.peerId]
      }
      initiatePeerConnection(msg.peerId)
      updateOnline()
      break

    case 'peer-left':
      removePeer(msg.peerId)
      addSystemMsg(`📤 成员 #${msg.peerId} 离开了频道`)
      roomPeers.value = roomPeers.value.filter(id => id !== msg.peerId)
      updateOnline()
      break

    case 'signal':
      handleSignalForPeer(msg.from, msg.data)
      break

    case 'relay-message':
      // Message relayed via WebSocket (fallback when P2P unavailable on HTTP)
      addMessage(`#${msg.from}`, msg.text, 'remote')
      break

    case 'error':
      roomError.value = msg.message
      break
  }
}

// ===== Mesh Connections =====
function initiatePeerConnection(peerId) {
  if (p2pPeers[peerId] || peerId === myPeerId.value) return
  const myId = parseInt(myPeerId.value)
  const theirId = parseInt(peerId)
  ensurePeerConnection(peerId, myId < theirId)
}

function ensurePeerConnection(peerId, shouldCreateOffer) {
  if (p2pPeers[peerId]?.pc) return

  console.log(`[MESH] Creating PC for #${peerId}, offer=${shouldCreateOffer}`)
  const pc = new RTCPeerConnection(STUN_SERVERS)
  p2pPeers[peerId] = { pc, dc: null, state: 'connecting' }
  if (!pendingCandidates[peerId]) pendingCandidates[peerId] = []

  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(peerId, { candidate: e.candidate.toJSON() })
  }

  pc.ondatachannel = (e) => {
    const dc = e.channel
    p2pPeers[peerId].dc = dc
    setupDataChannel(dc, peerId)
  }

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState
    if (s === 'connected' || s === 'completed') {
      p2pPeers[peerId].state = 'connected'
      updateOnline()
    } else if (s === 'disconnected' || s === 'failed') {
      p2pPeers[peerId].state = 'disconnected'
      updateOnline()
    }
  }

  if (shouldCreateOffer) {
    const dc = pc.createDataChannel('fileshare', { ordered: true })
    p2pPeers[peerId].dc = dc
    setupDataChannel(dc, peerId)
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => sendSignal(peerId, pc.localDescription))
  }
}

function handleSignalForPeer(fromPeerId, data) {
  if (!p2pPeers[fromPeerId]?.pc) {
    p2pPeers[fromPeerId] = { pc: null, dc: null, state: 'connecting' }
    pendingCandidates[fromPeerId] = []
    const pc = new RTCPeerConnection(STUN_SERVERS)
    p2pPeers[fromPeerId].pc = pc
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(fromPeerId, { candidate: e.candidate.toJSON() }) }
    pc.ondatachannel = (e) => { const dc = e.channel; p2pPeers[fromPeerId].dc = dc; setupDataChannel(dc, fromPeerId) }
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState
      if (s === 'connected' || s === 'completed') { p2pPeers[fromPeerId].state = 'connected'; updateOnline() }
      else if (s === 'disconnected' || s === 'failed') { p2pPeers[fromPeerId].state = 'disconnected'; updateOnline() }
    }
  }
  const pc = p2pPeers[fromPeerId].pc
  if (!pc) return

  if (data.type === 'offer') {
    pc.setRemoteDescription(new RTCSessionDescription(data))
      .then(() => pc.createAnswer())
      .then(a => pc.setLocalDescription(a))
      .then(() => { sendSignal(pc.localDescription); flushCandidates(fromPeerId) })
  } else if (data.type === 'answer') {
    pc.setRemoteDescription(new RTCSessionDescription(data))
      .then(() => flushCandidates(fromPeerId))
  } else if (data.candidate) {
    const c = new RTCIceCandidate(data.candidate)
    if (pc.remoteDescription) pc.addIceCandidate(c)
    else pendingCandidates[fromPeerId].push(c)
  }
}

function flushCandidates(peerId) {
  const pc = p2pPeers[peerId]?.pc
  if (!pc) return
  for (const c of (pendingCandidates[peerId] || [])) pc.addIceCandidate(c)
  pendingCandidates[peerId] = []
}

function setupDataChannel(dc, peerId) {
  dc.binaryType = 'arraybuffer'
  dc.onopen = () => {
    p2pPeers[peerId].state = 'connected'
    updateOnline()
    chatDisabled.value = false
    addSystemMsg(`🔗 与 #${peerId} 的 P2P 连接已建立`)
    flushCandidates(peerId)
    flushPendingMessage()
  }
  dc.onclose = () => {
    p2pPeers[peerId].state = 'disconnected'
    updateOnline()
  }
  dc.onmessage = (e) => {
    if (typeof e.data === 'string') handleDataChannelMsg(JSON.parse(e.data), peerId)
    else handleFileChunk(e.data, peerId)
  }
}

function removePeer(peerId) {
  if (p2pPeers[peerId]) {
    p2pPeers[peerId].dc?.close()
    p2pPeers[peerId].pc?.close()
    delete p2pPeers[peerId]
  }
  delete pendingCandidates[peerId]
  delete receivingFiles[peerId]
  updateOnline()
}

function closeAllConnections() {
  for (const pid in p2pPeers) {
    p2pPeers[pid].dc?.close()
    p2pPeers[pid].pc?.close()
  }
  p2pPeers = {}
  pendingCandidates = {}
  receivingFiles = {}
}

function getConnectedPeerIds() {
  return Object.entries(p2pPeers).filter(([,v]) => v.state === 'connected').map(([k]) => k)
}

function updateOnline() {
  const peers = roomPeers.value
  onlineCount.value = 1 + peers.length
  showOnlineTag.value = peers.length > 0
  const connected = getConnectedPeerIds()
  if (peers.length > 0) {
    statusText.value = `🟢 在线 (${peers.map(id => '#'+id).join(', ')})`
    statusState.value = connected.length > 0 ? 'connected' : 'connecting'
  } else {
    statusText.value = `等待其他人加入... (你 #${myPeerId.value})`
    statusState.value = 'waiting'
  }
}

// ===== Room =====
function createRoom() {
  if (!ws.value || ws.value.readyState !== 1) { roomError.value = '信令服务器未连接'; return }
  controlsDisabled.value = true
  statusText.value = '正在创建频道...'
  statusState.value = 'connecting'
  showStatus.value = true
  ws.value.send(JSON.stringify({ type: 'create-room' }))
}

function joinRoom() {
  const code = roomCode.value.trim()
  if (code.length !== 4) { roomError.value = '请输入完整的4位频道码'; return }
  if (!ws.value || ws.value.readyState !== 1) { roomError.value = '信令服务器未连接'; return }
  controlsDisabled.value = true
  statusText.value = '正在加入频道...'
  statusState.value = 'connecting'
  showStatus.value = true
  ws.value.send(JSON.stringify({ type: 'join-room', room: code.toUpperCase() }))
}

function leaveRoom() {
  ws.value?.send(JSON.stringify({ type: 'leave-room' }))
  closeAllConnections()
  myPeerId.value = null
  currentRoom.value = null
  roomCode.value = ''
  roomBadgeText.value = ''
  controlsDisabled.value = false
  showStatus.value = false
  showChat.value = false
  showShared.value = false
  showOnlineTag.value = false
  chatDisabled.value = true
  roomPeers.value = []
  pendingSendFile = null
  receivingFiles = {}
  fileProgress.value = { show: false, name: '', pct: 0 }
  chatMessages.value = []
}

function sendSignal(peerId, data) {
  ws.value?.send(JSON.stringify({ type: 'signal', target: peerId, data }))
}

// ===== Messaging =====
function broadcast(data) {
  for (const pid in p2pPeers) {
    if (p2pPeers[pid].dc?.readyState === 'open') {
      try { p2pPeers[pid].dc.send(data) } catch {}
    }
  }
}

function broadcastText(obj) { broadcast(JSON.stringify(obj)) }

function sendMessage() {
  const text = chatInput.value.trim()
  if (!text) return
  const connected = getConnectedPeerIds()
  if (connected.length > 0 || roomPeers.value.length > 0) {
    // 始终通过 WebSocket relay（保证所有用户都能收到）
    // 同时通过 P2P 通道加速（如果已建立连接）
    ws.value?.send(JSON.stringify({ type: 'send-message', text }))
    if (connected.length > 0) broadcastText({ t: 'm', d: text })
  } else {
    addSystemMsg('⏳ 暂无其他成员，消息将在有人加入后自动发送')
    pendingMessage = text
  }
  addLocalMessage(text)
  chatInput.value = ''
  nextTick(() => messageContainer.value?.scrollTo(0, messageContainer.value.scrollHeight))
}

let pendingMessage = ''

function addLocalMessage(text) {
  chatMessages.value.push({ sender: '你', text, cls: 'self' })
  nextTick(() => messageContainer.value?.scrollTo(0, messageContainer.value.scrollHeight))
}

function flushPendingMessage() {
  if (pendingMessage && (getConnectedPeerIds().length > 0 || roomPeers.value.length > 0)) {
    ws.value?.send(JSON.stringify({ type: 'send-message', text: pendingMessage }))
    addSystemMsg(`✅ 暂存消息已自动发送`)
    pendingMessage = ''
  }
}

function handleDataChannelMsg(msg, fromPeerId) {
  if (msg.t === 'm') addMessage('#' + fromPeerId, msg.d, 'remote')
  else if (msg.t === 'fm') handleFileMeta(msg, fromPeerId)
  else if (msg.t === 'fd') handleFileDone(fromPeerId)
}

function addMessage(sender, text, cls) {
  chatMessages.value.push({ sender, text, cls })
  nextTick(() => messageContainer.value?.scrollTo(0, messageContainer.value.scrollHeight))
}

function addSystemMsg(text) {
  chatMessages.value.push({ system: true, text })
  nextTick(() => messageContainer.value?.scrollTo(0, messageContainer.value.scrollHeight))
}

// ===== File Transfer - Send =====
function selectFile() { document.getElementById('fileInput')?.click() }

function sendFile(file) {
  if (!file) return
  const connected = getConnectedPeerIds()
  if (connected.length === 0) {
    if (roomPeers.value.length > 0) {
      addSystemMsg('⏳ P2P 通道建立中，请稍后再试')
    } else {
      addSystemMsg('⏳ 暂无其他成员，无法发送文件')
    }
    return
  }
  const chunks = Math.ceil(file.size / CHUNK_SIZE)
  pendingSendFile = { file, chunks, peerProgress: {}, totalSent: 0, totalPeers: connected.length }
  addSystemMsg(`📤 发送文件: ${file.name} (${formatSize(file.size)}) 给 ${connected.length} 人`)
  broadcastText({ t: 'fm', n: file.name, s: file.size, c: chunks })
  for (const pid of connected) {
    pendingSendFile.peerProgress[pid] = 0
    sendChunksTo(pid)
  }
  updateSendProgress()
}

function sendChunksTo(peerId) {
  const p = pendingSendFile
  if (!p) return
  const dc = p2pPeers[peerId]?.dc
  if (!dc || dc.readyState !== 'open') return
  const file = p.file, chunks = p.chunks
  let index = p.peerProgress[peerId] || 0
  const reader = new FileReader()
  reader.onload = (e) => {
    dc.send(e.target.result)
    index++
    p.peerProgress[peerId] = index
    p.totalSent++
    updateSendProgress()
    if (index < chunks) readNext()
    else {
      dc.send(JSON.stringify({ t: 'fd' }))
      const ext = file.name.split('.').pop().toLowerCase()
      if (['png','jpg','jpeg','gif','webp','svg','bmp','ico'].includes(ext)) {
        const url = URL.createObjectURL(file)
        addSystemMsg(`📤 图片: ${file.name}`)
        chatMessages.value.push({ image: true, url, name: file.name })
      }
      let allDone = true
      for (const pid in p.peerProgress) { if (p.peerProgress[pid] < chunks) { allDone = false; break } }
      if (allDone) {
        addSystemMsg(`✅ 文件发送完成: ${file.name}`)
        addSharedFile(file.name, file.size, file, true)
        setTimeout(resetFileProgress, 2000)
        pendingSendFile = null
      }
    }
  }
  reader.onerror = () => { addSystemMsg('❌ 文件读取失败'); resetFileProgress(); pendingSendFile = null }
  function readNext() {
    const start = index * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    reader.readAsArrayBuffer(file.slice(start, end))
  }
  readNext()
}

function updateSendProgress() {
  const p = pendingSendFile
  if (!p) return
  const total = p.chunks * p.totalPeers
  fileProgress.value = { show: true, name: p.file.name, pct: Math.round(p.totalSent / total * 100) }
}

// ===== File Transfer - Receive =====
function handleFileMeta(meta, fromPeerId) {
  addSystemMsg(`📥 来自 #${fromPeerId}: ${meta.n} (${formatSize(meta.s)})`)
  fileProgress.value = { show: true, name: `[#${fromPeerId}] ${meta.n}`, pct: 0 }
  receivingFiles[fromPeerId] = { meta, blobParts: [] }
}

function handleFileChunk(arrayBuffer, fromPeerId) {
  const rf = receivingFiles[fromPeerId]
  if (!rf) return
  rf.blobParts.push(new Uint8Array(arrayBuffer))
  const pct = Math.round(rf.blobParts.length / rf.meta.c * 100)
  fileProgress.value = { show: true, name: `[#${fromPeerId}] ${rf.meta.n}`, pct }
}

function handleFileDone(fromPeerId) {
  const rf = receivingFiles[fromPeerId]
  if (!rf) return
  const totalBytes = rf.blobParts.reduce((sum, arr) => sum + arr.length, 0)
  const full = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of rf.blobParts) { full.set(chunk, offset); offset += chunk.length }
  const blob = new Blob([full])
  const meta = rf.meta
  addSharedFile(meta.n, meta.s, blob, false)
  const ext = meta.n.split('.').pop().toLowerCase()
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico'].includes(ext)) {
    const url = URL.createObjectURL(blob)
    chatMessages.value.push({ image: true, url, name: `来自 #${fromPeerId}: ${meta.n}` })
  }
  addSystemMsg(`✅ 来自 #${fromPeerId} 的文件接收完成: ${meta.n}`)
  delete receivingFiles[fromPeerId]
  if (Object.keys(receivingFiles).length === 0) setTimeout(resetFileProgress, 2000)
}

function resetFileProgress() { fileProgress.value = { show: false, name: '', pct: 0 } }

// ===== Shared Files =====
function addSharedFile(name, size, blob, fromMe) {
  const ext = name.split('.').pop().toLowerCase()
  const imgExts = ['png','jpg','jpeg','gif','webp','svg','bmp','ico']
  const textExts = ['txt','md','json','xml','html','css','js','ts','py','java','c','cpp','h','sh','yaml','yml','toml','ini','cfg','log','csv','sql','rb','go','rs','php','pl','lua','r','bat','ps1']
  let fileType = 'other'
  if (imgExts.includes(ext)) fileType = 'image'
  else if (textExts.includes(ext)) fileType = 'text'
  sharedFiles.value.push({ id: ++sharedFileIdCounter, name, size, blob, fromMe, fileType, timestamp: Date.now() })
  showShared.value = true
}

function downloadFile(id) {
  const f = sharedFiles.value.find(e => e.id === id)
  if (!f) return
  const url = URL.createObjectURL(f.blob)
  const a = document.createElement('a')
  a.href = url; a.download = f.name; a.click()
  URL.revokeObjectURL(url)
}

function previewFile(id) {
  const f = sharedFiles.value.find(e => e.id === id)
  if (!f) return
  previewTitle.value = '预览: ' + f.name
  if (f.fileType === 'image') {
    const url = URL.createObjectURL(f.blob)
    previewContent.value = `<img src="${url}" style="max-width:100%;max-height:60vh;border-radius:8px;">`
  } else if (f.fileType === 'text') {
    const reader = new FileReader()
    reader.onload = (e) => { previewContent.value = `<pre style="text-align:left;font-family:var(--font-mono);font-size:12px;line-height:1.6;white-space:pre-wrap;max-height:60vh;overflow:auto;background:var(--vp-c-bg-mute);padding:16px;border-radius:8px;">${escapeHtml(e.target.result)}</pre>` }
    reader.readAsText(f.blob)
  }
  showPreview.value = true
}

function closePreview() { showPreview.value = false; previewContent.value = '' }

function escapeHtml(str) {
  const d = document.createElement('div')
  d.textContent = str; return d.innerHTML
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}

// ===== Clipboard Paste =====
async function handlePaste(e) {
  if (getConnectedPeerIds().length === 0) {
    if (roomPeers.value.length > 0) {
      addSystemMsg('⏳ P2P 通道建立中，请稍后再粘贴图片')
    }
    return
  }
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      const ext = blob.type.split('/')[1] || 'png'
      const name = `粘贴图片_${Date.now()}.${ext}`
      const file = new File([blob], name, { type: blob.type })
      const url = URL.createObjectURL(blob)
      chatMessages.value.push({ image: true, url, name })
      addSystemMsg(`📤 正在发送粘贴的图片...`)
      sendFile(file)
      break
    }
  }
}

// ===== Lifecycle =====
onMounted(() => {
  connectSignaling()
  document.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', handlePaste)
  closeAllConnections()
})
</script>

<template>
  <div>
    <h1>📡 文件 &amp; 消息互传</h1>
    <p class="description">创建或加入频道，点对点直连传输文件和消息。支持多人同时在线 Mesh 互联。</p>

    <!-- Room Controls -->
    <div v-if="!showStatus" class="tool-box">
      <label>频道</label>
      <div class="ws-status">
        <span class="ws-dot" :class="wsState"></span>
        <span class="ws-text">{{ wsText }}</span>
      </div>
      <div class="room-controls">
        <button class="btn btn-primary" :disabled="controlsDisabled" @click="createRoom">✨ 创建频道</button>
        <div class="room-divider"><span>或</span></div>
        <div class="room-join-row">
          <input v-model="roomCode" type="text" class="room-code-input" placeholder="频道码" maxlength="4" style="text-transform:uppercase;" :disabled="controlsDisabled">
          <button class="btn btn-secondary" :disabled="controlsDisabled" @click="joinRoom">加入 ➜</button>
        </div>
      </div>
      <div v-if="roomError" class="room-error" v-html="roomError"></div>
      <p class="room-hint">创建频道后分享4位频道码，多人在线自动 Mesh 互联</p>
    </div>

    <!-- Status -->
    <div v-if="showStatus" class="tool-box">
      <div class="status-bar">
        <span class="status-dot" :class="statusState"></span>
        <span v-if="roomBadgeText" class="room-badge">{{ roomBadgeText }}</span>
        <span>{{ statusText }}</span>
        <span v-if="showOnlineTag" class="online-tag">
          <span class="dot"></span>
          <span>{{ onlineCount }} 人在线</span>
        </span>
        <button class="btn btn-small btn-secondary" style="margin-left:auto;" @click="leaveRoom">退出频道</button>
      </div>
    </div>

    <!-- Chat -->
    <div v-if="showStatus" class="tool-box" :style="{ display: showStatus ? 'block' : 'none' }" v-show="true">
      <div ref="messageContainer" class="chat-messages">
        <div v-if="chatMessages.length === 0" class="chat-placeholder">连接成功后即可开始聊天和互传文件 📡</div>
        <div v-for="(msg, i) in chatMessages" :key="i"
          :class="['chat-msg', msg.system ? 'system' : msg.cls]"
        >
          <template v-if="msg.system">{{ msg.text }}</template>
          <template v-else>
            <span class="msg-text">{{ msg.text }}</span>
            <button class="msg-copy" @click="copyText(msg.text)" title="复制">
              <template v-if="copied">✅</template>
              <template v-else>📋</template>
            </button>
          </template>
        </div>
      </div>
      <div class="chat-input-row">
        <input v-model="chatInput" type="text" class="chat-input" placeholder="输入消息... (Ctrl+V 粘贴图片)" :disabled="chatDisabled" @keydown.enter="sendMessage">
        <button class="btn btn-primary" :disabled="chatDisabled" @click="sendMessage">发送</button>
        <button class="btn btn-secondary file-btn" :disabled="chatDisabled" @click="selectFile" title="选择文件发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <span class="paste-badge"><kbd>Ctrl</kbd>+<kbd>V</kbd> 贴图</span>
        <input id="fileInput" type="file" style="display:none" @change="sendFile($event.target.files?.[0])">
      </div>
      <div v-if="fileProgress.show" class="file-progress">
        <div class="file-progress-info">
          <span>{{ fileProgress.name }}</span>
          <span>{{ fileProgress.pct }}%</span>
        </div>
        <div class="file-progress-bar"><div class="file-progress-fill" :style="{ width: fileProgress.pct + '%' }"></div></div>
      </div>
    </div>

    <!-- Shared Files -->
    <div v-if="showShared" class="tool-box">
      <div class="shared-header">
        <label>📁 共享文件</label>
        <span class="shared-count">{{ sharedFiles.length }} 个文件</span>
      </div>
      <div class="shared-list">
        <div v-if="sharedFiles.length === 0" style="color:var(--vp-c-text-3);font-size:14px;">暂无共享文件</div>
        <div v-for="f in [...sharedFiles].reverse()" :key="f.id" class="shared-item">
          <span class="shared-item-icon">{{ f.fileType === 'image' ? '🖼' : f.fileType === 'text' ? '📄' : '📦' }}</span>
          <div class="shared-item-info">
            <div class="shared-item-name">{{ f.name }}</div>
            <div class="shared-item-meta">{{ f.fromMe ? '📤 发出' : '📥 收到' }} · {{ formatSize(f.size) }} · {{ new Date(f.timestamp).toLocaleTimeString() }}</div>
          </div>
          <div class="shared-item-actions">
            <button v-if="f.fileType === 'image' || f.fileType === 'text'" class="btn btn-tiny" @click="previewFile(f.id)">👁 预览</button>
            <button class="btn btn-tiny" @click="downloadFile(f.id)">⬇ 下载</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview Modal -->
    <Teleport to="body">
      <div v-if="showPreview" class="preview-overlay" @click.self="closePreview">
        <div class="preview-modal">
          <div class="preview-header">
            <span class="preview-title">{{ previewTitle }}</span>
            <button class="btn btn-small btn-secondary" @click="closePreview">✕ 关闭</button>
          </div>
          <div class="preview-body" v-html="previewContent"></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
