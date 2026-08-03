// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  app: {
    baseURL: '/',
    head: {
      title: 'Toolbox - 开发者工具箱',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'description', content: '轻量、快速、纯浏览器端运行的开发工具集合' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap' }
      ]
    }
  },
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2026-06-09',
  vite: {
    server: {
      allowedHosts: true
    }
  }
})
