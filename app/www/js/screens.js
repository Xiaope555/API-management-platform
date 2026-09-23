/* ==========================================================================
   AI API Hub — 页面渲染
   ========================================================================== */

'use strict';

/* ------------------------------------------------------------ 公共片段 */

function platformLogo(plat) {
  const p = plat || { name: '?', color: '#6BA8A0' };
  const ch = String(p.name || '?').trim().charAt(0).toUpperCase();
  return '<span class="logo" style="background:' + esc(p.color || '#6BA8A0') + '">' + esc(ch) + '</span>';
}

function platformName(id) {
  const p = Store.platform(id);
  return p ? p.name : '未知平台';
}

function platformColor(id) {
  const p = Store.platform(id);
  return p ? (p.color || '#6BA8A0') : '#6BA8A0';
}

function statusTagOf(log) {
  if (!log) return '<span class="tag mute">未验证</span>';
  if (log.status === 'ok') return '<span class="tag ok">' + esc(String(log.code || 200)) + ' OK</span>';
  return '<span class="tag err">' + esc(log.kind === 'timeout' ? '超时' : (log.code || '失败')) + '</span>';
}

function emptyBlock(icon, title, sub, actionHtml) {
  return '<div class="empty">' + (icon || '') +
    '<div class="em-title">' + esc(title) + '</div>' +
    '<div class="em-sub">' + (sub || '') + '</div>' +
    (actionHtml || '') + '</div>';
}

/* ------------------------------------------------------------ 总览 */

const OverviewFilter = { key: 'all' };

const Screens = {};

Screens.overview = function (root) {
  const accounts = Store.accounts();
  const plats = Store.platforms().filter((p) => Store.accountsOf(p.id).length > 0);

  if (!accounts.length) {
    root.innerHTML = emptyBlock(
      '<svg width="42" height="42" viewBox="0 0 42 42" fill="none"><rect x="5" y="9" width="32" height="24" rx="5" stroke="#C2BCB4" stroke-width="1.8"/><path d="M5 17h32" stroke="#C2BCB4" stroke-width="1.8"/><circle cx="12" cy="26" r="2.2" fill="#C2BCB4"/></svg>',
      '还没有接入任何账号',
      '先把你的第一个 API 密钥加进来。<br>数据只存在这台设备上，不会上传。',
      '<div class="stack gap-8" style="width:100%;max-width:220px">' +
        '<button class="btn primary" data-go="add">添加第一个账号</button>' +
        '<button class="btn ghost" data-demo>载入演示数据看看</button>' +
      '</div>'
    );
    root.querySelector('[data-go]').addEventListener('click', () => go('add'));
    root.querySelector('[data-demo]').addEventListener('click', () => {
      Store.loadDemo(); UI.toast('已载入演示数据', 'ok'); render();
    });
    return;
  }

  /* 汇总：可查余额的按数值求和，不可查的单独提示 */
  let sum = 0, cnt = 0, auto = 0;
  accounts.forEach((a) => {
    if (typeof a.balance === 'number') { sum += a.balance; cnt++; }
    if (!a.balanceManual && Store.platform(a.platformId) && Store.platform(a.platformId).balance === 'auto') auto++;
  });
  const lowCount = accounts.filter((a) => typeof a.balance === 'number' && a.balance < 10).length;

  /* 备注：默认展开第一个平台 */
  const expanded = Screens.overview._expanded || (Screens.overview._expanded = {});

  const withBalanceNum = plats.filter((p) => Store.accountsOf(p.id).some((a) => typeof a.balance === 'number')).length;

  let html = '';

  html += '<div class="strip"><div class="stack gap-4">' +
    '<span class="s-lab">' + cnt + ' 个账号已填余额' + (withBalanceNum < plats.length ? ' · ' + (plats.length - withBalanceNum) + ' 个平台待补' : '') + '</span>' +
    '<span class="s-val">¥' + (sum || 0).toFixed(2) + '</span>' +
    '</div>' +
    '<div class="stack gap-4" style="text-align:right">' +
    '<span class="s-lab">账号 / 平台</span>' +
    '<span class="mono w-500" style="font-size:13px">' + accounts.length + ' / ' + plats.length + '</span>' +
    '</div></div>';

  /* 筛选 chips */
  const filters = [
    { key: 'all', label: '全部 ' + accounts.length },
    { key: 'low', label: '余额偏低 ' + lowCount },
    { key: 'auto', label: '可自动查余额 ' + auto },
  ];
  html += '<div class="chips" style="margin-top:12px">' + filters.map((f) =>
    '<button class="chip' + (OverviewFilter.key === f.key ? ' on' : '') + '" data-filter="' + f.key + '">' + esc(f.label) + '</button>'
  ).join('') + '</div>';

  /* 平台卡 */
  const visiblePlats = plats.filter((p) => {
    const list = Store.accountsOf(p.id);
    if (OverviewFilter.key === 'low')  return list.some((a) => typeof a.balance === 'number' && a.balance < 10);
    if (OverviewFilter.key === 'auto') return p.balance === 'auto';
    return true;
  });

  html += '<div class="stack gap-10" style="margin-top:14px">';

  if (!visiblePlats.length) {
    html += '<div class="section-title" style="padding:18px 0;text-align:center">当前筛选下没有平台</div>';
  }

  visiblePlats.forEach((p) => {
    const list = Store.accountsOf(p.id);
    const numList = list.filter((a) => typeof a.balance === 'number');
    const total = numList.reduce((s, a) => s + a.balance, 0);
    const isOpen = !!expanded[p.id];
    const low = numList.filter((a) => a.balance < 10).length;

    let sub = list.length + ' 个账号';
    if (numList.length === list.length) sub += ' · 余额已补齐';
    else if (numList.length) sub += ' · ' + (list.length - numList.length) + ' 个待补余额';
    else sub += ' · 余额待补';
    if (low) sub += ' · ' + low + ' 个偏低';

    html += '<div class="card" data-platwrap="' + esc(p.id) + '">';
    html += '<button class="pf-head" data-toggle="' + esc(p.id) + '">' + platformLogo(p) +
      '<span class="stack gap-4 grow" style="align-items:flex-start">' +
        '<span class="t-md w-500">' + esc(p.name) + '</span>' +
        '<span class="t-xs ' + (low ? 'c-rose' : 'c-3') + '">' + esc(sub) + '</span>' +
      '</span>' +
      '<span class="stack gap-4" style="align-items:flex-end">' +
        '<span class="mono t-md w-600">' + (numList.length ? '¥' + total.toFixed(2) : '—') + '</span>' +
        '<span class="t-xs c-3">' + (isOpen ? '收起 ⌃' : '展开 ⌄') + '</span>' +
      '</span></button>';

    if (isOpen) {
      html += '<div class="pf-body">' + list.map((a) => {
        const amt = typeof a.balance === 'number'
          ? '<span class="a-amt ' + (a.balance < 10 ? 'c-rose' : '') + '">¥' + a.balance.toFixed(2) + '</span>'
          : '<span class="a-amt c-4">未填</span>';
        return '<button class="acct-row" data-acct="' + esc(a.id) + '" style="width:100%;text-align:left">' +
          '<span class="dot ' + (typeof a.balance === 'number' && a.balance < 10 ? 'err' : 'ok') + '"></span>' +
          '<span class="stack gap-4 grow" style="align-items:flex-start">' +
            '<span class="t-md w-500">' + esc(a.label) + '</span>' +
            '<span class="t-xs c-3 mono ellipsis" style="max-width:150px">' + esc(maskKey(a.apiKey)) + '</span>' +
          '</span>' + amt + '<span class="c-3" style="margin-left:6px">›</span></button>';
      }).join('') +
      '<button class="btn soft sm" style="width:100%;margin-top:10px" data-addto="' + esc(p.id) + '">+ 给 ' + esc(p.name) + ' 加账号</button>' +
      '</div>';
    }
    html += '</div>';
  });

  html += '</div>';
  root.innerHTML = html;

  /* 事件 */
  $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => {
    OverviewFilter.key = b.getAttribute('data-filter');
    render();
  }));
  $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.getAttribute('data-toggle');
    expanded[id] = !expanded[id];
    render();
  }));
  $$('[data-acct]', root).forEach((b) => b.addEventListener('click', () => go('account', b.getAttribute('data-acct'))));
  $$('[data-addto]', root).forEach((b) => b.addEventListener('click', () => go('add', b.getAttribute('data-addto'))));
};

