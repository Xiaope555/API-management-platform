/* ==========================================================================
   AI API Hub — 核心层
   价格表 · 本地数据层 · 三级网络抽象 · UI 工具
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- 常量 */

/* 版本号显示。APK 里用这个常量（跟随构建更新）；网页版启动后会被服务端
   /api/health 报告的版本覆盖（见 main.js 的 boot）—— 因为这里曾经硬编码成
   1.2.0 一直没跟着发版更新，用户装了新版本却看到旧号，根本分不清有没有生效。 */
let APP_VERSION = '1.3.0';
const STORE_KEY = 'aihub.v1';
const LOG_LIMIT = 500;

/**
 * 预置平台。baseUrl 是官方默认值，用户可改（中转站/代理）。
 *
 * balanceKind 决定「怎么读余额」，四类：
 *   deepseek / moonshot / siliconflow / openrouter —— 官方公开接口，拿 API Key 直接查
 *   panel   —— New API / One API 系中转站，要先拿账号密码登录面板
 *   manual  —— 平台没开余额接口，只能手动填
 * 旧数据里没有 balanceKind，靠 BALANCE_KIND_BY_ID 按平台 id 兜底。
 */
const PRESET_PLATFORMS = [
  { id: 'openai',      name: 'OpenAI',      color: '#0B7BD4', baseUrl: 'https://api.openai.com/v1',            balanceKind: 'manual',      doc: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek',    name: 'DeepSeek',    color: '#4D6BFE', baseUrl: 'https://api.deepseek.com/v1',          balanceKind: 'deepseek',    doc: 'https://platform.deepseek.com/api_keys' },
  { id: 'anthropic',   name: 'Anthropic',   color: '#C96442', baseUrl: 'https://api.anthropic.com/v1',         balanceKind: 'manual',      doc: 'https://console.anthropic.com/settings/keys' },
  { id: 'moonshot',    name: 'Moonshot',    color: '#111827', baseUrl: 'https://api.moonshot.cn/v1',           balanceKind: 'moonshot',    doc: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'siliconflow', name: '硅基流动',     color: '#6E56CF', baseUrl: 'https://api.siliconflow.cn/v1',        balanceKind: 'siliconflow', doc: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'openrouter',  name: 'OpenRouter',  color: '#6467F2', baseUrl: 'https://openrouter.ai/api/v1',         balanceKind: 'openrouter',  doc: 'https://openrouter.ai/settings/keys' },
  { id: 'zhipu',       name: '智谱 GLM',     color: '#2E5BFF', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', balanceKind: 'manual',      doc: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'dashscope',   name: '阿里通义',     color: '#615CED', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', balanceKind: 'manual', doc: 'https://bailian.console.aliyun.com/' },
  { id: 'custom',      name: '中转站 / 自定义', color: '#6BA8A0', baseUrl: '',                                  balanceKind: 'panel',       checkinKind: 'panel', doc: '' },
];

/** 平台 id → 余额读取方式。给没有 balanceKind 的旧数据兜底 */
const BALANCE_KIND_BY_ID = {
  deepseek: 'deepseek',
  moonshot: 'moonshot',
  siliconflow: 'siliconflow',
  openrouter: 'openrouter',
  custom: 'panel',
};

function balanceKindOf(plat) {
  const p = plat || {};
  if (p.balanceKind) return p.balanceKind;
  return BALANCE_KIND_BY_ID[p.id] || 'manual';
}

/** 能不能自动读余额（手动类不能） */
function canAutoBalance(plat) {
  return balanceKindOf(plat) !== 'manual';
}

/** 平台的签到能力：只有 new-api 系的中转站面板可能有签到，官方平台没有这回事。
    用户自己添加的中转站（pf_ 开头）也默认按面板对待 —— 到底有没有签到接口，
    签到时探测一下就知道，探不到会明确报「该站点没有开放签到接口」。 */
function checkinKindOf(plat) {
  const p = plat || {};
  if (p.checkinKind != null) return p.checkinKind;
  if (p.id === 'custom' || String(p.id).indexOf('pf_') === 0 || balanceKindOf(p) === 'panel') return 'panel';
  return '';
}

function canCheckin(plat) {
  return checkinKindOf(plat) === 'panel';
}

const BALANCE_KIND_LABEL = {
  deepseek: 'DeepSeek 官方接口',
  moonshot: 'Moonshot 官方接口',
  siliconflow: '硅基流动官方接口',
  openrouter: 'OpenRouter 官方接口',
  panel: '中转站面板',
  manual: '手动填写',
};

/** 参考单价，单位：元 / 100 万 tokens。仅用于本地估算，与平台账单必然有出入 */
const PRICING = {
  'gpt-4o':              { in: 18,   out: 72   },
  'gpt-4o-mini':         { in: 1.1,  out: 4.3  },
  'gpt-4.1':             { in: 15,   out: 60   },
  'gpt-4.1-mini':        { in: 3,    out: 12   },
  'gpt-4-turbo':         { in: 72,   out: 216  },
  'gpt-3.5-turbo':       { in: 3.6,  out: 10.8 },
  'o1':                  { in: 108,  out: 432  },
  'o1-mini':             { in: 8,    out: 32   },
  'o3-mini':             { in: 8,    out: 32   },
  'deepseek-chat':       { in: 2,    out: 8    },
  'deepseek-reasoner':   { in: 4,    out: 16   },
  'claude-sonnet-4':     { in: 21,   out: 105  },
  'claude-3-5-sonnet':   { in: 21,   out: 105  },
  'claude-3-7-sonnet':   { in: 21,   out: 105  },
  'claude-3-5-haiku':    { in: 6,    out: 30   },
  'claude-3-opus':       { in: 105,  out: 525  },
  'moonshot-v1-8k':      { in: 12,   out: 12   },
  'moonshot-v1-32k':     { in: 24,   out: 24   },
  'moonshot-v1-128k':    { in: 60,   out: 60   },
  'glm-4-plus':          { in: 50,   out: 50   },
  'glm-4-flash':         { in: 0,    out: 0    },
  'glm-4-air':           { in: 1,    out: 1    },
  'qwen-max':            { in: 20,   out: 60   },
  'qwen-plus':           { in: 0.8,  out: 2    },
  'qwen-turbo':          { in: 0.3,  out: 0.6  },
  'gemini-2.0-flash':    { in: 0.7,  out: 2.8  },
  'gemini-1.5-pro':      { in: 9,    out: 36   },
};

/* ---------------------------------------------------------------- 工具 */

const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 千分位 */
function num(n, digits) {
  if (n == null || isNaN(n)) return '—';
  const d = digits == null ? 0 : digits;
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function money(v) {
  if (v == null || isNaN(v)) return '—';
  if (v === 0) return '¥0.000';
  if (v < 0.001) return '¥' + v.toFixed(6);
  if (v < 1) return '¥' + v.toFixed(4);
  return '¥' + v.toFixed(2);
}

function maskKey(k) {
  const s = String(k || '');
  if (s.length <= 10) return s ? s.slice(0, 3) + '••••' : '—';
  return s.slice(0, 7) + '••••' + s.slice(-4);
}

function relTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day1 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day0 - day1) / 86400000);
  if (diff <= 0) return '今天 ' + hm;
  if (diff === 1) return '昨天 ' + hm;
  if (diff < 7) return diff + ' 天前 ' + hm;
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

/**
 * 是不是跑在安卓原生壳里。
 * 原生壳里有一批浏览器习惯不好使 —— 最典型的是 <a download> 点了没反应，
 * 所以凡是「下载文件」这类动作都要先问一下这里。
 */
function inNativeShell() {
  try {
    return !!(window.Capacitor && window.Capacitor.Plugins);
  } catch (_) {
    return false;
  }
}

/**
 * 打开外部链接。
 * Web 上开新标签；原生壳里走 Browser 插件（丢给系统浏览器），
 * 插件不在就退回「把地址摆出来 + 一键复制」——无论如何不能让链接点了没反应。
 */
function openExternal(url) {
  const u = String(url || '').trim();
  if (!u) return;

  if (!inNativeShell()) {
    window.open(u, '_blank', 'noopener');
    return;
  }

  const B = window.Capacitor.Plugins.Browser;
  if (B && typeof B.open === 'function') {
    try {
      const p = B.open({ url: u, toolbarColor: '#F8F6F2' });
      if (p && typeof p.catch === 'function') p.catch(fallback);
      return;
    } catch (_) { /* 落到下面的兜底 */ }
  }
  fallback();

  function fallback() {
    UI.openSheet({
      title: '在浏览器里打开',
      html: '<div class="field"><label>地址</label>' +
        '<input class="input mono" id="ext-url" readonly value="' + esc(u) + '"></div>' +
        '<div class="hint" style="margin-top:8px">复制这个地址，粘贴到手机浏览器里打开。</div>' +
        '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-close>关闭</button>' +
        '<button class="btn primary" data-copy>复制地址</button></div>',
      onMount(sheet) {
        sheet.querySelector('[data-copy]').addEventListener('click', () => UI.copy(u, '地址已复制'));
      },
    });
  }
}

/* ---------------------------------------------------------------- 价格 */

function normalizeModel(m) {
  return String(m || '').trim().toLowerCase();
}

function priceOf(model) {
  const m = normalizeModel(model);
  if (!m) return null;
  if (PRICING[m]) return PRICING[m];
  // 前缀匹配，取最长命中（gpt-4o-2024-08-06 → gpt-4o）
  let best = null;
  for (const k in PRICING) {
    if (m.indexOf(k) === 0 && (!best || k.length > best.length)) best = k;
  }
  return best ? PRICING[best] : null;
}

/** 估算费用（元）。返回 null 表示无单价，前端应显示"未知单价"而不是 0 */
function estimateCost(model, inTok, outTok) {
  const p = priceOf(model);
  if (!p) return null;
  return ((inTok || 0) / 1e6) * p.in + ((outTok || 0) / 1e6) * p.out;
}

/* ---------------------------------------------------------------- 数据层 */

/**
 * 账号对象的规范化。
 * 老数据里只有 `balanceManual`（布尔），现在换成 `balanceSource`（来源字符串），
 * 这样界面能说清「这个余额是手动填的还是从哪个接口读回来的」。
 */
function normalizeAccount(a) {
  const o = Object.assign({
    id: uid('ac'),
    platformId: 'custom',
    label: '主账号',
    apiKey: '',
    baseUrl: '',
    defaultModel: '',
    balance: null,
    balanceSource: null,
    balanceNative: null,
    balanceUpdatedAt: null,
    cred: null,
    createdAt: Date.now(),
  }, a);
  if (!o.balanceSource && typeof o.balance === 'number') {
    o.balanceSource = a.balanceManual ? 'manual' : null;
  }
  delete o.balanceManual;
  return o;
}

/** 面板凭据：token 永远留着（省得每次都要重新登录），密码看用户勾没勾 */
function normalizeCred(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    mode: c.mode === 'password' ? 'password' : 'panel',
    username: String(c.username || ''),
    password: c.password ? String(c.password) : '',
    savePassword: !!c.savePassword,
    token: c.token ? String(c.token) : '',
    tokenAt: c.tokenAt || null,
    userId: c.userId != null ? c.userId : null,
    lastError: c.lastError || '',
    lastAt: c.lastAt || null,
  };
}

