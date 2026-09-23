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

/** 失败原因的短标签 —— 日志表格里只有一格，写不下整句话 */
const STATUS_SHORT = {
  auth_invalid: '鉴权失败',
  auth_forbidden: '无权限',
  not_found: '404',
  rate_limited: '限流',
  timeout: '超时',
  network: '网络不通',
  cors: '跨域拦截',
  upstream_error: '上游异常',
  bad_request: '参数被拒',
  parse: '格式认不出',
  unsupported: '不支持',
  crypto: '加密失败',
  token_expired: '登录过期',
  turnstile: '人机验证',
};

function statusTagOf(log) {
  if (!log) return '<span class="tag mute">未验证</span>';
  if (log.status === 'ok') return '<span class="tag ok">' + esc(String(log.code || 200)) + ' OK</span>';
  const label = STATUS_SHORT[log.kind] || (log.code ? String(log.code) : '失败');
  return '<span class="tag err">' + esc(label) + '</span>';
}

/** 这条日志是「接口验证」还是「对话」产生的。老记录没有 trigger 字段，用 kind 兜底 */
function triggerLabel(l) {
  return (l && (l.trigger === 'verify' || l.kind === 'verify')) ? '接口验证' : '对话';
}

function emptyBlock(icon, title, sub, actionHtml) {
  return '<div class="empty">' + (icon || '') +
    '<div class="em-title">' + esc(title) + '</div>' +
    '<div class="em-sub">' + (sub || '') + '</div>' +
    (actionHtml || '') + '</div>';
}

/** 余额来源的短标签，表格里放得下 */
const BALANCE_SOURCE_SHORT = {
  deepseek: 'DeepSeek 接口',
  moonshot: 'Moonshot 接口',
  siliconflow: '硅基流动接口',
  openrouter: 'OpenRouter 接口',
  panel: '面板登录',
  manual: '手动填写',
};

function balanceSourceTag(a) {
  const src = a.balanceSource;
  if (!src) {
    return typeof a.balance === 'number'
      ? '<span class="tag line">来源未知</span>'
      : '<span class="tag mute">未读取</span>';
  }
  const label = BALANCE_SOURCE_SHORT[src] || esc(src);
  return src === 'manual'
    ? '<span class="tag line">' + esc(label) + '</span>'
    : '<span class="tag ok">' + esc(label) + '</span>';
}