/* ------------------------------------------------------------ 接口验证 */

const VS = {
  accountId: null,
  model: '',
  models: [],
  modelsFor: null,
  messages: [],
  busy: false,
  last: null,
};

Screens.verify = function (root) {
  const accounts = Store.accounts();

  if (!accounts.length) {
    root.innerHTML = emptyBlock(
      '<svg width="42" height="42" viewBox="0 0 42 42" fill="none"><circle cx="21" cy="21" r="15" stroke="#C2BCB4" stroke-width="1.8"/><path d="M13.5 21.5l5 5 10-11" stroke="#C2BCB4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '还没有可验证的账号',
      '先添加一个 API 账号，<br>之后就能在这里选模型真实发一次请求。',
      '<button class="btn primary" style="width:100%;max-width:220px" data-go="add">添加账号</button>'
    );
    root.querySelector('[data-go]').addEventListener('click', () => go('add'));
    return;
  }

  if (!VS.accountId || !Store.account(VS.accountId)) VS.accountId = accounts[0].id;
  const acct = Store.account(VS.accountId);
  const plat = Store.platform(acct.platformId);

  if (!VS.model && acct.defaultModel) VS.model = acct.defaultModel;
  if (!VS.model) VS.model = '';

  /* 最近用过的模型，做成快捷 chip */
  VS.quick = Store.logs()
    .filter((l) => l.accountId === acct.id && l.model)
    .map((l) => l.model)
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .slice(0, 4);

  const lastAcctLog = Store.logs().filter((l) => l.accountId === acct.id)[0] || null;

  let html = '';

  /* 目标账号 */
  html += '<div class="card"><button class="pf-head" data-pick-acct>' + platformLogo(plat) +
    '<span class="stack gap-4 grow" style="align-items:flex-start">' +
      '<span class="t-md w-500">' + esc(plat ? plat.name : '未知平台') + ' · ' + esc(acct.label) + '</span>' +
      '<span class="t-xs c-3 mono">' + esc(maskKey(acct.apiKey)) + '</span>' +
    '</span>' + statusTagOf(lastAcctLog) +
    '<span class="c-3" style="margin-left:4px">⌄</span></button></div>';

  /* 模型 */
  html += '<div class="card"><button class="pf-head" data-pick-model>' +
    '<span class="stack gap-4 grow" style="align-items:flex-start">' +
      '<span class="t-xs c-3">当前模型</span>' +
      '<span class="mono t-lg w-600">' + esc(VS.model || '未选择模型') + '</span>' +
    '</span>' +
    '<span class="t-xs ' + (VS.models.length ? 'c-brand' : 'c-3') + '">' + (VS.models.length ? VS.models.length + ' 个可选' : '选模型') + '</span>' +
    '<span class="c-3" style="margin-left:6px">⌄</span></button>';

  if (VS.quick && VS.quick.length) {
    html += '<div class="chips" style="margin-top:10px">' + VS.quick.slice(0, 4).map((m) =>
      '<button class="chip' + (m === VS.model ? ' on' : '') + '" data-model="' + esc(m) + '">' + esc(m) + '</button>'
    ).join('') + '</div>';
  }
  html += '</div>';

  /* 快捷 prompt */
  const prompts = ['打个招呼', '数 3 个数', '自我介绍', '你是谁'];
  html += '<div class="chips" style="margin-top:2px">' + prompts.map((p) =>
    '<button class="chip" data-prompt="' + esc(p) + '">' + esc(p) + '</button>'
  ).join('') + '</div>';

  /* 对话区 */
  html += '<div class="chat" style="margin-top:14px">';

  if (!VS.messages.length) {
    html += '<div class="bubble sys">选好模型后，在下面输入一句话发出去。<br>能正常收到回复，就说明这把密钥可用。</div>';
  }

  VS.messages.forEach((m, idx) => {
    if (m.role === 'user') {
      html += '<div class="bubble user">' + esc(m.content) + '</div>';
    } else if (m.role === 'assistant') {
      html += '<div class="stack gap-4" style="align-self:flex-start;max-width:100%">' +
        '<div class="bubble ai">' + esc(m.content) + '</div>' +
        '<div class="turn-actions"><span class="dot ' + (m.ok ? 'ok' : 'err') + '"></span>' +
        '<span class="t-xs c-3 mono">' + esc(m.meta || '') + '</span></div></div>';
    } else if (m.role === 'pending') {
      html += '<div class="bubble ai"><span class="typing"><i></i><i></i><i></i></span></div>';
    }
  });

  /* 结果卡 */
  if (VS.last && !VS.busy) {
    const r = VS.last;
    const info = failInfo(r.kind);
    if (r.ok) {
      const stats = [
        (r.latencyMs / 1000).toFixed(2) + 's 耗时',
        r.totalTok != null
          ? (r.tokEstimated ? '≈' : '') + num(r.totalTok) + ' tokens' + (r.tokEstimated ? '（估）' : '')
          : '无 usage 返回',
        r.hasPrice ? (r.tokEstimated ? '≈' : '') + money(r.cost) + ' 估算' : '未知单价',
        r.streamed ? '流式响应' + (r.chunks > 1 ? ' ×' + r.chunks : '') : '整体响应',
      ];
      if (r.finishReason) stats.push(esc(r.finishReason));

      html += '<div class="result ok"><div class="r-head">' + iconCheck() +
        '<span class="r-title">' + (r.emptyText ? '接口连通 · 但没返回正文' : '验证通过 · 接口可用') + '</span>' +
        '<span class="r-code">HTTP ' + esc(r.status || 200) + '</span></div>' +
        '<div class="r-stats">' + stats.map((s) => '<span>' + s + '</span>').join('') + '</div>';

      if (r.emptyText) {
        html += '<div class="r-msg">' +
          (r.reasoningLen
            ? '模型只吐了 ' + num(r.reasoningLen) + ' 字推理内容，没给最终正文。'
            : '上游回了 200，但正文是空的。') +
          '接口本身是通的 —— 这通常是这个模型在这家中转站上的输出习惯，换个模型或换个问法再试。</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="result ' + (info.tone === 'mute' ? 'warn' : info.tone) + '"><div class="r-head">' + iconAlert() +
        '<span class="r-title">' + esc(info.title) + '</span>' +
        '<span class="r-code">' + esc(r.status ? 'HTTP ' + r.status : (r.kind === 'timeout' ? 'TIMEOUT' : String(r.kind || '').toUpperCase())) + '</span></div>' +
        '<div class="r-msg">' + esc(r.message || info.msg) + '</div>' +
        '<div class="r-stats"><span>' + (r.latencyMs / 1000).toFixed(2) + 's</span><span>' + esc(r.model || '') + '</span>' +
          (r.streamed ? '<span>流式响应</span>' : '') + '</div>' +
        '</div>';

      /* todo 为空时不要留一个光秃秃的「可能的原因」标题 */
      if (info.todo && info.todo.length) {
        html += '<div class="section-title" style="margin-top:12px">可能的原因</div>';
        html += '<div class="card flat plain stack gap-10" style="margin-top:8px">' +
          info.todo.map((t, i) => '<div class="t-sm" style="line-height:1.6"><span class="c-3 mono">' + (i + 1) + '</span>&nbsp;&nbsp;' + esc(t) + '</div>').join('') +
          '</div>';
      }

      if (r.request) {
        const raw = String(r.raw || r.message || '');
        html += '<div class="diag" style="margin-top:12px"><span class="d-title">请求诊断</span>' +
          esc(r.request.method || 'POST') + ' ' + esc(r.request.url || '') + '\n' +
          'model: ' + esc(r.request.model || '') + '\n' +
          'timeout: ' + Math.round((r.request.timeoutMs || 0) / 1000) + 's\n' +
          '<span class="' + (info.tone === 'warn' ? 'd-warn' : 'd-err') + '">← ' + esc(r.status ? 'HTTP ' + r.status + ' ' : '') + esc(raw.slice(0, 220)) + (raw.length > 220 ? ' …' : '') + '</span>' +
          '</div>';
      }
    }
  }

  html += '</div>';

  if (VS.messages.length) {
    html += '<div style="text-align:center;margin-top:16px">' +
      '<button class="t-sm c-brand" data-clear>清空这轮会话</button></div>';
  }

  root.innerHTML = html;

  /* 事件 */
  root.querySelector('[data-pick-acct]').addEventListener('click', pickAccountSheet);
  root.querySelector('[data-pick-model]').addEventListener('click', pickModelSheet);
  $$('[data-model]', root).forEach((b) => b.addEventListener('click', () => { VS.model = b.getAttribute('data-model'); render(); }));
  $$('[data-prompt]', root).forEach((b) => b.addEventListener('click', () => {
    const p = b.getAttribute('data-prompt');
    const input = $('#ib-field');
    if (input) { input.textContent = p; input.focus(); }
  }));
  const clr = root.querySelector('[data-clear]');
  if (clr) clr.addEventListener('click', () => { VS.messages = []; VS.last = null; render(); });

  scrollViewToBottom();
};

function iconCheck() {
  return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7.6" stroke="#6BA8A0" stroke-width="1.5"/><path d="M5.6 9.2L7.7 11.3L12.4 6.6" stroke="#6BA8A0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function iconAlert() {
  return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7.6" stroke="#C4746E" stroke-width="1.5"/><path d="M9 5.2V10" stroke="#C4746E" stroke-width="1.5" stroke-linecap="round"/><circle cx="9" cy="12.8" r="0.95" fill="#C4746E"/></svg>';
}

/* ---------- 选择账号弹层 ---------- */
function pickAccountSheet() {
  const accounts = Store.accounts();
  UI.openSheet({
    title: '验证哪个账号',
    html: accounts.map((a) => {
      const p = Store.platform(a.platformId);
      return '<button class="mrow' + (a.id === VS.accountId ? ' on' : '') + '" data-id="' + esc(a.id) + '">' +
        platformLogo(p) +
        '<span class="stack gap-4 grow" style="align-items:flex-start">' +
          '<span class="m-name">' + esc(a.label) + '</span>' +
          '<span class="m-sub">' + esc(p ? p.name : '') + ' · ' + esc(maskKey(a.apiKey)) + '</span>' +
        '</span>' + (a.id === VS.accountId ? '<span class="c-brand">当前</span>' : '') + '</button>';
    }).join('') +
    '<div style="margin-top:14px"><button class="btn ghost" data-add>+ 添加新账号</button></div>',
    onMount(sheet) {
      $$('[data-id]', sheet).forEach((b) => b.addEventListener('click', () => {
        VS.accountId = b.getAttribute('data-id');
        VS.messages = []; VS.last = null; VS.models = []; VS.modelsFor = null;
        UI.closeSheet(); render();
      }));
      sheet.querySelector('[data-add]').addEventListener('click', () => { UI.closeSheet(); go('add'); });
    },
  });
}

/* ---------- 选择模型弹层 ---------- */
function pickModelSheet() {
  const acct = Store.account(VS.accountId);
  const common = ['gpt-4o-mini', 'gpt-4o', 'deepseek-chat', 'deepseek-reasoner', 'claude-sonnet-4', 'qwen-plus', 'glm-4-flash', 'moonshot-v1-8k'];
  const list = (VS.modelsFor === acct.id && VS.models.length) ? VS.models : common;

  function row(m) {
    const p = priceOf(m);
    return '<button class="mrow' + (m === VS.model ? ' on' : '') + '" data-m="' + esc(m) + '">' +
      '<span class="stack gap-4 grow" style="align-items:flex-start">' +
        '<span class="m-name">' + esc(m) + '</span>' +
        '<span class="m-sub">' + (p ? '参考单价 入 ¥' + p.in + ' / 出 ¥' + p.out + '（每百万 tokens）' : '未收录单价，费用无法估算') + '</span>' +
      '</span>' + (m === VS.model ? '<span class="c-brand t-sm">当前</span>' : '') + '</button>';
  }

  UI.openSheet({
    title: '选择模型',
    html:
      '<div class="row between" style="padding:2px 0 10px">' +
      '<span class="t-xs c-3">' + (VS.modelsFor === acct.id && VS.models.length ? '来自该账号 /v1/models' : '常用模型（未拉取列表）') + '</span>' +
      '<button class="t-xs c-brand" data-fetch>从账号拉取</button></div>' +
      '<div data-list>' + list.map(row).join('') + '</div>',
    onMount(sheet) {
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (b) {
          VS.model = b.getAttribute('data-m');
          UI.closeSheet(); render(); return;
        }
        const f = e.target.closest('[data-fetch]');
        if (f) fetchModelsFor(acct, sheet);
      });
    },
  });
}