const DEFAULT_DATA = () => ({
  version: 1,
  platforms: JSON.parse(JSON.stringify(PRESET_PLATFORMS)),
  accounts: [],
  logs: [],
  settings: {
    timeoutMs: 30000,
    verifyMaxTokens: 64,
    defaultPrompt: '你好，请用一句话介绍你自己。',
    /** 美元换人民币的汇率。OpenRouter / 中转站面板按美元折算，统一用这个价换成本地金额 */
    usdRate: 7.3,
  },
});

/** 本地金额统一是人民币。外币来源按 settings.usdRate 折算，折算过程留在 balanceNative 里可回溯 */
function toCNY(amount, currency, rate) {
  const a = Number(amount);
  if (!isFinite(a)) return null;
  const cur = String(currency || 'CNY').toUpperCase();
  if (cur === 'CNY' || cur === 'RMB') return { cny: a, rate: 1, converted: false };
  const r = Number(rate) > 0 ? Number(rate) : 7.3;
  return { cny: a * r, rate: r, converted: true };
}

const Store = (function () {
  let data = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = Object.assign(DEFAULT_DATA(), parsed);
        data.settings = Object.assign(DEFAULT_DATA().settings, parsed.settings || {});
        if (!Array.isArray(data.platforms) || !data.platforms.length) data.platforms = DEFAULT_DATA().platforms;
        if (!Array.isArray(data.accounts)) data.accounts = [];
        data.accounts = data.accounts.filter((a) => a && a.id).map(normalizeAccount);
        if (!Array.isArray(data.logs)) data.logs = [];
        mergePresetPlatforms();
      } else {
        data = DEFAULT_DATA();
        save();
      }
    } catch (e) {
      console.warn('读取本地数据失败，已重置', e);
      data = DEFAULT_DATA();
    }
    return data;
  }

  /**
   * 把新版本新增的预置平台补进已有数据里，并给老平台补上 balanceKind。
   * 不覆盖用户改过的 name / baseUrl —— 只补缺的字段。
   */
  function mergePresetPlatforms() {
    if (!data || !Array.isArray(data.platforms)) return;
    PRESET_PLATFORMS.forEach((pre) => {
      const cur = data.platforms.filter((p) => p.id === pre.id)[0];
      if (!cur) {
        data.platforms.push(JSON.parse(JSON.stringify(pre)));
        return;
      }
      if (!cur.balanceKind && pre.balanceKind) cur.balanceKind = pre.balanceKind;
      if (!cur.color) cur.color = pre.color;
    });
    /* 用户自建的平台（id 是 pf_xxx）没有 balanceKind，按「中转站」处理最不容易错 */
    data.platforms.forEach((p) => {
      if (!p.balanceKind) p.balanceKind = BALANCE_KIND_BY_ID[p.id] || 'panel';
    });
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      UI.toast('本机存储写入失败：' + e.message, 'err');
    }
  }

  const all = () => (data || load());
  const settings = () => all().settings;

  function setSetting(k, v) {
    all().settings[k] = v;
    save();
  }

  /* ---- 平台 ---- */
  const platforms = () => all().platforms;
  function platform(id) {
    return all().platforms.filter((p) => p.id === id)[0] || null;
  }
  function addPlatform(p) {
    const item = Object.assign({ id: uid('pf'), name: '自定义', color: '#6BA8A0', baseUrl: '', balance: 'manual', doc: '' }, p);
    all().platforms.push(item);
    save();
    return item;
  }

  /* ---- 账号 ---- */
  const accounts = () => all().accounts;
  const accountsOf = (pid) => all().accounts.filter((a) => a.platformId === pid);
  function account(id) {
    return all().accounts.filter((a) => a.id === id)[0] || null;
  }
  function addAccount(a) {
    const item = normalizeAccount(Object.assign({
      id: uid('ac'),
      platformId: 'custom',
      label: '主账号',
      apiKey: '',
      baseUrl: '',
      balance: null,
      balanceSource: null,
      balanceNative: null,
      balanceUpdatedAt: null,
      cred: null,
      createdAt: Date.now(),
    }, a));
    if (!item.baseUrl) {
      const p = platform(item.platformId);
      item.baseUrl = (p && p.baseUrl) || '';
    }
    all().accounts.push(item);
    save();
    return item;
  }
  function updateAccount(id, patch) {
    const a = account(id);
    if (!a) return null;
    Object.assign(a, patch);
    if ('cred' in patch) a.cred = normalizeCred(a.cred);
    save();
    return a;
  }
  /** 只改凭据的某几个字段，避免把 token 覆盖掉 */
  function setCred(id, credPatch) {
    const a = account(id);
    if (!a) return null;
    a.cred = normalizeCred(Object.assign({}, a.cred || {}, credPatch || {}));
    save();
    return a;
  }
  function removeAccount(id) {
    const d = all();
    d.accounts = d.accounts.filter((a) => a.id !== id);
    d.logs = d.logs.filter((l) => l.accountId !== id);
    save();
  }

  /* ---- 日志 ---- */
  function addLog(entry) {
    const d = all();
    d.logs.unshift(Object.assign({ id: uid('lg'), ts: Date.now() }, entry));
    const limit = Math.max(50, Number(d.settings.logLimit) || LOG_LIMIT);
    if (d.logs.length > limit) d.logs.length = limit;
    save();
  }
  function clearLogs() {
    all().logs = [];
    save();
  }
  function removeLog(id) {
    const d = all();
    d.logs = d.logs.filter((l) => l.id !== id);
    save();
  }

  /* ---- 导入导出 ---- */
  /**
   * 导出前的清洗。默认把「面板登录密码」和「面板 token」剥掉：
   * 备份文件最容易被随手丢到网盘或聊天窗口里，一份明文的面板账号密码跟着跑出去不合适。
   * 想连凭据一起备份，得显式传 { includeCreds: true }。
   */
  function exportData(opts) {
    const includeCreds = !!(opts && opts.includeCreds);
    const copy = JSON.parse(JSON.stringify(all()));
    (copy.accounts || []).forEach((a) => {
      if (!a.cred) return;
      a.cred = includeCreds ? a.cred : { mode: a.cred.mode, username: a.cred.username || '' };
    });
    return copy;
  }
  function exportJson(opts) {
    return JSON.stringify(exportData(opts), null, 2);
  }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('不是合法的数据对象');
    if (!Array.isArray(parsed.accounts)) throw new Error('缺少 accounts 字段');
    data = {
      version: 1,
      platforms: Array.isArray(parsed.platforms) && parsed.platforms.length
        ? parsed.platforms
        : JSON.parse(JSON.stringify(DEFAULT_DATA().platforms)),
      accounts: parsed.accounts.filter((a) => a && a.id).map(normalizeAccount),
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      settings: Object.assign(DEFAULT_DATA().settings, parsed.settings || {}),
    };
    mergePresetPlatforms();
    save();
  }
  function wipe() {
    data = DEFAULT_DATA();
    save();
  }

  /* ---- 演示数据 ---- */

  /* 演示账号的 id 是固定的；用户自己建的账号用随机 id，撞不上 */
  const DEMO_ACC = ['ac_demo1', 'ac_demo2', 'ac_demo3', 'ac_demo4', 'ac_demo5', 'ac_demo6'];

  /* 当前数据里有没有演示数据 */
  function isDemo() {
    return (all().accounts || []).some((a) => DEMO_ACC.indexOf(a.id) >= 0);
  }

  /* 只清演示数据，用户自己建的账号和记录留着。
     以前只有「一个个删」和「清空全部数据」（后者会把自己的账号也删掉），
     所以载入演示数据等于走进一条出不来的路。 */
  function clearDemo() {
    const d = all();
    const aBefore = (d.accounts || []).length;
    const lBefore = (d.logs || []).length;
    d.accounts = (d.accounts || []).filter((a) => DEMO_ACC.indexOf(a.id) < 0);
    d.logs = (d.logs || []).filter((l) => DEMO_ACC.indexOf(String(l.accountId || '')) < 0);
    save();
    return { accounts: aBefore - d.accounts.length, logs: lBefore - d.logs.length };
  }

  function loadDemo() {
    const d = DEFAULT_DATA();
    d.accounts = [
      { id: 'ac_demo1', platformId: 'openai',   label: '主账号',   apiKey: 'sk-proj-DEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxx4f2a', baseUrl: 'https://api.openai.com/v1', balance: 52.40, balanceSource: 'manual', balanceUpdatedAt: Date.now() - 3600e3, createdAt: Date.now() - 86400e3 * 30 },
      { id: 'ac_demo2', platformId: 'openai',   label: '备用账号', apiKey: 'sk-proj-DEMOyyyyyyyyyyyyyyyyyyyyyyyyyyyy7b19', baseUrl: 'https://api.openai.com/v1', balance: 30.00, balanceSource: 'manual', balanceUpdatedAt: Date.now() - 7200e3, createdAt: Date.now() - 86400e3 * 12 },
      { id: 'ac_demo3', platformId: 'deepseek', label: '主账号',   apiKey: 'sk-DEMOzzzzzzzzzzzzzzzzzzzzzzzzzzzzc410', baseUrl: 'https://api.deepseek.com/v1', balance: 88.60, balanceSource: 'deepseek', balanceUpdatedAt: Date.now() - 600e3, createdAt: Date.now() - 86400e3 * 20 },
      { id: 'ac_demo4', platformId: 'anthropic',label: '主账号',   apiKey: 'sk-ant-DEMOaaaaaaaaaaaaaaaaaaaaaaaaa9e77', baseUrl: 'https://api.anthropic.com/v1', balance: 12.20, balanceSource: 'manual', balanceUpdatedAt: Date.now() - 86400e3, createdAt: Date.now() - 86400e3 * 8 },
      { id: 'ac_demo5', platformId: 'custom',   label: '中转站号', apiKey: 'sk-DEMOrelayxxxxxxxxxxxxxxxxxxxxxxxxxx88a1', baseUrl: 'https://relay.example.com/v1', balance: 216.05, balanceSource: 'panel', balanceNative: { amount: 29.60, currency: 'USD' }, balanceUpdatedAt: Date.now() - 1800e3, cred: { mode: 'panel', username: 'demo@example.com', password: '', savePassword: false, token: '', userId: 1, lastAt: Date.now() - 1800e3 }, createdAt: Date.now() - 86400e3 * 40 },
      { id: 'ac_demo6', platformId: 'openrouter', label: '主账号', apiKey: 'sk-or-v1-DEMObbbbbbbbbbbbbbbbbbbbbbbbb3c04', baseUrl: 'https://openrouter.ai/api/v1', balance: 0, balanceSource: null, balanceUpdatedAt: null, createdAt: Date.now() - 86400e3 * 3 },
    ];
    d.logs = [
      { id: 'lg_d1', ts: Date.now() - 600e3,    accountId: 'ac_demo1', platformId: 'openai',    model: 'gpt-4o-mini',       kind: 'verify', status: 'ok', code: 200, inTok: 32,    outTok: 24,    latencyMs: 1200, costCNY: 0.0001, preview: '' },
      { id: 'lg_d2', ts: Date.now() - 3600e3,   accountId: 'ac_demo1', platformId: 'openai',    model: 'gpt-4o',            kind: 'chat',   status: 'ok', code: 200, inTok: 1240,  outTok: 380,   latencyMs: 1800, costCNY: 0.0497, preview: '' },
      { id: 'lg_d3', ts: Date.now() - 7200e3,   accountId: 'ac_demo3', platformId: 'deepseek',  model: 'deepseek-chat',     kind: 'chat',   status: 'ok', code: 200, inTok: 860,   outTok: 512,   latencyMs: 2400, costCNY: 0.0058, preview: '' },
      { id: 'lg_d4', ts: Date.now() - 86400e3,  accountId: 'ac_demo4', platformId: 'anthropic', model: 'claude-sonnet-4',   kind: 'chat',   status: 'ok', code: 200, inTok: 3120,  outTok: 980,   latencyMs: 3100, costCNY: 0.1684, preview: '' },
      { id: 'lg_d5', ts: Date.now() - 90000e3,  accountId: 'ac_demo2', platformId: 'openai',    model: 'gpt-3.5-turbo',     kind: 'verify', status: 'err',  code: 401, inTok: 0,     outTok: 0,     latencyMs: 420,  costCNY: 0,      preview: '', errorMsg: '服务端拒绝鉴权：该密钥无效或已被撤销' },
      { id: 'lg_d6', ts: Date.now() - 100000e3, accountId: 'ac_demo3', platformId: 'deepseek',  model: 'deepseek-reasoner', kind: 'chat',   status: 'ok', code: 200, inTok: 2060,  outTok: 1480,  latencyMs: 8400, costCNY: 0.0319, preview: '' },
      { id: 'lg_d7', ts: Date.now() - 115000e3, accountId: 'ac_demo5', platformId: 'custom',    model: 'claude-sonnet-4',   kind: 'chat',   status: 'ok', code: 200, inTok: 4180,  outTok: 1620,  latencyMs: 5200, costCNY: 0.2580, preview: '' },
      { id: 'lg_d8', ts: Date.now() - 130000e3, accountId: 'ac_demo5', platformId: 'custom',    model: 'gpt-4o',            kind: 'verify', status: 'ok', code: 200, inTok: 40,    outTok: 18,    latencyMs: 980,  costCNY: 0.0018, preview: '' },
    ];
    data = d;
    save();
  }

  return {
    load, save, all, settings, setSetting,
    platforms, platform, addPlatform,
    accounts, accountsOf, account, addAccount, updateAccount, removeAccount, setCred,
    logs: () => all().logs, addLog, clearLogs, removeLog,
    exportData, exportJson, importJson, wipe, loadDemo, isDemo, clearDemo,
    DEFAULT_DATA,
  };
})();

