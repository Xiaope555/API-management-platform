/* ==========================================================================
   截取干净的应用截图（用于 README）。
   和 e2e.js 一样走无头 Chrome + CDP，但用 Page.captureScreenshot 的 clip
   精确裁到应用本体上 —— 不会有窗口边框、调试面板之类的杂物。

   两个视口各拍一组：
     desktop  1440×900   电脑端：左侧固定导航 + 右侧宽内容区
     mobile    390×780   手机端：顶部栏 + 底部 Tab，表格降级成卡片

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

const VIEWS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 780 },
};

/* 接口验证页：直接把一次「流式」调用的结果摆出来，
   免得上游没通时截出来是空页面。 */
const VERIFY_PREP = `(function () {
  var a = Store.accounts()[0];
  VS.accountId = a.id;
  VS.model = a.defaultModel || 'gpt-4o-mini';
  VS.models = ['gpt-4o-mini', 'gpt-4o', 'o3-mini'];
  VS.messages = [
    { role: 'user', content: '用一句话说明你是什么模型' },
    { role: 'assistant', content: '我是 gpt-4o-mini，一个面向日常任务的语言模型。',
      ok: true, meta: 'HTTP 200 · 1.24s · 60 tokens（估） · 流式' }
  ];
  /* 结果卡按「上游硬吐 SSE」这条真实路径来摆：流式响应 + 分片数 + usage 估算 */
  VS.last = {
    ok: true, status: 200, latencyMs: 1240,
    totalTok: 60, cost: 0.000175, hasPrice: true, model: VS.model,
    tokEstimated: true, streamed: true, chunks: 14,
    emptyText: false, reasoningLen: 0, finishReason: 'stop'
  };
  VS.busy = false;
})()`;

/* mode:
     page     整页高度（内容长了就一起拍下来，适合展示一屏放不下的页面）
     viewport 只拍视口那一屏
     sheet    按弹层实际高度裁，避免下半截全是空白
   默认是 viewport。 */
const SHOTS = [
  { file: '01-overview.png', view: 'desktop', nav: "go('overview')", mode: 'page' },
  { file: '02-verify.png', view: 'desktop', prep: VERIFY_PREP, nav: "go('verify')" },
  { file: '03-logs.png', view: 'desktop', nav: "go('logs')" },
  { file: '04-account.png', view: 'desktop', nav: "go('account','ac_demo5')" },
  {
    /* 中转站账号的余额只能登录面板读 —— 这一张专门拍登录弹层 */
    file: '05-panel-login.png',
    view: 'desktop',
    nav: "go('account','ac_demo5')",
    after: "panelLoginSheet(Store.account('ac_demo5'), Store.platform('custom'))",
    mode: 'sheet',
  },
  { file: '06-add.png', view: 'desktop', nav: "go('add','custom')" },
  { file: '07-settings.png', view: 'desktop', nav: "go('settings')", mode: 'page' },
  {
    /* 窄屏抽屉导航 */
    file: '08-mobile.png',
    view: 'mobile',
    nav: "go('overview')",
    after: "document.body.classList.add('nav-open')",
  },
  { file: '09-mobile-cards.png', view: 'mobile', nav: "go('logs')" },
  {
    /* 总览页本身（不开抽屉）：顶栏 + 底部 Tab 都在，退得出去 */
    file: '10-mobile-nav.png',
    view: 'mobile',
    nav: "go('overview')",
  },
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
      '--window-size=' + VIEWS.desktop.width + ',' + VIEWS.desktop.height,
      APP,
    ],
    { stdio: 'ignore' }
  );

  const cleanup = () => {
    try { child.kill(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  };

  let target = null;
  /* 要截的页面按 APP 的 host 来匹配 —— 这里别硬编码 8787：
     本机上常常已经有一个服务占着 8787（新起的会顺延到 8788），
     写死端口会变成「Chrome 起来了但匹配不到页面」，报错还看不出原因。 */
  const APP_HOST = (() => { try { return new URL(APP).host; } catch (_) { return '127.0.0.1:8787'; } })();
  for (let i = 0; i < 80; i++) {
    try {
      const list = await jsonOf('http://127.0.0.1:' + PORT + '/json/list');
      target = list.find((t) => t.type === 'page' && String(t.url).indexOf(APP_HOST) >= 0);
      if (target && target.webSocketDebuggerUrl) break;
    } catch (_) {}
    await sleep(250);
  }
  if (!target) { cleanup(); console.error('FAIL 连不上调试端口（没找到 ' + APP + ' 的页面）'); process.exit(2); }

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

  let curView = null;
  async function setView(name) {
    if (curView === name) return;
    const v = VIEWS[name];
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: v.width, height: v.height, deviceScaleFactor: 2, mobile: name === 'mobile',
    });
    curView = name;
    await sleep(250);
  }

  /* 每次拍之前都把数据重置成演示态，保证截图可复现 */
  await evaluate('Store.wipe(); Store.loadDemo();');
  await sleep(300);

  for (const s of SHOTS) {
    await setView(s.view);

    /* 关掉上一张可能残留的弹层 / 抽屉 */
    await evaluate("UI.closeSheet(true); document.body.classList.remove('nav-open');");

    /* prep → nav → after：先摆数据，再切页面，最后触发弹层之类 */
    if (s.prep) await evaluate(s.prep);
    await evaluate(s.nav);
    await evaluate('render(); scrollViewToBottom();');
    if (s.after) { await evaluate(s.after); await sleep(420); }
    await sleep(380);

    const v = VIEWS[s.view];
    const mode = s.mode || 'viewport';

    let clip;
    if (mode === 'page') {
      const h = await evaluate("Math.ceil(document.querySelector('#shell').getBoundingClientRect().height)");
      clip = { x: 0, y: 0, width: v.width, height: h, scale: 1 };
    } else if (mode === 'sheet') {
      /* 弹层是垂直居中的，所以要从它的底边算，而不是从它自己的高度算 ——
         否则居中偏下的部分会被裁掉（按钮正好在那一带）。 */
      const bottom = await evaluate(
        "(function () { var el = document.querySelector('.sheet'); if (!el) return 0;" +
        " return Math.ceil(el.getBoundingClientRect().bottom); })()"
      );
      clip = { x: 0, y: 0, width: v.width, height: Math.min(v.height, Math.max(420, bottom + 64)), scale: 1 };
    } else {
      clip = { x: 0, y: 0, width: v.width, height: v.height, scale: 1 };
    }

    const shot = await cmd('Page.captureScreenshot', {
      format: 'png',
      clip: clip,
      captureBeyondViewport: mode === 'page',
      fromSurface: true,
    });

    const out = path.join(OUT, s.file);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('  OK  ' + s.file + '   ' + clip.width + 'x' + clip.height + ' @2x   [' + mode + ']');
  }

  ws.close();
  cleanup();
  process.exit(0);
})();