async function fetchModelsFor(acct, sheet) {
  const listEl = sheet.querySelector('[data-list]');
  const btn = sheet.querySelector('[data-fetch]');
  btn.textContent = '拉取中…';
  listEl.innerHTML = '<div class="row" style="padding:20px;justify-content:center"><span class="spin dark"></span></div>';
  const r = await Api.listModels(acct, Store.settings().timeoutMs);
  if (r.ok && r.models.length) {
    VS.models = r.models;
    VS.modelsFor = acct.id;
    listEl.innerHTML = r.models.map(function (m) {
      const p = priceOf(m);
      return '<button class="mrow" data-m="' + esc(m) + '">' +
        '<span class="stack gap-4 grow" style="align-items:flex-start"><span class="m-name">' + esc(m) + '</span>' +
        '<span class="m-sub">' + (p ? '入 ¥' + p.in + ' / 出 ¥' + p.out : '未收录单价') + '</span></span></button>';
    }).join('');
    btn.textContent = '重新拉取';
    UI.toast('拉到 ' + r.models.length + ' 个模型', 'ok');
  } else {
    const info = failInfo(r.kind);
    listEl.innerHTML = '<div class="t-sm c-2" style="padding:16px 0;line-height:1.8">' +
      '拉取失败：' + esc(r.message || info.msg) + '<br><span class="c-3">不影响手动选择模型，直接点上面的常用模型即可。</span></div>';
    btn.textContent = '重试';
  }
}

