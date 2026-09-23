/* ==========================================================================
   AI API Hub — 核心层
   价格表 · 本地数据层 · 三级网络抽象 · UI 工具
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- 常量 */

const APP_VERSION = '1.1.0';
const STORE_KEY = 'aihub.v1';
const LOG_LIMIT = 500;

/** 预置平台。baseUrl 是官方默认值，用户可改（中转站/代理） */
const PRESET_PLATFORMS = [
  { id: 'openai',    name: 'OpenAI',    color: '#0B7BD4', baseUrl: 'https://api.openai.com/v1',            balance: 'manual', doc: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek',  name: 'DeepSeek',  color: '#4D6BFE', baseUrl: 'https://api.deepseek.com/v1',          balance: 'auto',   doc: 'https://platform.deepseek.com/api_keys' },
  { id: 'anthropic', name: 'Anthropic', color: '#C96442', baseUrl: 'https://api.anthropic.com/v1',         balance: 'manual', doc: 'https://console.anthropic.com/settings/keys' },
  { id: 'moonshot',  name: 'Moonshot',  color: '#111827', baseUrl: 'https://api.moonshot.cn/v1',           balance: 'auto',   doc: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu',     name: '智谱 GLM',   color: '#2E5BFF', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', balance: 'manual', doc: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'dashscope', name: '阿里通义',   color: '#615CED', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', balance: 'manual', doc: 'https://bailian.console.aliyun.com/' },
  { id: 'custom',    name: '自定义 / 中转站', color: '#6BA8A0', baseUrl: '', balance: 'manual', doc: '' },
];

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

const DEFAULT_DATA = () => ({
  version: 1,
  platforms: JSON.parse(JSON.stringify(PRESET_PLATFORMS)),
  accounts: [],
  logs: [],
  settings: {
    timeoutMs: 30000,
    verifyMaxTokens: 64,
    defaultPrompt: '你好，请用一句话介绍你自己。',
  },
});

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
        if (!Array.isArray(data.logs)) data.logs = [];
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
    const item = Object.assign({
      id: uid('ac'),
      platformId: 'custom',
      label: '主账号',
      apiKey: '',
      baseUrl: '',
      balance: null,
      balanceManual: false,
      balanceUpdatedAt: null,
      createdAt: Date.now(),
    }, a);
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
    if (a) { Object.assign(a, patch); save(); }
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
  function exportJson() {
    return JSON.stringify(all(), null, 2);
  }
  function importJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('不是合法的数据对象');
    if (!Array.isArray(parsed.accounts)) throw new Error('缺少 accounts 字段');
    const merged = {
      version: 1,
      platforms: Array.isArray(parsed.platforms) && parsed.platforms.length ? parsed.platforms : DEFAULT_DATA().platforms,
      accounts: parsed.accounts,
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      settings: Object.assign(DEFAULT_DATA().settings, parsed.settings || {}),
    };
    data = merged;
    save();
  }
  function wipe() {
    data = DEFAULT_DATA();
    save();
  }

  /* ---- 演示数据 ---- */
  function loadDemo() {
    const d = DEFAULT_DATA();
    d.accounts = [
      { id: 'ac_demo1', platformId: 'openai',   label: '主账号',   apiKey: 'sk-proj-DEMOxxxxxxxxxxxxxxxxxxxxxxxxxxxx4f2a', baseUrl: 'https://api.openai.com/v1', balance: 52.40, balanceManual: true, balanceUpdatedAt: Date.now() - 3600e3, createdAt: Date.now() - 86400e3 * 30 },
      { id: 'ac_demo2', platformId: 'openai',   label: '备用账号', apiKey: 'sk-proj-DEMOyyyyyyyyyyyyyyyyyyyyyyyyyyyy7b19', baseUrl: 'https://api.openai.com/v1', balance: 30.00, balanceManual: true, balanceUpdatedAt: Date.now() - 7200e3, createdAt: Date.now() - 86400e3 * 12 },
      { id: 'ac_demo3', platformId: 'deepseek', label: '主账号',   apiKey: 'sk-DEMOzzzzzzzzzzzzzzzzzzzzzzzzzzzzc410', baseUrl: 'https://api.deepseek.com/v1', balance: 88.60, balanceManual: false, balanceUpdatedAt: Date.now() - 600e3, createdAt: Date.now() - 86400e3 * 20 },
      { id: 'ac_demo4', platformId: 'anthropic',label: '主账号',   apiKey: 'sk-ant-DEMOaaaaaaaaaaaaaaaaaaaaaaaaa9e77', baseUrl: 'https://api.anthropic.com/v1', balance: 12.20, balanceManual: true, balanceUpdatedAt: Date.now() - 86400e3, createdAt: Date.now() - 86400e3 * 8 },
    ];
    d.logs = [
      { id: 'lg_d1', ts: Date.now() - 600e3,    accountId: 'ac_demo1', platformId: 'openai',    model: 'gpt-4o-mini',       kind: 'verify', status: 'ok', code: 200, inTok: 32,    outTok: 24,    latencyMs: 1200, costCNY: 0.0001, preview: '' },
      { id: 'lg_d2', ts: Date.now() - 3600e3,   accountId: 'ac_demo1', platformId: 'openai',    model: 'gpt-4o',            kind: 'chat',   status: 'ok', code: 200, inTok: 1240,  outTok: 380,   latencyMs: 1800, costCNY: 0.0497, preview: '' },
      { id: 'lg_d3', ts: Date.now() - 7200e3,   accountId: 'ac_demo3', platformId: 'deepseek',  model: 'deepseek-chat',     kind: 'chat',   status: 'ok', code: 200, inTok: 860,   outTok: 512,   latencyMs: 2400, costCNY: 0.0058, preview: '' },
      { id: 'lg_d4', ts: Date.now() - 86400e3,  accountId: 'ac_demo4', platformId: 'anthropic', model: 'claude-sonnet-4',   kind: 'chat',   status: 'ok', code: 200, inTok: 3120,  outTok: 980,   latencyMs: 3100, costCNY: 0.1684, preview: '' },
      { id: 'lg_d5', ts: Date.now() - 90000e3,  accountId: 'ac_demo2', platformId: 'openai',    model: 'gpt-3.5-turbo',     kind: 'verify', status: 'err',  code: 401, inTok: 0,     outTok: 0,     latencyMs: 420,  costCNY: 0,      preview: '', errorMsg: '服务端拒绝鉴权：该密钥无效或已被撤销' },
      { id: 'lg_d6', ts: Date.now() - 100000e3, accountId: 'ac_demo3', platformId: 'deepseek',  model: 'deepseek-reasoner', kind: 'chat',   status: 'ok', code: 200, inTok: 2060,  outTok: 1480,  latencyMs: 8400, costCNY: 0.0319, preview: '' },
    ];
    data = d;
    save();
  }

  return {
    load, save, all, settings, setSetting,
    platforms, platform, addPlatform,
    accounts, accountsOf, account, addAccount, updateAccount, removeAccount,
    logs: () => all().logs, addLog, clearLogs, removeLog,
    exportJson, importJson, wipe, loadDemo,
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

  /** 余额查询：目前只有部分平台提供公开接口，其余返回 unsupported */
  async balance(account, platform) {
    const plat = platform || {};
    if (plat.balance !== 'auto') {
      return { ok: false, kind: 'unsupported', message: '该平台未提供公开的余额接口，请手动填写' };
    }
    let url;
    if (plat.id === 'deepseek') {
      let b = String(account.baseUrl || plat.baseUrl || '').replace(/\/v\d+\/?$/, '');
      url = apiUrl(b, '/user/balance');
    } else {
      return { ok: false, kind: 'unsupported', message: '该平台暂未适配余额查询' };
    }
    const r = await Net.request({ url, method: 'GET', headers: { Authorization: 'Bearer ' + account.apiKey, Accept: 'application/json' }, timeoutMs: 15000 });
    if (!r.ok) return { ok: false, kind: r.kind, message: r.message };
    if (r.status !== 200) return { ok: false, kind: r.kind, status: r.status, message: errMessageOf(r) };
    try {
      const j = JSON.parse(r.body);
      const info = (j.balance_infos && j.balance_infos[0]) || {};
      const total = Number(info.total_balance != null ? info.total_balance : j.total_balance);
      if (isNaN(total)) throw new Error('响应里没有余额字段');
      return { ok: true, balance: total, currency: info.currency || j.currency || 'CNY', raw: j };
    } catch (e) {
      return { ok: false, kind: 'parse', message: '解析余额失败：' + e.message, raw: r.body };
    }
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
