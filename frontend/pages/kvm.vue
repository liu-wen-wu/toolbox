<script setup>
useHead({ title: 'KVM 屏幕共享 · 测试中' })

// ===== State =====
const myPeerId = ref(null)
const currentRoom = ref(null)
const roomCode = ref('')
const statusText = ref('等待连接...')
const showStatus = ref(false)
const isSharing = ref(false)
const hasRemoteStream = ref(false)
const remoteVideo = ref(null)
const canvasEl = ref(null)
const chatInput = ref('')
const chatMessages = ref([])
const annotTool = ref('pen')
const annotColor = ref('#ff5b4f')
const showChat = ref(false)

// WebRTC state
let ws = null
let wsRetries = 0
const MAX_WS_RETRIES = 5
let peers = {}
let localStream = null
let ctx = null
let isDrawing = false
let lastX = 0, lastY = 0
let remoteCursors = {}
const colors = ['#ff5b4f', '#0a72ef', '#10b981', '#de1d8d', '#f0ad4e', '#ffffff']
const tools = ['pen', 'arrow', 'rect', 'circle', 'text', 'eraser']

const STUN = {
  iceServers: [
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.miwifi.com' },
    { urls: 'stun:stun.l.google.com:19302' },
  ]
}

// ===== Signaling =====
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws`)
  ws.onopen = () => { wsRetries = 0 }
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      handleSignal(msg)
    } catch {}
  }
  ws.onclose = () => {
    if (wsRetries < MAX_WS_RETRIES) {
      wsRetries++
      setTimeout(connect, Math.min(1000 * Math.pow(2, wsRetries), 10000))
    }
  }
}

function handleSignal(msg) {
  switch (msg.type) {
    case 'room-created':
      myPeerId.value = msg.peerId
      currentRoom.value = msg.room
      roomCode.value = msg.room
      showStatus.value = true
      statusText.value = `等待其他人加入... (#${msg.peerId})`
      break
    case 'joined':
      myPeerId.value = msg.peerId
      currentRoom.value = msg.room
      roomCode.value = msg.room
      showStatus.value = true
      statusText.value = '已加入'
      for (const p of (msg.peers || [])) initPeer(p.id)
      break
    case 'peer-joined':
      initPeer(msg.peerId)
      break
    case 'peer-left':
      removePeer(msg.peerId)
      break
    case 'signal':
      handlePeerSignal(msg.from, msg.data)
      break
  }
}

function wsSend(obj) { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)) }

// ===== Peer Management =====
function initPeer(peerId) {
  if (peers[peerId] || peerId === myPeerId.value) return
  const myId = parseInt(myPeerId.value)
  const theirId = parseInt(peerId)
  const createOffer = myId < theirId
  const pc = new RTCPeerConnection(STUN)
  peers[peerId] = { pc, dc: null, state: 'connecting' }

  pc.onicecandidate = (e) => { if (e.candidate) wsSend({ type: 'signal', data: { candidate: e.candidate.toJSON() } }) }

  pc.ontrack = (e) => {
    hasRemoteStream.value = true
    if (remoteVideo.value) remoteVideo.value.srcObject = e.streams[0]
  }

  pc.ondatachannel = (e) => setupDC(e.channel, peerId)

  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream)
  }

  if (createOffer) {
    const dc = pc.createDataChannel('kvm', { ordered: false })
    peers[peerId].dc = dc
    setupDC(dc, peerId)
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => wsSend({ type: 'signal', data: pc.localDescription }))
  }
}

function setupDC(dc, peerId) {
  dc.onopen = () => { peers[peerId].state = 'connected'; addChatMsg('system', `与 #${peerId} 连接`) }
  dc.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data)
      if (msg.t === 'm') addChatMsg('remote', `#${peerId}: ${msg.d}`)
      else if (msg.t === 'cursor') drawRemoteCursor(peerId, msg.x, msg.y)
      else if (msg.t === 'annot') drawRemoteAnnot(msg)
    }
  }
}