/* ------------------------------------------------------------ 调用日志 */

const LogFilter = { platform: 'all' };

Screens.logs = function (root) {
  const all = Store.logs();

  if (!all.length) {
    root.innerHTML = emptyBlock(
      '<svg width="42" height="42" viewBox="0 0 42 42" fill="none"><rect x="8" y="6" width="26" height="30" rx="4" stroke="#C2BCB4" stroke-width="1.8"/><path d="M14 15h14M14 21h14M14 27h8" stroke="#C2BCB4" stroke-width="1.8" stroke-linecap="round"/></svg>',
      '还没有调用记录',
      '去「验证」页真发一次请求，<br>这里会自动记下 token、耗时和费用。',
      '<button class="btn primary" style="width:100%;max-width:220px" data-go="verify">去验证一个接口</button>'
    );
    root.querySelector('[data-go]').addEventListener('click', () => go('verify'));
    return;
  }

  /* 近 7 天 */
  const days = [];
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(day0.getTime() - i * 86400000);
    days.push({ key: dayKey(d.getTime()), label: (d.getMonth() + 1) + '/' + d.getDate(), cost: 0, calls: 0, tokens: 0, ms: 0 });
  }
  const idx = {};
  days.forEach((d) => { idx[d.key] = d; });

  let totalCost = 0, totalCalls = 0, totalTok = 0, msSum = 0, msCnt = 0, unknownPrice = 0;
  all.forEach((l) => {
    totalCalls++;
    if (l.inTok != null || l.outTok != null) totalTok += (l.inTok || 0) + (l.outTok || 0);
    if (typeof l.costCNY === 'number') totalCost += l.costCNY; else unknownPrice++;
    if (l.latencyMs) { msSum += l.latencyMs; msCnt++; }
    const k = dayKey(l.ts);
    if (idx[k]) {
      idx[k].calls++;
      if (typeof l.costCNY === 'number') idx[k].cost += l.costCNY;
      idx[k].tokens += (l.inTok || 0) + (l.outTok || 0);
    }
  });

  const maxCost = Math.max.apply(null, days.map((d) => d.cost)) || 1;

  let html = '';
  html += '<div class="card stack gap-10">' +
    '<div class="row between" style="align-items:flex-end">' +
      '<span class="stack gap-4" style="align-items:flex-start">' +
        '<span class="t-xs c-3">近 7 天调用消耗（估算）</span>' +
        '<span class="mono" style="font-size:24px;font-weight:600;letter-spacing:-.6px">' + money(totalCost) + '</span>' +
      '</span>' +
      '<span class="t-xs c-3">' + num(totalCalls) + ' 次调用</span>' +
    '</div>' +
    '<div class="bars">' + days.map((d, i) =>
      '<i class="' + (i === days.length - 1 ? 'today' : '') + '" style="height:' + Math.max(6, Math.round((d.cost / maxCost) * 40)) + 'px"></i>'
    ).join('') + '</div>' +
    '<div class="bars-axis"><span>7 天前</span><span class="c-brand w-500">今天</span></div>' +
    '<div class="divider"></div>' +
    '<div class="row" style="gap:18px;flex-wrap:wrap">' +
      metric(num(totalTok), 'tokens 合计') +
      metric(msCnt ? (msSum / msCnt / 1000).toFixed(2) + 's' : '—', '平均响应') +
      metric(num(days[6].calls), '今天调用') +
    '</div>' +
    (unknownPrice ? '<div class="t-xs c-4">有 ' + unknownPrice + ' 条记录未收录单价，未计入金额</div>' : '') +
    '</div>';

  /* 平台筛选 */
  const pidSet = {};
  all.forEach((l) => { pidSet[l.platformId] = (pidSet[l.platformId] || 0) + 1; });
  const chips = [{ id: 'all', label: '全部 ' + all.length }].concat(
    Object.keys(pidSet).map((pid) => ({ id: pid, label: platformName(pid) + ' ' + pidSet[pid] }))
  );
  if (chips.length > 1) {
    html += '<div class="chips" style="margin-top:12px">' + chips.map((c) =>
      '<button class="chip' + (LogFilter.platform === c.id ? ' on' : '') + '" data-pf="' + esc(c.id) + '">' + esc(c.label) + '</button>'
    ).join('') + '</div>';
  }

  const list = all.filter((l) => LogFilter.platform === 'all' || l.platformId === LogFilter.platform);

  html += '<div class="row between" style="margin-top:16px;margin-bottom:8px">' +
    '<span class="section-title">调用明细</span>' +
    '<button class="t-sm c-brand" data-sort>' + (Screens.logs._byCost ? '按时间排序' : '按费用排序') + '</button></div>';

  const sorted = list.slice().sort((a, b) => Screens.logs._byCost ? ((b.costCNY || 0) - (a.costCNY || 0)) : (b.ts - a.ts));

  html += '<div class="list-card">' + sorted.slice(0, 60).map((l) => {
    const ok = l.status === 'ok';
    const tokTxt = (l.inTok == null && l.outTok == null)
      ? (ok ? '未返回 usage' : '未计费')
      : '入' + num(l.inTok) + '/出' + num(l.outTok);
    const costTxt = typeof l.costCNY === 'number' ? money(l.costCNY) : '—';
    const kindTag = l.kind === 'verify' ? '验证' : '对话';
    return '<button class="lrow" style="width:100%;text-align:left" data-log="' + esc(l.id) + '">' +
      '<span class="dot ' + (ok ? 'ok' : 'err') + '"></span>' +
      '<span class="l-main">' +
        '<span class="l-title"><span class="mono">' + esc(l.model || '未知模型') + '</span>' +
          '<span class="tag mute" style="padding:1px 6px">' + esc(kindTag) + '</span>' +
          '<span class="grow"></span>' +
          '<span class="mono ' + (ok ? '' : 'c-4') + '">' + esc(costTxt) + '</span>' +
        '</span>' +
        '<span class="l-sub row between">' +
          '<span class="ellipsis">' + esc(relTime(l.ts)) + ' · ' + esc(platformName(l.platformId)) + '</span>' +
          '<span class="mono" style="flex:0 0 auto;margin-left:8px">' + esc(tokTxt) + ' · ' + (l.latencyMs / 1000).toFixed(1) + 's</span>' +
        '</span>' +
      '</span></button>';
  }).join('') + '</div>';

  if (sorted.length > 60) {
    html += '<div class="t-xs c-3" style="text-align:center;margin-top:12px">仅显示最近 60 条，共 ' + sorted.length + ' 条</div>';
  }
  html += '<div class="t-xs c-4" style="text-align:center;margin-top:14px;line-height:1.7">入 / 出 = 输入与输出 token · 费用按内置参考单价估算，与平台账单可能有出入</div>';

  root.innerHTML = html;

  $$('[data-pf]', root).forEach((b) => b.addEventListener('click', () => {
    LogFilter.platform = b.getAttribute('data-pf'); render();
  }));
  root.querySelector('[data-sort]').addEventListener('click', () => {
    Screens.logs._byCost = !Screens.logs._byCost; render();
  });
  $$('[data-log]', root).forEach((b) => b.addEventListener('click', () => logDetail(b.getAttribute('data-log'))));
};

