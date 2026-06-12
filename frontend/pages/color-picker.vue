<script setup>
useHead({ title: '取色器' })

const { copy: clipboardCopy, copied, copyError } = useCopy()
const color = ref('#5e6ad2')
const hex = ref('#5e6ad2')
const rgb = ref('rgb(94, 106, 210)')
const hsl = ref('hsl(234, 56%, 60%)')
const history = ref([])
const eyeDropSupported = ref(false)
const eyeDropError = ref('')

function hexToRgb(h) {
  const r = parseInt(h.slice(1,3), 16)
  const g = parseInt(h.slice(3,5), 16)
  const b = parseInt(h.slice(5,7), 16)
  return `rgb(${r}, ${g}, ${b})`
}

function hexToHsl(h) {
  let r = parseInt(h.slice(1,3), 16) / 255
  let g = parseInt(h.slice(3,5), 16) / 255
  let b = parseInt(h.slice(5,7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let hue = 0, sat = 0, light = (max + min) / 2
  if (max !== min) {
    const d = max - min
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) * 60; break
      case g: hue = ((b - r) / d + 2) * 60; break
      case b: hue = ((r - g) / d + 4) * 60; break
    }
  }
  return `hsl(${Math.round(hue)}, ${Math.round(sat * 100)}%, ${Math.round(light * 100)}%)`
}

function updateColor(val) {
  color.value = val
  hex.value = val.toUpperCase()
  rgb.value = hexToRgb(val)
  hsl.value = hexToHsl(val)
}

async function eyeDrop() {
  if (!window.EyeDropper) {
    eyeDropError.value = '当前浏览器不支持取色器 API，请使用 Chrome 95+ 或 Edge 95+，并通过 HTTPS 访问。'
    return
  }
  try {
    const ed = new EyeDropper()
    const r = await ed.open()
    updateColor(r.sRGBHex)
    eyeDropError.value = ''
  } catch (e) {
    // user cancelled or API blocked (e.g. HTTP instead of HTTPS)
    if (e.name === 'NotAllowedError' || e.message?.includes('secure')) {
      eyeDropError.value = 'EyeDropper API 需要 HTTPS 安全连接才能工作。当前页面通过 HTTP 访问，请改用 HTTPS 或使用下方的颜色选择器。'
    }
  }
}

// Fallback: use native color input when EyeDropper isn't available
function fallbackPick() {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = color.value
  input.addEventListener('input', (e) => {
    updateColor(e.target.value)
  })
  input.click()
}

function addToHistory() {
  if (!history.value.includes(hex.value)) {
    history.value.unshift(hex.value)
    if (history.value.length > 12) history.value.pop()
  }
}

function selectFromHistory(c) {
  updateColor(c)
}

function randomColor() {
  const c = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
  updateColor(c)
}

watch(color, (val) => {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    updateColor(val)
  }
})

onMounted(() => {
  eyeDropSupported.value = !!window.EyeDropper
  if (!eyeDropSupported.value) {
    eyeDropError.value = '当前浏览器不支持 EyeDropper API。建议使用 Chrome 95+，或使用下方的颜色选择器。'
  } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    eyeDropError.value = '⚠ EyeDropper 取色功能需要 HTTPS 才能正常工作。当前为 HTTP 访问，取色按钮可能无效。你可以使用下方的颜色选择器作为替代。'
  }
})
</script>

<template>
  <div>
    <h1>🎨 取色器</h1>
    <p class="description">从屏幕任意位置取色，支持 HEX、RGB、HSL 格式复制，自动保存取色历史。</p>

    <!-- HTTPS warning -->
    <div v-if="eyeDropError" class="inline-warning">{{ eyeDropError }}</div>

    <div class="tool-box">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
        <div
          style="width:80px;height:80px;border-radius:12px;border:2px solid var(--vp-c-border);flex-shrink:0;"
          :style="{ background: color }"
        ></div>
        <div>
          <input v-model="hex" class="input" style="width:140px;font-family:var(--font-mono);text-transform:uppercase;" maxlength="7" placeholder="#000000" @input="updateColor($event.target.value)">
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" @click="eyeDrop" title="从屏幕取色（Chrome 95+，需 HTTPS）">👁 取色</button>
            <button class="btn btn-secondary" @click="fallbackPick" title="使用系统颜色选择器取色（所有浏览器均支持）">🎨 颜色面板</button>
            <button class="btn btn-secondary" @click="randomColor">🎲 随机</button>
            <button class="btn btn-secondary" @click="addToHistory" :disabled="history.includes(hex)">💾 保存</button>
          </div>
        </div>
      </div>
    </div>

    <div class="tool-box">
      <label>颜色值</label>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div v-for="(fmt, name) in { HEX: hex, RGB: rgb, HSL: hsl }" :key="name" style="display:flex;align-items:center;gap:8px;">
          <span style="width:40px;font-size:13px;font-weight:600;color:var(--vp-c-text-3);">{{ name }}</span>
          <code style="flex:1;padding:6px 10px;background:var(--vp-c-bg-mute);border-radius:6px;font-family:var(--font-mono);font-size:13px;">{{ fmt }}</code>
          <button class="btn btn-tiny btn-secondary" @click="clipboardCopy(fmt)">📋 复制</button>
        </div>
      </div>
      <p v-if="copied" style="margin-top:8px;font-size:12px;color:var(--vp-c-green);">✅ 已复制到剪贴板</p>
      <p v-if="copyError" style="margin-top:8px;font-size:12px;color:var(--vp-c-red);">❌ {{ copyError }}</p>
    </div>

    <div v-if="history.length" class="tool-box">
      <label>取色历史</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div
          v-for="c in history" :key="c"
          :style="{ background: c, width: '32px', height: '32px', borderRadius: '6px', cursor: 'pointer', border: '2px solid var(--vp-c-border)' }"
          @click="selectFromHistory(c)"
          :title="c"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inline-warning {
  margin-bottom: 16px;
  padding: 10px 14px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  color: #b45309;
  line-height: 1.5;
}
</style>
