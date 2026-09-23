/**
 * AI API Hub — 本地服务
 *
 * 职责只有三件：
 *   1. 托管 www/ 里的前端静态资源
 *   2. /api/proxy  —— 代替浏览器去请求各家大模型 API（浏览器直连会被 CORS 拦掉）
 *   3. /api/health —— 前端用它判断"我现在跑在 Web 版还是 APK 版"
 *
 * 零依赖，只用 Node 内置模块。只绑 127.0.0.1，不对外暴露。
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'www');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const VERSION = '1.0.0';

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

function readBody(req, limit = 4 * 1024 * 1024) {
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

  let body;
  if (payload.body != null) {
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
    return sendJson(res, 200, { ok: true, app: 'ai-api-hub', version: VERSION, runtime: 'web' });
  }
  if (pathname === '/api/proxy') return handleProxy(req, res);

  return handleStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  AI API Hub 已启动');
  console.log('  ──────────────────────────────────────────');
  console.log(`  打开浏览器访问：http://${HOST}:${PORT}`);
  console.log(`  代理接口：      http://${HOST}:${PORT}/api/proxy`);
  console.log('  数据全部存在浏览器本地（localStorage），不上云');
  console.log('');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。换一个端口再试，例如：  PORT=8899 node server.js`);
  } else {
    console.error('服务启动失败：', e.message);
  }
  process.exit(1);
});