function handlePeerSignal(from, data) {
  if (!peers[from]) {
    peers[from] = { pc: null, dc: null, state: 'connecting' }
    const pc = new RTCPeerConnection(STUN)
    peers[from].pc = pc
    pc.onicecandidate = (e) => { if (e.candidate) wsSend({ type: 'signal', data: { candidate: e.candidate.toJSON() } }) }
    pc.ontrack = (e) => { hasRemoteStream.value = true; if (remoteVideo.value) remoteVideo.value.srcObject = e.streams[0] }
    pc.ondatachannel = (e) => setupDC(e.channel, from)
    if (localStream) { for (const t of localStream.getTracks()) pc.addTrack(t, localStream) }
  }
  const pc = peers[from].pc
  if (!pc) return
  if (data.type === 'offer') {
    pc.setRemoteDescription(new RTCSessionDescription(data))
      .then(() => pc.createAnswer())
      .then(a => pc.setLocalDescription(a))
      .then(() => wsSend({ type: 'signal', data: pc.localDescription }))
  } else if (data.type === 'answer') {
    pc.setRemoteDescription(new RTCSessionDescription(data))
  } else if (data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate))
  }
}

function removePeer(peerId) {
  if (peers[peerId]) {
    peers[peerId].dc?.close()
    peers[peerId].pc?.close()
    delete peers[peerId]
  }
  if (Object.keys(peers).length === 0) {
    hasRemoteStream.value = false
    if (remoteVideo.value) remoteVideo.value.srcObject = null
  }
}

function broadcast(obj) {
  for (const pid in peers) {
    if (peers[pid].dc?.readyState === 'open') {
      try { peers[pid].dc.send(JSON.stringify(obj)) } catch {}
    }
  }
}

// ===== Screen Sharing =====
async function startScreenShare() {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    isSharing.value = true
    // Add tracks to all existing peer connections
    for (const pid in peers) {
      const pc = peers[pid].pc
      if (pc) {
        for (const track of localStream.getTracks()) pc.addTrack(track, localStream)
      }
    }
    localStream.getVideoTracks()[0].onended = () => stopScreenShare()
  } catch { /* cancelled */ }
}

function stopScreenShare() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop())
    localStream = null
  }
  isSharing.value = false
}

// ===== Room =====
function createRoom() {
  wsSend({ type: 'create-room' })
}
function joinRoom() {
  if (roomCode.value.length === 4) wsSend({ type: 'join-room', room: roomCode.value.toUpperCase() })
}
function leaveRoom() {
  stopScreenShare()
  wsSend({ type: 'leave-room' })
  for (const pid in peers) { peers[pid].dc?.close(); peers[pid].pc?.close() }
  peers = {}
  myPeerId.value = null
  currentRoom.value = null
  showStatus.value = false
  hasRemoteStream.value = false
}

// ===== Canvas =====
function initCanvas() {
  if (!canvasEl.value) return
  ctx = canvasEl.value.getContext('2d')
  resizeCanvas()
}

function resizeCanvas() {
  if (!canvasEl.value) return
  const parent = canvasEl.value.parentElement
  canvasEl.value.width = parent.clientWidth
  canvasEl.value.height = parent.clientHeight
}

function getPos(e) {
  const rect = canvasEl.value.getBoundingClientRect()
  const x = (e.clientX - rect.left) * (canvasEl.value.width / rect.width)
  const y = (e.clientY - rect.top) * (canvasEl.value.height / rect.height)
  return { x, y }
}

function startDraw(e) {
  isDrawing = true
  const pos = getPos(e)
  lastX = pos.x; lastY = pos.y
}

function draw(e) {
  if (!isDrawing || !ctx) return
  const pos = getPos(e)
  ctx.strokeStyle = annotColor.value
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(lastX, lastY)
  ctx.lineTo(pos.x, pos.y)
  ctx.stroke()
  broadcast({ t: 'annot', tool: 'pen', x1: lastX, y1: lastY, x2: pos.x, y2: pos.y, color: annotColor.value })
  lastX = pos.x; lastY = pos.y
}

function endDraw() { isDrawing = false }

function handleMouseMove(e) {
  const pos = getPos(e)
  broadcast({ t: 'cursor', x: pos.x, y: pos.y })
}

function drawRemoteCursor(peerId, x, y) {
  // Simple cursor indicator
  remoteCursors[peerId] = { x, y }
}

function drawRemoteAnnot(msg) {
  if (!ctx) return
  ctx.strokeStyle = msg.color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(msg.x1, msg.y1)
  ctx.lineTo(msg.x2, msg.y2)
  ctx.stroke()
}

function clearCanvas() {
  if (!ctx) return
  ctx.clearRect(0, 0, canvasEl.value.width, canvasEl.value.height)
}

// ===== Chat =====
function addChatMsg(type, text) {
  chatMessages.value.push({ type, text })
}

