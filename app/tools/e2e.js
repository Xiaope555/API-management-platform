/* ==========================================================================
   端到端自测驱动 —— 用无头 Chrome 直接驱动页面里的真实逻辑
   用法：
     1) node server.js      （App 本地服务，8787。必须先在跑）
     2) node tools/e2e.js   （自动拉起模拟上游 → 跑全部检查 → 收尾）

   e2e.js 会自己启动 tools/mock-upstream.js 并在结束时关掉它。
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.APP || 'http://127.0.0.1:8787/';
const PORT = Number(process.env.DBG_PORT) || 9333;

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonOf(url) {
  const r = await fetch(url, { cache: 'no-store' });
  return r.json();
}

(async () => {
  /* --- 先拉起模拟上游 --- */
  const mock = spawn(process.execPath, [path.join(__dirname, 'mock-upstream.js')], { stdio: 'ignore' });
  try {
    await fetch('http://127.0.0.1:8899/v1/models', { headers: { Authorization: 'Bearer sk-warmup' } });
  } catch (_) {
    await sleep(500);
  }

  const profile = path.join(os.tmpdir(), 'aihub-e2e-' + Date.now());
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,BackForwardCache',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profile,
      '--window-size=900,1000',
      APP,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try { child.kill(); } catch (_) {}
    try { mock.kill(); } catch (_) {}
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

  if (!target) {
    cleanup();
    console.error('FAIL  无法连接到无头 Chrome 的调试端口');
    process.exit(2);
  }

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

  await cmd('Runtime.enable');

  /* 等 boot() 里的 Net.detect() 跑完 */
  for (let i = 0; i < 40; i++) {
    const r = await cmd('Runtime.evaluate', { expression: 'Net.mode()', returnByValue: true });
    if (r.result.value && r.result.value !== 'unknown') break;
    await sleep(200);
  }

  const src = fs.readFileSync(path.join(__dirname, 'e2e-page.js'), 'utf8');
  const r = await cmd('Runtime.evaluate', {
    expression: src,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  let out;
  if (r.exceptionDetails) {
    const ex = r.exceptionDetails;
    out = { pass: 0, total: 0, steps: [], fatal: (ex.exception && ex.exception.description) || ex.text };
  } else {
    out = r.result.value;
  }

  ws.close();
  cleanup();

  if (out.fatal) {
    console.log('FATAL 页面执行异常：');
    console.log(out.fatal);
    process.exit(1);
  }

  console.log('');
  (out.steps || []).forEach((s) => {
    console.log((s.pass ? '  OK  ' : '  **  ') + pad(s.name, 46) + (s.pass ? '' : '   got=' + JSON.stringify(s.got)));
  });
  console.log('');
  console.log('结果：' + out.pass + ' / ' + out.total + ' 通过');
  process.exit(out.pass === out.total ? 0 : 1);
})();