/** 表格里的余额单元格：主数字 + 折算前的原始金额 */
function balanceCell(a) {
  if (typeof a.balance !== 'number') {
    return '<span class="t-md c-4">—</span>';
  }
  const low = a.balance < 10;
  let html = '<span class="strong' + (low ? ' c-rose' : '') + '">¥' + a.balance.toFixed(2) + '</span>';
  if (a.balanceNative && a.balanceNative.amount != null) {
    const sym = String(a.balanceNative.currency).toUpperCase() === 'USD' ? '$' : '';
    html += '<div class="sub">原始 ' + sym + a.balanceNative.amount +
      ' · 按 ¥' + (Store.settings().usdRate || 7.3) + '/$ 折算</div>';
  }
  return html;
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

  /* 汇总 */
  let sum = 0, withBal = 0, autoable = 0, missing = 0, lowCount = 0;
  accounts.forEach((a) => {
    const p = Store.platform(a.platformId);
    if (typeof a.balance === 'number') { sum += a.balance; withBal++; }
    else missing++;
    if (typeof a.balance === 'number' && a.balance < 10) lowCount++;
    if (canAutoBalance(p)) autoable++;
  });

  let html = '';

  /* ---------- 演示数据横幅 ----------
     载入演示数据原本是一条「进得去出不来」的路：账号全是假的，界面上却没有任何
     说明，也没有一键清掉的地方（设置里的「清空全部数据」会把用户自己建的账号也删了）。
     所以只要数据里还有演示账号，就在总览最上面挂这条横幅，并就地给出口。 */
  if (Store.isDemo()) {
    html += '<div class="card flat" style="border:1px solid var(--brand-l);background:var(--brand-l);' +
      'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
      '<span class="t-xs" style="color:var(--brand-d);flex:1 1 170px;line-height:1.7">' +
      '当前是<b>演示数据</b>：这些账号和调用记录都是假的，不是你的真实密钥。</span>' +
      '<button class="btn soft sm" data-cleardemo>清除演示数据</button>' +
      '</div>';
  }

  /* ---------- 四个数字块 ---------- */
  html += '<div class="stats">' +
    '<div class="stat accent"><span class="st-lab">余额合计</span>' +
      '<span class="st-val">¥' + sum.toFixed(2) + '</span>' +
      '<span class="st-sub">' + withBal + ' / ' + accounts.length + ' 个账号有余额</span></div>' +
    '<div class="stat"><span class="st-lab">账号 / 平台</span>' +
      '<span class="st-val">' + accounts.length + ' / ' + plats.length + '</span>' +
      '<span class="st-sub">' + (missing ? missing + ' 个账号还没读到余额' : '余额都齐了') + '</span></div>' +
    '<div class="stat"><span class="st-lab">支持自动读取</span>' +
      '<span class="st-val">' + autoable + '</span>' +
      '<span class="st-sub">官方接口 + 中转站面板</span></div>' +
    '<div class="stat"><span class="st-lab">余额偏低</span>' +
      '<span class="st-val"' + (lowCount ? ' style="color:var(--rose-d)"' : '') + '>' + lowCount + '</span>' +
      '<span class="st-sub">低于 ¥10 的账号</span></div>' +
    '</div>';

  /* ---------- 操作条 ---------- */
  const filters = [
    { key: 'all', label: '全部 ' + accounts.length },
    { key: 'low', label: '余额偏低 ' + lowCount },
    { key: 'auto', label: '可自动读取 ' + autoable },
    { key: 'missing', label: '待读取 ' + missing },
  ];
  const checkinable = accounts.filter((a) => canCheckin(Store.platform(a.platformId))).length;
  html += '<div class="row between" style="margin-top:16px;gap:14px;flex-wrap:wrap">' +
    '<div class="chips">' + filters.map((f) =>
      '<button class="chip' + (OverviewFilter.key === f.key ? ' on' : '') + '" data-filter="' + f.key + '">' + esc(f.label) + '</button>'
    ).join('') + '</div>' +
    '<div class="row" style="gap:8px">' +
      (checkinable ? '<button class="btn ghost sm" data-checkin-all>一键签到 ' + checkinable + '</button>' : '') +
      '<button class="btn ghost sm" data-refresh-all>刷新全部余额</button>' +
    '</div></div>';

  /* ---------- 平台分组 ---------- */
  const expanded = Screens.overview._expanded || (Screens.overview._expanded = {});

  const visiblePlats = plats.filter((p) => {
    const list = Store.accountsOf(p.id);
    if (OverviewFilter.key === 'low') return list.some((a) => typeof a.balance === 'number' && a.balance < 10);
    if (OverviewFilter.key === 'auto') return canAutoBalance(p);
    if (OverviewFilter.key === 'missing') return list.some((a) => typeof a.balance !== 'number');
    return true;
  });

  html += '<div class="stack gap-12" style="margin-top:16px">';

  if (!visiblePlats.length) {
    html += '<div class="section-title" style="padding:22px 0;text-align:center">当前筛选下没有平台</div>';
  }

  visiblePlats.forEach((p) => {
    const list = Store.accountsOf(p.id);
    const numList = list.filter((a) => typeof a.balance === 'number');
    const total = numList.reduce((s, a) => s + a.balance, 0);
    /* 默认全部展开：表格本来就是为了「一眼看完」，没必要让用户逐个点开 */
    const isOpen = expanded[p.id] !== false;
    const low = numList.filter((a) => a.balance < 10).length;

    let sub = list.length + ' 个账号 · ' + (BALANCE_KIND_LABEL[balanceKindOf(p)] || '');
    if (numList.length < list.length) sub += ' · ' + (list.length - numList.length) + ' 个待读取';
    if (low) sub += ' · ' + low + ' 个偏低';

    html += '<div class="card" style="padding:0;overflow:hidden">';

    html += '<button class="pf-head" data-toggle="' + esc(p.id) + '" style="padding:14px 16px">' +
      platformLogo(p) +
      '<span class="stack gap-4 grow self-start">' +
        '<span class="t-md w-500">' + esc(p.name) + '</span>' +
        '<span class="t-xs ' + (low ? 'c-rose' : 'c-3') + '">' + esc(sub) + '</span>' +
      '</span>' +
      '<span class="stack gap-4" style="align-items:flex-end">' +
        '<span class="mono t-md w-600">' + (numList.length ? '¥' + total.toFixed(2) : '—') + '</span>' +
        '<span class="t-xs c-3">' + (isOpen ? '收起' : '展开') + '</span>' +
      '</span></button>';

    if (isOpen) {
      html += '<div style="border-top:1px solid var(--line-soft)">' +
        '<div class="tbl-wrap" style="box-shadow:none;border-radius:0">' +
        '<table class="tbl"><thead><tr>' +
          '<th>账号</th><th>密钥</th><th>余额</th><th>读取方式</th><th>更新时间</th><th class="right">操作</th>' +
        '</tr></thead><tbody>';

      list.forEach((a) => {
        const src = a.balanceSource;
        const canRefresh = canAutoBalance(p);
        html += '<tr class="rowbtn" data-acct="' + esc(a.id) + '">' +
          '<td class="main-cell"><span class="t-md w-500">' + esc(a.label) + '</span>' +
            (a.defaultModel ? '<div class="sub mono">默认 ' + esc(a.defaultModel) + '</div>' : '') + '</td>' +
          '<td class="mono t-sm c-3 nowrap" data-th="密钥">' + esc(maskKey(a.apiKey)) + '</td>' +
          '<td data-th="余额">' + balanceCell(a) + '</td>' +
          '<td data-th="读取方式">' + balanceSourceTag(a) + '</td>' +
          '<td class="t-sm c-3 nowrap" data-th="更新时间">' + (a.balanceUpdatedAt ? esc(relTime(a.balanceUpdatedAt)) : '—') + '</td>' +
          '<td class="right nowrap" data-th="操作">' +
            (canRefresh
              ? '<button class="btn soft sm" data-bal-one="' + esc(a.id) + '">' +
                (src === 'panel' || balanceKindOf(p) === 'panel' ? '读余额' : '刷新') + '</button>'
              : '<button class="btn ghost sm" data-manual="' + esc(a.id) + '">填余额</button>') +
          '</td></tr>';
      });

      html += '</tbody></table></div>' +
        '<div class="tbl-foot">' +
        '<button class="t-sm c-brand" data-addto="' + esc(p.id) + '">+ 给 ' + esc(p.name) + ' 加一个账号</button>' +
        '</div></div>';
    }

    html += '</div>';
  });

  html += '</div>';
  root.innerHTML = html;

  /* ---------- 事件 ---------- */
  $$('[data-filter]', root).forEach((b) => b.addEventListener('click', () => {
    OverviewFilter.key = b.getAttribute('data-filter');
    render();
  }));
  $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.getAttribute('data-toggle');
    expanded[id] = expanded[id] === false;
    render();
  }));
  $$('[data-acct]', root).forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    go('account', tr.getAttribute('data-acct'));
  }));
  $$('[data-addto]', root).forEach((b) => b.addEventListener('click', () => go('add', b.getAttribute('data-addto'))));
  $$('[data-bal-one]', root).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await refreshOneBalance(b.getAttribute('data-bal-one'), b);
  }));
  $$('[data-manual]', root).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = Store.account(b.getAttribute('data-manual'));
    if (a) manualBalanceSheet(a, Store.platform(a.platformId));
  }));
  const rall = root.querySelector('[data-refresh-all]');
  if (rall) rall.addEventListener('click', refreshAllBalances);
  const call = root.querySelector('[data-checkin-all]');
  if (call) call.addEventListener('click', () => checkinAllNow(call));

  /* 横幅上的一键清除 */
  const cdemo = root.querySelector('[data-cleardemo]');
  if (cdemo) cdemo.addEventListener('click', () => clearDemoFlow());
};

/* 清除演示数据：把 6 个假账号与它们的记录删掉，用户自己建的账号不受影响。
   清完落到总览的空状态，正好接着「添加第一个账号」。 */