/* ---------------------------------------------------------------- 网络层
   三级降级：
     1. 运行在 APK 里  → CapacitorHttp（原生请求，完全绕开 CORS）
     2. 运行在 Web 里  → 本地 Node 代理 /api/proxy（绕开 CORS）
     3. 都没有        → 直连 fetch（会被跨域拦住，前端给明确提示）
   ------------------------------------------------------------------ */

const Net = (function () {
  let mode = 'unknown';   // 'native' | 'proxy' | 'direct'

  function capacitorHttp() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
        return window.Capacitor.Plugins.CapacitorHttp;
      }
    } catch (_) {}
    return null;
  }

  async function detect() {
    if (capacitorHttp()) { mode = 'native'; return mode; }
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.app === 'ai-api-hub') { mode = 'proxy'; return mode; }
      }
    } catch (_) {}
    mode = 'direct';
    return mode;
  }

  function classify(status) {
    if (status === 401) return 'auth_invalid';
    if (status === 403) return 'auth_forbidden';
    if (status === 404) return 'not_found';
    if (status === 408) return 'timeout';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'upstream_error';
    if (status >= 400) return 'bad_request';
    return 'ok';
  }

  /**
   * 统一请求
   * @returns {Promise<{ok:boolean,status?:number,kind:string,body?:string,latencyMs:number,message?:string}>}
   */
  async function request(opts) {
    const url = opts.url;
    const method = (opts.method || 'POST').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});
    const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 30000, 1000), 300000);
    const rawBody = opts.body;
    const bodyStr = rawBody == null ? undefined : (typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody));

    if (mode === 'unknown') await detect();

    const started = Date.now();

    /* ---- 1. 原生 ---- */
    if (mode === 'native') {
      const http = capacitorHttp();
      try {
        let data = rawBody;
        if (typeof rawBody === 'string') {
          try { data = JSON.parse(rawBody); } catch (_) { data = rawBody; }
        }
        const res = await http.request({
          url, method, headers, data,
          /* 明确要文本：Capacitor 默认会试着把响应 JSON.parse 一遍，
             遇到 SSE 这种不是 JSON 的流式响应容易把内容搞坏 */
          responseType: 'text',
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        return { ok: true, status: res.status, kind: classify(res.status), body: text, latencyMs: Date.now() - started };
      } catch (e) {
        return { ok: false, kind: 'network', message: String((e && e.message) || e), latencyMs: Date.now() - started };
      }
    }

    /* ---- 2. 本地代理 ---- */
    if (mode === 'proxy') {
      try {
        const r = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, method, headers, body: bodyStr, timeoutMs }),
        });
        const j = await r.json();
        if (j.ok) {
          return { ok: true, status: j.status, kind: j.kind || classify(j.status), body: j.body, latencyMs: Date.now() - started };
        }
        return { ok: false, kind: j.kind || 'network', message: j.message, latencyMs: Date.now() - started };
      } catch (e) {
        return { ok: false, kind: 'network', message: '本地代理不可用：' + String((e && e.message) || e), latencyMs: Date.now() - started };
      }
    }

    /* ---- 3. 直连（大概率被 CORS 拦） ---- */
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method, headers, body: bodyStr, signal: ac.signal });
      const text = await r.text();
      clearTimeout(timer);
      return { ok: true, status: r.status, kind: classify(r.status), body: text, latencyMs: Date.now() - started };
    } catch (e) {
      clearTimeout(timer);
      const aborted = e && e.name === 'AbortError';
      return {
        ok: false,
        kind: aborted ? 'timeout' : 'cors',
        message: aborted
          ? '请求在 ' + Math.round(timeoutMs / 1000) + ' 秒内未收到响应，已主动中断'
          : '浏览器直连被拦截（CORS）。请通过 npm start 以本地服务方式打开。',
        latencyMs: Date.now() - started,
      };
    }
  }

  return { request, detect, mode: () => mode };
})();

