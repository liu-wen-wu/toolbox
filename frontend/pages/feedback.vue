<script setup>
useHead({ title: '留言反馈' })

const name = ref('')
const contact = ref('')
const message = ref('')
const submitting = ref(false)
const submitted = ref(false)
const resultMsg = ref('')
const resultType = ref('') // 'success' or 'error'
const feedbacks = ref([])
const loaded = ref(false)

async function submitFeedback() {
  if (!message.value.trim()) {
    resultMsg.value = '请填写反馈内容'
    resultType.value = 'error'
    return
  }
  submitting.value = true
  resultMsg.value = ''
  try {
    const res = await fetch('/tools/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(),
        message: message.value.trim(),
        contact: contact.value.trim(),
      })
    })
    const data = await res.json()
    if (data.success) {
      submitted.value = true
      resultMsg.value = data.message
      resultType.value = 'success'
      name.value = ''
      contact.value = ''
      message.value = ''
      loadFeedbacks()
    } else {
      resultMsg.value = data.error || '提交失败'
      resultType.value = 'error'
    }
  } catch (e) {
    resultMsg.value = '网络错误，请稍后重试'
    resultType.value = 'error'
  }
  submitting.value = false
}

async function loadFeedbacks() {
  try {
    const res = await fetch('/tools/api/feedback')
    const data = await res.json()
    feedbacks.value = data.items || []
  } catch {}
  loaded.value = true
}

onMounted(loadFeedbacks)
</script>

<template>
  <div>
    <h1 data-index="09">留言反馈</h1>
    <p class="description">遇到问题？有功能建议？欢迎留言，我们会尽快回复。</p>

    <!-- Submit form -->
    <div class="tool-box">
      <div v-if="submitted && resultType==='success'" class="success-banner">
        {{ resultMsg }}
        <button class="btn btn-small btn-secondary" style="margin-left:12px;" @click="submitted=false; resultMsg=''">再写一条</button>
      </div>

      <div v-else>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          <div style="flex:1;min-width:180px;">
            <label>称呼 <span class="field-optional">（可选）</span></label>
            <input v-model="name" class="input" placeholder="你的名字" maxlength="30">
          </div>
          <div style="flex:1;min-width:180px;">
            <label>联系方式 <span class="field-optional">（可选）</span></label>
            <input v-model="contact" class="input" placeholder="微信 / 邮箱 / 手机号" maxlength="100">
          </div>
        </div>
        <div>
          <label>反馈内容 <span class="field-required">*</span></label>
          <textarea v-model="message" class="input" rows="5" placeholder="描述你遇到的问题或建议..." maxlength="2000"></textarea>
          <div class="char-count">{{ message.length }}/2000</div>
        </div>

        <div v-if="resultMsg && resultType==='error'" class="error-box">{{ resultMsg }}</div>

        <button class="btn btn-primary" style="margin-top:12px;" :disabled="submitting || !message.trim()" @click="submitFeedback">
          {{ submitting ? '提交中...' : '提交反馈' }}
        </button>
      </div>
    </div>

    <!-- Feedback list -->
    <div class="tool-box" v-if="loaded">
      <label>
        历史反馈
        <span v-if="feedbacks.length" class="feedback-count">({{ feedbacks.length }})</span>
      </label>

      <div v-if="!feedbacks.length" class="empty-state">
        还没有反馈，来写第一条吧
      </div>

      <div v-for="fb in feedbacks" :key="fb.id" class="feedback-item">
        <div class="feedback-header">
          <span class="feedback-name">{{ fb.name }}</span>
          <span class="feedback-time">{{ new Date(fb.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
        </div>
        <div class="feedback-message">{{ fb.message }}</div>
        <div v-if="fb.contact" class="feedback-contact">{{ fb.contact }}</div>
      </div>
    </div>

    <div v-else class="empty-state">加载中...</div>
  </div>
</template>

<style scoped>
.field-optional { color: var(--vp-c-text-3, #8a8f98); font-size: 12px; font-weight: 400; }
.field-required { color: #dc2626; font-size: 14px; }

.char-count {
  text-align: right;
  font-size: 11px;
  color: var(--vp-c-text-3, #8a8f98);
  margin-top: 4px;
}

.success-banner {
  padding: 16px 20px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: var(--radius-md, 8px);
  font-size: 15px;
  color: #059669;
  font-weight: 500;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

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

.feedback-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--vp-c-text-3, #8a8f98);
  margin-left: 6px;
}

.empty-state {
  text-align: center;
  padding: 32px 0;
  color: var(--vp-c-text-3, #8a8f98);
  font-size: 14px;
}

.feedback-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--vp-c-border-subtle, rgba(0,0,0,0.06));
}
.feedback-item:last-child { border-bottom: none; }

.feedback-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.feedback-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1, #171717);
}
.feedback-time {
  font-size: 11px;
  color: var(--vp-c-text-3, #8a8f98);
}
.feedback-message {
  font-size: 14px;
  color: var(--vp-c-text-2, #525252);
  line-height: 1.6;
  white-space: pre-wrap;
}
.feedback-contact {
  margin-top: 6px;
  font-size: 12px;
  color: var(--vp-c-text-3, #8a8f98);
}
</style>
