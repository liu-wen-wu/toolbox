<script setup>
useHead({ title: 'MP4 转动图' })

const fileInput = ref(null)
const dragOver = ref(false)
const error = ref('')
const converting = ref(false)
const uploadPct = ref(0)
const convPct = ref(0)
// idle | uploading | parsing | ready | converting | done
const phase = ref('idle')
const fileId = ref('')         // 服务器保存的上传文件 ID (转换复用, 重转不重传)
const uploadFailed = ref(false)

// Original video: 本地预览 + 服务器解析的元数据 (duration/width/height/fps 解析后填充)
const original = ref(null)
// Converted result
const result = ref(null) // { blob, url, size, info }

// 输出帧率上限: 不超过源视频帧率 (源帧率未知时按 30)
const maxFps = computed(() => {
  const src = original.value && original.value.fps
  if (!src) return 30
  return Math.min(30, Math.max(1, Math.round(src)))
})

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

// 竞态保护: 换文件/重传时使旧请求结果作废
let reqToken = 0

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

// 步骤 0: 本地校验 → 记录文件 → 自动进入上传
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
  converting.value = false
  stopPolling()
  uploadFailed.value = false
  fileId.value = ''
  uploadPct.value = 0
  convPct.value = 0
  const token = ++reqToken
  original.value = { file, url: URL.createObjectURL(file), size: file.size }
  await uploadFile(token)
}

// 步骤 1: 上传 (独立进度, 完成后服务器保存文件并返回 fileId)
async function uploadFile(token = reqToken) {
  if (!original.value) return
  error.value = ''
  uploadFailed.value = false
  uploadPct.value = 0
  phase.value = 'uploading'
  try {
    const d = await uploadXhrJson('/api/video2gif/upload', original.value.file.type || 'video/mp4', original.value.file)
    if (token !== reqToken) return // 已被新选择取代
    fileId.value = d.fileId
    await parseVideo(token)
  } catch (e) {
    if (token !== reqToken) return
    error.value = e.message || '上传失败，请重试'
    uploadFailed.value = true
    phase.value = 'idle'
  }
}

// 步骤 2: 解析 (服务器 ffmpeg 探测时长/分辨率)
async function parseVideo(token) {
  phase.value = 'parsing'
  try {
    const r = await fetch(`/api/video2gif/parse?file=${encodeURIComponent(fileId.value)}`, { cache: 'no-store' })
    const d = await r.json().catch(() => ({}))
    if (token !== reqToken) return
    if (!r.ok) throw new Error(d.error || '解析失败')
    original.value.duration = d.duration
    original.value.width = d.width
    original.value.height = d.height
    original.value.fps = d.fps
    // 输出帧率不能超过源视频帧率, 自动钳制
    if (settings.value.fps > maxFps.value) settings.value.fps = maxFps.value
    phase.value = 'ready'
  } catch (e) {
    if (token !== reqToken) return
    error.value = e.message || '解析失败，请重新选择视频'
    uploadFailed.value = true
    phase.value = 'idle'
  }
}

// 步骤 3: 转换 (复用已上传文件, 参数调整后重转无需重新上传)
async function convert() {
  if (!fileId.value || converting.value) return
  error.value = ''
  result.value = null
  converting.value = true
  convPct.value = 0
  phase.value = 'converting'
  const s = settings.value
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  const token = reqToken
  startPolling(jobId)
  try {
    const blob = await postJsonBlob('/api/video2gif/convert', {
      file: fileId.value,
      fmt: s.fmt,
      fps: s.fps,
      width: s.width,
      lossless: s.lossless,
      quality: s.quality,
      job: jobId,
    })
    if (token !== reqToken) return // 转换期间已更换视频, 结果作废
    const url = URL.createObjectURL(blob)
    result.value = { blob, url, size: blob.size }
    phase.value = 'done'
  } catch (e) {
    if (token !== reqToken) return // 转换期间已更换视频, 忽略失败
    error.value = e.message || '转换失败'
    phase.value = 'ready'
  } finally {
    if (token === reqToken) {
      converting.value = false
      stopPolling()
    }
  }
}

// 上传 → JSON 响应 (上传进度写入 uploadPct)
function uploadXhrJson(url, contentType, body) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) uploadPct.value = e.loaded / e.total
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
      else reject(new Error((xhr.response && xhr.response.error) || '上传失败'))
    }
    xhr.onerror = () => reject(new Error('网络错误，请重试'))
    xhr.send(body)
  })
}

// POST JSON → 文件 blob (错误解析 JSON)
function postJsonBlob(url, data) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.responseType = 'blob'
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
    xhr.send(JSON.stringify(data))
  })
}

// ---- 转换进度轮询 ----
let pollTimer = null

