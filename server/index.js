/**
 * Unified Server — 信令 + 留言板 + 部署 Webhook
 * 合并三个 Node.js 进程为一个，节省 ~60MB 内存
 *
 * 路由:
 *   WebSocket /ws  → 文件互传信令
 *   /feedback      → 留言板 API (GET/POST)
 *   /              → 部署 Webhook (POST) / 健康检查 (GET)
 *   /health        → 健康检查
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
        const { name, message, contact } = body;
        if (!message || !message.trim()) { json(res, 400, { error: '请填写反馈内容' }); return; }
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

    // === HEALTH CHECK ===
    if (pathname === '/health' || (pathname === '/' && req.method === 'GET')) {
      json(res, 200, {
        status: 'ok',
        uptime: process.uptime().toFixed(0) + 's',
        rss: (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + ' MB',
        rooms: rooms.size,
      });
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
          if (info.signature && !verifyGitHubSignature(rawBody, info.signature)) {
            log('deploy', `Invalid signature for ${info.repo}`);
            res.writeHead(403); res.end('Invalid signature'); return;
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
