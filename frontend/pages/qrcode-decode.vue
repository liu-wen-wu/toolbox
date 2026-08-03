<script setup lang="ts">
import jsQR from 'jsqr'
useHead({ title: '二维码识别' })

const { copy, copied, copyError } = useCopy()

// ---- state ----
const fileInput = ref<HTMLInputElement>()
const dropActive = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const result = ref('')
const previewUrl = ref('')
const isUrl = ref(false)
const history = ref<{ text: string; time: string }[]>([])
const scanCount = ref(0)

// ---- helpers ----
function isLikelyUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+[/:?#]/i.test(s)
}

function decodeImage(file: File) {
  if (!file) return
  loading.value = true
  errorMsg.value = ''
  result.value = ''
  isUrl.value = false
  scanCount.value++

  // Revoke old preview
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)

  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        // Cap at 2048px to avoid OOM on large images
        const maxDim = 2048
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)

        if (code) {
          result.value = code.data
          isUrl.value = isLikelyUrl(code.data)
          addHistory(code.data)
        } else {
          errorMsg.value = '未识别到二维码内容'
        }
      } catch (err) {
        errorMsg.value = '识别失败，请检查图片是否包含有效的二维码'
      }
      loading.value = false
    }
    img.onerror = () => { errorMsg.value = '图片加载失败'; loading.value = false }
    img.src = e.target.result as string
  }
  reader.onerror = () => { errorMsg.value = '文件读取失败'; loading.value = false }
  reader.readAsDataURL(file)
}

// ---- input methods ----
function handleFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) decodeImage(file)
}

function onDrop(e: DragEvent) {
  dropActive.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    decodeImage(file)
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) { decodeImage(file); break }
    }
  }
}

function resetAll() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  result.value = ''
  errorMsg.value = ''
  isUrl.value = false
}

function openUrl() {
  if (isUrl.value && result.value) {
    window.open(result.value, '_blank', 'noopener,noreferrer')
  }
}

// ---- history ----
function addHistory(text: string) {
  history.value.unshift({ text, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })
  if (history.value.length > 10) history.value.pop()
  try { localStorage.setItem('qr_history', JSON.stringify(history.value)) } catch {}
}

// ---- lifecycle ----
onMounted(() => {
  document.addEventListener('paste', handlePaste)
  // Load history
  try {
    const saved = localStorage.getItem('qr_history')
    if (saved) history.value = JSON.parse(saved)
  } catch {}
})