const barWidth = computed(() => {
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

// 配置变更后: 旧转换结果失效, 回到就绪态 (文件已上传, 无需重传)
watch(settings, () => {
  if (converting.value) return
  if (result.value) result.value = null
  if (phase.value === 'done') phase.value = 'ready'
}, { deep: true })

// 源帧率变化 (新视频解析完成) 后, 确保输出帧率不超上限
watch(maxFps, (m) => {
  if (settings.value.fps > m) settings.value.fps = m
})

// 释放旧预览 URL
watch(original, (nv, ov) => {
  if (ov && ov.url) URL.revokeObjectURL(ov.url)
})
</script>

<template>
  <div>
    <h1 data-index="06">MP4 转动图</h1>
    <p class="description">将 MP4 视频转换为 GIF 或动画 WebP。上传 → 解析 → 转换 三步独立，文件只需上传一次，调整参数后重新转换无需重复上传。</p>

    <!-- Settings (始终可见, 先选配置) -->
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
            <input type="range" v-model.number="settings.fps" min="1" :max="maxFps" class="slider">
            <span class="slider-val">{{ settings.fps }}</span>
          </div>
          <span class="setting-unit">
            <template v-if="original && original.fps">源视频 {{ Math.round(original.fps) }}fps · 输出上限 {{ maxFps }}fps · 越低体积越小</template>
            <template v-else>动图常用 10-15，越低体积越小</template>
          </span>
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
      <div class="drop-hint">支持 MP4 · 最长 120 秒 · 最大 100MB · 上传后自动解析</div>
    </div>
    <!-- Hidden file input: always in DOM -->
    <input ref="fileInput" type="file" accept="video/mp4,video/*" style="display:none" @change="onFileSelect">

    <!-- Error -->
    <div v-if="error" class="inline-error">{{ error }}</div>

    <template v-if="original">
      <!-- File info bar -->
      <div class="tool-box file-info">
        <span class="fi-name">{{ original.file.name }}</span>
        <span class="fi-sep">·</span>
        <span>{{ formatSize(original.size) }}</span>
        <template v-if="original.duration != null">
          <span class="fi-sep">·</span>
          <span>{{ original.width }} × {{ original.height }}</span>
          <span class="fi-sep">·</span>
          <span>{{ formatDuration(original.duration) }}</span>
          <template v-if="original.fps">
            <span class="fi-sep">·</span>
            <span>{{ Math.round(original.fps) }} fps</span>
          </template>
        </template>
        <span class="fi-actions">
          <button v-if="uploadFailed" class="btn btn-secondary btn-small" @click="uploadFile()">重试上传</button>
          <button class="btn btn-secondary btn-small" @click="triggerFilePicker">更换视频</button>
        </span>
      </div>

      <!-- 上传中 -->
      <div v-if="phase === 'uploading'" class="tool-box" style="text-align:center;padding:40px;">
        <div class="spin-icon"></div>
        <p style="margin-top:12px;color:var(--vp-c-text-3);font-size:14px;">
          正在上传视频 {{ Math.round(uploadPct * 100) }}%
        </p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: barWidth + '%' }"></div>
        </div>
        <p class="conv-info">上传完成后自动解析视频信息</p>
      </div>

      <!-- 解析中 -->
      <div v-if="phase === 'parsing'" class="tool-box" style="text-align:center;padding:40px;">
        <div class="spin-icon"></div>
        <p style="margin-top:12px;color:var(--vp-c-text-3);font-size:14px;">正在解析视频信息（时长 / 分辨率）...</p>
        <p class="conv-info">解析完成后即可调整参数并转换，无需重复上传</p>
      </div>

      <!-- 就绪: 原视频预览 + 开始转换 -->
      <template v-if="phase === 'ready'">
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
        <div class="action-bar">
          <button class="btn btn-primary" @click="convert">
            开始转换
          </button>
          <button class="btn btn-secondary" @click="triggerFilePicker">
            更换视频
          </button>
        </div>
      </template>

      <!-- 转换中 -->
      <div v-if="phase === 'converting'" class="tool-box" style="text-align:center;padding:40px;">
        <div class="spin-icon"></div>
        <p style="margin-top:12px;color:var(--vp-c-text-3);font-size:14px;">
          正在转换 {{ convPct }}% ...
        </p>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: barWidth + '%' }"></div>
        </div>
        <p class="conv-info">
          {{ settings.fmt === 'gif' ? 'GIF' : 'WebP' }} {{ settings.fps }}fps
          <template v-if="original.duration != null">
            · {{ formatDuration(original.duration) }} · {{ original.width }}×{{ original.height }}
          </template>
        </p>
      </div>

      <!-- 完成: 对比 + 下载 -->
      <template v-if="phase === 'done'">
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

          <div class="tool-box compare-card">
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
        <div class="action-bar">
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
  display: flex;
  gap: 8px;
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
