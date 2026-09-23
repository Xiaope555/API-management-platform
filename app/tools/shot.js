/* ==========================================================================
   截取干净的应用截图（用于 README）。
   和 e2e.js 一样走无头 Chrome + CDP，但用 Page.captureScreenshot 的 clip
   精确裁到手机容器上 —— 这样不会有窗口边框、调试面板之类的杂物。

   前置：node server.js 已在 8787 跑着
   用法：node tools/shot.js
   产物：<workspace>/screenshots/*.png
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.APP || 'http://127.0.0.1:8787/';
const PORT = Number(process.env.DBG_PORT) || 9344;
const OUT = process.env.OUT || path.join(path.dirname(__dirname), '..', 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { file: '01-overview.png', nav: "go('overview')" },
  { file: '02-verify.png', nav: "go('verify')", prep: `(function () {
      var a = Store.accounts()[0];
      VS.accountId = a.id;
      VS.model = a.defaultModel || 'gpt-4o-mini';
      VS.models = ['gpt-4o-mini', 'gpt-4o', 'o3-mini'];
      VS.messages = [
        { role: 'user', content: '用一句话说明你是什么模型' },
        { role: 'assistant', content: '我是 gpt-4o-mini，一个面向日常任务的语言模型。',
          ok: true, meta: 'HTTP 200 · 1.24s · 52 tokens' }
      ];
      VS.last = { ok: true, status: 200, latencyMs: 1080, totalTok: 68, cost: null, hasPrice: false, model: VS.model };
      VS.busy = false;
    })()` },
  { file: '03-logs.png', nav: "go('logs')" },
  { file: '04-account.png', nav: "go('account', Store.accounts()[0].id)" },
  { file: '05-settings.png', nav: "go('settings')" },
];

async function jsonOf(url) {
  const r = await fetch(url, { cache: 'no-store' });
  return r.json();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const profile = path.join(os.tmpdir(), 'aihub-shot-' + Date.now());
  const child = spawn(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profile,
      '--window-size=900,1000',
      APP,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try { child.kill(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await jsonOf('http://127.0.0.1:' + PORT + '/json/list');
      target = list.find((t) => t.type === 'page' && String(t.url).indexOf('127.0.0.1:8787') >= 0);
      if (target && target.webSocketDebuggerUrl) break;
    } catch (_) {}
    await sleep(250);
  }
  if (!target) { cleanup(); console.error('FAIL 连不上调试端口'); process.exit(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const cmd = (method, params) =>
    new Promise((res, rej) => {
      const id = ++seq;
      waiting.set(id, (m) => (m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result)));
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });

  await cmd('Page.enable');
  await cmd('Runtime.enable');

  async function evaluate(expr) {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result.value;
  }

  /* 等 boot 完成 */
  for (let i = 0; i < 40; i++) {
    const m = await evaluate('Net.mode()');
    if (m && m !== 'unknown') break;
    await sleep(200);
  }

  await evaluate('Store.wipe(); Store.loadDemo(); render();');
  await sleep(300);

  for (const s of SHOTS) {
    // 先摆状态，再导航（页面在渲染时读 VS），最后补一次 render 保证状态已反映到界面
    if (s.prep) { await evaluate(s.prep); }
    await evaluate(s.nav);
    await evaluate('render(); scrollViewToBottom();');
    await sleep(400);

    const rect = await evaluate(
      "(function () { var el = document.querySelector('#phone'); if (!el) return null;" +
      " var r = el.getBoundingClientRect();" +
      " return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()"
    );
    if (!rect) { console.error('FAIL 找不到 #phone'); continue; }

    const shot = await cmd('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 },
      captureBeyondViewport: true,
    });

    const out = path.join(OUT, s.file);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('  OK  ' + s.file + '   ' + rect.w + 'x' + rect.h + ' @2x');
  }

  ws.close();
  cleanup();
  process.exit(0);
})();