/* ---------------------------------------------------------------- 接口封装 */

/** 拼 URL：兼容用户填 https://api.x.com 或 https://api.x.com/v1 */
function apiUrl(base, endpoint) {
  let b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  if (/\/v\d+$/i.test(b)) return b + String(endpoint).replace(/^\/v\d+/i, '');
  return b + endpoint;
}

/* ---------------------------------------------------------------- 响应解析
 *
 * 「OpenAI 兼容」的上游实际有三副面孔，必须都认：
 *   1. 标准非流式  { object:'chat.completion',        choices:[{message:{content}}] }
 *   2. SSE 流式    data: {...chat.completion.chunk...} 逐条 delta 攒出来
 *   3. 单个 chunk  { object:'chat.completion.chunk',  choices:[{delta:{content}}] }
 *
 * 第 2 种最容易踩：请求体里明明写了 stream:false，相当多中转站照样硬吐 SSE。
 * 之前只认第 1 种，于是把 HTTP 200 的可用接口误判成「无法解析」，再被兜底文案
 * 显示成「请求失败 / 未知错误」—— 明明能用的 Key 被自己的解析器判了死刑。
 */

/** 响应体是不是 SSE（text/event-stream） */
function isSseBody(text) {
  const t = String(text == null ? '' : text);
  return /^[ \t]*(?:data|event)[ \t]*:/m.test(t.slice(0, 8192));
}

/** 把 SSE 里的 data: 负载逐条取出（丢掉注释心跳与 [DONE]） */
function ssePayloads(text) {
  const out = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^[ \t]+/, '');
    if (!line || line.charAt(0) === ':') continue;
    if (line.slice(0, 5).toLowerCase() !== 'data:') continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    out.push(payload);
  }
  return out;
}

/** 从一个 chunk / completion 里把正文、推理内容、收尾原因抠出来 */
function textOfChunk(chunk) {
  let text = '', reasoning = '', finish = '';
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], depth + 1);
      return;
    }
    if (typeof node.content === 'string') text += node.content;
    if (typeof node.reasoning_content === 'string') reasoning += node.reasoning_content;
    if (typeof node.reasoning === 'string') reasoning += node.reasoning;
    if (typeof node.finish_reason === 'string' && node.finish_reason) finish = node.finish_reason;
    /* 只沿「可能装正文」的字段往下钻，免得把 error.message 之类的文本也吃进来。
       顺带兜住一种见过的畸形上游：把整个 chunk 又套一层塞进 delta 里。 */
    walk(node.choices, depth + 1);
    walk(node.delta, depth + 1);
    walk(node.message, depth + 1);
  };
  walk(chunk && chunk.choices, 0);
  return { text: text, reasoning: reasoning, finish: finish };
}

/**
 * 解析一次对话请求的响应体，三种形状通吃。
 * ok=false 只表示「认不出这是对话结构」，不代表 HTTP 失败。
 */
function parseChatBody(raw) {
  const body = typeof raw === 'string' ? raw : (raw == null ? '' : JSON.stringify(raw));
  const res = {
    ok: false, shape: '', text: '', reasoning: '', error: null,
    usage: null, finishReason: '', id: '', model: '', streamed: false, chunks: 0,
  };

  const take = (chunk) => {
    if (!chunk || typeof chunk !== 'object') return;
    const t = textOfChunk(chunk);
    res.text += t.text;
    res.reasoning += t.reasoning;
    if (t.finish) res.finishReason = t.finish;
    if (chunk.usage && typeof chunk.usage === 'object') res.usage = chunk.usage;
    if (chunk.error && !res.error) res.error = chunk.error;
    if (chunk.model && !res.model) res.model = chunk.model;
    if (chunk.id && !res.id) res.id = chunk.id;
    res.chunks++;
  };

  if (isSseBody(body)) {
    res.streamed = true;
    const payloads = ssePayloads(body);
    let parsed = 0;
    for (let i = 0; i < payloads.length; i++) {
      let j = null;
      try { j = JSON.parse(payloads[i]); } catch (_) { continue; }
      parsed++;
      take(j);
    }
    res.shape = parsed > 0 ? 'sse' : 'sse-empty';
    res.ok = parsed > 0;
    return res;
  }

  let j = null;
  try { j = JSON.parse(body); } catch (_) { return res; }
  if (!j || typeof j !== 'object') return res;

  take(j);
  const objType = String(j.object || '');
  if (objType.indexOf('chunk') >= 0) { res.shape = 'chunk'; res.ok = true; }
  else if (Array.isArray(j.choices)) { res.shape = 'completion'; res.ok = true; }
  else if (j.error) { res.shape = 'error'; }
  else { res.shape = 'unknown'; }
  return res;
}

/**
 * 没有 usage 时的粗略 token 估算（中日韩字符按 1 token/字，其余按 4 字符/token）。
 * 流式响应基本不回 usage，日志里空着不如给个量级——但调用方必须标成「估算」。
 */
function estimateTokens(text) {
  const s = String(text == null ? '' : text);
  if (!s) return 0;
  let wide = 0;
  for (let i = 0; i < s.length; i++) { if (s.charCodeAt(i) >= 0x2e80) wide++; }
  const narrow = s.length - wide;
  return Math.max(1, Math.round(wide + narrow / 4));
}

const Api = {
  /** 拉取可用模型列表 */
  async listModels(account, timeoutMs) {
    const url = apiUrl(account.baseUrl, '/v1/models');
    const r = await Net.request({
      url, method: 'GET',
      headers: { Authorization: 'Bearer ' + account.apiKey, Accept: 'application/json' },
      timeoutMs: timeoutMs,
    });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message, latencyMs: r.latencyMs };
    if (r.status !== 200) {
      return { ok: false, status: r.status, kind: r.kind, raw: r.body, latencyMs: r.latencyMs,
               message: errMessageOf(r) };
    }
    let ids = [];
    try {
      const j = JSON.parse(r.body);
      const arr = (j && (j.data || j.models)) || [];
      ids = arr.map((m) => m && (m.id || m.name)).filter(Boolean);
    } catch (_) {}
    ids.sort();
    return { ok: true, models: ids, latencyMs: r.latencyMs };
  },

  /** 发一次对话请求（也用于接口验证） */
  async chat(account, model, messages, maxTokens, timeoutMs) {
    const url = apiUrl(account.baseUrl, '/v1/chat/completions');
    const payload = { model: model, messages: messages, stream: false };
    if (maxTokens) payload.max_tokens = maxTokens;
    const req = { method: 'POST', url: url, model: model, timeoutMs: timeoutMs };

    /* 这里刻意不写 Accept: text/event-stream —— 让上游优先给完整的非流式 JSON；
       真遇上「不管不顾硬吐 SSE」的中转站，parseChatBody 会兜住。

       有些中转站只认 stream:true，可以考虑加个开关；目前先用兼容性最好的写法。 */
    const r = await Net.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + account.apiKey,
        Accept: 'application/json',
      },
      body: payload,
      timeoutMs: timeoutMs,
    });

    if (!r.ok) {
      return {
        ok: false,
        kind: r.kind,
        status: null,
        latencyMs: r.latencyMs,
        message: r.message,
        request: req,
      };
    }

    if (r.status !== 200) {
      let j = null;
      try { j = JSON.parse(r.body); } catch (_) {}
      return {
        ok: false,
        status: r.status,
        kind: r.kind,
        latencyMs: r.latencyMs,
        message: errMessageOf(r, j),
        raw: r.body,
        request: req,
      };
    }

    const p = parseChatBody(r.body);

    /* 有些中转站把错误塞进 HTTP 200 的流里，得单独挑出来 */
    if (p.error) {
      const em = typeof p.error === 'string'
        ? p.error
        : (p.error.message || JSON.stringify(p.error));
      return {
        ok: false, status: r.status, kind: 'upstream_error', latencyMs: r.latencyMs,
        message: em, raw: r.body, streamed: p.streamed, shape: p.shape, request: req,
      };
    }

    /* HTTP 通了，但返回的形状不属于任何一种对话结构 */
    if (!p.ok) {
      return {
        ok: false, status: r.status, kind: 'parse', latencyMs: r.latencyMs,
        message: p.streamed
          ? '返回了流式数据，但里面没有可解析的对话分片'
          : 'HTTP 200，但返回体不是可识别的对话结构',
        raw: r.body, streamed: p.streamed, shape: p.shape, request: req,
      };
    }

    const usage = p.usage || {};
    const hasUsage = usage.prompt_tokens != null
      || usage.completion_tokens != null
      || usage.total_tokens != null;
    let inTok = usage.prompt_tokens != null ? usage.prompt_tokens : null;
    let outTok = usage.completion_tokens != null ? usage.completion_tokens : null;
    const tokEstimated = !hasUsage;
    if (tokEstimated) {
      inTok = estimateTokens((messages || []).map((m) => String((m && m.content) || '')).join('\n'));
      outTok = estimateTokens(p.text);
    }
    const totalTok = usage.total_tokens != null
      ? usage.total_tokens
      : ((inTok != null && outTok != null) ? inTok + outTok : null);

    return {
      ok: true,
      status: r.status,
      kind: 'ok',
      latencyMs: r.latencyMs,
      text: p.text,
      emptyText: !p.text,
      reasoningLen: (p.reasoning || '').length,
      streamed: p.streamed,
      shape: p.shape,
      chunks: p.chunks,
      finishReason: p.finishReason || '',
      inTok: inTok, outTok: outTok, totalTok: totalTok,
      tokEstimated: tokEstimated,
      cost: (inTok == null && outTok == null) ? null : estimateCost(model, inTok, outTok),
      hasPrice: !!priceOf(model),
      request: req,
    };
  },

  /**
   * 余额查询（薄封装，真正的实现在 Balance 里）。
   * 保留这个入口是为了让调用方只关心「成没成」，不用管走的是官方接口还是面板登录。
   */
  async balance(account, platform, opts) {
    const r = await Balance.query(account, platform, opts);
    if (r.ok) {
      return { ok: true, balance: r.amount, currency: r.currency, extra: r.extra || [], via: r.via, raw: r.raw };
    }
    /* 'manual' 对外统一成 unsupported，历史调用方认这个值 */
    return {
      ok: false,
      kind: r.kind === 'manual' ? 'unsupported' : r.kind,
      status: r.httpStatus,
      message: r.message,
      raw: r.raw,
    };
  },
};