function metric(val, label) {
  return '<span class="stack gap-4" style="align-items:flex-start">' +
    '<span class="mono t-md w-500">' + esc(val) + '</span>' +
    '<span class="t-xs c-3">' + esc(label) + '</span></span>';
}

function logDetail(id) {
  const l = Store.logs().filter((x) => x.id === id)[0];
  if (!l) return;
  const info = failInfo(l.kind);
  const rows = [
    ['时间', new Date(l.ts).toLocaleString('zh-CN')],
    ['平台 / 账号', platformName(l.platformId) + ' · ' + ((Store.account(l.accountId) || {}).label || '已删除')],
    ['模型', l.model || '—'],
    ['触发方式', l.kind === 'verify' ? '接口验证' : '对话'],
    ['结果', l.status === 'ok' ? '成功' : (info.title + '（' + (l.code || l.kind) + '）')],
    ['耗时', (l.latencyMs / 1000).toFixed(2) + 's'],
    ['输入 tokens', l.inTok == null ? '未返回' : num(l.inTok)],
    ['输出 tokens', l.outTok == null ? '未返回' : num(l.outTok)],
    ['估算费用', typeof l.costCNY === 'number' ? money(l.costCNY) : '未知单价'],
  ];
  UI.openSheet({
    title: '调用详情',
    html:
      '<div class="stack gap-0" style="margin:4px 0 14px">' + rows.map((r) =>
        '<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line-soft)">' +
        '<span class="t-sm c-3">' + esc(r[0]) + '</span>' +
        '<span class="t-sm mono" style="text-align:right;max-width:200px;word-break:break-all">' + esc(r[1]) + '</span></div>'
      ).join('') + '</div>' +
      (l.preview ? '<div class="t-xs c-3" style="margin-bottom:6px">回复摘要</div><div class="diag">' + esc(l.preview) + '</div>' : '') +
      (l.errorMsg ? '<div class="t-xs c-3" style="margin-bottom:6px">错误信息</div><div class="diag"><span class="d-err">' + esc(l.errorMsg) + '</span></div>' : '') +
      '<div style="margin-top:16px"><button class="btn ghost" data-del>删除这条记录</button></div>',
    onMount(sheet) {
      sheet.querySelector('[data-del]').addEventListener('click', () => {
        Store.removeLog(id); UI.closeSheet(); UI.toast('已删除'); render();
      });
    },
  });
}

/* ------------------------------------------------------------ 账号详情 */

