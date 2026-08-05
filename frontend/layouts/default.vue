<script setup>
const route = useRoute()
const isDark = ref(false)

const links = [
  { path: '/', idx: '00', label: '首页' },
  { path: '/url-encode', idx: '01', label: 'URL 编码/解码' },
  { path: '/qrcode', idx: '02', label: '二维码生成' },
  { path: '/qrcode-decode', idx: '03', label: '二维码识别' },
  { path: '/color-picker', idx: '04', label: '取色器' },
  { path: '/img-compress', idx: '05', label: '图片压缩' },
  { path: '/video2gif', idx: '06', label: 'MP4 转动图' },
  { path: '/fileshare', idx: '07', label: '文件 & 消息互传' },
  { path: '/kvm', idx: '08', label: 'KVM 屏幕共享' },
  { path: '/feedback', idx: '09', label: '留言反馈' },
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
      <div class="icon">T</div>
      <span>Toolbox</span>
      <small>DEV-UTILS</small>
    </NuxtLink>
    <button class="theme-toggle" @click="toggleTheme">
      {{ isDark ? 'LIGHT' : 'DARK' }}
    </button>
  </nav>

  <aside class="sidebar">
    <div class="sidebar-title">工具列表 / TOOLS</div>
    <NuxtLink
      v-for="link in links"
      :key="link.path"
      :to="link.path"
      class="sidebar-link"
      :class="{ active: route.path === link.path }"
    >
      <span class="idx">{{ link.idx }}</span>
      <span>{{ link.label }}</span>
    </NuxtLink>
  </aside>

  <main class="main-content">
    <slot />
  </main>
</template>