/** 从响应里抠出人话错误信息 */
function errMessageOf(r, json) {
  const j = json || (function () { try { return JSON.parse(r.body); } catch (_) { return null; } })();
  if (j && j.error) {
    if (typeof j.error === 'string') return j.error;
    if (j.error.message) return j.error.message;
  }
  if (j && j.message) return typeof j.message === 'string' ? j.message : JSON.stringify(j.message);
  if (r.body && r.body.length < 400 && r.body.trim()) return r.body.trim();
  if (r.status === 401) return '服务端拒绝鉴权：该密钥无效或已被撤销';
  if (r.status === 403) return '该密钥没有访问该模型的权限';
  if (r.status === 404) return '接口地址不存在，请检查 BaseURL 是否填写正确';
  if (r.status === 429) return '触发限流或额度耗尽，请稍后重试';
  if (r.status >= 500) return '上游服务异常，不是你的配置问题';
  return 'HTTP ' + r.status;
}

/* ---------------------------------------------------------------- 余额
 *
 * 现实里「查余额」有两套完全不同的口径，必须分开对待：
 *
 *   A. 官方平台（DeepSeek / Moonshot / 硅基流动 / OpenRouter）
 *      平台自己开放了余额接口，拿 API Key 直接查，不需要账号密码。
 *
 *   B. New API / One API 系中转站
 *      没有对外的余额接口，但面板自己有登录接口。先拿站点账号密码登录换
 *      access_token，再读 /api/user/self。两条硬边界（上游这么设计的，不是我们偷懒）：
 *        · 站点开了 Turnstile 人机验证 → 脚本登录过不去，只能手动填余额；
 *        · 站点开了密码加密 → 按 new-api 官方前端的做法，用 WebCrypto 做
 *          RSA-OAEP(SHA-256) 加密后再提交，见 encryptPanelPassword。
 *
 * 金额口径统一：本机一律存人民币。外币按 settings.usdRate 折算，
 * 原始金额留在 balanceNative 里，界面上随时能回溯。
 * ------------------------------------------------------------------ */

