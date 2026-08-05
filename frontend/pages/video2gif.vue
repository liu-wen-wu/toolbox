<script setup>
useHead({ title: 'MP4 转动图' })

const fileInput = ref(null)
const dragOver = ref(false)
const error = ref('')
const converting = ref(false)
const uploadPct = ref(0)
const phase = ref('idle') // idle | uploading | converting | done

// Original video
const original = ref(null) // { file, url, duration, width, height }
// Converted result
const result = ref(null) // { blob, url, size, info }

const settings = ref({
  fmt: 'gif',
  fps: 10,
  width: 640,
  lossless: false,
  quality: 75,
})

const fmtOptions = [
  { value: 'gif', label: 'GIF 动图' },
  { value: 'webp', label: '动画 WebP' },
]
const widthOptions = [
  { value: 0, label: '原尺寸 (≤1280)' },
  { value: 240, label: '240 px' },
  { value: 360, label: '360 px' },
  { value: 480, label: '480 px' },
  { value: 640, label: '640 px' },
  { value: 960, label: '960 px' },
]

const MAX_BYTES = 100 * 1024 * 1024
const MAX_DURATION = 120

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}
function formatDuration(secs) {
  if (secs == null) return '--'
  if (secs < 60) return secs.toFixed(1) + 's'
  return Math.floor(secs / 60) + 'm' + Math.round(secs % 60) + 's'
}

function onDragOver(e) { e.preventDefault(); dragOver.value = true }
function onDragLeave() { dragOver.value = false }
function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  const files = e.dataTransfer.files
  if (files.length) loadVideo(files[0])
}
function onFileSelect(e) {
  const files = e.target.files
  if (files.length) loadVideo(files[0])
  e.target.value = ''
}
function triggerFilePicker() {
  if (fileInput.value) {
    fileInput.value.value = ''
    fileInput.value.click()
  }
}

async function loadVideo(file) {
  if (!/video\/mp4|\.mp4$/i.test(file.type + file.name)) {
    error.value = '请选择 MP4 视频文件'
    return
  }
  if (file.size > MAX_BYTES) {
    error.value = '文件超过 100MB 上限'
    return
  }
  error.value = ''
  result.value = null
  phase.value = 'idle'
  uploadPct.value = 0

  // 读取时长/分辨率 (本地元数据, 提前拦截超长视频)
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  const meta = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000)
    video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }) }
    video.onerror = () => { clearTimeout(timer); resolve(null) }
    video.src = url
  })
  if (!meta) {
    URL.revokeObjectURL(url)
    error.value = '无法读取视频信息，请确认是有效的 MP4'
    return
  }
  if (meta.duration > MAX_DURATION) {
    URL.revokeObjectURL(url)
    error.value = `视频过长（${Math.round(meta.duration)}s），最大支持 ${MAX_DURATION} 秒`
    return
  }
  original.value = { file, url, size: file.size, ...meta }
  convert()
}

async function convert() {
  if (!original.value || converting.value) return
  error.value = ''
  result.value = null
  converting.value = true
  phase.value = 'extracting'
  uploadPct.value = 0
  convPct.value = 0
  framePct.value = 0

  const s = settings.value
  // 前端生成 jobId, 服务端用它登记转换进度 (轮询用)
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  const params = new URLSearchParams({
    fmt: s.fmt,
    fps: String(s.fps),
    width: String(s.width),
    lossless: s.lossless ? '1' : '0',
    quality: String(s.quality),
    job: jobId,
  })

  startPolling(jobId)

  try {
    // 优先浏览器抽帧 (上传量小 20 倍, 服务器免解码); 失败回退整文件上传
    let body, ctype
    try {
      const frames = await extractFrames(original.value.file, s.fps, s.width, s.lossless)
      body = frames.blob
      ctype = 'application/octet-stream'
      if (body.size < original.value.size) {
        phase.value = 'uploading'
        uploadPct.value = 0
        const blob = await uploadXhr('/api/video2gif/frames?' + params.toString(), ctype, body)
        const url = URL.createObjectURL(blob)
        result.value = { blob, url, size: blob.size }
        phase.value = 'done'
        return
      }
      // 帧包反而更大 (极短视频) → 走整文件
      console.log('[video2gif] frames bigger than source, fallback to full upload')
    } catch (e) {
      console.log('[video2gif] extract fail, fallback:', e.message)
    }

    phase.value = 'uploading'
    uploadPct.value = 0
    const blob = await uploadXhr('/api/video2gif?' + params.toString(), original.value.file.type || 'video/mp4', original.value.file)
    const url = URL.createObjectURL(blob)
    result.value = { blob, url, size: blob.size }
    phase.value = 'done'
  } catch (e) {
    error.value = e.message || '转换失败'
    phase.value = 'idle'
  } finally {
    converting.value = false
    stopPolling()
  }
}