function clearDemoFlow() {
  UI.confirmDialog('清除演示数据', '演示用的假账号和假记录会被删掉；你自己添加的账号不受影响。', () => {
    const r = Store.clearDemo();
    VS.accountId = null;
    UI.toast('已清除 ' + r.accounts + ' 个演示账号、' + r.logs + ' 条演示记录', 'ok');
    route = { name: 'overview', param: null, edit: null };
    stack = [];
    syncHash('replace');
    render();
  }, '清除');
}

/**
 * 刷新单个账号余额。
 * 中转站面板第一次需要账号密码 —— 这里直接把登录框弹出来，不让用户自己去翻页面。
 */
async function refreshOneBalance(accountId, btn) {
  const a = Store.account(accountId);
  if (!a) return;
  const p = Store.platform(a.platformId);
  const old = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '读取中…'; btn.disabled = true; }

  let r = await Balance.query(a, p);
  if (!r.ok && r.kind === 'need_login') {
    if (btn) { btn.textContent = old; btn.disabled = false; }
    panelLoginSheet(a, p);
    return;
  }
  const applied = Balance.applyResult(a.id, r);
  if (btn) { btn.textContent = old; btn.disabled = false; }

  if (applied.ok) {
    UI.toast('余额已更新：' + (applied.native ? (applied.native.currency === 'USD' ? '$' : '') + applied.native.amount + ' ≈ ' : '') + '¥' + Number(applied.cny).toFixed(2), 'ok');
    render();
  } else {
    const info = failInfo(applied.kind);
    UI.toast(info.title + '：' + (applied.message || info.msg), 'err');
    render();
  }
}

/** 手动填余额的弹层（官方接口读不到、人机验证挡住时的兜底） */
function manualBalanceSheet(a, p) {
  const cur = typeof a.balance === 'number' ? a.balance : '';
  UI.openSheet({
    title: '手动填写余额',
    html:
      '<div class="field"><label>当前可用余额（元）</label>' +
      '<input class="input mono" id="bval" type="number" step="0.01" placeholder="例如 52.40" value="' + cur + '"></div>' +
      '<div class="hint" style="margin-top:10px">该数字只存在本机，用于总览汇总与「余额偏低」提醒。' +
      (p && balanceKindOf(p) === 'manual' ? '「' + esc(p.name) + '」没有公开的余额接口，只能这样维护。' : '') + '</div>' +
      '<div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-close>取消</button>' +
      '<button class="btn primary" data-save>保存</button></div>',
    onMount(sheet) {
      sheet.querySelector('[data-save]').addEventListener('click', () => {
        const v = parseFloat(sheet.querySelector('#bval').value);
        if (isNaN(v)) { UI.toast('请输入数字', 'err'); return; }
        Store.updateAccount(a.id, {
          balance: v, balanceSource: 'manual', balanceNative: null, balanceUpdatedAt: Date.now(),
        });
        UI.closeSheet(); UI.toast('已保存', 'ok'); render();
      });
    },
  });
}

/**
 * 中转站面板登录。
 * 两个必须让用户看见的前提：
 *   1) 密码默认不保存 —— 只留登录换来的 token；
 *   2) 站点开了人机验证就登录不了，得给一条别的路（手动填 / 粘 token）。
 */