const Balance = (function () {
  const BAL_TIMEOUT = 15000;

  /* ---- URL 小工具 ---- */
  function trimSlash(s) { return String(s || '').trim().replace(/\/+$/, ''); }
  /** 去掉结尾的 /v1、/v4 这类版本段，得到站点根 */
  function siteRoot(base) { return trimSlash(base).replace(/\/v\d+$/i, ''); }
  function withScheme(b) {
    const t = trimSlash(b);
    if (!t) return '';
    return /^https?:\/\//i.test(t) ? t : 'https://' + t;
  }
  function bearer(k) { return { Authorization: 'Bearer ' + String(k || ''), Accept: 'application/json' }; }

  function numOf(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* ---------------------------------------------------------------- 密码加密
     new-api 的前端在站点开启「密码加密登录」时，会先用 /api/user/login/encryption-key
     拿一个 RSA 公钥，把密码做 RSA-OAEP(SHA-256) 加密再 POST 上去。
     这里按同样的做法来，这样开了这个开关的站点也能登录。
     WebCrypto 只在安全上下文里有（127.0.0.1 / https / APK 内壳都算），
     用普通 http 域名打开网页版时拿不到，要给出明确提示而不是静默失败。 */
  function pemToDer(pem) {
    const body = String(pem || '')
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '');
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function b64Of(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  async function encryptPanelPassword(password, publicKeyPem) {
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) || null;
    if (!subtle) {
      throw new Error('当前页面不是安全上下文（WebCrypto 不可用），无法加密密码。请用 http://127.0.0.1 打开，或使用 APK 版本。');
    }
    const key = await subtle.importKey('spki', pemToDer(publicKeyPem),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const modLen = (key.algorithm && key.algorithm.modulusLength) || 2048;
    const plain = new TextEncoder().encode(String(password));
    if (plain.byteLength > modLen / 8 - 66) {
      throw new Error('密码过长，超出该站点公钥能加密的长度');
    }
    const ct = await subtle.encrypt({ name: 'RSA-OAEP' }, key, plain);
    return b64Of(ct);
  }

  /* ---------------------------------------------------------------- 中转站面板
     凭据链：/api/status（探站点）→ 可选 /api/user/login/encryption-key
             → /api/user/login（换 token）→ /api/user/self（读余额） */

  async function panelStatus(base) {
    const root = siteRoot(withScheme(base));
    if (!root) return { ok: false, kind: 'bad_request', message: '账号没填 BaseURL' };
    const r = await Net.request({ url: root + '/api/status', method: 'GET', headers: { Accept: 'application/json' }, timeoutMs: BAL_TIMEOUT });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message, root: root };
    /* 401 / 403 同样说明「这儿不是面板」。
       New API 系的 /api/status 是公开端点，匿名就能读；真要是个面板，
       绝不会对匿名请求要鉴权。用户把官方 API 域名（api.openai.com 之类）
       填进中转站账号时，撞的就是这个 401 —— 这时候提示「账号密码不对」
       会把人带偏，正确的话是「这不是面板地址」。 */
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      return { ok: false, kind: 'not_panel', status: r.status, root: root, raw: r.body,
               message: r.status === 404
                 ? '这个地址上没有 /api/status（404），看起来不是 New API / One API 系的中转站面板'
                 : `这个地址上的 /api/status 要鉴权（HTTP ${r.status}）——面板的这个接口本该是公开的，所以它不是面板` };
    }
    if (r.status !== 200) {
      return { ok: false, kind: r.kind, status: r.status, root: root, raw: r.body, message: errMessageOf(r) };
    }
    try {
      const j = JSON.parse(r.body);
      const d = (j && j.data) || j || {};
      if (!j || (j.success === false)) throw new Error('站点返回 success=false');
      return {
        ok: true, root: root, status: r.status, raw: r.body,
        info: {
          turnstile: !!(d.turnstile_check),
          siteKey: d.turnstile_site_key || '',
          quotaPerUnit: numOf(d.quota_per_unit) || 500000,
          displayInCurrency: d.display_in_currency,
          usdRate: numOf(d.usd_exchange_rate),
          pwdEncryption: !!(d.password_login_encryption_enabled),
          version: d.version || '',
          name: d.system_name || d.name || '',
        },
      };
    } catch (e) {
      return { ok: false, kind: 'parse', status: r.status, root: root, raw: r.body,
               message: '/api/status 的返回不是面板格式：' + e.message };
    }
  }

  async function panelEncryptionKey(root) {
    const r = await Net.request({ url: root + '/api/user/login/encryption-key', method: 'GET', headers: { Accept: 'application/json' }, timeoutMs: BAL_TIMEOUT });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message };
    if (r.status !== 200) return { ok: false, kind: r.kind, status: r.status, message: errMessageOf(r) };
    let j = null;
    try { j = JSON.parse(r.body); } catch (_) {}
    const d = (j && j.data) || {};
    if (!d.public_key) return { ok: false, kind: 'parse', message: '该站点没有返回可用于加密的公钥' };
    return { ok: true, kid: d.kid || '', publicKey: d.public_key };
  }

  function panelErrMessage(j, r) {
    const msg = (j && (j.message || (j.error && j.error.message))) || '';
    if (msg) return String(msg);
    if (r.status === 401) return '账号或密码不对（该站点拒绝了这次登录）';
    if (r.status === 404) return '这个地址上没有 /api/user/login，不是面板站点';
    return errMessageOf(r);
  }

  /**
   * 面板登录 → { ok, token, user } / { ok:false, kind, message }
   * kind: auth_invalid 账号密码错 / turnstile 有人机验证 / need_encryption 加密不可用 …
   */
  async function panelLogin(base, username, password) {
    const st = await panelStatus(base);
    if (!st.ok) return st;
    if (st.info.turnstile) {
      return {
        ok: false, kind: 'turnstile', root: st.root, status: st,
        message: '该站点开启了人机验证（Cloudflare Turnstile），脚本没法自动登录。可以在浏览器里登录后把 access token 粘进来，或者直接手动填余额。',
      };
    }

    const payload = { username: String(username || ''), password: String(password || '') };
    if (!payload.username || !payload.password) {
      return { ok: false, kind: 'bad_request', root: st.root, status: st, message: '请先填写该站点的登录账号和密码' };
    }

    if (st.info.pwdEncryption) {
      const k = await panelEncryptionKey(st.root);
      if (!k.ok) return { ok: false, kind: k.kind, root: st.root, status: st, message: '读取加密公钥失败：' + k.message };
      try {
        payload.password_encrypted = await encryptPanelPassword(payload.password, k.publicKey);
        payload.encryption_key_id = k.kid;
        delete payload.password;
      } catch (e) {
        return { ok: false, kind: 'crypto', root: st.root, status: st, message: '加密密码失败：' + e.message };
      }
    }

    const r = await Net.request({
      url: st.root + '/api/user/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload, timeoutMs: BAL_TIMEOUT,
    });
    if (!r.ok) return { ok: false, kind: r.kind, root: st.root, status: st, message: r.message };

    let j = null;
    try { j = JSON.parse(r.body); } catch (_) {}
    if (r.status !== 200 || !j || j.success === false || !(j.data && (j.data.access_token || j.data.token))) {
      const kind = r.status === 401 || r.status === 400 ? 'auth_invalid' : r.kind;
      return { ok: false, kind: kind, root: st.root, status: st, httpStatus: r.status, raw: r.body,
               message: panelErrMessage(j, r) };
    }

    const d = j.data;
    return {
      ok: true, root: st.root, status: st, raw: r.body,
      token: d.access_token || d.token,
      user: d.user || null,
      expiresAt: d.access_expires_at || null,
    };
  }

  /** 用 token 读面板上的自己 → { ok, user } */
  async function panelSelf(base, token) {
    const root = siteRoot(withScheme(base));
    const r = await Net.request({
      url: root + '/api/user/self', method: 'GET',
      headers: { Authorization: 'Bearer ' + String(token || ''), Accept: 'application/json' },
      timeoutMs: BAL_TIMEOUT,
    });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message };
    let j = null;
    try { j = JSON.parse(r.body); } catch (_) {}
    if (r.status === 401 || r.status === 403) {
      return { ok: false, kind: 'token_expired', httpStatus: r.status, raw: r.body,
               message: '登录凭据已失效，需要重新登录一次' };
    }
    if (r.status !== 200 || !j || j.success === false || !j.data) {
      return { ok: false, kind: r.kind === 'ok' ? 'parse' : r.kind, httpStatus: r.status, raw: r.body,
               message: panelErrMessage(j, r) };
    }
    return { ok: true, user: j.data, raw: r.body };
  }

  /** 把面板 user 里的 quota 折算成金额。new-api 的口径：quota / quota_per_unit = 美元 */
  function amountOfPanelUser(user, info) {
    const u = user || {};
    const quota = numOf(u.quota);
    if (quota == null) return { ok: false, kind: 'parse', message: '面板没有返回 quota 字段，读不到余额' };
    const per = Number(info && info.quotaPerUnit) > 0 ? Number(info.quotaPerUnit) : 500000;
    const usd = quota / per;
    const extra = [
      { k: '站点配额 quota', v: num(quota) },
      { k: '每美元配额', v: num(per) },
      { k: '折算余额', v: '$' + usd.toFixed(4) },
    ];
    const used = numOf(u.used_quota);
    if (used != null) extra.push({ k: '已消耗配额', v: num(used) + '（≈$' + (used / per).toFixed(4) + '）' });
    if (info && info.usdRate) extra.push({ k: '站内汇率', v: '1 USD = ¥' + info.usdRate });
    if (u.username) extra.push({ k: '面板账号', v: String(u.username) });
    if (u.group) extra.push({ k: '用户分组', v: String(u.group) });
    if (info && info.version) extra.push({ k: '站点版本', v: String(info.version) });
    return { ok: true, amount: usd, currency: 'USD', extra: extra, user: u };
  }

  /** 面板全流程：优先复用已有 token，不行再用账号密码换一个 */
  async function queryPanel(account, opts) {
    const o = opts || {};
    const rawBase = account.baseUrl;
    if (!withScheme(rawBase)) return { ok: false, kind: 'bad_request', message: '这个账号还没填 BaseURL，没法定位面板' };

    const cred = normalizeCred(account.cred);
    const username = (o.username != null ? o.username : (cred && cred.username)) || '';
    const password = (o.password != null ? o.password : (cred && cred.password)) || '';
    const token = (o.token != null ? o.token : (cred && cred.token)) || '';

    /* 1. 先试已经在手上的 token —— 拿到面板第一次登录后，之后就不必再输密码 */
    if (token) {
      const self = await panelSelf(rawBase, token);
      if (self.ok) {
        const st = await panelStatus(rawBase);
        const amt = amountOfPanelUser(self.user, st.ok ? st.info : null);
        if (amt.ok) {
          return Object.assign({ ok: true, via: 'token', root: siteRoot(withScheme(rawBase)) },
            amt, { status: st.ok ? st : null, raw: self.raw });
        }
        return amt;
      }
      /* token 过期：如果没留密码也没这次现输的密码，就别硬着头皮往下走 */
      if (!username || !password) {
        return {
          ok: false, kind: 'token_expired', root: siteRoot(withScheme(rawBase)),
          message: '这个站点上次登录的凭据已经失效了，请重新登录一次（或手动填余额）。',
        };
      }
    }

    /* 2. 没有可用 token → 用账号密码登录 */
    if (!username || !password) {
      return {
        ok: false, kind: 'need_login', root: siteRoot(withScheme(rawBase)),
        message: '这是中转站面板，需要先填入该站点的登录账号和密码才能读余额',
      };
    }
    const login = await panelLogin(rawBase, username, password);
    if (!login.ok) return login;

    const self = await panelSelf(login.root, login.token);
    if (!self.ok) return self;

    const amt = amountOfPanelUser(self.user, login.status.ok ? login.status.info : null);
    if (!amt.ok) return amt;

    return Object.assign({
      ok: true, via: 'login', root: login.root,
      token: login.token, expiresAt: login.expiresAt,
      status: login.status, raw: self.raw,
    }, amt);
  }

  /* ---------------------------------------------------------------- 官方平台
     每家一个接口，形状都不一样，所以一家一段。 */
  const OFFICIAL = {
    deepseek: {
      label: 'DeepSeek',
      path: '/user/balance',
      pick(j) {
        const infos = Array.isArray(j.balance_infos) ? j.balance_infos : [];
        const info = infos[0] || {};
        const total = numOf(j.total_balance != null ? j.total_balance : info.total_balance);
        if (total == null) return { ok: false, kind: 'parse', message: '返回里没有 balance_infos[].total_balance' };
        const extra = [];
        if (info.granted_balance != null) extra.push({ k: '赠金余额', v: String(info.granted_balance) });
        if (info.topped_up_balance != null) extra.push({ k: '充值余额', v: String(info.topped_up_balance) });
        if (j.is_available != null) extra.push({ k: '账户可用', v: j.is_available ? '是' : '否' });
        return { ok: true, amount: total, currency: info.currency || j.currency || 'CNY', extra: extra };
      },
    },
    moonshot: {
      label: 'Moonshot',
      path: '/v1/users/me/balance',
      pick(j) {
        const d = j.data || j;
        const total = numOf(d.available_balance);
        if (total == null) return { ok: false, kind: 'parse', message: '返回里没有 data.available_balance' };
        const extra = [];
        if (d.voucher_balance != null) extra.push({ k: '代金券余额', v: '¥' + d.voucher_balance });
        if (d.cash_balance != null) extra.push({ k: '现金余额', v: '¥' + d.cash_balance });
        return { ok: true, amount: total, currency: 'CNY', extra: extra };
      },
    },
    siliconflow: {
      label: '硅基流动',
      path: '/v1/user/info',
      pick(j) {
        const d = j.data || j;
        const total = numOf(d.totalBalance != null ? d.totalBalance : d.balance);
        if (total == null) return { ok: false, kind: 'parse', message: '返回里没有 data.totalBalance' };
        const extra = [];
        if (d.chargeBalance != null) extra.push({ k: '充值余额', v: '¥' + d.chargeBalance });
        if (d.balance != null) extra.push({ k: '赠送余额', v: '¥' + d.balance });
        if (d.name) extra.push({ k: '账户', v: String(d.name) });
        return { ok: true, amount: total, currency: 'CNY', extra: extra };
      },
    },
    openrouter: {
      label: 'OpenRouter',
      path: '/v1/key',
      async pick(j, acct) {
        const d = j.data || j;
        const left = numOf(d.limit_remaining);
        const extra = [];
        if (d.label) extra.push({ k: '密钥备注', v: String(d.label) });
        if (d.limit != null) extra.push({ k: '该密钥额度上限', v: '$' + d.limit });
        if (d.usage != null) extra.push({ k: '该密钥已用', v: '$' + d.usage });
        if (left != null) {
          extra.push({ k: '读取方式', v: '/api/v1/key（普通密钥的剩余额度）' });
          return { ok: true, amount: left, currency: 'USD', extra: extra };
        }
        /* 普通密钥没有限额时读不到账户总额度，退一步试 credits（需要 Management Key） */
        const root = siteRoot(withScheme(acct.baseUrl || 'https://openrouter.ai/api/v1'));
        const r2 = await Net.request({ url: root + '/v1/credits', method: 'GET', headers: bearer(acct.apiKey), timeoutMs: BAL_TIMEOUT });
        if (r2.ok && r2.status === 200) {
          let j2 = null;
          try { j2 = JSON.parse(r2.body); } catch (_) {}
          const d2 = (j2 && j2.data) || {};
          const tc = numOf(d2.total_credits), tu = numOf(d2.total_usage);
          if (tc != null && tu != null) {
            extra.push({ k: '累计充值', v: '$' + tc });
            extra.push({ k: '累计消耗', v: '$' + tu });
            extra.push({ k: '读取方式', v: '/api/v1/credits（Management Key）' });
            return { ok: true, amount: tc - tu, currency: 'USD', extra: extra };
          }
        }
        return {
          ok: false, kind: 'parse',
          message: '这把密钥是充值计费型（没有设置额度上限），OpenRouter 只能靠 Management Key 才能读到账户总余额',
        };
      },
    },
  };

  async function queryOfficial(account, kind, opts) {
    const p = OFFICIAL[kind];
    if (!p) return { ok: false, kind: 'unsupported', message: '这个平台还没适配余额查询' };
    const root = siteRoot(withScheme(account.baseUrl));
    if (!root) return { ok: false, kind: 'bad_request', message: '这个账号还没填 BaseURL' };
    const url = root + p.path;
    const req = { method: 'GET', url: url };
    const r = await Net.request({ url: url, method: 'GET', headers: bearer(account.apiKey), timeoutMs: BAL_TIMEOUT });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message, request: req };
    if (r.status !== 200) {
      const hint = r.status === 401
        ? '该平台的余额接口拒绝了这把密钥（401）。检查密钥是否填错，或这个账号是不是该平台的。'
        : errMessageOf(r);
      return { ok: false, kind: r.kind, httpStatus: r.status, message: hint, raw: r.body, request: req };
    }
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {
      return { ok: false, kind: 'parse', httpStatus: r.status, message: p.label + ' 的余额返回不是 JSON', raw: r.body, request: req };
    }
    const out = await p.pick(j, account);
    if (!out.ok) return Object.assign({ httpStatus: r.status, raw: r.body, request: req }, out);
    return Object.assign({ via: 'official', provider: kind, label: p.label, request: req, raw: r.body }, out);
  }

  /* ---------------------------------------------------------------- 对外 */

  /**
   * 读一个账号的余额。
   * 返回 { ok, amount, currency, extra, via, ... } 或 { ok:false, kind, message }
   * kind 取值：manual / need_login / turnstile / auth_invalid / token_expired /
   *            token_rejected / not_panel / parse / network / timeout / cors / …
   */
  async function query(account, platform, opts) {
    const o = opts || {};
    const plat = platform || (Store.platform(account.platformId) || {});
    const kind = o.kind || balanceKindOf(plat);
    if (kind === 'manual') {
      return { ok: false, kind: 'manual',
               message: '该平台没有公开的余额查询接口，只能手动填写（' + (plat.name || '未命名') + '）' };
    }
    if (kind === 'panel') return queryPanel(account, o);
    return queryOfficial(account, kind, o);
  }

  /** 把查到的结果写回账号，顺便落盘 token / 清掉失效的 token */
  function applyResult(accountId, r, opts) {
    const o = opts || {};
    if (r.ok) {
      const rate = o.rate != null ? o.rate : Store.settings().usdRate;
      const conv = toCNY(r.amount, r.currency, rate);
      const patch = {
        balance: conv ? Number(conv.cny.toFixed(4)) : null,
        balanceSource: r.via === 'login' || r.via === 'token' ? 'panel' : (r.provider || 'manual'),
        balanceNative: conv && conv.converted ? { amount: r.amount, currency: r.currency } : null,
        balanceUpdatedAt: Date.now(),
      };
      Store.updateAccount(accountId, patch);
      const credPatch = { lastError: '', lastAt: Date.now() };
      if (r.token) { credPatch.token = r.token; credPatch.tokenAt = Date.now(); }
      if (r.user) {
        credPatch.userId = r.user.id != null ? r.user.id : null;
        if (r.user.username) credPatch.username = r.user.username;
      }
      if (o.username) credPatch.username = o.username;
      if (o.password) {
        credPatch.password = o.rememberPassword ? o.password : '';
        credPatch.savePassword = !!o.rememberPassword;
      }
      Store.setCred(accountId, credPatch);
      return { ok: true, cny: patch.balance, native: patch.balanceNative, currency: r.currency, amount: r.amount };
    }
    /* 失败时把原因留在凭据里，界面上能一眼看到上次为什么没读到 */
    Store.setCred(accountId, { lastError: r.message || '', lastAt: Date.now() });
    if (r.kind === 'token_expired' || r.kind === 'token_rejected') Store.setCred(accountId, { token: '' });
    return { ok: false, kind: r.kind, message: r.message };
  }

  /** 批量刷新。并发 3，避免把中转站打爆 */
  async function refreshAll(list, onEach) {
    const items = (list || []).slice();
    const out = [];
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const it = items[cursor++];
        let res;
        try { res = await query(it.account, it.platform); }
        catch (e) { res = { ok: false, kind: 'network', message: String((e && e.message) || e) }; }
        const applied = applyResult(it.account.id, res);
        out.push({ id: it.account.id, result: applied });
        if (onEach) onEach(it.account, applied);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return out;
  }

  return {
    query, applyResult, refreshAll,
    panelStatus, panelLogin, panelSelf,
    encryptPanelPassword, siteRoot, withScheme,
    /* 签到模块（Checkin）要复用的内部件 */
    normalizeCred, numOf, panelErrMessage,
    PROVIDERS: OFFICIAL,
  };
})();