// 统一上传 (返回响应 blob, 错误解析 JSON)
function uploadXhr(url, contentType, body) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.responseType = 'blob'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        uploadPct.value = e.loaded / e.total
        if (uploadPct.value >= 1) phase.value = 'converting'
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
      else {
        xhr.response.text().then(t => {
          let msg = '转换失败'
          try { msg = JSON.parse(t).error || msg } catch {}
          reject(new Error(msg))
        }).catch(() => reject(new Error('转换失败')))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误，请重试'))
    xhr.send(body)
  })
}

// ---- 浏览器抽帧: 播放视频按 fps 抽帧, 打包为 [u32BE 帧长][帧数据]... ----
const framePct = ref(0)

function extractFrames(file, fps, width, lossless) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    const parts = []
    let count = 0
    let lastTime = -1
    let busy = false
    let pending = 0
    let done = false

    const calcSize = (vw, vh) => {
      let w = width > 0 ? Math.min(width, vw) : Math.min(vw, 1280)
      let h = Math.round(w * vh / vw)
      if (h % 2) h++
      return { w, h }
    }

    const grab = async () => {
      pending++
      try {
        const { w, h } = calcSize(video.videoWidth, video.videoHeight)
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        ctx.drawImage(video, 0, 0, w, h)
        const blob = await new Promise(r => canvas.toBlob(r, lossless ? 'image/png' : 'image/jpeg', lossless ? undefined : 0.9))
        if (!blob) return
        const head = new Uint8Array(4)
        new DataView(head.buffer).setUint32(0, blob.size)
        parts.push(head, blob)
        count++
        framePct.value = Math.min(99, Math.round(count / (video.duration * fps) * 100))
      } finally {
        pending--
      }
    }

    video.ontimeupdate = () => {
      if (done || busy) return
      if (video.currentTime - lastTime >= 1 / fps) {
        lastTime = video.currentTime
        busy = true
        grab().finally(() => { busy = false })
      }
    }

    video.onloadedmetadata = () => {
      if (video.duration > MAX_DURATION) {
        URL.revokeObjectURL(url)
        reject(new Error(`视频过长（${Math.round(video.duration)}s）`))
      }
      video.play().catch(() => {
        URL.revokeObjectURL(url)
        reject(new Error('浏览器无法播放该视频，已回退整文件上传'))
      })
    }

    const finish = () => {
      if (done) return
      done = true
      video.pause()
      URL.revokeObjectURL(url)
      const blob = new Blob(parts, { type: 'application/octet-stream' })
      resolve({ blob, count })
    }

    video.onended = async () => {
      if (video.currentTime - lastTime >= 0.3) await grab() // 补最后一帧
      while (pending > 0) await new Promise(r => setTimeout(r, 50))
      finish()
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('视频解码失败'))
    }

    // 超时保护: 视频时长 + 45s
    setTimeout(() => {
      if (!done) {
        video.pause()
        URL.revokeObjectURL(url)
        reject(new Error('抽帧超时'))
      }
    }, (Math.min(file.size / 1024, 120) * 1000) + 45000)
  })
}

// ---- 转换进度轮询 ----
const convPct = ref(0)
let pollTimer = null

const barWidth = computed(() => {
  if (phase.value === 'extracting') return framePct.value
  if (phase.value === 'uploading') return Math.round(uploadPct.value * 100)
  return convPct.value
})

function startPolling(jobId) {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const r = await fetch(`/api/video2gif/progress?job=${jobId}`, { cache: 'no-store' })
      if (!r.ok) return // 404 → job 已清理, 等 XHR 结果即可
      const d = await r.json()
      convPct.value = d.progress || 0
      if (d.status === 'converting' && phase.value === 'uploading') phase.value = 'converting'
    } catch { /* 网络抖动忽略 */ }
  }, 500)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

onUnmounted(stopPolling)

function download() {
  if (!result.value) return
  const a = document.createElement('a')
  a.href = result.value.url
  const base = original.value.file.name.replace(/\.[^.]+$/, '')
  a.download = `${base}-anim.${settings.value.fmt}`
  a.click()
}

function getSavings() {
  if (!original.value || !result.value) return null
  const savings = original.value.size - result.value.size
  const percent = ((savings / original.value.size) * 100).toFixed(1)
  return { bytes: savings, percent }
}

const showQuality = computed(() => settings.value.fmt === 'webp' && !settings.value.lossless)
const fmtHint = computed(() => {
  if (settings.value.fmt === 'gif') return 'GIF 为 256 色索引格式，已启用两遍高质量调色板 + Sierra 抖动；追求极致清晰建议选 WebP'
  return settings.value.lossless
    ? '无损 WebP 完全保留画面细节，但体积较大；动图场景推荐有损模式'
    : '动画 WebP 支持真彩色，同清晰度下体积通常比 GIF 小 40-60%'
})
</script>

