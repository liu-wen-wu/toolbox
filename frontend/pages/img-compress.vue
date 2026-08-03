<script setup>
useHead({ title: '图片压缩' })

const fileInput = ref(null)
const dragOver = ref(false)
const error = ref('')
const wasmReady = ref(false)
const wasmError = ref('')
const processing = ref(false)

// Original image
const original = ref(null) // { file, url, info, size }
// Compressed result
const compressed = ref(null) // { blob, url, size }

// Settings
const settings = ref({
  format: 'auto',
  quality: 80,
  maxWidth: 1920,
  maxHeight: 0,
})

const outputFormats = [
  { value: 'auto', label: '保持原格式' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'png', label: 'PNG' },
]

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

async function initWasm() {
  try {
    const wasmModule = await import('../wasm/img-compress/img_compress.js')
    await wasmModule.default()
    wasmReady.value = true
  } catch (e) {
    wasmError.value = 'WASM 加载失败: ' + e.message
  }
}

onMounted(() => {
  initWasm()
})

function onDragOver(e) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function onDrop(e) {
  e.preventDefault()
  dragOver.value = false
  const files = e.dataTransfer.files
  if (files.length) loadImage(files[0])
}

function onFileSelect(e) {
  const files = e.target.files
  if (files.length) loadImage(files[0])
  // Reset input so selecting the same file re-fires 'change'
  e.target.value = ''
}

function triggerFilePicker() {
  if (fileInput.value) {
    fileInput.value.value = ''
    fileInput.value.click()
  }
}

async function loadImage(file) {
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片文件'
    return
  }
  error.value = ''
  compressed.value = null

  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const url = URL.createObjectURL(file)

  // Get image info via WASM
  try {
    const wasmModule = await import('../wasm/img-compress/img_compress.js')
    const infoJson = wasmModule.image_info(bytes)
    const info = JSON.parse(infoJson)
    original.value = {
      file,
      url,
      info,
      bytes,
      size: file.size,
    }
  } catch (e) {
    // Fallback: load as image to get dimensions
    error.value = '无法识别图片格式: ' + e.message
    // Still show the image
    const img = new Image()
    img.onload = () => {
      original.value = {
        file,
        url,
        info: { width: img.width, height: img.height, format: 'unknown' },
        bytes,
        size: file.size,
      }
    }
    img.onerror = () => { error.value = '图片加载失败' }
    img.src = url
    return
  }

  // Auto compress
  doCompress(bytes)
}

async function doCompress(bytes) {
  if (!original.value) return
  processing.value = true
  error.value = ''

  try {
    const data = bytes || original.value.bytes
    const wasmModule = await import('../wasm/img-compress/img_compress.js')
    const s = settings.value
    let resultBytes, mime

    // Determine format
    let fmt = s.format
    if (fmt === 'auto') {
      fmt = original.value.info.format
      // Only map unknown formats to jpeg; known formats stay as-is
      if (!['jpeg', 'png', 'webp'].includes(fmt)) fmt = 'jpeg'
    }

    const hasQuality = fmt === 'jpeg' || fmt === 'webp'

    switch (fmt) {
      case 'jpeg':
        resultBytes = wasmModule.compress_jpeg(data, s.quality, s.maxWidth, s.maxHeight)
        mime = 'image/jpeg'
        break
      case 'webp':
        resultBytes = wasmModule.compress_webp(data, s.quality, s.maxWidth, s.maxHeight)
        mime = 'image/webp'
        break
      case 'png':
        resultBytes = wasmModule.compress_png(data, s.maxWidth, s.maxHeight)
        mime = 'image/png'
        break
      default:
        throw new Error('不支持的输出格式: ' + fmt)
    }

    if (resultBytes.length === 0) {
      throw new Error('压缩结果为空')
    }

    const blob = new Blob([resultBytes], { type: mime })
    const url = URL.createObjectURL(blob)

    // Clean up previous compressed URL
    if (compressed.value?.url) {
      URL.revokeObjectURL(compressed.value.url)
    }

    compressed.value = {
      blob,
      url,
      size: blob.size,
      format: fmt,
    }
  } catch (e) {
    error.value = '压缩失败: ' + e.message
  } finally {
    processing.value = false
  }
}

function recompress() {
  if (original.value) doCompress()
}

function download() {
  if (!compressed.value) return
  const a = document.createElement('a')
  a.href = compressed.value.url
  const ext = compressed.value.format === 'jpeg' ? 'jpg' : compressed.value.format
  const name = original.value.file.name.replace(/\.[^.]+$/, '')
  a.download = `${name}-compressed.${ext}`
  a.click()
}

function getSavings() {
  if (!original.value || !compressed.value) return null
  const savings = original.value.size - compressed.value.size
  const percent = ((savings / original.value.size) * 100).toFixed(1)
  return { bytes: savings, percent }
}

