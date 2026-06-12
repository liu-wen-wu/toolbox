<script setup>
useHead({ title: '二维码识别' })

const { copy, copied, copyError } = useCopy()
const result = ref('')
const errorMsg = ref('')
const loading = ref(false)

function decodeImage(file) {
  if (!file) return
  loading.value = true
  errorMsg.value = ''
  result.value = ''

  const reader = new FileReader()
  reader.onload = (e) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          result.value = code.data
        } else {
          errorMsg.value = '未识别到二维码'
        }
      } catch {
        errorMsg.value = '识别失败，请检查图片'
      }
      loading.value = false
    }
    img.onerror = () => { errorMsg.value = '图片加载失败'; loading.value = false }
    img.src = e.target.result
  }
  reader.onerror = () => { errorMsg.value = '文件读取失败'; loading.value = false }
  reader.readAsDataURL(file)
}

function handleFile(e) {
  const file = e.target.files?.[0]
  if (file) decodeImage(file)
}

function handleDrop(e) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) decodeImage(file)
}

function handlePaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) decodeImage(file)
      break
    }
  }
}

function copyResult() {
  if (result.value) copy(result.value)
}

onMounted(() => {
  // Load jsQR library
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
  script.onload = () => console.log('jsQR loaded')
  document.head.appendChild(script)
  document.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', handlePaste)
})
</script>

<template>
  <div>
    <h1>👁 二维码识别</h1>
    <p class="description">上传/拖拽/粘贴二维码图片，自动识别文本内容，纯本地处理。</p>

    <div class="tool-box">
      <div
        style="border:2px dashed var(--vp-c-border);border-radius:12px;padding:40px;text-align:center;cursor:pointer;transition:border-color 0.2s;"
        @drop="handleDrop"
        @dragover.prevent
        @click="$refs.fileInput.click()"
      >
        <div style="font-size:48px;margin-bottom:12px;">📷</div>
        <p style="color:var(--vp-c-text-3);font-size:14px;">点击选择图片、拖拽图片到此处，或 <kbd style="font-family:var(--font-mono);background:var(--vp-c-bg-mute);padding:2px 6px;border-radius:4px;border:1px solid var(--vp-c-border);">Ctrl+V</kbd> 粘贴</p>
      </div>
      <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="handleFile">
    </div>

    <div v-if="loading" class="tool-box" style="text-align:center;">
      <p>⏳ 正在识别...</p>
    </div>

    <div v-if="errorMsg" class="tool-box">
      <p style="color:var(--vp-c-red);">❌ {{ errorMsg }}</p>
    </div>

    <div v-if="result" class="tool-box">
      <label>识别结果</label>
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <textarea :value="result" class="input" rows="3" readonly></textarea>
        <button class="btn btn-secondary btn-small" style="white-space:nowrap;margin-top:0;" @click="copyResult">
          <template v-if="copied">✅</template>
          <template v-else>📋 复制</template>
        </button>
      </div>
      <p v-if="copyError" style="margin-top:8px;font-size:12px;color:var(--vp-c-red);">❌ {{ copyError }}</p>
    </div>
  </div>
</template>
