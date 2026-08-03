<script setup>
useHead({ title: '二维码生成' })

const text = ref('')
const size = ref(256)
const errorLevel = ref('M')
const qrDataUrl = ref('')
const showDownload = ref(false)

function generateQR() {
  if (!text.value) { qrDataUrl.value = ''; showDownload.value = false; return }
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size.value}x${size.value}&data=${encodeURIComponent(text.value)}&ecc=${errorLevel.value}`
  qrDataUrl.value = url
  showDownload.value = true
}

function downloadQR() {
  if (!qrDataUrl.value) return
  const a = document.createElement('a')
  a.href = qrDataUrl.value
  a.download = `qrcode_${Date.now()}.png`
  a.click()
}

watch(text, generateQR)
watch(size, generateQR)
watch(errorLevel, generateQR)
</script>

<template>
  <div>
    <h1 data-index="02">二维码生成</h1>
    <p class="description">将文本、链接等任意内容生成二维码图片，支持自定义大小和纠错级别。</p>

    <div class="tool-box">
      <label>内容</label>
      <textarea v-model="text" class="input" rows="4" placeholder="输入要生成二维码的文本或链接..."></textarea>
    </div>

    <div class="tool-box">
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        <div>
          <label>尺寸</label>
          <select v-model.number="size" class="input" style="width:120px;">
            <option :value="128">128px</option>
            <option :value="256">256px</option>
            <option :value="512">512px</option>
            <option :value="1024">1024px</option>
          </select>
        </div>
        <div>
          <label>纠错级别</label>
          <select v-model="errorLevel" class="input" style="width:120px;">
            <option value="L">低 (L)</option>
            <option value="M">中 (M)</option>
            <option value="Q">较高 (Q)</option>
            <option value="H">高 (H)</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="showDownload && qrDataUrl" class="tool-box" style="text-align:center;">
      <img :src="qrDataUrl" alt="QR Code" style="max-width:100%;border-radius:8px;">
      <div style="margin-top:12px;">
        <button class="btn btn-primary" @click="downloadQR">下载 PNG</button>
      </div>
    </div>
  </div>
</template>