<template>
  <div>
    <h1 data-index="06">MP4 转动图</h1>
    <p class="description">将 MP4 视频转换为 GIF 或动画 WebP，服务端 ffmpeg 高效转换，WebP 支持无损模式。</p>

    <!-- Drop Zone -->
    <div
      v-if="!original"
      class="drop-zone"
      :class="{ 'drag-over': dragOver }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="triggerFilePicker"
    >
      <div class="drop-icon">MP4</div>
      <div class="drop-text">拖拽视频到此处，或点击选择文件</div>
      <div class="drop-hint">支持 MP4 · 最长 120 秒 · 最大 100MB</div>
    </div>
    <!-- Hidden file input: always in DOM -->
    <input ref="fileInput" type="file" accept="video/mp4,video/*" style="display:none" @change="onFileSelect">

    <!-- Error -->
    <div v-if="error" class="inline-error">{{ error }}</div>

    <template v-if="original">
      <!-- Original file info -->
      <div class="tool-box file-info">
        <span class="fi-name">{{ original.file.name }}</span>
        <span class="fi-sep">·</span>
        <span>{{ formatSize(original.size) }}</span>
        <span class="fi-sep">·</span>
        <span>{{ original.width }} × {{ original.height }}</span>
        <span class="fi-sep">·</span>
        <span>{{ formatDuration(original.duration) }}</span>
        <span class="fi-actions">
          <button class="btn btn-secondary btn-small" @click="triggerFilePicker">更换视频</button>
        </span>
      </div>

      <!-- Settings -->
      <div class="tool-box">
        <label>转换设置</label>
        <div class="settings-grid">
          <div class="setting-item">
            <span class="setting-label">输出格式</span>
            <select v-model="settings.fmt" class="input setting-select">
              <option v-for="f in fmtOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </div>
          <div class="setting-item">
            <span class="setting-label">帧率 FPS</span>
            <div class="slider-row">
              <input type="range" v-model.number="settings.fps" min="1" max="30" class="slider">
              <span class="slider-val">{{ settings.fps }}</span>
            </div>
            <span class="setting-unit">动图常用 10-15，越低体积越小</span>
          </div>
          <div class="setting-item">
            <span class="setting-label">输出宽度</span>
            <select v-model.number="settings.width" class="input setting-select">
              <option v-for="w in widthOptions" :key="w.value" :value="w.value">{{ w.label }}</option>
            </select>
          </div>
          <div class="setting-item" v-if="settings.fmt === 'webp'">
            <span class="setting-label">无损模式</span>
            <label class="toggle-row">
              <input type="checkbox" v-model="settings.lossless" class="toggle-input">
              <span class="toggle-box"></span>
              <span>{{ settings.lossless ? '已开启 · 完全保留细节' : '已关闭 · 有损压缩' }}</span>
            </label>
          </div>
          <div class="setting-item" v-if="showQuality">
            <span class="setting-label">质量</span>
            <div class="slider-row">
              <input type="range" v-model.number="settings.quality" min="1" max="100" class="slider">
              <span class="slider-val">{{ settings.quality }}</span>
            </div>
          </div>
        </div>
        <p class="fmt-hint">{{ fmtHint }}</p>
      </div>

      <!-- Converting State -->
      <div v-if="converting" class="tool-box" style="text-align:center;padding:40px;">
        <div class="spin-icon"></div>
        <p style="margin-top:12px;color:var(--vp-c-text-3);font-size:14px;">
          <template v-if="phase === 'extracting'">正在解析视频 {{ framePct }}%（浏览器本地）</template>
          <template v-else-if="phase === 'uploading'">正在上传 {{ Math.round(uploadPct * 100) }}%</template>
          <template v-else>正在转换 {{ convPct }}% ...</template>
        </p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: barWidth + '%' }"></div>
        </div>
        <p class="conv-info">
          原始 {{ formatSize(original.size) }} · {{ formatDuration(original.duration) }} · {{ original.width }}×{{ original.height }}
          → {{ settings.fmt === 'gif' ? 'GIF' : 'WebP' }} {{ settings.fps }}fps
        </p>
      </div>

      <!-- Comparison -->
      <template v-if="!converting">
        <div class="compare-grid">
          <div class="tool-box compare-card">
            <label>原始视频</label>
            <div class="img-wrap">
              <video :src="original.url" muted controls playsinline></video>
            </div>
            <div class="img-meta">
              <span>{{ original.width }} × {{ original.height }}</span>
              <span class="meta-dot">·</span>
              <span>{{ formatDuration(original.duration) }}</span>
              <span class="meta-dot">·</span>
              <span>{{ formatSize(original.size) }}</span>
            </div>
          </div>

          <div class="tool-box compare-card" v-if="result">
            <label>转换结果</label>
            <div class="img-wrap">
              <img :src="result.url" alt="converted animation">
            </div>
            <div class="img-meta">
              <span>{{ settings.fmt.toUpperCase() }}</span>
              <span class="meta-dot">·</span>
              <span>{{ settings.fps }} fps</span>
              <span class="meta-dot">·</span>
              <span>{{ formatSize(result.size) }}</span>
            </div>
            <div class="savings" v-if="getSavings().bytes > 0">
              <span class="savings-pct">-{{ getSavings().percent }}%</span>
              <span class="savings-abs">(节省 {{ formatSize(getSavings().bytes) }})</span>
            </div>
            <div class="savings savings-negative" v-else>
              <span class="savings-pct">+{{ (-getSavings().percent).toFixed(1) }}%</span>
              <span class="savings-abs">(增加了 {{ formatSize(-getSavings().bytes) }})</span>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="action-bar" v-if="result">
          <button class="btn btn-primary" @click="download">
            下载{{ settings.fmt === 'gif' ? ' GIF' : ' WebP' }}
          </button>
          <button class="btn btn-secondary" @click="convert" :disabled="converting">
            按当前设置重新转换
          </button>
          <button class="btn btn-secondary" @click="triggerFilePicker">
            选择其他视频
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.drop-zone {
  border: 2px dashed var(--vp-c-border);
  border-radius: var(--radius-lg);
  padding: 60px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--vp-c-bg-elevated);
  margin-bottom: 16px;
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
}
.drop-icon {
  font-size: 34px;
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
  opacity: 0.6;
}
.drop-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}
.drop-hint {
  font-size: 12px;
  color: var(--vp-c-text-4);
  margin-top: 8px;
}