function sendChatMsg() {
  const text = chatInput.value.trim()
  if (!text) return
  broadcast({ t: 'm', d: text })
  addChatMsg('self', `你: ${text}`)
  chatInput.value = ''
}

function toggleChat() { showChat.value = !showChat.value }

// ===== Lifecycle =====
onMounted(() => {
  connect()
  setTimeout(() => {
    initCanvas()
    resizeCanvas()
  }, 500)
  window.addEventListener('resize', resizeCanvas)
})

onUnmounted(() => {
  stopScreenShare()
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <div>
    <div class="kvm-header">
      <div>
        <h1 data-index="08">KVM 屏幕共享 <span class="test-badge">BETA</span></h1>
        <p>共享屏幕 + 远程光标 + 画板标注，WebRTC 点对点直连</p>
      </div>
    </div>

    <!-- Room Controls -->
    <div v-if="!showStatus" class="tool-box">
      <div class="room-section">
        <button class="btn btn-primary" @click="createRoom">创建房间</button>
        <div class="room-divider"><span>或</span></div>
        <input v-model="roomCode" type="text" class="room-code-input" placeholder="频道码" maxlength="4" style="text-transform:uppercase;">
        <button class="btn btn-secondary" @click="joinRoom">加入</button>
      </div>
      <p class="room-hint">创建房间后分享4位频道码，对方加入观看屏幕</p>
    </div>

    <!-- Status -->
    <div v-if="showStatus" class="tool-box" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span class="room-badge">#{{ roomCode }}</span>
      <span>{{ statusText }}</span>
      <button v-if="!isSharing" class="btn btn-primary" @click="startScreenShare">共享屏幕</button>
      <button v-if="isSharing" class="btn btn-secondary" @click="stopScreenShare" style="color:var(--vp-c-red);">停止共享</button>
      <button class="btn btn-secondary" @click="toggleChat">聊天</button>
      <button class="btn btn-small btn-secondary" style="margin-left:auto;" @click="leaveRoom">退出房间</button>
    </div>

    <!-- Main Area -->
    <div style="display:flex;gap:16px;">
      <!-- Canvas + Video -->
      <div style="flex:1;min-width:0;">
        <div class="canvas-container">
          <video v-if="hasRemoteStream" ref="remoteVideo" autoplay playsinline></video>
          <div v-if="!hasRemoteStream && !isSharing" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--vp-c-text-3);font-size:14px;">
            等待屏幕共享...
          </div>
          <canvas
            ref="canvasEl"
            @mousedown="startDraw"
            @mousemove="handleMouseMove"
            @mouseup="endDraw"
            @mouseleave="endDraw"
            style="position:absolute;inset:0;cursor:crosshair;"
          ></canvas>
        </div>

        <!-- Annotation Toolbar -->
        <div class="tool-box" style="margin-top:12px;padding:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button v-for="tool in tools" :key="tool"
            :class="['btn btn-tiny', annotTool === tool ? 'btn-primary' : 'btn-secondary']"
            @click="annotTool = tool">
            {{ {pen:'笔',arrow:'箭头',rect:'方框',circle:'圆圈',text:'文字',eraser:'橡皮'}[tool] }}
          </button>
          <span style="margin:0 4px;color:var(--vp-c-text-3);">|</span>
          <button v-for="c in colors" :key="c"
            :style="{ background: c, width: '22px', height: '22px', borderRadius: '50%', border: annotColor === c ? '2px solid var(--vp-c-brand)' : '2px solid var(--vp-c-border)', cursor: 'pointer' }"
            @click="annotColor = c"
          ></button>
          <span style="margin:0 4px;color:var(--vp-c-text-3);">|</span>
          <button class="btn btn-tiny btn-secondary" @click="clearCanvas">清空</button>
        </div>
      </div>

      <!-- Chat Panel -->
      <div v-if="showChat" class="tool-box" style="width:280px;flex-shrink:0;display:flex;flex-direction:column;">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px;">聊天</div>
        <div class="chat-messages" style="flex:1;">
          <div v-for="(m,i) in chatMessages" :key="i" class="chat-msg system" v-text="m.text"></div>
        </div>
        <div class="chat-input-row" style="margin-top:8px;">
          <input v-model="chatInput" class="chat-input" placeholder="发送消息..." @keydown.enter="sendChatMsg">
          <button class="btn btn-primary btn-small" @click="sendChatMsg">发送</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-badge {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  padding: 2px 10px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: var(--radius-pill, 9999px);
  color: #b45309;
  vertical-align: middle;
  margin-left: 8px;
}
</style>