/* ==========================================================================
   自动签到（中转站面板）
   签到只存在于 new-api 系的中转站面板 —— 官方平台没有这回事，直接如实告知。
   各分站的签到接口路径不统一，所以按候选列表挨个探测；全都 404 就明确说
   「该站点没有开放签到接口」，绝不假装成功。
   凭据与余额共用一套：优先 token，没有就用账号密码登录换 token。
   ========================================================================== */

const CHECKIN_TIMEOUT = 12000;
const CHECKIN_PATHS = ['/api/user/check_in', '/api/user/sign_in'];

/** 本地日期键（按设备时区）。签到是「每天一次」，幂等判断用它 */
function todayKey(ts) {
  const d = new Date(ts == null ? Date.now() : ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

const Checkin = (function () {

  /**
   * 给一个账号签到。
   * 返回 { ok, kind, message, via?, rewardQuota? }
   * kind: ok / already / already_today / not_supported / need_login /
   *       turnstile / auth_invalid / token_expired / bad_request / network / timeout / cors
   */
  async function checkin(account, opts) {
    const o = opts || {};
    const rawBase = account.baseUrl;
    if (!Balance.withScheme(rawBase)) return { ok: false, kind: 'bad_request', message: '这个账号还没填 BaseURL，没法定位面板' };

    /* 本地幂等：今天已经签过就不再去打站点（批量签到时省时间，也少骚扰站点） */
    if (!o.force && account.checkinDay === todayKey()) {
      return { ok: true, kind: 'already_today', via: 'local', message: '今天已经签过到了' };
    }

    const cred = Balance.normalizeCred(account.cred);
    const username = (o.username != null ? o.username : (cred && cred.username)) || '';
    const password = (o.password != null ? o.password : (cred && cred.password)) || '';
    let token = (o.token != null ? o.token : (cred && cred.token)) || '';
    let root = Balance.siteRoot(Balance.withScheme(rawBase));

    /* 先验证手上的 token 还活着（顺带把过期的清掉） */
    if (token) {
      const self = await Balance.panelSelf(rawBase, token);
      if (!self.ok) {
        if (self.kind === 'token_expired' && username && password) { token = ''; }
        else {
          return { ok: false, kind: self.kind,
                   message: self.kind === 'token_expired'
                     ? '这个站点上次登录的凭据已经失效，需要重新登录一次才能签到'
                     : (self.message || '连不上面板') };
        }
      }
    }

    /* 没有 token → 用账号密码登录换一个（与余额查询同一套逻辑） */
    if (!token) {
      if (!username || !password) {
        return { ok: false, kind: 'need_login', root: root,
                 message: '这个站点要签到得先登录面板：请在该账号里填入面板的账号密码（或粘 access token）' };
      }
      const login = await Balance.panelLogin(rawBase, username, password);
      if (!login.ok) return login;
      token = login.token;
      root = login.root;
    }

    /* 候选接口挨个试：new-api 用 check_in，部分分站用 sign_in */
    let saw404 = false;
    for (const path of CHECKIN_PATHS) {
      const r = await Net.request({
        url: root + path, method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: {}, timeoutMs: CHECKIN_TIMEOUT,
      });
      if (!r.ok) return { ok: false, kind: r.kind, message: r.message };

      if (r.status === 404) { saw404 = true; continue; }   /* 这个路径没有 → 换下一个候选 */
      if (r.status === 401 || r.status === 403) {
        return { ok: false, kind: 'auth_invalid', httpStatus: r.status, raw: r.body,
                 message: '签到接口拒绝了这份登录凭据（' + r.status + '）。去账号详情重新登录一次面板试试' };
      }

      let j = null;
      try { j = JSON.parse(r.body); } catch (_) {}
      if (j && j.success === true) {
        const d = j.data || {};
        const reward = Balance.numOf(d.quota != null ? d.quota : d.reward);
        return { ok: true, kind: 'ok', via: path, raw: r.body,
                 rewardQuota: reward != null ? reward : null,
                 message: '签到成功' };
      }
      const msg = Balance.panelErrMessage(j, r) || '';
      if (/已经|已签|重复|已领取|already/i.test(msg)) {
        return { ok: true, kind: 'already', via: path, raw: r.body, message: '今天已经签过到了（' + msg + '）' };
      }
      return { ok: false, kind: 'upstream_error', httpStatus: r.status, raw: r.body,
               message: msg || ('站点对 ' + path + ' 返回了失败（' + r.status + '）') };
    }

    if (saw404) {
      return { ok: false, kind: 'not_supported',
               message: '这个站点没有开放签到接口（候选路径都是 404）：它大概率没有签到功能，或不是 new-api 系面板' };
    }
    return { ok: false, kind: 'parse', message: '站点返回了认不得的签到结果' };
  }

  /** 把签到结果写回账号：状态、时间、今天的幂等键；鉴权失败顺带清掉失效 token */
  function applyCheckin(accountId, r) {
    const patch = {
      checkinLast: { ok: !!r.ok, kind: r.kind, message: r.message || '', at: Date.now() },
    };
    if (r.ok) {
      patch.checkinAt = Date.now();
      patch.checkinDay = todayKey();
    }
    Store.updateAccount(accountId, patch);
    if (!r.ok && (r.kind === 'auth_invalid' || r.kind === 'token_expired')) {
      Store.setCred(accountId, { lastError: r.message || '' });
      if (r.kind === 'token_expired') Store.setCred(accountId, { token: '' });
    }
    return r;
  }

  /** 批量签到：并发 2（签到是轻请求，但也没必要打爆站点）。
      list 的形状与 Balance.refreshAll 一致：[{ account, platform }] */
  async function checkinAll(list, onEach) {
    const items = (list || []).filter((it) => canCheckin(it.platform));
    const out = [];
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const it = items[cursor++];
        let res;
        try { res = await checkin(it.account, it.opts); }
        catch (e) { res = { ok: false, kind: 'network', message: String((e && e.message) || e) }; }
        applyCheckin(it.account.id, res);
        out.push({ id: it.account.id, result: res });
        if (onEach) onEach(it.account, res);
      }
    }
    await Promise.all([worker(), worker()]);
    return out;
  }

  /** 汇总批量结果，给界面一句话 */
  function summarize(results) {
    let ok = 0, already = 0, failed = 0;
    (results || []).forEach(({ result }) => {
      if (result.ok && result.kind === 'ok') ok++;
      else if (result.ok) already++;       /* already / already_today */
      else failed++;
    });
    return { ok: ok, already: already, failed: failed, total: (results || []).length };
  }

  return {
    checkin, checkinAll, applyCheckin, summarize,
    todayKey, PATHS: CHECKIN_PATHS,
  };
})();

