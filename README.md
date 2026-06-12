# Toolbox — 开发者工具箱

> 轻量、快速、纯浏览器端运行的开发工具集合
>
> 包含 URL 编码/解码、二维码生成/识别、取色器、文件互传 & 消息、KVM 屏幕共享、留言反馈
> 以及配套的 WebSocket 信令服务、留言板 API、GitHub/Gitee 自动部署系统

---

## 目录结构

```
toolbox/
├── frontend/                    ← Nuxt 4 SPA (Vue 3 + TypeScript)
│   ├── pages/                   ← 页面组件
│   │   ├── index.vue            ← 首页（工具导航）
│   │   ├── fileshare.vue        ← 文件互传 & 消息
│   │   ├── url-encode.vue       ← URL 编码/解码
│   │   ├── qrcode.vue           ← 二维码生成
│   │   ├── qrcode-decode.vue    ← 二维码识别
│   │   ├── color-picker.vue     ← 取色器
│   │   ├── kvm.vue              ← KVM 屏幕共享（实验性）
│   │   └── feedback.vue         ← 留言反馈
│   ├── composables/             ← 可复用工具函数
│   │   └── useCopy.ts           ← 统一复制工具（Clipboard API + fallback）
│   ├── layouts/
│   │   └── default.vue          ← 全局布局（导航 + 暗色主题切换）
│   ├── assets/
│   │   └── css/main.css         ← 全局样式
│   ├── public/
│   │   └── favicon.svg
│   ├── app.vue
│   ├── nuxt.config.ts
│   └── package.json
│
├── server/                      ← 统一后端服务 (Node.js)
│   ├── index.js                 ← 三合一服务：信令 + 留言板 API + 部署 Webhook
│   └── package.json             ← 依赖（仅 ws）
│
├── deploy/                      ← 部署运维
│   └── nginx/
│       ├── nuxt-tools.conf      ← port 80: /tools/ + /ws 代理
│       ├── nuxt-tools-8999.conf ← port 8999: 独立站点
│       ├── feedback-api.conf    ← /tools/api/ 代理
│       └── deploy-webhook.conf  ← /deploy/ 代理
│
├── .gitignore
├── .npmrc                       ← engine-strict=true
├── .node-version                ← Node 22
├── env.example                  ← 环境变量模板
└── README.md                    ← 本文档
```

## 技术栈

| 层 | 技术 | 说明 |
|:--|:--|:--|
| **前端** | Nuxt 4 + Vue 3 + TypeScript | 纯静态 SPA（ssr: false） |
| **后端** | Node.js + ws (WebSocket) | 约 420 行，零外部框架 |
| **WebSocket** | ws 库 | 信令服务 + 消息中继 |
| **存储** | JSON 文件 | 留言板数据，无数据库 |
| **部署** | GitHub/Gitee Webhook | 自动拉取 → 构建 → 发布 |
| **反向代理** | nginx | 多端口/多路径转发 |
| **进程管理** | systemd | unified-server.service |

## 本地开发

### 前置要求

- Node.js >= 18（推荐 22）
- npm

### 启动前端

```bash
cd toolbox/frontend
npm install
npm run dev
# → http://localhost:3000
```

### 启动后端

```bash
cd toolbox/server
npm install
node index.js
# → WebSocket ws://localhost:9200/ws
# → HTTP   http://localhost:9200/health
```

> 前端通过 `/ws` WebSocket 连接后端信令；留言板通过 `/api/feedback` 调用 API。

## 构建 & 部署

### 构建前端

```bash
cd toolbox/frontend
npm run generate
# 输出到 .output/public/
```

### 部署到服务器

```bash
# 部署前端到 8999 端口
sudo rm -rf /usr/share/nginx/html/nuxt-tools/tools/*
sudo cp -r frontend/.output/public/* /usr/share/nginx/html/nuxt-tools/tools/

# 部署后端
sudo systemctl restart unified-server

# 重载 nginx
sudo nginx -s reload
```

## 架构

```mermaid
graph TB
    subgraph "浏览器 / 客户端"
        A[用户访问<br/>port 80 / 8999]
    end

    subgraph "nginx 反向代理"
        B[location /ws<br/>location /tools/api<br/>location /deploy]
    end

    subgraph "Unified Server :9200"
        C[WebSocket 信令<br/>/ws]
        D[留言板 API<br/>POST/GET /feedback]
        E[部署 Webhook<br/>POST /]
    end

    subgraph "Nuxt SPA"
        F[/tools/ 静态文件<br/>pages/*.vue]
    end

    subgraph "外部"
        G[GitHub / Gitee<br/>Webhook Push]
    end

    A --> B
    B --> F
    B --> C
    B --> D
    B --> E
    G --> E
```

## 在线功能

### 文件互传 & 消息 📡

- WebRTC P2P 点对点直连（LAN 下）
- WebSocket 中继兜底（公网 HTTP 环境自动切换）
- 4 位频道码加入房间，多人 Mesh 互联
- 文本消息 + 文件传输 + 图片预览

### 留言反馈 💬

- 填写留言，JSON 文件存储
- 轻量 API，零依赖

### 自动部署 🚀

- GitHub / Gitee Webhook 推送触发
- 按仓库配置执行部署命令序列
- 逐条命令失败即中止（安全）

## 配置参考

| 文件 | 作用 |
|:--|:--|
| `frontend/nuxt.config.ts` | Nuxt 构建配置（baseURL、css、app 等） |
| `frontend/package.json` | 前端依赖 + engines 版本声明 |
| `server/index.js` | 后端路由：信令/留言板/Webhook 实现 |
| `deploy/nginx/*.conf` | nginx 反向代理规则 |
| `.npmrc` | npm 严格模式（engine-strict） |
| `.node-version` | nvm 自动版本切换 |
| `env.example` | 环境变量模板（复制为 .env） |

## 许可证

MIT