.file-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--vp-c-text-2);
  padding: 12px 16px;
  margin-bottom: 16px;
}
.fi-name {
  font-weight: 600;
  color: var(--vp-c-text-1);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fi-sep {
  color: var(--vp-c-text-4);
}
.fi-actions {
  margin-left: auto;
}

.conv-info {
  margin-top: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--vp-c-text-4);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}
.setting-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.setting-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-3);
}
.setting-select { width: 100%; }
.setting-unit {
  font-size: 11px;
  color: var(--vp-c-text-4);
}
.fmt-hint {
  margin-top: 14px;
  font-size: 12px;
  color: var(--vp-c-text-4);
  border-top: 1px solid var(--vp-c-border);
  padding-top: 12px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: var(--vp-c-bg-mute);
  border-radius: 2px;
  outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vp-c-brand);
  cursor: pointer;
  border: none;
}
.slider-val {
  min-width: 28px;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--vp-c-text-2);
  text-align: center;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--vp-c-text-2);
  user-select: none;
}
.toggle-input {
  display: none;
}
.toggle-box {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--vp-c-bg-mute);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle-box::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--vp-c-text-2);
  transition: all 0.2s;
}
.toggle-input:checked + .toggle-box {
  background: var(--vp-c-brand);
}
.toggle-input:checked + .toggle-box::after {
  left: 18px;
  background: #fff;
}

.progress-bar {
  margin: 14px auto 0;
  max-width: 320px;
  height: 4px;
  border-radius: 2px;
  background: var(--vp-c-bg-mute);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--vp-c-brand);
  transition: width 0.15s;
}

.compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 768px) {
  .compare-grid {
    grid-template-columns: 1fr;
  }
}
.compare-card {
  display: flex;
  flex-direction: column;
  margin-bottom: 0;
}
.compare-card label { margin-bottom: 12px; }
.img-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  background: var(--vp-c-bg);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.img-wrap video,
.img-wrap img {
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
}
.img-meta {
  margin-top: 10px;
  font-size: 13px;
  color: var(--vp-c-text-3);
  font-family: var(--font-mono);
}
.meta-dot {
  padding: 0 4px;
  color: var(--vp-c-text-4);
}
.savings {
  margin-top: 6px;
  font-size: 13px;
}
.savings-pct {
  font-weight: 600;
  color: var(--vp-c-green);
}
.savings-abs {
  color: var(--vp-c-text-3);
  margin-left: 4px;
}
.savings-negative .savings-pct {
  color: var(--vp-c-yellow);
}

.action-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.inline-error {
  margin-bottom: 16px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--vp-c-red) 8%, transparent);
  border-radius: var(--radius-md);
  color: var(--vp-c-red);
  font-size: 13px;
}
</style>