Screens.account = function (root, ctx) {
  const a = Store.account(ctx.param);
  if (!a) { root.innerHTML = emptyBlock('', '账号已不存在', ''); return; }
  const p = Store.platform(a.platformId) || { name: '未知', color: '#6BA8A0', balance: 'manual' };
  const logs = Store.logs().filter((l) => l.accountId === a.id);
  const okCnt = logs.filter((l) => l.status === 'ok').length;
  const cost = logs.reduce((s, l) => s + (l.costCNY || 0), 0);
  const last = logs[0];

  const showKey = !!Screens.account._showKey;

  let html = '';

  /* 余额卡 */
  html += '<div class="card">' +
    '<div class="row between">' +
      '<span class="stack gap-4" style="align-items:flex-start">' +
        '<span class="t-xs c-3">当前余额' + (a.balanceManual ? '（手动填写）' : '') + '</span>' +
        '<span class="mono" style="font-size:22px;font-weight:600;letter-spacing:-.5px">' +
          (typeof a.balance === 'number' ? '¥' + a.balance.toFixed(2) : '未填写') + '</span>' +
      '</span>' +
      '<button class="btn ghost sm" data-bal>' + (p.balance === 'auto' ? '自动查询' : '手动填写') + '</button>' +
    '</div>' +
    (a.balanceUpdatedAt ? '<div class="t-xs c-4" style="margin-top:10px">更新于 ' + esc(relTime(a.balanceUpdatedAt)) + '</div>' : '') +
    '</div>';

  /* 凭证卡 */
  html += '<div class="card stack gap-12" style="margin-top:12px">' +
    '<div class="stack gap-8">' +
      '<div class="row between"><span class="t-xs c-3">API Key</span>' +
      '<button class="t-xs c-brand" data-showkey>' + (showKey ? '隐藏' : '显示') + '</button></div>' +
      '<div class="mono t-sm" style="background:var(--card-2);border-radius:10px;padding:11px 12px;word-break:break-all;line-height:1.6">' +
        esc(showKey ? a.apiKey : maskKey(a.apiKey)) + '</div>' +
      '<div class="row gap-8"><button class="btn soft sm grow" data-copykey>复制密钥</button>' +
      '<button class="btn ghost sm grow" data-copyboth>复制全部</button></div>' +
    '</div>' +
    '<div class="divider"></div>' +
    '<div class="stack gap-8">' +
      '<span class="t-xs c-3">BaseURL</span>' +
      '<div class="mono t-sm" style="background:var(--card-2);border-radius:10px;padding:11px 12px;word-break:break-all;line-height:1.6">' +
        esc(a.baseUrl || '（未填写）') + '</div>' +
      '<button class="btn soft sm" data-copyurl>复制 BaseURL</button>' +
    '</div>' +
    '</div>';

  /* 统计条 */
  html += '<div class="strip" style="margin-top:12px">' +
    '<span class="stack gap-4" style="align-items:flex-start"><span class="s-lab">本机记录调用</span>' +
    '<span class="mono s-val" style="font-size:15px">' + num(logs.length) + ' 次</span></span>' +
    '<span class="stack gap-4" style="align-items:flex-end"><span class="s-lab">成功 / 估算花费</span>' +
    '<span class="mono" style="font-size:15px;font-weight:600">' + num(okCnt) + ' / ' + money(cost) + '</span></span>' +
    '</div>';

  /* 操作 */
  html += '<div class="section-title" style="margin-top:16px">该账号的操作</div>' +
    '<div class="list-card" style="margin-top:8px">' +
    rowAction('去验证这个接口', '真发一次请求，看能不能通', 'verify', true) +
    rowAction('拉取可用模型列表', '调 /v1/models 看该密钥能访问哪些模型', 'models') +
    rowAction('编辑账号信息', '改名称、密钥、BaseURL', 'edit') +
    '</div>';

  /* 最近记录 */
  if (logs.length) {
    html += '<div class="section-title" style="margin-top:16px">最近调用</div><div class="list-card" style="margin-top:8px">' +
      logs.slice(0, 5).map((l) =>
        '<div class="lrow"><span class="dot ' + (l.status === 'ok' ? 'ok' : 'err') + '"></span>' +
        '<span class="l-main"><span class="l-title"><span class="mono">' + esc(l.model) + '</span>' +
        '<span class="grow"></span><span class="mono ' + (l.status === 'ok' ? '' : 'c-4') + '">' +
        (typeof l.costCNY === 'number' ? money(l.costCNY) : '—') + '</span></span>' +
        '<span class="l-sub row between"><span>' + esc(relTime(l.ts)) + '</span>' +
        '<span class="mono">' + (l.latencyMs / 1000).toFixed(1) + 's</span></span></span></div>'
      ).join('') + '</div>';
  }

  html += '<div style="margin-top:18px"><button class="btn danger" data-del>删除这个账号</button></div>';

  root.innerHTML = html;

  root.querySelector('[data-showkey]').addEventListener('click', () => {
    Screens.account._showKey = !showKey; render();
  });
  root.querySelector('[data-copykey]').addEventListener('click', () => UI.copy(a.apiKey, '密钥已复制'));
  root.querySelector('[data-copyurl]').addEventListener('click', () => UI.copy(a.baseUrl, 'BaseURL 已复制'));
  root.querySelector('[data-copyboth]').addEventListener('click', () => UI.copy(
    '平台：' + p.name + '\n账号：' + a.label + '\nAPI Key：' + a.apiKey + '\nBaseURL：' + a.baseUrl, '已复制全部'));
  root.querySelector('[data-bal]').addEventListener('click', () => queryBalance(a, p));
  root.querySelector('[data-del]').addEventListener('click', () => {
    UI.confirmDialog('删除账号', '会同时删掉这个账号在本机的调用记录，且无法恢复。密钥本身不受影响。', () => {
      Store.removeAccount(a.id);
      Screens.account._showKey = false;
      VS.accountId = null; VS.models = []; VS.modelsFor = null;
      back();
    });
  });

  const vBtn = root.querySelector('[data-a-verify]');
  if (vBtn) vBtn.addEventListener('click', () => { VS.accountId = a.id; go('verify'); });
  const mBtn = root.querySelector('[data-a-models]');
  if (mBtn) mBtn.addEventListener('click', () => pullModels(a));
  const eBtn = root.querySelector('[data-a-edit]');
  if (eBtn) eBtn.addEventListener('click', () => go('add', null, a.id));
};

function rowAction(title, sub, kind, accent) {
  return '<button class="lrow" style="width:100%;text-align:left" data-a-' + kind + '>' +
    '<span class="l-main"><span class="l-title"' + (accent ? ' style="color:var(--brand-d)"' : '') + '>' + esc(title) + '</span>' +
    '<span class="l-sub">' + esc(sub) + '</span></span>' +
    '<span class="c-3">›</span></button>';
}

async function queryBalance(a, p) {
  const btn = document.querySelector('[data-bal]');
  if (btn) { btn.textContent = '查询中…'; btn.disabled = true; }
  const r = await Api.balance(a, p);
  if (btn) btn.disabled = false;
  if (r.ok) {
    Store.updateAccount(a.id, { balance: r.balance, balanceManual: false, balanceUpdatedAt: Date.now() });
    UI.toast('余额已更新：' + r.currency + ' ' + r.balance, 'ok');
    render();
  } else if (r.kind === 'unsupported') {
    UI.openSheet({
      title: '手动填写余额',
      html: '<div class="field"><label>当前可用余额（元）</label>' +
        '<input class="input mono" id="bval" type="number" step="0.01" placeholder="例如 52.40" value="' + (typeof a.balance === 'number' ? a.balance : '') + '"></div>' +
        '<div class="hint" style="margin-top:10px">' + esc(r.message) + '。该数字只存在本机，用于总览汇总。</div>' +
        '<div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-close>取消</button>' +
        '<button class="btn primary" data-save>保存</button></div>',
      onMount(sheet) {
        sheet.querySelector('[data-save]').addEventListener('click', () => {
          const v = parseFloat(sheet.querySelector('#bval').value);
          if (isNaN(v)) { UI.toast('请输入数字', 'err'); return; }
          Store.updateAccount(a.id, { balance: v, balanceManual: true, balanceUpdatedAt: Date.now() });
          UI.closeSheet(); UI.toast('已保存', 'ok'); render();
        });
      },
    });
  } else {
    UI.toast(r.message || '查询失败', 'err');
  }
}

async function pullModels(a) {
  UI.openSheet({
    title: '可用模型',
    html: '<div class="row" style="padding:24px;justify-content:center"><span class="spin dark"></span></div>',
    onMount(sheet) {
      Api.listModels(a, Store.settings().timeoutMs).then((r) => {
        const body = sheet.querySelector('.sheet-body');
        if (r.ok && r.models.length) {
          const withPrice = r.models.filter(priceOf).length;
          body.innerHTML = '<div class="t-xs c-3" style="padding:2px 0 10px">共 ' + r.models.length +
            ' 个模型，其中 ' + withPrice + ' 个已收录参考单价 · ' + (r.latencyMs / 1000).toFixed(2) + 's</div>' +
            r.models.map((m) => {
              const pr = priceOf(m);
              return '<div class="mrow"><span class="stack gap-4 grow" style="align-items:flex-start">' +
                '<span class="m-name">' + esc(m) + '</span>' +
                '<span class="m-sub">' + (pr ? '入 ¥' + pr.in + ' / 出 ¥' + pr.out : '未收录单价') + '</span></span></div>';
            }).join('');
        } else {
          const info = failInfo(r.kind);
          body.innerHTML = '<div class="t-sm c-2" style="padding:14px 0;line-height:1.8">' +
            '<b>' + esc(info.title) + '</b><br>' + esc(r.message || info.msg) + '</div>' +
            (r.raw ? '<div class="diag"><span class="d-err">' + esc(String(r.raw).slice(0, 300)) + '</span></div>' : '');
        }
      });
    },
  });
}