function panelLoginSheet(a, p) {
  const cred = normalizeCred(a.cred) || {};
  const kind = balanceKindOf(p);
  const isPanel = kind === 'panel';

  UI.openSheet({
    title: isPanel ? '登录中转站面板' : '读取余额',
    html:
      (isPanel
        ? '<div class="t-sm c-2" style="line-height:1.8;padding:2px 0 14px">' +
          '「' + esc(p ? p.name : '该平台') + '」是 New API / One API 系的中转站，余额只能登录面板读。' +
          '<br>登录成功后 <b>只会保留登录凭据</b>，密码默认不落盘。</div>'
        : '<div class="t-sm c-2" style="line-height:1.8;padding:2px 0 14px">' +
          '这个平台用 API Key 就能读余额，不需要账号密码。点下面的按钮直接读。</div>') +

      (isPanel
        ? '<div class="stack gap-12">' +
          '<div class="field"><label>站点登录账号</label>' +
          '<input class="input" id="p-user" autocomplete="off" spellcheck="false" placeholder="用户名或邮箱" value="' + esc(cred.username || '') + '"></div>' +
          '<div class="field"><label>站点登录密码</label>' +
          '<input class="input" id="p-pass" type="password" autocomplete="off" placeholder="只在本次登录时使用" value="' + esc(cred.password || '') + '"></div>' +
          '<label class="check"><input type="checkbox" id="p-remember"' + (cred.savePassword ? ' checked' : '') + '>' +
          '<span class="ck-body"><span class="ck-title">在本机记住密码</span>' +
          '<span class="hint">勾上以后可以一键刷新余额。密码会明文存在浏览器本地存储里 —— 共用电脑时别勾。</span></span></label>' +
          '<div class="field"><label>或者：直接粘贴站点 access token（可选）</label>' +
          '<input class="input mono" id="p-token" autocomplete="off" spellcheck="false" placeholder="浏览器 F12 → Application → localStorage 里的 token" value="' + esc(cred.token || '') + '"></div>' +
          '</div>'
        : '') +

      '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn ghost" data-close>取消</button>' +
      '<button class="btn primary" data-go>' + (isPanel ? '登录并读取' : '读取余额') + '</button></div>' +
      (isPanel ? '<div style="margin-top:12px;text-align:center">' +
        '<button class="t-sm c-brand" data-manual>读不到？直接手动填一个余额</button></div>' : ''),

    onMount(sheet) {
      const goBtn = sheet.querySelector('[data-go]');
      const mBtn = sheet.querySelector('[data-manual]');
      if (mBtn) mBtn.addEventListener('click', () => { UI.closeSheet(); manualBalanceSheet(a, p); });

      goBtn.addEventListener('click', async () => {
        const user = sheet.querySelector('#p-user') ? sheet.querySelector('#p-user').value.trim() : '';
        const pass = sheet.querySelector('#p-pass') ? sheet.querySelector('#p-pass').value : '';
        const remember = sheet.querySelector('#p-remember') ? sheet.querySelector('#p-remember').checked : false;
        const pastedToken = sheet.querySelector('#p-token') ? sheet.querySelector('#p-token').value.trim() : '';

        if (isPanel && pastedToken) {
          Store.setCred(a.id, { token: pastedToken, tokenAt: Date.now() });
        } else if (isPanel && (!user || !pass)) {
          UI.toast('请填写站点的登录账号和密码', 'err');
          return;
        }

        goBtn.textContent = '读取中…';
        goBtn.disabled = true;
        const r = await Balance.query(Store.account(a.id), p, {
          username: user, password: pass, rememberPassword: remember,
        });
        const applied = Balance.applyResult(a.id, r);

        if (applied.ok) {
          UI.closeSheet();
          UI.toast('余额已读取：' + (applied.native ? (applied.native.currency === 'USD' ? '$' : '') + applied.native.amount + ' ≈ ' : '') + '¥' + Number(applied.cny).toFixed(2), 'ok');
          render();
          return;
        }

        goBtn.textContent = isPanel ? '登录并读取' : '读取余额';
        goBtn.disabled = false;
        const info = failInfo(applied.kind);
        UI.openSheet({
          title: info.title,
          html: '<div class="t-sm c-2" style="line-height:1.8">' + esc(applied.message || info.msg) + '</div>' +
            (info.todo && info.todo.length
              ? '<div class="stack gap-8" style="margin-top:14px">' + info.todo.map((t, i) =>
                  '<div class="t-sm" style="line-height:1.6"><span class="c-3 mono">' + (i + 1) + '</span>&nbsp;&nbsp;' + esc(t) + '</div>').join('') + '</div>'
              : '') +
            '<div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-close>知道了</button>' +
            '<button class="btn primary" data-manual>手动填余额</button></div>',
          onMount(s2) {
            s2.querySelector('[data-manual]').addEventListener('click', () => {
              UI.closeSheet(); manualBalanceSheet(a, p);
            });
          },
        });
      });
    },
  });
}


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
  const shown = sorted.slice(0, 120);

  html += '<div class="tbl-wrap"><table class="tbl wide"><thead><tr>' +
    '<th>时间</th><th>模型</th><th>平台 / 账号</th><th>状态</th>' +
    '<th class="num">入 / 出 tokens</th><th class="num">耗时</th><th class="num">费用</th>' +
    '</tr></thead><tbody>';

  shown.forEach((l) => {
    const ok = l.status === 'ok';
    const tokTxt = (l.inTok == null && l.outTok == null)
      ? (ok ? '未返回 usage' : '未计费')
      : num(l.inTok) + ' / ' + num(l.outTok) + (l.tokEstimated ? '（估）' : '');
    const costTxt = typeof l.costCNY === 'number' ? money(l.costCNY) : '—';
    const acct = Store.account(l.accountId);
    html += '<tr class="rowbtn" data-log="' + esc(l.id) + '">' +
      '<td class="t-sm c-3 nowrap">' + esc(relTime(l.ts)) + '</td>' +
      '<td class="main-cell"><span class="mono t-sm">' + esc(l.model || '未知模型') + '</span>' +
        '<div class="sub">' + esc(triggerLabel(l)) + (l.streamed ? ' · 流式' : '') + '</div></td>' +
      '<td class="t-sm" data-th="来源">' + esc(platformName(l.platformId)) +
        '<div class="sub">' + esc(acct ? acct.label : '账号已删除') + '</div></td>' +
      '<td data-th="状态">' + statusTagOf(l) + '</td>' +
      '<td class="num" data-th="入 / 出 tokens">' + esc(tokTxt) + '</td>' +
      '<td class="num" data-th="耗时">' + (l.latencyMs / 1000).toFixed(1) + 's</td>' +
      '<td class="num" data-th="费用">' + esc(costTxt) + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';

  if (sorted.length > shown.length) {
    html += '<div class="t-xs c-3" style="text-align:center;margin-top:12px">仅显示最近 ' + shown.length + ' 条，共 ' + sorted.length + ' 条</div>';
  }
  html += '<div class="t-xs c-4" style="text-align:center;margin-top:14px;line-height:1.7">入 / 出 = 输入与输出 token · 费用按内置参考单价估算，与平台账单可能有出入</div>';

  root.innerHTML = html;

  $$('[data-pf]', root).forEach((b) => b.addEventListener('click', () => {
    LogFilter.platform = b.getAttribute('data-pf'); render();
  }));
  root.querySelector('[data-sort]').addEventListener('click', () => {
    Screens.logs._byCost = !Screens.logs._byCost; render();
  });
  $$('[data-log]', root).forEach((tr) => tr.addEventListener('click', () => logDetail(tr.getAttribute('data-log'))));
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
    ['触发方式', triggerLabel(l)],
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
  const p = Store.platform(a.platformId) || { id: 'custom', name: '未知', color: '#6BA8A0', balanceKind: 'panel' };
  const kind = balanceKindOf(p);
  const isPanel = kind === 'panel';
  const cred = normalizeCred(a.cred) || {};
  const logs = Store.logs().filter((l) => l.accountId === a.id);
  const okCnt = logs.filter((l) => l.status === 'ok').length;
  const cost = logs.reduce((s, l) => s + (l.costCNY || 0), 0);
  const last = logs[0];

  const showKey = !!Screens.account._showKey;

  /* ---------- 左栏：余额 ---------- */
  let left = '';

  const native = a.balanceNative;
  left += '<div class="card">' +
    '<div class="row between self-start">' +
      '<span class="stack gap-6 self-start">' +
        '<span class="t-xs c-3">当前余额</span>' +
        '<span class="mono" style="font-size:30px;font-weight:600;letter-spacing:-.8px">' +
          (typeof a.balance === 'number' ? '¥' + a.balance.toFixed(2) : '未读取') + '</span>' +
        '<span>' + balanceSourceTag(a) + '</span>' +
      '</span>' +
      '<span class="stack gap-8 self-start" style="align-items:flex-end">' +
        '<button class="btn primary sm" data-bal>' + (isPanel ? '登录并读余额' : '读取余额') + '</button>' +
        '<button class="btn ghost sm" data-manual>手动填写</button>' +
      '</span>' +
    '</div>' +
    (native
      ? '<div class="t-xs c-3" style="margin-top:12px">接口原始值 ' +
        (String(native.currency).toUpperCase() === 'USD' ? '$' : '') + native.amount +
        ' ' + esc(String(native.currency)) + '，按 ¥' + (Store.settings().usdRate || 7.3) + '/$ 折算</div>'
      : '') +
    (a.balanceUpdatedAt ? '<div class="t-xs c-4" style="margin-top:6px">更新于 ' + esc(relTime(a.balanceUpdatedAt)) + '</div>' : '') +
    (cred.lastError ? '<div class="t-xs c-rose" style="margin-top:8px;line-height:1.7">上次读取失败：' + esc(cred.lastError) + '</div>' : '') +
    '</div>';

  /* 每日签到（只有中转站面板类账号可能有；官方平台没有这回事） */
  if (canCheckin(Store.platform(a.platformId))) {
    const ck = a.checkinLast || null;
    const doneToday = a.checkinDay === Checkin.todayKey();
    left += '<div class="card">' +
      '<div class="row between self-start">' +
        '<span class="stack gap-6 self-start">' +
          '<span class="t-xs c-3">每日签到</span>' +
          '<span class="t-sm w-600">' + (doneToday ? '今天已签到' : '今天还没签') + '</span>' +
          (ck ? '<span class="t-xs ' + (ck.ok ? 'c-3' : 'c-rose') + '" style="line-height:1.7">' +
                '上次：' + esc(ck.message || (ck.ok ? '成功' : '失败')) + '</span>' : '') +
        '</span>' +
        '<button class="btn ' + (doneToday ? 'ghost' : 'primary') + ' sm" data-checkin>' + (doneToday ? '再签一次' : '签到') + '</button>' +
      '</div>' +
      '<div class="t-xs c-4" style="margin-top:10px;line-height:1.7">' +
        (doneToday && a.checkinAt ? '签到于 ' + esc(new Date(a.checkinAt).toLocaleTimeString()) + '。' : '') +
        '能不能签由站点决定：没有开放签到接口的站点会明确提示，不会假装成功。</div>' +
      '</div>';
  }

  /* 统计条 */
  left += '<div class="card flat plain">' +
    '<div class="row between"><span class="t-xs c-3">本机记录调用</span>' +
    '<span class="mono t-md w-600">' + num(logs.length) + ' 次</span></div>' +
    '<div class="divider" style="margin:9px 0"></div>' +
    '<div class="row between"><span class="t-xs c-3">成功次数</span>' +
    '<span class="mono t-md">' + num(okCnt) + '</span></div>' +
    '<div class="divider" style="margin:9px 0"></div>' +
    '<div class="row between"><span class="t-xs c-3">估算花费</span>' +
    '<span class="mono t-md">' + money(cost) + '</span></div>' +
    '</div>';

  /* 操作 */
  left += '<div class="section-title">该账号的操作</div>' +
    '<div class="list-card">' +
    rowAction('去验证这个接口', '真发一次请求，看能不能通', 'verify', true) +
    rowAction('拉取可用模型列表', '调 /v1/models 看该密钥能访问哪些模型', 'models') +
    rowAction('编辑账号信息', '改名称、密钥、BaseURL', 'edit') +
    '</div>';

  /* ---------- 右栏：凭证 ---------- */
  let right = '';

  right += '<div class="card stack gap-12">' +
    '<div class="stack gap-8">' +
      '<div class="row between"><span class="t-xs c-3">API Key</span>' +
      '<button class="t-xs c-brand" data-showkey>' + (showKey ? '隐藏' : '显示') + '</button></div>' +
      '<div class="mono t-sm" style="background:var(--card-2);border-radius:10px;padding:11px 12px;word-break:break-all;line-height:1.6">' +
        esc(showKey ? a.apiKey : maskKey(a.apiKey)) + '</div>' +
      '<div class="btn-row gap-8"><button class="btn soft sm" data-copykey>复制密钥</button>' +
      '<button class="btn ghost sm" data-copyboth>复制全部</button></div>' +
    '</div>' +
    '<div class="divider"></div>' +
    '<div class="stack gap-8">' +
      '<span class="t-xs c-3">BaseURL</span>' +
      '<div class="mono t-sm" style="background:var(--card-2);border-radius:10px;padding:11px 12px;word-break:break-all;line-height:1.6">' +
        esc(a.baseUrl || '（未填写）') + '</div>' +
      '<button class="btn soft sm" data-copyurl>复制 BaseURL</button>' +
    '</div>' +
    '</div>';

  /* 余额读取方式的说明卡 / 面板登录卡 */
  if (isPanel) {
    const hasToken = !!cred.token;
    right += '<div class="card stack gap-10">' +
      '<div class="row between"><span class="t-md w-500">中转站面板</span>' +
      '<span class="tag ' + (hasToken ? 'ok' : 'mute') + '">' + (hasToken ? '已登录过' : '未登录') + '</span></div>' +
      '<div class="t-xs c-3" style="line-height:1.8">' +
        '这是 New API / One API 系的中转站。它没有对外的余额接口，' +
        '余额只能登录站点面板后从 <span class="mono">/api/user/self</span> 读。<br>' +
        '登录后本机只保留登录凭据；密码要单独勾选才会记住。' +
      '</div>' +
      (cred.username ? '<div class="kv"><span class="kv-k">面板账号</span><span class="kv-v">' + esc(cred.username) + '</span></div>' : '') +
      (hasToken ? '<div class="kv"><span class="kv-k">登录凭据</span><span class="kv-v">已保存' + (cred.tokenAt ? '（' + esc(relTime(cred.tokenAt)) + '）' : '') + '</span></div>' : '') +
      '<div class="kv"><span class="kv-k">保存密码</span><span class="kv-v">' + (cred.savePassword ? '已勾选' : '未勾选（更安全）') + '</span></div>' +
      '<div class="btn-row"><button class="btn primary sm" data-panel-login>' + (hasToken ? '重新登录' : '登录面板') + '</button>' +
      (hasToken ? '<button class="btn ghost sm" data-forget>清除凭据</button>' : '') + '</div>' +
      '</div>';
  } else if (kind === 'manual') {
    right += '<div class="card stack gap-8">' +
      '<span class="t-md w-500">余额怎么读</span>' +
      '<div class="t-xs c-3" style="line-height:1.8">' +
        '「' + esc(p.name) + '」没有开放余额查询接口，只能手动填一个数字，' +
        '本机用它做汇总和「余额偏低」提醒。' +
      '</div>' +
      '<button class="btn ghost sm" data-manual style="align-self:flex-start">手动填写余额</button>' +
      '</div>';
  } else {
    right += '<div class="card stack gap-8">' +
      '<span class="t-md w-500">余额怎么读</span>' +
      '<div class="t-xs c-3" style="line-height:1.8">' +
        '用这个账号的 API Key 直接调 <span class="mono">' +
        esc((Balance.PROVIDERS[kind] && Balance.PROVIDERS[kind].path) || '') + '</span>，' +
        '不需要账号密码。点上面的「读取余额」即可。' +
      '</div>' +
      '</div>';
  }

  /* 最近记录 */
  if (logs.length) {
    right += '<div class="section-title">最近调用</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>模型</th><th>时间</th><th class="num">耗时</th><th class="num">费用</th>' +
      '</tr></thead><tbody>' +
      logs.slice(0, 6).map((l) =>
        '<tr><td class="main-cell mono t-sm">' + esc(l.model || '—') + '</td>' +
        '<td class="t-sm c-3 nowrap" data-th="时间">' + esc(relTime(l.ts)) + '</td>' +
        '<td class="num" data-th="耗时">' + (l.latencyMs / 1000).toFixed(1) + 's</td>' +
        '<td class="num" data-th="费用">' + (typeof l.costCNY === 'number' ? money(l.costCNY) : '—') + '</td></tr>'
      ).join('') + '</tbody></table></div>';
  }

  root.innerHTML =
    '<div class="detail-grid">' +
      '<div class="detail-col">' + left + '</div>' +
      '<div class="detail-col">' + right + '</div>' +
      '<div class="span-2" style="margin-top:4px"><button class="btn danger" data-del>删除这个账号</button></div>' +
    '</div>';

  /* ---------- 事件 ---------- */
  root.querySelector('[data-showkey]').addEventListener('click', () => {
    Screens.account._showKey = !showKey; render();
  });
  root.querySelector('[data-copykey]').addEventListener('click', () => UI.copy(a.apiKey, '密钥已复制'));
  root.querySelector('[data-copyurl]').addEventListener('click', () => UI.copy(a.baseUrl, 'BaseURL 已复制'));
  root.querySelector('[data-copyboth]').addEventListener('click', () => UI.copy(
    '平台：' + p.name + '\n账号：' + a.label + '\nAPI Key：' + a.apiKey + '\nBaseURL：' + a.baseUrl, '已复制全部'));
  root.querySelector('[data-del]').addEventListener('click', () => {
    UI.confirmDialog('删除账号', '会同时删掉这个账号在本机的调用记录，且无法恢复。密钥本身不受影响。', () => {
      Store.removeAccount(a.id);
      Screens.account._showKey = false;
      VS.accountId = null; VS.models = []; VS.modelsFor = null;
      back();
    });
  });

  $$('[data-bal]', root).forEach((b) => b.addEventListener('click', () => {
    const hasCred = !!(cred.username && cred.password);
    if (isPanel && !cred.token && !hasCred) panelLoginSheet(a, p);
    else refreshOneBalance(a.id, b);
  }));
  $$('[data-manual]', root).forEach((b) => b.addEventListener('click', () => manualBalanceSheet(a, p)));
  const pl = root.querySelector('[data-panel-login]');
  if (pl) pl.addEventListener('click', () => panelLoginSheet(a, p));
  const fg = root.querySelector('[data-forget]');
  if (fg) fg.addEventListener('click', () => {
    UI.confirmDialog('清除登录凭据', '会删掉本机保存的面板登录 token 与密码，余额数字保留。', () => {
      Store.updateAccount(a.id, { cred: null });
      UI.toast('已清除', 'ok'); render();
    }, '清除');
  });

  const vBtn = root.querySelector('[data-a-verify]');
  if (vBtn) vBtn.addEventListener('click', () => { VS.accountId = a.id; go('verify'); });
  const mBtn = root.querySelector('[data-a-models]');
  if (mBtn) mBtn.addEventListener('click', () => pullModels(a));
  const eBtn = root.querySelector('[data-a-edit]');
  if (eBtn) eBtn.addEventListener('click', () => go('add', null, a.id));

  const ckBtn = root.querySelector('[data-checkin]');
  if (ckBtn) ckBtn.addEventListener('click', () => checkinOne(a.id, ckBtn));
};

function rowAction(title, sub, kind, accent) {
  return '<button class="lrow" style="width:100%;text-align:left" data-a-' + kind + '>' +
    '<span class="l-main"><span class="l-title"' + (accent ? ' style="color:var(--brand-d)"' : '') + '>' + esc(title) + '</span>' +
    '<span class="l-sub">' + esc(sub) + '</span></span>' +
    '<span class="c-3">›</span></button>';
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
    ).join('') + '</div>' +
    '<div class="hint" id="f-pf-note"></div></div>';

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

  /* 余额：能自动读的平台就交给程序，只有读不到的平台才需要手填 */
  html += '<div class="field" style="margin-top:14px" id="f-bal-wrap"><label>当前余额（选填）</label>' +
    '<input class="input mono" id="f-bal" type="number" step="0.01" placeholder="不知道该填多少就留空" value="' +
    (editing && typeof editing.balance === 'number' ? editing.balance : '') + '">' +
    '<div class="hint">该平台没有公开的余额接口，只能手动维护一个数字，用于总览汇总。</div></div>';

  html += '<div class="field" style="margin-top:14px"><label>默认模型（选填）</label>' +
    '<input class="input mono" id="f-model" placeholder="例如 gpt-4o-mini" value="' +
    esc(editing ? (editing.defaultModel || '') : '') + '"></div>';

  html += '<div class="stack gap-10" style="margin-top:20px">' +
    '<button class="btn primary" data-save>' + (editing ? '保存修改' : '添加账号') + '</button>' +
    (editing ? '' : '<button class="btn ghost" data-save-verify>添加并立即验证</button>') +
    '<div class="hint" style="text-align:center">添加后可以随时在账号详情里改</div></div>';

  root.innerHTML = html;

  let curPid = pid;

  /** 平台一换，「余额怎么读」那几行说明和输入框都要跟着换 */
  function syncPlatformFields(id) {
    const p = Store.platform(id);
    const kind = balanceKindOf(p);
    const note = root.querySelector('#f-pf-note');
    const wrap = root.querySelector('#f-bal-wrap');
    if (note) {
      const how = kind === 'manual'
        ? '该平台没有公开的余额查询接口，需要手动填余额。'
        : kind === 'panel'
          ? '这是中转站面板：添加后填站点账号密码登录一次，就能自动读余额。'
          : '该平台有官方余额接口，用 API Key 就能直接读余额。';
      note.textContent = '余额读取方式：' + (BALANCE_KIND_LABEL[kind] || '') + '。' + how;
    }
    if (wrap) wrap.style.display = kind === 'manual' ? '' : 'none';
  }
  syncPlatformFields(curPid);

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
    syncPlatformFields(curPid);
  }));

  function collect() {
    const label = root.querySelector('#f-label').value.trim() || '主账号';
    const key = root.querySelector('#f-key').value.trim();
    const url = root.querySelector('#f-url').value.trim();
    const balEl = root.querySelector('#f-bal');
    const balRaw = (balEl && balEl.closest('#f-bal-wrap').style.display !== 'none') ? balEl.value.trim() : '';
    const model = root.querySelector('#f-model').value.trim();
    if (!key) { UI.toast('请填写 API Key', 'err'); return null; }
    if (!url) { UI.toast('请填写 BaseURL', 'err'); return null; }
    const bal = balRaw === '' ? null : parseFloat(balRaw);
    const out = {
      platformId: curPid, label: label, apiKey: key, baseUrl: url,
      defaultModel: model || '',
    };
    if (!isNaN(bal)) {
      out.balance = bal;
      out.balanceSource = 'manual';
      out.balanceNative = null;
      out.balanceUpdatedAt = Date.now();
    }
    return out;
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
  html += '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    '<th>账号</th><th>平台</th><th>余额</th><th>读取方式</th><th class="right">操作</th>' +
    '</tr></thead><tbody>';
  if (!accounts.length) {
    html += '<tr><td colspan="5" class="t-sm c-3" style="text-align:center;padding:18px">还没有账号</td></tr>';
  } else {
    accounts.forEach((a) => {
      const p = Store.platform(a.platformId);
      html += '<tr class="rowbtn" data-acct="' + esc(a.id) + '">' +
        '<td class="main-cell"><span class="t-md w-500">' + esc(a.label) + '</span>' +
          '<div class="sub mono">' + esc(maskKey(a.apiKey)) + '</div></td>' +
        '<td class="t-sm">' + esc(p ? p.name : '未知平台') + '</td>' +
        '<td>' + balanceCell(a) + '</td>' +
        '<td>' + balanceSourceTag(a) + '</td>' +
        '<td class="right"><span class="c-3">›</span></td></tr>';
    });
  }
  html += '</tbody></table></div>';
  html += '<button class="btn ghost" style="width:100%;margin-top:10px" data-go="add">+ 添加账号</button>';

  /* ---------- 金额换算 ---------- */
  html += '<div class="section-title" style="margin-top:20px">金额换算</div>';
  html += '<div class="card flat plain stack gap-10" style="margin-top:8px">' +
    '<div class="row between">' +
    '<span class="stack gap-4 self-start"><span class="t-sm">美元汇率</span>' +
    '<span class="hint">OpenRouter、多数中转站面板按美元计账，统一按这个价换成本地金额</span></span>' +
    '<span class="row gap-6"><span class="t-sm c-3">¥</span>' +
    '<input class="input mono" id="f-rate" type="number" step="0.01" min="0.01" style="width:88px;padding:8px 10px" value="' +
      esc(String(s.usdRate || 7.3)) + '"><span class="t-sm c-3">/ $</span></span>' +
    '</div></div>';

  /* ---------- 余额读取能力 ---------- */
  const usedKinds = [];
  Store.platforms().forEach((p) => {
    if (Store.accountsOf(p.id).length && usedKinds.indexOf(balanceKindOf(p)) < 0) usedKinds.push(balanceKindOf(p));
  });
  const capRows = [
    ['deepseek', 'GET /user/balance', '拿 API Key 直接读，不需要账号密码'],
    ['moonshot', 'GET /v1/users/me/balance', '拿 API Key 直接读'],
    ['siliconflow', 'GET /v1/user/info', '拿 API Key 直接读'],
    ['openrouter', 'GET /api/v1/key', '普通密钥读本密钥额度；账户总额度需要 Management Key'],
    ['panel', '登录面板后读 /api/user/self', '需要站点账号密码；站点开了人机验证就无法自动读'],
    ['manual', '—', '平台没开放余额接口，只能手动填'],
  ];

  html += '<div class="section-title" style="margin-top:20px">余额读取能力</div>';
  html += '<div class="tbl-wrap" style="margin-top:8px"><table class="tbl wide"><thead><tr>' +
    '<th>方式</th><th>接口 / 途径</th><th>说明</th></tr></thead><tbody>' +
    capRows.map((r) =>
      '<tr><td class="nowrap">' +
        (usedKinds.indexOf(r[0]) >= 0 ? '<span class="dot ok" style="display:inline-block;margin-right:6px"></span>' : '') +
        esc(BALANCE_KIND_LABEL[r[0]] || r[0]) + '</td>' +
      '<td class="mono t-sm c-2" data-th="接口">' + esc(r[1]) + '</td>' +
      '<td class="t-sm c-2" data-th="说明">' + esc(r[2]) + '</td></tr>'
    ).join('') +
    '</tbody></table></div>' +
    '<div class="hint" style="margin-top:8px">带绿点的表示你当前已经在用这种读取方式。</div>';

  /* ---------- 请求设置 ---------- */
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

  /* ---------- 数据 ---------- */
  html += '<div class="section-title" style="margin-top:20px">数据</div>';
  html += '<div class="list-card" style="margin-top:8px">' +
    '<button class="lrow" style="width:100%;text-align:left" data-export data-safe="1">' +
    '<span class="l-main"><span class="l-title">导出全部数据</span>' +
    '<span class="l-sub">账号、密钥、调用记录打包成 JSON —— 不含面板登录密码（推荐）</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-export data-safe="0">' +
    '<span class="l-main"><span class="l-title">导出（含面板登录密码）</span>' +
    '<span class="l-sub">中转站的账号密码会一起写进文件，只适合自己留档</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-import>' +
    '<span class="l-main"><span class="l-title">从 JSON 导入</span>' +
    '<span class="l-sub">会覆盖当前全部数据</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-clearlogs>' +
    '<span class="l-main"><span class="l-title">清空调用记录</span>' +
    '<span class="l-sub">保留账号，只清日志（' + Store.logs().length + ' 条）</span></span><span class="c-3">›</span></button>' +
    '<button class="lrow" style="width:100%;text-align:left" data-demo>' +
    '<span class="l-main"><span class="l-title">载入演示数据</span>' +
    '<span class="l-sub">会写入几个假账号和假记录，用来看效果（随时可以只清掉它们）</span></span><span class="c-3">›</span></button>' +
    (Store.isDemo()
      ? '<button class="lrow" style="width:100%;text-align:left" data-cleardemo>' +
        '<span class="l-main"><span class="l-title">清除演示数据</span>' +
        '<span class="l-sub">删掉那几个假账号和假记录，自己添加的账号不受影响</span></span><span class="c-3">›</span></button>'
      : '') +
    '<button class="lrow" style="width:100%;text-align:left" data-wipe>' +
    '<span class="l-main"><span class="l-title c-rose">清空全部数据</span>' +
    '<span class="l-sub">账号、密钥、记录全部删除，不可恢复</span></span><span class="c-3">›</span></button>' +
    '</div>';

  /* ---------- 运行环境 ---------- */
  html += '<div class="section-title" style="margin-top:20px">运行环境</div>';
  html += '<div class="card flat plain stack gap-10" style="margin-top:8px">' +
    '<div class="row between"><span class="t-sm c-2">网络模式</span>' +
    '<span class="tag ' + modeTone + '">' + esc(modeText) + '</span></div>' +
    '<div class="row between"><span class="t-sm c-2">明文密钥存储</span>' +
    '<span class="tag warn">本机 localStorage</span></div>' +
    '<div class="row between"><span class="t-sm c-2">版本</span><span class="t-sm mono">v' + esc(APP_VERSION) + '</span></div>' +
    '<div class="t-xs c-4" style="line-height:1.7">密钥与面板登录凭据都以明文存在浏览器本地存储里，方便随时复制。' +
    '共用电脑时，用完建议导出备份后「清空全部数据」。</div>' +
    (mode === 'proxy'
      ? '<div class="divider"></div><button class="btn ghost sm" data-shutdown style="align-self:flex-start">退出程序（停止本地服务）</button>' +
        '<div class="hint">点这个会关掉后台的本地服务，之后网页就打不开了。想再用就重新运行启动脚本。</div>'
      : '') +
    '</div>';

  root.innerHTML = html;

  $$('[data-acct]', root).forEach((tr) => tr.addEventListener('click', () => go('account', tr.getAttribute('data-acct'))));
  root.querySelector('[data-go]').addEventListener('click', () => go('add'));
  root.querySelector('[data-timeout]').addEventListener('change', (e) => Store.setSetting('timeoutMs', Number(e.target.value)));
  root.querySelector('[data-maxtok]').addEventListener('change', (e) => Store.setSetting('verifyMaxTokens', Number(e.target.value)));

  const rateEl = root.querySelector('#f-rate');
  if (rateEl) {
    rateEl.addEventListener('change', () => {
      const v = parseFloat(rateEl.value);
      if (!(v > 0)) { UI.toast('汇率要大于 0', 'err'); rateEl.value = String(s.usdRate || 7.3); return; }
      Store.setSetting('usdRate', v);
      UI.toast('汇率已更新为 ¥' + v + '/$', 'ok');
      render();
    });
  }

  $$('[data-export]', root).forEach((b) => b.addEventListener('click', () => {
    exportData(b.getAttribute('data-safe') === '1');
  }));

  root.querySelector('[data-import]').addEventListener('click', () => {
    UI.openSheet({
      title: '从 JSON 导入',
      html: '<div class="field"><label>粘贴备份内容</label>' +
        '<textarea class="textarea mono" id="imp" style="min-height:140px;font-size:11px" placeholder="把备份文件内容粘贴到这里"></textarea></div>' +
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
    UI.confirmDialog('载入演示数据',
      '会覆盖当前账号与记录，写入 6 个假账号和 8 条假调用记录。旧数据不会保留。载入后想退出，用「清除演示数据」即可。',
      () => {
        Store.loadDemo(); VS.accountId = null; UI.toast('已载入演示数据', 'ok'); render();
      }, '载入');
  });

  const cdemo = root.querySelector('[data-cleardemo]');
  if (cdemo) cdemo.addEventListener('click', () => clearDemoFlow());

  root.querySelector('[data-wipe]').addEventListener('click', () => {
    UI.confirmDialog('清空全部数据', '账号、密钥、调用记录会全部删除，无法恢复。建议先导出备份。', () => {
      Store.wipe(); VS.accountId = null; Screens.account._showKey = false;
      UI.toast('已清空', 'ok'); go('overview');
    }, '确认清空');
  });

  const sd = root.querySelector('[data-shutdown]');
  if (sd) sd.addEventListener('click', () => {
    UI.confirmDialog('退出程序', '本地服务会停掉，网页随之失效。下次使用重新运行启动脚本即可。', async () => {
      try { await fetch('/api/shutdown', { method: 'POST' }); } catch (_) {}
      document.body.innerHTML =
        '<div class="empty" style="padding-top:22vh">' +
        '<div class="em-title">已经退出</div>' +
        '<div class="em-sub">本地服务已停止，这个页面可以关掉了。<br>下次使用重新运行启动脚本即可。</div></div>';
    }, '退出');
  });
};

/** 导出：默认剥掉面板密码，只有明确选了「含密码」才带出去 */
function exportData(safe) {
  const json = Store.exportJson({ includeCreds: !safe });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = 'ai-api-hub-backup-' + stamp + (safe ? '' : '-with-credentials') + '.json';

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
  UI.toast(safe ? '已导出（不含面板密码）' : '已导出（含面板密码，注意保管）', 'ok');
}
