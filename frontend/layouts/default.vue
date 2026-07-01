<script setup>
const route = useRoute()
const isDark = ref(false)

const links = [
  { path: '/', icon: '🏠', label: '首页' },
  { path: '/url-encode', icon: '🔗', label: 'URL 编码/解码' },
  { path: '/qrcode', icon: '📱', label: '二维码生成' },
  { path: '/qrcode-decode', icon: '👁', label: '二维码识别' },
  { path: '/color-picker', icon: '🎨', label: '取色器' },
  { path: '/img-compress', icon: '🖼', label: '图片压缩' },
  { path: '/fileshare', icon: '📡', label: '文件 & 消息互传' },
  { path: '/kvm', icon: '🖥', label: 'KVM 屏幕共享  🧪' },
  { path: '/feedback', icon: '💬', label: '留言反馈' },
]

function toggleTheme() {
  isDark.value = !isDark.value
  document.body.classList.toggle('dark-theme', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

onMounted(() => {
  if (localStorage.getItem('theme') === 'dark') {
    isDark.value = true
    document.body.classList.add('dark-theme')
  }
})
</script>

<template>
  <nav class="navbar">
    <NuxtLink to="/" class="logo">
      <div class="icon">⚒</div>
      <span>Toolbox</span>
    </NuxtLink>
    <button class="theme-toggle" @click="toggleTheme">
      {{ isDark ? '🌙 暗色' : '☀️ 亮色' }}
    </button>
  </nav>

  <aside class="sidebar">
    <div class="sidebar-title">工具列表</div>
    <NuxtLink
      v-for="link in links"
      :key="link.path"
      :to="link.path"
      class="sidebar-link"
      :class="{ active: route.path === link.path }"
    >
      {{ link.icon }} {{ link.label }}
    </NuxtLink>
  </aside>

  <main class="main-content">
    <slot />
  </main>
</template>
