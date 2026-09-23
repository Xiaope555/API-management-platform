/* ==========================================================================
   AI API Hub — 路由、导航、发送逻辑
   ========================================================================== */

'use strict';

/* ------------------------------------------------------------ 路由状态 */

let route = { name: 'overview', param: null, edit: null };
let stack = [];

const TITLES = {
  overview: '总览',
  verify: '接口验证',
  logs: '调用日志',
  settings: '设置',
};

const TABS = [
  { name: 'overview', label: '总览' },
  { name: 'verify', label: '验证' },
  { name: 'logs', label: '日志' },
  { name: 'settings', label: '设置' },
];

/* ------------------------------------------------------------ 图标 */

const ICON = {
  grid: '<svg viewBox="0 0 16 16" fill="none"><rect x="1.6" y="1.6" width="5.4" height="5.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="1.6" width="5.4" height="5.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="1.6" y="9" width="5.4" height="5.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5.4" height="5.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-width="1.4"/><path d="M5.2 8.2l2 2 3.6-4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  tune: '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4.5h12M2 11.5h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5.6" cy="4.5" r="1.9" fill="currentColor"/><circle cx="10.4" cy="11.5" r="1.9" fill="currentColor"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M13.4 5.6L7.9 11l5.5 5.4" stroke="#22201D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  send: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V3.4M8 3.4L3.8 7.6M8 3.4L12.2 7.6" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* ------------------------------------------------------------ 渲染 */

function render() {
  renderNav();
  renderTabbar();
  renderView();
  renderInputBar();
}

function renderNav() {
  const el = $('#nav');
  const r = route;

  if (r.name === 'account') {
    const a = Store.account(r.param);
    const p = a ? Store.platform(a.platformId) : null;
    el.innerHTML =
      '<button class="icon-btn" data-back>' + ICON.back + '</button>' +
      '<div class="nav-left"><div>' +
        '<div class="nav-title">' + esc(a ? a.label : '账号') + '</div>' +
        '<div class="nav-sub">' + esc(p ? p.name : '') + '</div>' +
      '</div></div>' +
      '<button class="nav-action" data-edit>编辑</button>';
    el.querySelector('[data-back]').addEventListener('click', back);
    el.querySelector('[data-edit]').addEventListener('click', () => go('add', null, r.param));
    return;
  }

  if (r.name === 'add') {
    const editing = !!r.edit;
    el.innerHTML =
      '<button class="icon-btn" data-back>' + ICON.back + '</button>' +
      '<div class="nav-left"><div class="nav-title">' + (editing ? '编辑账号' : '添加账号') + '</div></div>';
    el.querySelector('[data-back]').addEventListener('click', back);
    return;
  }

  let action = '';
  if (r.name === 'overview') action = '<button class="nav-action" data-act="add">＋ 添加</button>';
  else if (r.name === 'verify') action = '<button class="nav-action" data-act="logs">验证记录</button>';
  else if (r.name === 'logs') action = '<button class="nav-action" data-act="verify">去验证</button>';

  el.innerHTML = '<div class="nav-left"><div class="nav-title">' + esc(TITLES[r.name] || '') + '</div></div>' + action;

  const btn = el.querySelector('[data-act]');
  if (btn) {
    const act = btn.getAttribute('data-act');
    btn.addEventListener('click', () => { if (act === 'add') go('add'); else go(act); });
  }
}

function renderTabbar() {
  const el = $('#tabbar');
  const onTab = TABS.some((t) => t.name === route.name);
  if (!onTab) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div class="tab-inner">' + TABS.map((t) =>
    '<button class="tab' + (t.name === route.name ? ' on' : '') + '" data-tab="' + t.name + '">' +
    ICON[t.name === 'overview' ? 'grid' : t.name === 'verify' ? 'check' : t.name === 'logs' ? 'list' : 'tune'] +
    '<span>' + esc(t.label) + '</span></button>'
  ).join('') + '</div>';
  $$('[data-tab]', el).forEach((b) => b.addEventListener('click', () => go(b.getAttribute('data-tab'))));
}

function renderView() {
  const root = $('#view');
  root.innerHTML = '';
  root.scrollTop = 0;
  const fn = Screens[route.name] || Screens.overview;
  fn(root, route);
}

function renderInputBar() {
  const phone = $('#phone');
  const existing = $('#inputbar');

  if (route.name !== 'verify' || !Store.accounts().length) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const bar = document.createElement('div');
  bar.className = 'input-bar';
  bar.id = 'inputbar';
  bar.innerHTML =
    '<div class="ib-field" id="ib-field" contenteditable="true" role="textbox" ' +
      'data-ph="输入一句话，测试接口是否可用…"></div>' +
    '<button class="ib-send" id="ib-send" title="发送">' + ICON.send + '</button>';

  const tabbar = $('#tabbar');
  phone.insertBefore(bar, tabbar);

  const field = $('#ib-field');
  const send = $('#ib-send');

  send.addEventListener('click', () => {
    const text = field.textContent.trim();
    field.textContent = '';
    sendMessage(text);
  });

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = field.textContent.trim();
      field.textContent = '';
      sendMessage(text);
    }
  });
}

function scrollViewToBottom() {
  const v = $('#view');
  if (v) v.scrollTop = v.scrollHeight;
}

/* ------------------------------------------------------------ 发送 */