/** 把失败归类成「用户该做什么」 */
const FAIL_HINT = {
  auth_invalid:   { tone: 'err',  title: '验证失败', msg: '服务端拒绝鉴权：该密钥无效或已被撤销', todo: ['密钥复制不完整，或前后多了空格 / 换行', '该密钥已在平台侧被撤销或已过期', 'BaseURL 填错，请求打到了非本平台的地址', '账号额度用尽，被服务端限流'] },
  auth_forbidden: { tone: 'err',  title: '无权访问', msg: '密钥有效，但没有该模型的调用权限',       todo: ['该模型未开通，去平台侧申请权限', '部分模型需要单独开通或实名认证', '换个有权限的模型再试'] },
  not_found:      { tone: 'err',  title: '地址不存在', msg: 'BaseURL 或接口路径不对',              todo: ['检查 BaseURL 是否需要带 /v1', '中转站地址是否已失效', '直接访问该地址看返回什么'] },
  rate_limited:   { tone: 'warn', title: '被限流了', msg: '请求过于频繁，或该账号额度已耗尽',      todo: ['降低调用频率，稍后重试', '去平台确认余额与配额', '换备用账号继续'] },
  upstream_error: { tone: 'warn', title: '上游异常', msg: '服务端 5xx，不是你的配置问题',          todo: ['查看平台状态页确认是否在维护', '稍后重试', '若是中转站，联系对方'] },
  timeout:        { tone: 'warn', title: '验证超时', msg: '请求在超时时间内没有收到任何响应',      todo: ['BaseURL 指向的中转站 / 代理无响应', '当前网络需要代理，直连被拦截', '该模型冷启动慢，或服务端排队积压', '把超时时间调大再试'] },
  network:        { tone: 'warn', title: '网络不通', msg: '请求没能发出去',                        todo: ['检查本机网络', '确认 BaseURL 域名可访问', '若用了代理软件，确认它放行该域名'] },
  cors:           { tone: 'warn', title: '浏览器拦截', msg: '跨域被拦，请求没发出去',              todo: ['用 npm start 以本地服务方式打开', 'APK 版本不受此限制'] },
  bad_request:    { tone: 'err',  title: '请求被拒绝', msg: '参数格式有问题',                      todo: ['检查模型名是否正确', '检查 max_tokens 等参数', '展开请求诊断看原始返回'] },
  parse:          { tone: 'warn', title: '响应认不出来', msg: 'HTTP 通了，但返回体不是任何一种已知的对话结构', todo: ['BaseURL 可能指向了非对话接口（模型列表 / 余额 / 网页）', '若是中转站，检查它是否改写了返回格式', '展开下面的请求诊断，看原始返回长什么样', '把诊断内容发出来，可以针对性适配这种格式'] },
  unsupported:    { tone: 'mute', title: '不支持自动查询', msg: '该平台没有公开的余额接口',        todo: ['手动填写余额并定期更新'] },
  manual:         { tone: 'mute', title: '只能手动填余额', msg: '该平台没有公开的余额查询接口',  todo: ['手动填一个数，只在总览里做汇总用', '平台侧改过余额后回来更新一下'] },
  need_login:     { tone: 'warn', title: '需要登录面板', msg: '这是中转站，得先填站点账号密码',  todo: ['在下面「中转站面板登录」里填该站点的账号密码', '登录一次之后会记住凭据，之后就能一键刷新', '不想给密码？也可以在浏览器登录后把 token 粘进来'] },
  turnstile:      { tone: 'warn', title: '站点开了人机验证', msg: 'Turnstile 验证挡住了脚本登录',      todo: ['这是站点侧的开关，脚本无法绕过', '在浏览器里登录该站点，把 access token 粘贴到下面', '或者直接手动填一个余额数字'] },
  token_expired:  { tone: 'warn', title: '登录凭据已失效', msg: '站点把上次的登录 token 作废了',    todo: ['重新登录一次即可', '若站点改过密码，记得同步更新'] },
  token_rejected: { tone: 'err',  title: '登录凭据被拒绝', msg: '站点不认这个 access token',        todo: ['确认这个 token 是该站点签发的', '重新登录一次拿新的 token'] },
  not_panel:      { tone: 'warn', title: '不是面板站点', msg: '这个地址上没有 /api/status',        todo: ['确认 BaseURL 指向的是中转站面板', '官方平台（DeepSeek 等）用的是 API Key 直查，不需要登录'] },
  crypto:         { tone: 'err',  title: '密码加密失败', msg: '站点要求加密密码，但当前环境做不了加密', todo: ['改用 http://127.0.0.1 打开网页版（WebCrypto 需要安全上下文）', '或者换成 APK 版本', '也可以手动填余额'] },
  not_supported:  { tone: 'mute', title: '该站点没有签到功能', msg: '签到接口在站点上不存在（404）', todo: ['这个站点大概率不是 new-api 系面板，或没开签到', '官方平台（OpenAI / DeepSeek 等）本来就没有签到', '不用管它，签到时会被自动跳过'] },
};

/* 兜底文案。注意 kind='ok' 也会走到这里 —— 那是「HTTP 200 但归类没跟上」，
   必须给一句能解释清楚的话，不能甩一个空列表出去。 */
const FALLBACK_HINT = {
  tone: 'warn', title: '请求没走通',
  msg: '请求已发出，但没能完成一次可用的对话',
  todo: ['展开下面的请求诊断看原始返回', '确认模型名与 BaseURL 匹配', '换个模型再试一次'],
};

function failInfo(kind) {
  if (kind && kind !== 'ok' && FAIL_HINT[kind]) return FAIL_HINT[kind];
  return FALLBACK_HINT;
}

/* ---------------------------------------------------------------- UI 工具 */

const UI = (function () {
  let toastTimer = null;

  function toast(msg, type) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'on' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, type === 'err' ? 3200 : 1900);
  }

  async function copy(text, label) {
    const t = String(text == null ? '' : text);
    if (!t) { toast('没有可复制的内容', 'err'); return false; }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
      } else {
        const ta = document.createElement('textarea');
        ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast((label || '已复制') , 'ok');
      return true;
    } catch (e) {
      toast('复制失败，请长按手动选择', 'err');
      return false;
    }
  }

  let sheetCleanup = null;

  function openSheet(opts) {
    closeSheet(true);
    const root = $('#sheet-root');
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML =
      '<div class="grab"></div>' +
      '<div class="sheet-head"><span class="sh-title">' + esc(opts.title || '') + '</span>' +
      '<button class="sh-close" data-close>关闭</button></div>' +
      '<div class="sheet-body">' + (opts.html || '') + '</div>';
    root.appendChild(scrim);
    root.appendChild(sheet);
    requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); });

    scrim.addEventListener('click', () => closeSheet());
    sheet.addEventListener('click', (e) => {
      const t = e.target.closest('[data-close]');
      if (t) closeSheet();
    });
    sheetCleanup = opts.onMount ? opts.onMount(sheet) : null;
  }

  function closeSheet(silent) {
    const root = $('#sheet-root');
    const sheet = root.querySelector('.sheet');
    const scrim = root.querySelector('.scrim');
    if (typeof sheetCleanup === 'function') { try { sheetCleanup(); } catch (_) {} }
    sheetCleanup = null;
    if (sheet) {
      if (silent) { sheet.remove(); if (scrim) scrim.remove(); return; }
      sheet.classList.remove('on');
      if (scrim) scrim.classList.remove('on');
      setTimeout(() => { sheet.remove(); if (scrim) scrim.remove(); }, 240);
    }
  }

  function confirmDialog(title, message, onYes, yesLabel) {
    openSheet({
      title: title,
      html:
        '<div class="t-sm c-2" style="line-height:1.8;padding:6px 0 18px">' + esc(message) + '</div>' +
        '<div class="btn-row"><button class="btn ghost" data-close>取消</button>' +
        '<button class="btn danger" data-yes>' + esc(yesLabel || '确认删除') + '</button></div>',
      onMount: function (root) {
        root.querySelector('[data-yes]').addEventListener('click', function () {
          closeSheet();
          setTimeout(onYes, 200);
        });
      },
    });
  }

  return { toast, copy, openSheet, closeSheet, confirmDialog };
})();