/* ------------------------------------------------------------ 添加 / 编辑账号 */

Screens.add = function (root, ctx) {
  const editing = ctx.edit ? Store.account(ctx.edit) : null;
  const presetPid = editing ? editing.platformId : (ctx.param || Screens.add._pid || 'openai');
  const pid = presetPid;
  const plat = Store.platform(pid) || Store.platforms()[1];

  let html = '';
  html += '<div class="field"><label>平台</label><div class="chips" data-plats>' +
    Store.platforms().map((p) =>
      '<button class="chip' + (p.id === pid ? ' on' : '') + '" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>'
    ).join('') + '</div></div>';

  html += '<div class="field" style="margin-top:14px"><label>账号备注</label>' +
    '<input class="input" id="f-label" placeholder="例如：主账号 / 备用账号 / 测试号" value="' +
    esc(editing ? editing.label : '') + '"></div>';

  html += '<div class="field" style="margin-top:14px"><label>API Key</label>' +
    '<input class="input mono" id="f-key" placeholder="粘贴平台的 API 密钥" value="' +
    esc(editing ? editing.apiKey : '') + '" autocomplete="off" spellcheck="false">' +
    '<div class="hint">仅保存在这台设备本地（localStorage），不会上传到任何服务器。' +
    (plat && plat.doc ? ' 没有密钥？<a href="' + esc(plat.doc) + '" data-ext="' + esc(plat.doc) + '" target="_blank" rel="noreferrer">去 ' + esc(plat.name) + ' 申请</a>' : '') + '</div></div>';

  html += '<div class="field" style="margin-top:14px"><label>BaseURL</label>' +
    '<input class="input mono" id="f-url" placeholder="https://api.example.com/v1" value="' +
    esc(editing ? editing.baseUrl : ((plat && plat.baseUrl) || '')) + '">' +
    '<div class="hint">官方地址可直接留默认；用中转站 / 代理就换成对方的地址。带不带 <span class="mono">/v1</span> 都能识别。</div></div>';

  html += '<div class="field" style="margin-top:14px"><label>当前余额（选填）</label>' +
    '<input class="input mono" id="f-bal" type="number" step="0.01" placeholder="不知道该填多少就留空" value="' +
    (editing && typeof editing.balance === 'number' ? editing.balance : '') + '"></div>';

  html += '<div class="field" style="margin-top:14px"><label>默认模型（选填）</label>' +
    '<input class="input mono" id="f-model" placeholder="例如 gpt-4o-mini" value="' +
    esc(editing ? (editing.defaultModel || '') : '') + '"></div>';

  html += '<div class="stack gap-10" style="margin-top:20px">' +
    '<button class="btn primary" data-save>' + (editing ? '保存修改' : '添加账号') + '</button>' +
    (editing ? '' : '<button class="btn ghost" data-save-verify>添加并立即验证</button>') +
    '<div class="hint" style="text-align:center">添加后可以随时在账号详情里改</div></div>';

  root.innerHTML = html;

  let curPid = pid;
  $$('[data-ext]', root).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openExternal(a.getAttribute('data-ext'));
  }));
  $$('[data-pid]', root).forEach((b) => b.addEventListener('click', () => {
    curPid = b.getAttribute('data-pid');
    Screens.add._pid = curPid;
    const p = Store.platform(curPid);
    const urlEl = root.querySelector('#f-url');
    if (urlEl && p && p.baseUrl) urlEl.value = p.baseUrl;
    $$('[data-pid]', root).forEach((x) => x.classList.toggle('on', x.getAttribute('data-pid') === curPid));
  }));

  function collect() {
    const label = root.querySelector('#f-label').value.trim() || '主账号';
    const key = root.querySelector('#f-key').value.trim();
    const url = root.querySelector('#f-url').value.trim();
    const balRaw = root.querySelector('#f-bal').value.trim();
    const model = root.querySelector('#f-model').value.trim();
    if (!key) { UI.toast('请填写 API Key', 'err'); return null; }
    if (!url) { UI.toast('请填写 BaseURL', 'err'); return null; }
    const bal = balRaw === '' ? null : parseFloat(balRaw);
    return {
      platformId: curPid, label: label, apiKey: key, baseUrl: url,
      balance: isNaN(bal) ? null : bal, balanceManual: bal != null,
      balanceUpdatedAt: bal != null ? Date.now() : null,
      defaultModel: model || '',
    };
  }

  root.querySelector('[data-save]').addEventListener('click', () => {
    const data = collect(); if (!data) return;
    if (editing) {
      Store.updateAccount(editing.id, data);
      UI.toast('已保存', 'ok');
      back();
    } else {
      const a = Store.addAccount(data);
      UI.toast('账号已添加', 'ok');
      VS.accountId = a.id; VS.model = a.defaultModel || ''; VS.messages = []; VS.last = null;
      go('account', a.id);
    }
  });

  const sv = root.querySelector('[data-save-verify]');
  if (sv) sv.addEventListener('click', () => {
    const data = collect(); if (!data) return;
    const a = Store.addAccount(data);
    VS.accountId = a.id; VS.model = a.defaultModel || ''; VS.messages = []; VS.last = null;
    VS.models = []; VS.modelsFor = null;
    go('verify');
  });
};

/* ------------------------------------------------------------ 设置 */