const showQuality = computed(() => {
  if (!settings.value.format || settings.value.format === 'png') return false
  if (settings.value.format === 'jpeg' || settings.value.format === 'webp') return true
  // Auto: show quality unless original is a lossless-only format
  if (settings.value.format === 'auto' && original.value) {
    return !['png'].includes(original.value.info.format)
  }
  return true
})
</script>

<template>
  <div>
    <h1 data-index="05">图片压缩</h1>
    <p class="description">纯本地浏览器端图片压缩，支持 JPEG / PNG / WebP 格式，可选择输出格式、压缩质量和最大尺寸。</p>

    <div v-if="wasmError" class="inline-error">{{ wasmError }}</div>

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
          <div class="drop-icon">IMG</div>
      <div class="drop-text">拖拽图片到此处，或点击选择文件</div>
      <div class="drop-hint">支持 JPEG / PNG / WebP / BMP / GIF</div>
    </div>
    <!-- Hidden file input: always in DOM so "选择其他图片" can trigger it -->
    <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFileSelect">

    <!-- Processing State -->
    <div v-if="original && !compressed && processing" class="tool-box" style="text-align:center;padding:40px;">
      <div class="spin-icon"></div>
      <p style="margin-top:12px;color:var(--vp-c-text-3);font-size:14px;">正在压缩...</p>
    </div>

    <!-- Main Content -->
    <template v-if="original">
      <!-- Settings -->
      <div class="tool-box">
        <label>压缩设置</label>
        <div class="settings-grid">
          <div class="setting-item">
            <span class="setting-label">输出格式</span>
            <select v-model="settings.format" @change="recompress" class="input setting-select">
              <option v-for="fmt in outputFormats" :key="fmt.value" :value="fmt.value">{{ fmt.label }}</option>
            </select>
          </div>
          <div class="setting-item" v-if="showQuality">
            <span class="setting-label">质量</span>
            <div class="slider-row">
              <input type="range" v-model.number="settings.quality" min="1" max="100" @input="recompress" class="slider">
              <span class="slider-val">{{ settings.quality }}</span>
            </div>
          </div>
          <div class="setting-item">
            <span class="setting-label">最大宽度</span>
            <input type="number" v-model.number="settings.maxWidth" min="0" max="10000" @change="recompress" class="input setting-input">
            <span class="setting-unit">px（0=不限制）</span>
          </div>
          <div class="setting-item">
            <span class="setting-label">最大高度</span>
            <input type="number" v-model.number="settings.maxHeight" min="0" max="10000" @change="recompress" class="input setting-input">
            <span class="setting-unit">px（0=不限制）</span>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="inline-error">{{ error }}</div>

      <!-- Comparison -->
      <div class="compare-grid">
        <div class="tool-box compare-card">
          <label>原图</label>
          <div class="img-wrap">
            <img :src="original.url" :alt="original.file.name">
          </div>
          <div class="img-meta">
            <span>{{ original.info.width }} × {{ original.info.height }}</span>
            <span class="meta-dot">·</span>
            <span>{{ original.info.format.toUpperCase() }}</span>
            <span class="meta-dot">·</span>
            <span>{{ formatSize(original.size) }}</span>
          </div>
        </div>

        <div class="tool-box compare-card" v-if="compressed && !processing">
          <label>压缩后</label>
          <div class="img-wrap">
            <img :src="compressed.url" :alt="'compressed-' + original.file.name">
          </div>
          <div class="img-meta">
            <span v-if="compressed.format === original.info.format">{{ original.info.width }} × {{ original.info.height }} → {{ compressed.format.toUpperCase() }}</span>
            <span v-else>{{ original.info.width }} × {{ original.info.height }} → {{ compressed.format.toUpperCase() }}</span>
            <span class="meta-dot">·</span>
            <span>{{ formatSize(compressed.size) }}</span>
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
      <div class="action-bar" v-if="compressed">
        <button class="btn btn-primary" @click="download">
          下载压缩图片
        </button>
        <button class="btn btn-secondary" @click="triggerFilePicker">
          选择其他图片
        </button>
      </div>
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
  margin-bottom: 0;
}
.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--vp-c-brand);
  background: var(--vp-c-brand-soft);
}
.drop-icon {
  font-size: 40px;
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
.setting-select {
  width: 100%;
}
.setting-input {
  width: 100%;
}
.setting-unit {
  font-size: 11px;
  color: var(--vp-c-text-4);
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
.compare-card label {
  margin-bottom: 12px;
}
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
  border: 1px solid color-mix(in srgb, var(--vp-c-red) 25%, transparent);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--vp-c-red);
  line-height: 1.5;
}

.spin-icon {
  font-size: 32px;
  animation: spin 1s linear infinite;
  display: inline-block;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
