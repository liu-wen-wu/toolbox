# img-compress WASM 模块规范

## 项目结构

```
toolbox/wasm/img-compress/
├── Cargo.toml          # Rust 项目配置
├── src/
│   └── lib.rs          # 源码（已写好，见下文）
└── pkg/                # wasm-pack build 产物目录
```

## 构建方法

```bash
# 在安装了 Rust + wasm-pack 的机器上
rustup target add wasm32-unknown-unknown
wasm-pack build --target web

# 产物在 pkg/ 目录下，会生成：
#   pkg/img_compress_bg.wasm
#   pkg/img_compress.js
#   pkg/img_compress.d.ts
```

## 暴露的 API

所有函数均为同步调用，返回值是 `Result<T, String>`。

### 1. `compress_jpeg(input, quality, max_width, max_height) -> Vec<u8>`

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `&[u8]` | 原始图片的二进制字节（支持 jpeg/png/webp/bmp/gif 输入） |
| `quality` | `u8` | JPEG 质量 1-100，数值越大质量越高文件越大 |
| `max_width` | `u32` | 最大宽度，0 表示不限制（按比例缩放） |
| `max_height` | `u32` | 最大高度，0 表示不限制 |

- **返回**: 压缩后的 JPEG 二进制字节
- **缩放逻辑**: 宽高同时非 0 时，按较小比例等比缩小（Lanczos3 滤波）
- **边界**: quality 自动 clamp 到 1-100

### 2. `compress_png(input, max_width, max_height) -> Vec<u8>`

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `&[u8]` | 原始图片二进制字节 |
| `max_width` | `u32` | 最大宽度，0 不限制 |
| `max_height` | `u32` | 最大高度，0 不限制 |

- **返回**: 压缩后的 PNG 二进制字节（无损压缩）
- **注意**: 主要靠缩放减小体积，PNG 是 lossless 格式

### 3. `compress_webp(input, quality, max_width, max_height) -> Vec<u8>`

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `&[u8]` | 原始图片二进制字节 |
| `quality` | `u8` | WebP 质量 1-100 |
| `max_width` | `u32` | 最大宽度，0 不限制 |
| `max_height` | `u32` | 最大高度，0 不限制 |

- **返回**: 压缩后的 WebP 二进制字节

### 4. `image_info(input) -> String (JSON)`

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | `&[u8]` | 原始图片二进制字节 |

- **返回**: JSON 字符串，格式：
  ```json
  {"width": 1920, "height": 1080, "format": "jpeg"}
  ```
- **format 取值**: `jpeg` / `png` / `gif` / `webp` / `bmp` / `unknown`

## 前端集成方式（Vue 页面用法）

```typescript
import init, * as wasm from './pkg/img_compress.js'

// 1. 初始化 WASM
await init()

// 2. 获取图片信息
const rawBytes = new Uint8Array(await file.arrayBuffer())
const info = JSON.parse(wasm.image_info(rawBytes))
// => { width: 1920, height: 1080, format: 'jpeg' }

// 3. 压缩为 JPEG（质量 80%，最大宽 1920）
const compressed = wasm.compress_jpeg(rawBytes, 80, 1920, 0)
const blob = new Blob([compressed], { type: 'image/jpeg' })
const url = URL.createObjectURL(blob)
```

## Cargo.toml（依赖说明）

```toml
[dependencies]
wasm-bindgen = "0.2"          # WASM 绑定
image = { version = "0.25",   # Rust 图片处理库
  default-features = false,
  features = ["jpeg", "png", "webp"]   # 支持的输出格式
}
```

> **注意**: `image` crate 的 `default-features = false` 减少了编译体积，只启用了 JPEG/PNG/WebP 三种输出格式。输入解码支持的格式更多（由 `image` 内置，包括 bmp/gif 等）。

## 源码

完整源码见 `toolbox/wasm/img-compress/src/lib.rs`，功能说明：

| 函数 | 输入 | 输出 | 核心逻辑 |
|------|------|------|----------|
| `compress_jpeg` | bytes + quality + max_w/h | JPEG bytes | decode → resize(可选) → JPEG encode |
| `compress_png` | bytes + max_w/h | PNG bytes | decode → resize(可选) → PNG encode |
| `compress_webp` | bytes + quality + max_w/h | WebP bytes | decode → resize(可选) → WebP encode |
| `image_info` | bytes | JSON string | decode → 提取宽高 + 魔数识别格式 |

## 产物部署

构建得到的 `pkg/` 目录（含 `.wasm`、`.js`、`.d.ts`）复制到：

```
toolbox/frontend/wasm/img-compress/
```

然后在 Vue 页面中 `import` 即可使用。
