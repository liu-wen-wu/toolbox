<script setup>
useHead({ title: 'URL 编码/解码' })

const { copy, copied, copyError } = useCopy()
const input = ref('')
const mode = ref('encode')
const output = ref('')
const error = ref('')
const decodeCount = ref(0)

function convert() {
  error.value = ''
  decodeCount.value = 0
  if (!input.value) { output.value = ''; return }
  try {
    if (mode.value === 'encode') {
      decodeCount.value = 0
      output.value = encodeURIComponent(input.value)
    } else {
      decodeCount.value = 1
      output.value = decodeURIComponent(input.value)
    }
  } catch (e) {
    output.value = ''
    showError(e)
  }
}

function decodeMore() {
  if (!output.value) return
  error.value = ''
  try {
    const next = decodeURIComponent(output.value)
    if (next === output.value) {
      error.value = '已无更多编码层，无法继续解码。'
      return
    }
    output.value = next
    decodeCount.value++
  } catch (e) {
    showError(e)
  }
}

function showError(e) {
  if (e instanceof URIError) {
    const msg = e.message
    if (msg.includes('malformed') || msg.includes('invalid')) {
      error.value = `解码失败：输入包含无效的百分号编码序列（如 %ZZ、%XX 等），无法解析。`
    } else if (msg.includes('overlong') || msg.includes('out of range')) {
      error.value = `解码失败：百分号编码的值超出有效范围（0-127 或 UTF-8 编码无效）。`
    } else {
      error.value = `解码失败：${msg}`
    }
  } else {
    error.value = `解码失败：${e.message || '未知错误'}`
  }
}

function swap() {
  input.value = output.value
  output.value = ''
  error.value = ''
  decodeCount.value = 0
  mode.value = mode.value === 'encode' ? 'decode' : 'encode'
  convert()
}

function copyOutput() {
  if (output.value) copy(output.value)
}

watch(input, convert)
watch(mode, convert)
</script>

<template>
  <div>
    <h1 data-index="01">URL 编码/解码</h1>
    <p class="description">对 URL 参数、字符串进行编码或解码，支持连续多层解码。</p>

    <div class="tool-box">
      <label>操作模式</label>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button class="btn" :class="mode==='encode'?'btn-primary':'btn-secondary'" @click="mode='encode'">编码</button>
        <button class="btn" :class="mode==='decode'?'btn-primary':'btn-secondary'" @click="mode='decode'">解码</button>
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:250px;">
          <label>输入</label>
          <textarea v-model="input" class="input" rows="6" placeholder="输入需要编码/解码的内容..."></textarea>
        </div>
        <div style="display:flex;align-items:center;padding-top:28px;">
          <button class="btn btn-secondary" @click="swap" title="交换">交换</button>
        </div>
        <div style="flex:1;min-width:250px;">
          <label>输出</label>
          <textarea :value="output" class="input" rows="6" readonly placeholder="结果将显示在这里..."></textarea>
          <div v-if="error" class="error-box">{{ error }}</div>
          <div v-if="output" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-small btn-secondary" @click="copyOutput">
              <template v-if="copied">已复制</template>
              <template v-else>复制</template>
            </button>
            <button v-if="mode==='decode'" class="btn btn-small btn-secondary" @click="decodeMore" title="对当前结果再次解码">再解码</button>
            <span v-if="decodeCount > 1" class="decode-badge">已解码 {{ decodeCount }} 层</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-box {
  margin-top: 10px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  color: #dc2626;
  line-height: 1.5;
}

.decode-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  background: rgba(94, 106, 210, 0.08);
  border: 1px solid rgba(94, 106, 210, 0.15);
  border-radius: var(--radius-pill, 9999px);
  font-size: 12px;
  color: var(--vp-c-brand, #5e6ad2);
  font-weight: 500;
}
</style>
