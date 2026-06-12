<script setup>
useHead({ title: '开发者工具箱' })

const tools = [
  { href: '/url-encode', icon: '🔗', title: 'URL 编码/解码', desc: '对 URL 参数、字符串进行编码或解码，支持双向转换。' },
  { href: '/qrcode', icon: '📱', title: '二维码生成', desc: '将文本、链接等任意内容生成二维码图片，支持自定义大小和纠错级别。' },
  { href: '/qrcode-decode', icon: '👁', title: '二维码识别', desc: '上传/拖拽/粘贴二维码图片，自动识别文本内容，纯本地处理。' },
  { href: '/color-picker', icon: '🎨', title: '取色器', desc: '从屏幕任意位置取色，支持 HEX、RGB、HSL 格式复制。' },
  { href: '/fileshare', icon: '📡', title: '文件互传 & 消息', desc: '创建频道，点对点直连传输文件和消息，支持多人 Mesh 互联。' },
  { href: '/kvm', icon: '🖥', title: 'KVM 屏幕共享', desc: '共享屏幕 + 远程光标 + 画板标注，WebRTC 点对点直连。' },
]

const features = [
  { icon: '🔒', text: '纯本地运行，数据不上传' },
  { icon: '⚡', text: '即开即用，无需安装依赖' },
  { icon: '📱', text: '响应式设计，手机电脑通用' },
  { icon: '🎨', text: '亮色/暗色主题自由切换' },
  { icon: '🌐', text: 'WebRTC 点对点直连传输' },
  { icon: '📋', text: '支持粘贴板粘贴操作' },
]
</script>

<template>
  <div>
    <h1>⚒ 开发者工具箱</h1>
    <p class="description">轻量、快速、纯浏览器端运行的开发工具集合，所有数据均在本地处理，不上传服务器。</p>

    <div class="tool-grid">
      <NuxtLink v-for="tool in tools" :key="tool.href" :to="tool.href" class="tool-card">
        <div class="tool-icon">{{ tool.icon }}</div>
        <h3>{{ tool.title }}</h3>
        <p>{{ tool.desc }}</p>
      </NuxtLink>
    </div>

    <h2 style="margin-top: 40px;">特性</h2>
    <div class="feature-list">
      <div v-for="f in features" :key="f.text" class="feature-item">
        <span class="feat-icon">{{ f.icon }}</span>
        <span>{{ f.text }}</span>
      </div>
    </div>
  </div>
</template>