onUnmounted(() => {
  document.removeEventListener('paste', handlePaste)
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

// Watch preview URL
watch(result, (v) => {
  if (!v && previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
})
</script>

<template>
  <div>
    <h1 data-index="03">二维码识别</h1>
    <p class="description">上传图片、拖拽图片或 <kbd class="kbd">Ctrl+V</kbd> 粘贴二维码截图，自动识别文本内容，纯本地处理，图片不上传服务器。</p>

    <!-- Drop zone -->
    <div
      class="tool-box"
      :class="{ 'drop-active': dropActive, 'drop-done': result && !errorMsg }"
      @dragover.prevent="dropActive = true"
      @dragleave="dropActive = false"
      @drop="onDrop"
      @click="fileInput?.click()"
      style="cursor:pointer;text-align:center;padding:48px 24px;transition:all 0.25s;"
    >
      <div v-if="!loading && !result && !errorMsg" class="drop-inner">
        <div class="drop-icon">QR</div>
        <div class="drop-title">选择二维码图片</div>
        <div class="drop-hint">点击上传、拖拽图片到此处，或直接粘贴截图</div>
      </div>

      <div v-if="loading" class="drop-inner">
        <div class="spinner"></div>
        <div class="drop-title" style="margin-top:16px;">正在识别...</div>
        <div class="drop-hint">请稍候，正在分析图片中的二维码</div>
      </div>

      <div v-if="errorMsg && !loading" class="drop-inner">
        <div class="drop-icon" style="font-size:40px;">!</div>
        <div class="drop-title" style="color:var(--vp-c-red);">{{ errorMsg }}</div>
        <div class="drop-hint" style="margin-top:8px;">点击重新选择图片，或换一张试试</div>
        <button class="btn btn-secondary btn-small" style="margin-top:12px;" @click.stop="resetAll">清除</button>
      </div>

      <div v-if="result && !loading" class="drop-result">
        <img :src="previewUrl || undefined" class="preview-img" />
        <div class="result-badge" :class="{ url: isUrl }">
          {{ isUrl ? '链接' : '文本' }}
        </div>
      </div>

      <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="handleFile">
    </div>

    <!-- Result -->
    <div v-if="result && !loading" class="tool-box">
      <label>识别结果</label>
      <div class="result-row">
        <div class="result-text">{{ result }}</div>
        <div class="result-actions">
          <button class="btn btn-secondary btn-small" @click="copy(result)">
            <template v-if="copied">已复制</template>
            <template v-else>复制</template>
          </button>
          <button v-if="isUrl" class="btn btn-primary btn-small" @click="openUrl">打开链接</button>
          <button class="btn btn-small" style="background:transparent;color:var(--vp-c-text-3);" @click="resetAll">
            重新识别
          </button>
        </div>
      </div>
      <p v-if="copyError" class="error-hint">{{ copyError }}</p>
    </div>

    <!-- History -->
    <div v-if="history.length" class="tool-box">
      <div class="history-header">
        <label style="margin-bottom:0;">历史记录 (最近 {{ history.length }}/10)</label>
        <button class="btn btn-tiny" style="background:transparent;color:var(--vp-c-text-3);" @click="history = []; localStorage.removeItem('qr_history')">清空</button>
      </div>
      <div class="history-list">
        <div
          v-for="(item, i) in history"
          :key="i"
          class="history-item"
          @click="result = item.text; isUrl = isLikelyUrl(item.text)"
        >
          <span class="history-icon">{{ isLikelyUrl(item.text) ? 'URL' : 'TXT' }}</span>
          <span class="history-text">{{ item.text }}</span>
          <span class="history-time">{{ item.time }}</span>
          <button class="btn btn-tiny" style="flex-shrink:0;" @click.stop="copy(item.text)">复制</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kbd {
  font-family: var(--font-mono);
  background: var(--vp-c-bg-mute);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--vp-c-border);
  font-size: 12px;
}

.drop-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.drop-icon {
  font-size: 56px;
  line-height: 1;
  margin-bottom: 4px;
  transition: transform 0.3s;
}

.tool-box:hover .drop-icon {
  transform: scale(1.08);
}

.drop-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.3px;
  color: var(--vp-c-text-1);
}

.drop-hint {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
}

/* Spinner */
.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--vp-c-bg-mute);
  border-top-color: var(--vp-c-brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Drop zone states */
.tool-box.drop-active {
  border-color: var(--vp-c-brand) !important;
  background: var(--vp-c-brand-soft) !important;
  box-shadow: 0 0 0 2px var(--vp-c-brand) !important;
}

.tool-box.drop-done {
  padding: 24px !important;
}

/* Preview in result mode */
.drop-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.preview-img {
  max-width: 200px;
  max-height: 200px;
  border-radius: var(--radius-md);
  box-shadow: var(--vp-shadow-border);
  object-fit: contain;
}

.result-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand);
}

.result-badge.url {
  background: color-mix(in srgb, var(--vp-c-green) 12%, transparent);
  color: var(--vp-c-green);
}

/* Result row */
.result-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.result-text {
  flex: 1;
  padding: 10px 14px;
  background: var(--vp-c-bg-mute);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-family: var(--font-mono);
  line-height: 1.5;
  word-break: break-all;
  color: var(--vp-c-text-1);
  min-height: 42px;
  max-height: 200px;
  overflow-y: auto;
}

.result-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.error-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--vp-c-red);
}

/* History */
.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
}

.history-item:hover {
  background: var(--vp-c-bg-mute);
}

.history-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.history-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vp-c-text-2);
}

.history-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--vp-c-text-4);
  min-width: 36px;
  text-align: right;
}
</style>
