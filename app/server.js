/**
 * AI API Hub — 本地服务
 *
 * 职责只有三件：
 *   1. 托管 www/ 里的前端静态资源
 *   2. /api/proxy  —— 代替浏览器去请求各家大模型 API（浏览器直连会被 CORS 拦掉）
 *   3. /api/health —— 前端用它判断"我现在跑在 Web 版还是 APK 版"
 *
 * 零依赖，只用 Node 内置模块。只绑 127.0.0.1，不对外暴露。
 *
 * 命令行参数：
 *   --open        启动后自动打开浏览器
 *   --port=8899   指定端口（默认 8787；被占用会自动往后试）
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, 'www');
const HOST = '127.0.0.1';
const VERSION = '1.2.4';

const argv = process.argv.slice(2);
const wantOpen = argv.indexOf('--open') >= 0 || process.env.AIHUB_OPEN === '1';
const portArg = (argv.filter((a) => /^--port=/.test(a))[0] || '').split('=')[1];
const BASE_PORT = Number(portArg || process.env.PORT) || 8787;
const PORT_TRIES = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(code, Object.assign({ 'Content-Length': buf.length }, headers));
  res.end(buf);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 把上游返回的错误归类，前端据此给出不同的处理建议 */
function classifyHttpStatus(status) {
  if (status === 401) return 'auth_invalid';
  if (status === 403) return 'auth_forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'upstream_error';
  if (status >= 400) return 'bad_request';
  return 'ok';
}

/* ------------------------------------------------------------------ */
/* /api/proxy                                                          */
/* ------------------------------------------------------------------ */

async function handleProxy(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'use POST' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { ok: false, kind: 'bad_request', message: 'invalid json: ' + e.message });
  }

  const url = payload && payload.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return sendJson(res, 400, { ok: false, kind: 'bad_request', message: 'url must be http(s)' });
  }

  const method = (payload.method || 'POST').toUpperCase();
  const headers = Object.assign({}, payload.headers || {});
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 60000, 1000), 300000);

  /* GET / HEAD 带 body 会被 fetch 直接拒掉（UND_ERR_REQ_CONTENT_LENGTH_MISMATCH 之类），
     所以只有真的有 body、且不是 GET 时才发 */
  let body;
  if (payload.body != null && method !== 'GET' && method !== 'HEAD') {
    body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body);
  }

  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch(url, { method, headers, body, signal: ac.signal, redirect: 'follow' });
    const text = await r.text();
    clearTimeout(timer);
    return sendJson(res, 200, {
      ok: true,
      status: r.status,
      statusText: r.statusText,
      kind: classifyHttpStatus(r.status),
      headers: { 'content-type': r.headers.get('content-type') || '' },
      body: text,
      latencyMs: Date.now() - started,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');
    return sendJson(res, 200, {
      ok: false,
      kind: aborted ? 'timeout' : 'network',
      message: aborted
        ? `请求在 ${Math.round(timeoutMs / 1000)} 秒内未收到响应，已主动中断`
        : String((e && e.message) || e),
      latencyMs: Date.now() - started,
    });
  }
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const target = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));

  // 防目录穿越
  if (!target.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用：未知路径回退到 index.html
      if (!path.extname(rel)) {
        return fs.readFile(path.join(ROOT, 'index.html'), (e2, buf) => {
          if (e2) return send(res, 404, 'not found');
          send(res, 200, buf, { 'Content-Type': MIME['.html'] });
        });
      }
      return send(res, 404, 'not found');
    }
    fs.readFile(target, (e3, buf) => {
      if (e3) return send(res, 500, 'read error');
      const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    });
  });
}

/* ------------------------------------------------------------------ */

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch (_) {
    return send(res, 400, 'bad request');
  }

  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: 'ai-api-hub', version: VERSION, runtime: 'web', port: actualPort });
  }
  if (pathname === '/api/proxy') return handleProxy(req, res);
  if (pathname === '/api/shutdown') {
    sendJson(res, 200, { ok: true, message: '正在停止' });
    console.log('\n  收到退出请求，服务已停止。\n');
    setTimeout(() => process.exit(0), 120);
    return;
  }

  return handleStatic(req, res, pathname);
});

/* ---------- 端口：被占用就往后试，别让用户去改代码 ---------- */

let actualPort = BASE_PORT;
let tries = 0;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < PORT_TRIES) {
    tries++;
    actualPort = BASE_PORT + tries;
    console.log(`  端口 ${actualPort - 1} 被占用，换到 ${actualPort} 再试…`);
    setTimeout(() => server.listen(actualPort, HOST), 60);
    return;
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ${BASE_PORT} ~ ${BASE_PORT + PORT_TRIES} 全都被占用了。`);
    console.error('  指定一个空闲端口再试，例如：  node server.js --port=9000\n');
  } else {
    console.error('  服务启动失败：', e.message);
  }
  process.exit(1);
});

server.on('listening', () => {
  const url = `http://${HOST}:${actualPort}`;
  console.log('');
  console.log('  AI API Hub 已启动');
  console.log('  ──────────────────────────────────────────');
  console.log(`  用浏览器打开：  ${url}`);
  console.log('  数据全部存在浏览器本地（localStorage），不上云');
  console.log('');
  console.log('  想关掉：关掉这个黑窗口，或在页面「设置 → 退出程序」里点一下');
  console.log('');

  if (wantOpen) openBrowser(url);
});

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      /* 用 start 走系统默认浏览器。cmd /c start 的第一个参数会被当成窗口标题，
         所以得先给一个空标题。 */
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (_) {
    /* 打不开就算了，反正地址已经打在控制台上了 */
  }
}

server.listen(BASE_PORT, HOST);
