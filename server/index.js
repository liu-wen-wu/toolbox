/**
 * Unified Server — 信令 + 留言板 + 部署 Webhook + 视频转动图
 * 合并多个 Node.js 进程为一个，节省内存
 *
 * 路由:
 *   WebSocket /ws    → 文件互传信令
 *   /feedback        → 留言板 API (GET/POST)
 *   /video2gif       → MP4 → GIF / 动画 WebP 转换 (POST)
 *   /                → 部署 Webhook (POST) / 健康检查 (GET)
 *   /health          → 健康检查
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FFMPEG = '/usr/local/bin/ffmpeg';

const PORT = 9200;
const WS_PATH = '/ws';

// ======================================================================
// 1. 文件互传信令 (WebSocket)
// ======================================================================
const rooms = new Map();
const roomPeerCounters = new Map();
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ======================================================================
// 2. 留言板 API (HTTP)
// ======================================================================
const FEEDBACK_DIR = path.join(__dirname, '..', '..', 'feedback-server', 'data');
const FEEDBACK_FILE = path.join(FEEDBACK_DIR, 'feedback.json');
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
if (!fs.existsSync(FEEDBACK_FILE)) fs.writeFileSync(FEEDBACK_FILE, '[]', 'utf-8');

function readFeedbacks() {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE, 'utf-8')); }
  catch { return []; }
}

function writeFeedbacks(list) {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

// Basic sanitization: strip HTML tags, trim, limit length
function sanitize(str, maxLen = 2000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')    // strip HTML tags
    .replace(/[<>&"']/g, '')    // strip remaining dangerous chars
    .trim()
    .slice(0, maxLen);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ======================================================================
// 3. 部署 Webhook
// ======================================================================
const DEPLOY_CONFIG = path.join(__dirname, '..', 'deploy', 'config.json');
let deployConfig = { github_secret: '', gitee_token: '', projects: [] };
try { deployConfig = JSON.parse(fs.readFileSync(DEPLOY_CONFIG, 'utf-8')); } catch {}

function verifyGitHubSignature(rawBody, signature) {
  if (!deployConfig.github_secret || !signature) return false;
  const algo = signature.startsWith('sha256=') ? 'sha256' : 'sha1';
  const expected = crypto.createHmac(algo, deployConfig.github_secret).update(rawBody).digest('hex');
  const received = signature.replace(/^(sha256=|sha1=)/, '');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function parseRepo(headers, body) {
  const ua = headers['user-agent'] || '';
  if (ua.includes('GitHub-Hookshot')) {
    return {
      repo: body.repository?.full_name,
      branch: (body.ref || '').replace('refs/heads/', ''),
      signature: headers['x-hub-signature-256'] || headers['x-hub-signature'] || ''
    };
  }
  if (ua.includes('git-oschina') || headers['x-gitee-event']) {
    return {
      repo: body.repository?.full_name,
      branch: (body.ref || '').replace('refs/heads/', ''),
      password: body.password || ''
    };
  }
  return { repo: body.repository?.full_name, branch: (body.ref || '').replace('refs/heads/', '') };
}

function runDeploy(project, repo, branch) {
  return new Promise((resolve) => {
    const workdir = project.workdir;
    if (!workdir || !fs.existsSync(workdir)) {
      resolve({ success: false, output: `Workdir not found: ${workdir}` });
      return;
    }
    const cmds = project.deploy || [];
    if (cmds.length === 0) { resolve({ success: true, output: 'No commands' }); return; }
    console.log(`[deploy] ${repo} (${branch}) started`);
    let output = '', idx = 0;
    function next() {
      if (idx >= cmds.length) { console.log(`[deploy] ${repo} done`); resolve({ success: true, output }); return; }
      const cmd = cmds[idx++];
      console.log(`[deploy] step: ${cmd}`);
      const child = spawn('sh', ['-c', cmd], { cwd: workdir, env: { ...process.env, DEPLOY_REPO: repo, DEPLOY_BRANCH: branch } });
      child.stdout.on('data', d => output += d.toString());
      child.stderr.on('data', d => output += d.toString());
      child.on('close', code => {
        if (code !== 0) resolve({ success: false, output: output + `\n[FAIL] exit ${code}` });
        else next();
      });
      child.on('error', e => resolve({ success: false, output: output + `\n[ERROR] ${e.message}` }));
    }
    next();
  });
}

// ======================================================================
// 4. 视频转动图 API (MP4 → GIF / 动画 WebP, ffmpeg 服务端转换)
// ======================================================================
const CONV_MAX_BYTES = 100 * 1024 * 1024;  // 上传上限 100MB
const CONV_MAX_DURATION = 120;             // 时长上限 120s
const CONV_MAX_WIDTH = 1280;               // 宽度上限, 防内存膨胀
const CONV_TIMEOUT_MS = 180 * 1000;        // 转换超时 180s
const CONV_MAX_CONCURRENT = 2;             // 并发上限
let convActive = 0;

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function parseConvParams(url) {
  const fmt = url.searchParams.get('fmt') === 'webp' ? 'webp' : 'gif';
  let fps = Math.round(Number(url.searchParams.get('fps')) || (fmt === 'gif' ? 10 : 12));
  fps = clamp(fps, 1, 30);
  let width = Math.round(Number(url.searchParams.get('width')) || 0);
  if (width !== 0) width = clamp(width, 16, CONV_MAX_WIDTH);
  const lossless = url.searchParams.get('lossless') === '1';
  let quality = Math.round(Number(url.searchParams.get('quality')) || 75);
  quality = clamp(quality, 1, 100);
  return { fmt, fps, width, lossless, quality };
}

// 用 ffmpeg 探测时长 (只解码 1 秒, Duration 从容器头即可读出)
function probeDuration(input) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', input, '-t', '1', '-f', 'null', '-']);
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) { resolve(null); return; }
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    p.on('error', () => resolve(null));
  });
}

function convertVideo(input, output, params) {
  return new Promise((resolve) => {
    const scale = params.width
      ? `scale=${params.width}:-2:flags=lanczos`
      : `scale='min(iw,${CONV_MAX_WIDTH})':-2:flags=lanczos`;
    const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-an',
      '-t', String(CONV_MAX_DURATION)];
    let args;
    if (params.fmt === 'gif') {
      // 两遍调色板法: stats_mode=diff 只统计变化区域 → 色板更准、体积更小
      // sierra2_4a 抖动 → 观感最接近原片; diff_mode=rectangle 减少闪烁
      args = [
        ...base,
        '-vf', `fps=${params.fps},${scale},split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
        '-loop', '0',
        output,
      ];
    } else {
      // 动画 WebP: libwebp, 有损 / 无损
      // 无损时用 level 4 + q75: 输出仍真无损, 但避免 level6+q100 的极限压缩耗时
      args = [
        ...base,
        '-vf', `fps=${params.fps},${scale}`,
        '-c:v', 'libwebp',
        '-loop', '0',
        '-lossless', params.lossless ? '1' : '0',
        '-compression_level', params.lossless ? '4' : '6',
        '-q:v', params.lossless ? '75' : String(params.quality),
        output,
      ];
    }
    const proc = spawn(FFMPEG, args);
    let errOut = '';
    proc.stderr.on('data', d => { errOut += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, CONV_TIMEOUT_MS);
    proc.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 ? null : (errOut.trim() || 'ffmpeg 转换失败'));
    });
    proc.on('error', e => { clearTimeout(timer); resolve('无法启动 ffmpeg: ' + e.message); });
  });
}

function handleVideo2Gif(req, res, url) {
  if (convActive >= CONV_MAX_CONCURRENT) {
    json(res, 429, { error: '服务繁忙，请稍后再试' });
    return;
  }
  const params = parseConvParams(url);
  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const input = path.join('/tmp', `conv-${stamp}.mp4`);
  const output = path.join('/tmp', `conv-${stamp}.${params.fmt}`);
  convActive++;
  log('conv', `${params.fmt} fps=${params.fps} w=${params.width || 'auto'} lossless=${params.lossless} start`);

  let received = 0;
  let aborted = false;
  const ws = fs.createWriteStream(input);
  // 中止时 destroy 可能触发 writev error, 吞噬即可 (文件作废)
  ws.on('error', () => {});

  function cleanup() {
    convActive--;
    fs.unlink(input, () => {});
    fs.unlink(output, () => {});
    ws.destroy();
  }

  req.on('data', c => {
    if (aborted) return;
    received += c.length;
    if (received > CONV_MAX_BYTES) {
      aborted = true;
      const body = JSON.stringify({ error: '文件过大，最大支持 100MB' });
      res.writeHead(413, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      res.on('finish', () => req.destroy());
      cleanup();
      return;
    }
    ws.write(c);
  });
  req.on('error', () => { if (!aborted) { aborted = true; cleanup(); } });
  req.on('end', async () => {
    if (aborted) return;
    await new Promise(r => ws.end(r));
    try {
      const duration = await probeDuration(input);
      if (duration === null) {
        json(res, 422, { error: '无法解析视频，请确认是有效的 MP4 文件' });
        cleanup(); return;
      }
      if (duration > CONV_MAX_DURATION) {
        json(res, 422, { error: `视频过长（${Math.round(duration)}s），最大支持 ${CONV_MAX_DURATION} 秒` });
        cleanup(); return;
      }
      const err = await convertVideo(input, output, params);
      if (err) { json(res, 500, { error: err }); cleanup(); return; }
      const stat = fs.statSync(output);
      const info = JSON.stringify({
        inSize: received, outSize: stat.size,
        duration: Math.round(duration * 10) / 10,
        fps: params.fps, lossless: params.lossless, fmt: params.fmt,
      });
      log('conv', `done ${params.fmt} ${Math.round(duration)}s → ${(stat.size / 1024).toFixed(0)}KB`);
      res.writeHead(200, {
        'Content-Type': params.fmt === 'gif' ? 'image/gif' : 'image/webp',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Convert-Info': info,
      });
      const rs = fs.createReadStream(output);
      rs.pipe(res);
      rs.on('end', cleanup);
      rs.on('error', () => { res.destroy(); cleanup(); });
    } catch (e) {
      json(res, 500, { error: e.message || '转换失败' });
      cleanup();
    }
  });
}

// ======================================================================
// Helpers
// ======================================================================
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function log(prefix, msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] [${prefix}] ${msg}`);
}

// ======================================================================
// HTTP Router
// ======================================================================
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') { json(res, 204, ''); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  try {
    // === FEEDBACK API ===
    if (pathname === '/feedback') {
      if (req.method === 'POST') {
        const body = await parseBody(req);
        let { name, message, contact } = body;
        name = sanitize(name, 50);
        message = sanitize(message, 2000);
        contact = sanitize(contact, 200);
        if (!message) { json(res, 400, { error: '请填写反馈内容' }); return; }
        const feedbacks = readFeedbacks();
        feedbacks.unshift({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: (name || '').trim() || '匿名',
          message: message.trim(),
          contact: (contact || '').trim() || '',
          timestamp: new Date().toISOString(),
        });
        writeFeedbacks(feedbacks);
        json(res, 200, { success: true, message: '感谢反馈 🙏' });
      } else {
        const feedbacks = readFeedbacks();
        json(res, 200, { total: feedbacks.length, items: feedbacks.slice(0, 50) });
      }
      return;
    }

    // === VIDEO2GIF: MP4 → GIF / 动画 WebP ===
    if (pathname === '/video2gif') {
      if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return; }
      handleVideo2Gif(req, res, url);
      return;
    }

    // === HEALTH CHECK ===
    if (pathname === '/health' || (pathname === '/' && req.method === 'GET')) {
      try {
        // Basic dependency: verify feedback data directory is readable
        fs.accessSync(FEEDBACK_DIR, fs.constants.R_OK);
        json(res, 200, {
          status: 'ok',
          uptime: process.uptime().toFixed(0) + 's',
          rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + ' MB',
          rooms: rooms.size,
          timestamp: new Date().toISOString(),
        });
      } catch {
        json(res, 503, {
          status: 'degraded',
          reason: 'feedback data directory not accessible',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    // === DEPLOY WEBHOOK ===
    if (pathname === '/' && req.method === 'POST') {
      let rawBody = '';
      req.on('data', c => rawBody += c);
      req.on('end', async () => {
        try {
          const body = JSON.parse(rawBody);
          const info = parseRepo(req.headers, body);
          if (!info.branch) { json(res, 200, { message: 'Ignored (not a push)' }); return; }
          // GitHub: verify HMAC signature
          if (info.signature) {
            if (!verifyGitHubSignature(rawBody, info.signature)) {
              log('deploy', `Invalid signature for ${info.repo}`);
              res.writeHead(403); res.end('Invalid signature'); return;
            }
          } else {
            // Non-GitHub (Gitea/Gitee/manual): require matching secret in body
            const giteaPass = deployConfig.gitea_secret || deployConfig.gitee_token;
            const bodySecret = body.secret || body.password || '';
            if (bodySecret && (bodySecret === giteaPass || bodySecret === deployConfig.github_secret)) {
              // Gitea webhook secret / Gitee password / manual — OK
            } else {
              log('deploy', `Unauthorized trigger attempt for ${info.repo}`);
              json(res, 403, { error: 'Unauthorized' }); return;
            }
          }
          if (!info.repo) { json(res, 400, { error: 'Unknown repo' }); return; }
          const project = deployConfig.projects.find(p => p.repo === info.repo && (!p.branch || p.branch === info.branch));
          if (!project) { json(res, 200, { message: `No config for ${info.repo}` }); return; }
          json(res, 202, { message: 'Deploy started' });
          const result = await runDeploy(project, info.repo, info.branch);
          log('deploy', `${info.repo}: ${result.success ? 'OK' : 'FAIL'}`);
        } catch (e) {
          if (!res.headersSent) json(res, 500, { error: e.message });
        }
      });
      return;
    }

    // 404
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    json(res, 500, { error: e.message || 'Server error' });
  }
});

// ======================================================================
// WebSocket (信令, only on /ws)
// ======================================================================
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let currentRoom = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.type) {
        case 'create-room': {
          let code; do { code = generateRoomCode(); } while (rooms.has(code));
          rooms.set(code, new Set());
          roomPeerCounters.set(code, 1);
          const peerId = String(roomPeerCounters.get(code));
          ws.peerId = peerId;
          rooms.get(code).add(ws);
          currentRoom = code;
          ws.send(JSON.stringify({ type: 'room-created', room: code, peerId }));
          log('ws', `Room ${code} created, peer=${peerId}`);
          break;
        }

        case 'join-room': {
          const { room } = msg;
          if (!rooms.has(room)) { ws.send(JSON.stringify({ type: 'error', message: '频道不存在' })); return; }
          const peers = rooms.get(room);
          const counter = roomPeerCounters.get(room) + 1;
          roomPeerCounters.set(room, counter);
          const peerId = String(counter);
          const existingPeers = [];
          for (const p of peers) { if (p.readyState === 1) existingPeers.push({ id: p.peerId }); }
          ws.peerId = peerId;
          peers.add(ws);
          currentRoom = room;
          ws.send(JSON.stringify({ type: 'joined', room, peerId, peers: existingPeers }));
          for (const p of peers) {
            if (p !== ws && p.readyState === 1) p.send(JSON.stringify({ type: 'peer-joined', peerId }));
          }
          log('ws', `Peer ${peerId} joined ${room} (now ${peers.size})`);
          break;
        }

        case 'signal': {
          if (!currentRoom || !rooms.has(currentRoom)) return;
          const peers = rooms.get(currentRoom);
          const from = ws.peerId;
          for (const p of peers) {
            if (p !== ws && p.readyState === 1) p.send(JSON.stringify({ type: 'signal', from, data: msg.data }));
          }
          break;
        }

        case 'send-message': {
          if (!currentRoom || !rooms.has(currentRoom)) return;
          const peers = rooms.get(currentRoom);
          const from = ws.peerId;
          if (!from || !msg.text) return;
          for (const p of peers) {
            if (p !== ws && p.readyState === 1) p.send(JSON.stringify({ type: 'relay-message', from, text: msg.text }));
          }
          break;
        }

        case 'leave-room': leaveRoom(); break;
      }
    } catch (e) { log('ws', 'Parse error: ' + e.message); }
  });

  function leaveRoom() {
    if (currentRoom && rooms.has(currentRoom)) {
      const peers = rooms.get(currentRoom);
      const leftPeerId = ws.peerId;
      peers.delete(ws);
      for (const p of peers) { if (p.readyState === 1) p.send(JSON.stringify({ type: 'peer-left', peerId: leftPeerId })); }
      if (peers.size === 0) { rooms.delete(currentRoom); roomPeerCounters.delete(currentRoom); }
      log('ws', `Peer ${leftPeerId} left ${currentRoom} (remaining: ${peers.size})`);
    }
    currentRoom = null;
  }

  ws.on('close', leaveRoom);
  ws.on('error', leaveRoom);
});

// Handle upgrade — only for /ws path
server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== WS_PATH) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch { socket.destroy(); }
});

// ======================================================================
// Start
// ======================================================================
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Unified Server running on :${PORT}   ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║ WS  /ws        → 文件互传信令         ║`);
  console.log(`║ GET /feedback  → 留言板 (列表)        ║`);
  console.log(`║ POST/feedback  → 留言板 (提交)        ║`);
  console.log(`║ POST /         → 部署 Webhook         ║`);
  console.log(`║ GET /health    → 健康检查             ║`);
  console.log(`╠══════════════════════════════════════╣`);
  console.log(`║ RSS: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB                    ║`);
  console.log(`╚══════════════════════════════════════╝`);
});