Screens.settings = function (root) {
  const accounts = Store.accounts();
  const s = Store.settings();
  const mode = Net.mode();
  const modeText = mode === 'native' ? 'APK 原生请求' : mode === 'proxy' ? '本地服务代理' : '浏览器直连（可能被跨域拦）';
  const modeTone = mode === 'direct' ? 'err' : 'ok';

  let html = '';

  html += '<div class="section-title">账号管理</div>';
  html += '<div class="list-card" style="margin-top:8px">';
  if (!accounts.length) {
    html += '<div class="t-sm c-3" style="padding:16px 0;text-align:center">还没有账号</div>';
  } else {
    accounts.forEach((a) => {
      const p = Store.platform(a.platformId);
      html += '<button class="lrow" style="width:100%;text-align:left" data-acct="' + esc(a.id) + '">' +
        platformLogo(p) +
        '<span class="l-main"><span class="l-title">' + esc(a.label) + '</span>' +
        '<span class="l-sub">' + esc(p ? p.name : '未知平台') + ' · ' + esc(maskKey(a.apiKey)) + '</span></span>' +
        '<span class="mono t-sm c-2">' + (typeof a.balance === 'number' ? '¥' + a.balance.toFixed(2) : '—') + '</span>' +
        '<span class="c-3">›</span></button>';
    });
  }
  html += '</div>';
  html += '<button class="btn ghost" style="width:100%;margin-top:10px" data-go="add">+ 添加账号</button>';

  html += '<div class="section-title" style="margin-top:20px">请求设置</div>';
  html += '<div class="list-card" style="margin-top:8px">' +
    '<div class="lrow"><span class="l-main"><span class="l-title">超时时间</span>' +
    '<span class="l-sub">推理模型建议调到 60s ~ 120s</span></span>' +
    '<select class="select" style="width:96px;padding:8px 10px" data-timeout>' +
      [15000, 30000, 60000, 120000].map((v) =>
        '<option value="' + v + '"' + (s.timeoutMs === v ? ' selected' : '') + '>' + (v / 1000) + 's</option>').join('') +
    '</select></div>' +
    '<div class="lrow"><span class="l-main"><span class="l-title">验证时的 max_tokens</span>' +
    '<span class="l-sub">越小越省，验证够用就行</span></span>' +
    '<select class="select" style="width:96px;padding:8px 10px" data-maxtok>' +
      [32, 64, 128, 256].map((v) =>
        '<option value="' + v + '"' + (s.verifyMaxTokens === v ? ' selected' : '') + '>' + v + '</option>').join('') +
    '</select></div>' +
    '</div>';

  html += '<div class="section-title" style="margin-top:20px">数据</div>';
  html += '<div class="list-card" style="margin-top:8px">' +
    '<button class="lrow" style="width:100%;text-align:left" data-export>' +
    '<span class="l-main"><span class="l-title">导出全部数据</span>' +
    '<span class="l-sub">账号、密钥、调用记录打包成 JSON</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-import>' +
    '<span class="l-main"><span class="l-title">从 JSON 导入</span>' +
    '<span class="l-sub">会覆盖当前全部数据</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-clearlogs>' +
    '<span class="l-main"><span class="l-title">清空调用记录</span>' +
    '<span class="l-sub">保留账号，只清日志（' + Store.logs().length + ' 条）</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-demo>' +
    '<span class="l-main"><span class="l-title">载入演示数据</span>' +
    '<span class="l-sub">会写入几个假账号和假记录，用来看效果</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-wipe>' +
    '<span class="l-main"><span class="l-title c-rose">清空全部数据</span>' +
    '<span class="l-sub">账号、密钥、记录全部删除，不可恢复</span></span><span class="c-3">›</span></button>' +
    '</div>';

  html += '<div class="section-title" style="margin-top:20px">运行环境</div>';
  html += '<div class="card flat plain stack gap-10" style="margin-top:8px">' +
    '<div class="row between"><span class="t-sm c-2">网络模式</span>' +
    '<span class="tag ' + modeTone + '">' + esc(modeText) + '</span></div>' +
    '<div class="row between"><span class="t-sm c-2">明文密钥存储</span>' +
    '<span class="tag warn">本机 localStorage</span></div>' +
    '<div class="row between"><span class="t-sm c-2">版本</span><span class="t-sm mono">v' + esc(APP_VERSION) + '</span></div>' +
    '<div class="t-xs c-4" style="line-height:1.7">密钥以明文存在浏览器本地存储里，方便随时复制。共用电脑时，用完建议导出备份后「清空全部数据」。</div>' +
    '</div>';

  root.innerHTML = html;

  $$('[data-acct]', root).forEach((b) => b.addEventListener('click', () => go('account', b.getAttribute('data-acct'))));
  root.querySelector('[data-go]').addEventListener('click', () => go('add'));
  root.querySelector('[data-timeout]').addEventListener('change', (e) => Store.setSetting('timeoutMs', Number(e.target.value)));
  root.querySelector('[data-maxtok]').addEventListener('change', (e) => Store.setSetting('verifyMaxTokens', Number(e.target.value)));

  root.querySelector('[data-export]').addEventListener('click', () => {
    const json = Store.exportJson();
    const stamp = new Date().toISOString().slice(0, 10);
    const name = 'ai-api-hub-backup-' + stamp + '.json';

    /* 安卓 WebView 里 <a download> 是不生效的，点了没有任何反应。
       所以在原生壳里改成「把内容摆出来 + 一键复制」，用户可以自己存到文件。 */
    if (typeof inNativeShell === 'function' && inNativeShell()) {
      UI.openSheet({
        title: '导出全部数据',
        html: '<div class="field"><label>备份内容（' + name + '）</label>' +
          '<textarea class="textarea mono" id="exp" readonly style="min-height:160px;font-size:10px"></textarea></div>' +
          '<div class="hint" style="margin-top:8px">手机端不能直接下载文件。点下面的按钮复制走，' +
          '再粘贴到备忘录或电脑上的 .json 文件里保存。</div>' +
          '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-close>关闭</button>' +
          '<button class="btn primary" data-copy>复制全部内容</button></div>',
        onMount(sheet) {
          const ta = sheet.querySelector('#exp');
          ta.value = json;
          sheet.querySelector('[data-copy]').addEventListener('click', () => {
            ta.select();
            UI.copy(json, '备份内容已复制');
          });
        },
      });
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    UI.toast('已导出备份文件', 'ok');
  });

  root.querySelector('[data-import]').addEventListener('click', () => {
    UI.openSheet({
      title: '从 JSON 导入',
      html: '<div class="field"><label>粘贴备份内容</label>' +
        '<textarea class="textarea mono" id="imp" style="min-height:140px;font-size:10px" placeholder="把备份文件内容粘贴到这里"></textarea></div>' +
        '<div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-close>取消</button>' +
        '<button class="btn primary" data-do>导入并覆盖</button></div>',
      onMount(sheet) {
        sheet.querySelector('[data-do]').addEventListener('click', () => {
          try {
            Store.importJson(sheet.querySelector('#imp').value.trim());
            UI.closeSheet(); UI.toast('导入成功', 'ok'); VS.accountId = null; render();
          } catch (e) { UI.toast('导入失败：' + e.message, 'err'); }
        });
      },
    });
  });

  root.querySelector('[data-clearlogs]').addEventListener('click', () => {
    UI.confirmDialog('清空调用记录', '只删除调用日志，账号和密钥保留。', () => {
      Store.clearLogs(); UI.toast('已清空记录', 'ok'); render();
    }, '清空记录');
  });

  root.querySelector('[data-demo]').addEventListener('click', () => {
    UI.confirmDialog('载入演示数据', '会覆盖当前账号与记录，写入 4 个假账号和 6 条假调用记录。旧数据不会保留。', () => {
      Store.loadDemo(); VS.accountId = null; UI.toast('已载入演示数据', 'ok'); render();
    }, '载入');
  });

  root.querySelector('[data-wipe]').addEventListener('click', () => {
    UI.confirmDialog('清空全部数据', '账号、密钥、调用记录会全部删除，无法恢复。建议先导出备份。', () => {
      Store.wipe(); VS.accountId = null; Screens.account._showKey = false;
      UI.toast('已清空', 'ok'); go('overview');
    }, '确认清空');
  });
};
