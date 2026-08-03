<script setup>
useHead({ title: '开发者工具箱' })

const tools = [
  { href: '/url-encode', num: '01', title: 'URL 编码/解码', desc: '对 URL 参数、字符串进行编码或解码，支持双向转换。' },
  { href: '/qrcode', num: '02', title: '二维码生成', desc: '将文本、链接等任意内容生成二维码图片，支持自定义大小和纠错级别。' },
  { href: '/qrcode-decode', num: '03', title: '二维码识别', desc: '上传/拖拽/粘贴二维码图片，自动识别文本内容，纯本地处理。' },
  { href: '/color-picker', num: '04', title: '取色器', desc: '从屏幕任意位置取色，支持 HEX、RGB、HSL 格式复制。' },
  { href: '/img-compress', num: '05', title: '图片压缩', desc: '纯本地压缩 JPEG / PNG / WebP，支持质量调节和尺寸缩放，WASM 引擎高效处理。' },
  { href: '/fileshare', num: '06', title: '文件互传 & 消息', desc: '创建频道，点对点直连传输文件和消息，支持多人 Mesh 互联。' },
  { href: '/kvm', num: '07', title: 'KVM 屏幕共享', desc: '共享屏幕 + 远程光标 + 画板标注，WebRTC 点对点直连。' },
]

const features = [
  { icon: '01', text: '纯本地运行，数据不上传' },
  { icon: '02', text: '即开即用，无需安装依赖' },
  { icon: '03', text: '响应式设计，手机电脑通用' },
  { icon: '04', text: '亮色/暗色主题自由切换' },
  { icon: '05', text: 'WebRTC 点对点直连传输' },
  { icon: '06', text: '支持粘贴板粘贴操作' },
]
</script>

<template>
  <div>
    <h1 data-index="00">开发者工具箱</h1>
    <p class="description">轻量、快速、纯浏览器端运行的开发工具集合，所有数据均在本地处理，不上传服务器。</p>

    <div class="tool-grid">
      <NuxtLink v-for="tool in tools" :key="tool.href" :to="tool.href" class="tool-card">
        <span class="tool-num">{{ tool.num }}</span>
        <div class="tool-icon">{{ tool.title }}</div>
        <h3>{{ tool.title }}</h3>
        <p>{{ tool.desc }}</p>
      </NuxtLink>
    </div>

    <h2 style="margin-top: 40px;">特性 / FEATURES</h2>
    <div class="feature-list">
      <div v-for="f in features" :key="f.text" class="feature-item">
        <span class="feat-icon">{{ f.icon }}</span>
        <span>{{ f.text }}</span>
      </div>
    </div>
  </div>
</template>