async function sendMessage(text) {
  if (!text) return;
  if (VS.busy) { UI.toast('上一条还在等回复'); return; }

  const acct = Store.account(VS.accountId);
  if (!acct) { UI.toast('先选一个账号', 'err'); return; }
  if (!VS.model) { UI.toast('先选一个模型', 'err'); return; }

  VS.messages.push({ role: 'user', content: text });
  VS.messages.push({ role: 'pending' });
  VS.busy = true;
  VS.last = null;
  render();
  scrollViewToBottom();

  const s = Store.settings();
  const history = VS.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const r = await Api.chat(acct, VS.model, history, s.verifyMaxTokens, s.timeoutMs);

  VS.messages = VS.messages.filter((m) => m.role !== 'pending');
  VS.busy = false;

  const base = {
    accountId: acct.id,
    platformId: acct.platformId,
    model: VS.model,
    kind: 'verify',
  };

  if (r.ok) {
    const tokTxt = r.totalTok != null
      ? (r.tokEstimated ? '≈' : '') + num(r.totalTok) + ' tokens' + (r.tokEstimated ? '（估）' : '')
      : ((r.inTok != null || r.outTok != null) ? '入' + num(r.inTok) + '/出' + num(r.outTok) : '无 usage 返回');
    VS.messages.push({
      role: 'assistant',
      content: r.text || (r.reasoningLen
        ? '（这个模型只返回了推理内容，没有正文。接口本身是通的）'
        : '（接口返回了空内容，但这本身也是有效响应）'),
      ok: true,
      meta: 'HTTP ' + r.status + ' · ' + (r.latencyMs / 1000).toFixed(2) + 's · ' + tokTxt + (r.streamed ? ' · 流式' : ''),
    });
    VS.last = {
      ok: true, status: r.status, latencyMs: r.latencyMs,
      totalTok: r.totalTok, cost: r.cost, hasPrice: r.hasPrice, model: VS.model,
      tokEstimated: r.tokEstimated, streamed: r.streamed, chunks: r.chunks,
      emptyText: r.emptyText, reasoningLen: r.reasoningLen, finishReason: r.finishReason,
    };
    Store.addLog(Object.assign({}, base, {
      status: 'ok', code: r.status,
      inTok: r.inTok, outTok: r.outTok, tokEstimated: r.tokEstimated,
      latencyMs: r.latencyMs, costCNY: r.cost, streamed: r.streamed,
      preview: String(r.text || '').slice(0, 240),
    }));
    UI.toast(r.emptyText ? '接口连通，但没返回正文' : '接口可用 · ' + (r.latencyMs / 1000).toFixed(2) + 's', r.emptyText ? '' : 'ok');
  } else {
    const info = failInfo(r.kind);
    VS.last = {
      ok: false, kind: r.kind, status: r.status, latencyMs: r.latencyMs,
      message: r.message || info.msg, raw: r.raw, model: VS.model,
      streamed: r.streamed,
      request: { method: 'POST', url: (r.request && r.request.url) || '', model: VS.model, timeoutMs: (r.request && r.request.timeoutMs) || s.timeoutMs },
    };
    Store.addLog(Object.assign({}, base, {
      status: 'err', code: r.status, kind: r.kind,
      inTok: r.inTok != null ? r.inTok : null,
      outTok: r.outTok != null ? r.outTok : null,
      latencyMs: r.latencyMs, costCNY: null,
      errorMsg: r.message || info.msg,
    }));
    UI.toast(info.title, 'err');
  }

  render();
  scrollViewToBottom();
}

/* ------------------------------------------------------------ 导航 */

function go(name, param, edit) {
  stack.push({ name: route.name, param: route.param, edit: route.edit });
  route = { name: name, param: param || null, edit: edit || null };
  if (name === 'add') Screens.add._pid = Screens.add._pid || 'openai';
  syncHash();
  render();
}

function back() {
  const prev = stack.pop();
  route = prev || { name: 'overview', param: null, edit: null };
  syncHash();
  render();
}

function syncHash() {
  let h = '#/' + route.name + (route.param ? '/' + route.param : '');
  if (history.replaceState) history.replaceState(null, '', h);
}

/* ------------------------------------------------------------ 启动 */

/** 解析 #/name/param，支持刷新后停在原页面 */
function parseHash() {
  const raw = String(window.location.hash || '').replace(/^#\/?/, '');
  if (!raw) return null;
  const parts = raw.split('/');
  const name = parts[0];
  if (!name) return null;
  if (!TITLES[name] && !Screens[name]) return null;
  return { name: name, param: parts[1] ? decodeURIComponent(parts[1]) : null, edit: null };
}

(function boot() {
  Store.load();

  const deep = parseHash();
  if (deep) route = deep;

  /* 时钟 */
  function tick() {
    const d = new Date();
    const el = $('#clock');
    if (el) el.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  tick();
  setInterval(tick, 20000);

  /* 网络模式检测 → 之后才渲染，设置页要显示真实模式 */
  Net.detect().then((mode) => {
    render();
    if (mode === 'direct') {
      setTimeout(() => UI.toast('当前是直连模式，调 API 可能被浏览器跨域拦截。建议用 npm start 打开。', 'err'), 900);
    }
  });

  /* 浏览器返回键 */
  window.addEventListener('popstate', () => {
    if (stack.length) { back(); }
  });

  /* 状态栏高度适配（移动端）
     view 的高度由 flex 决定，这里只需要在真机上补安全区 */
  if (window.CSS && CSS.supports && CSS.supports('padding-bottom: env(safe-area-inset-bottom)')) {
    const tb = $('#tabbar');
    if (tb) tb.style.paddingBottom = 'calc(8px + env(safe-area-inset-bottom))';
  }

  /* 首次进入给个提示 */
  setTimeout(() => {
    if (!Store.accounts().length && route.name === 'overview') {
      UI.toast('还没有账号，先添加一个，或载入演示数据看看');
    }
  }, 1200);
})();
