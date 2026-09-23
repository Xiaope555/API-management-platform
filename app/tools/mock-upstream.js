/* ==========================================================================
   本地模拟「上游大模型平台」——仅用于端到端自测
   一个进程模拟三件事：
     1. OpenAI 兼容的 /v1 接口（对话、模型列表、流式、各类错误）
     2. 各家官方余额接口（DeepSeek / Moonshot / 硅基流动 / OpenRouter）
     3. New API / One API 系中转站面板（/api/status、/api/user/login、/api/user/self）

   面板有五种形态，各自挂在不同的路径前缀下，用来覆盖不同站点的配置：
     /            普通面板：无验证码、密码明文提交
     /turnstile   开了 Cloudflare 人机验证 → 脚本登录必须失败
     /enc         开启密码加密 → 必须用 RSA-OAEP 提交，且本进程会用真私钥验签
     /signin      签到接口挂在 /api/user/sign_in（候选路径回退）
     /nocheckin   压根没有签到接口 → 签到必须明确报 not_supported

   用法：node tools/mock-upstream.js   （默认 127.0.0.1:8899）
   ========================================================================== */

'use strict';

const http = require('http');
const crypto = require('crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_PORT) || 8899;

const MODELS = [
  'mock-chat-mini',
  'mock-chat-pro',
  'mock-embed',
  /* 下面三个专门用来复刻「不守规矩的中转站」——见 sse 相关分支 */
  'mock-stream',
  'mock-stream-empty',
  'mock-stream-error',
];

/* --------------------------------------------------------------------------
   中转站面板
   -------------------------------------------------------------------------- */

const PANEL_TOKEN = 'mock-panel-access-token-0001';
const PANEL_QUOTA_PER_UNIT = 500000;          // 500000 quota = 1 美元（new-api 默认值）
const PANEL_QUOTA = 25000000;                 // → $50.00
const PANEL_USED_QUOTA = 1000000;             // → $2.00

const PANELS = {
  '':           { turnstile: false, encryption: false, user: 'demo', pass: 'demo123' },
  '/turnstile': { turnstile: true,  encryption: false, user: 'demo', pass: 'demo123' },
  '/enc':       { turnstile: false, encryption: true,  user: 'demo', pass: 'demo123' },
  /* 签到接口挂在 sign_in 而不是 check_in —— 覆盖「候选路径要挨个试」这条逻辑 */
  '/signin':    { turnstile: false, encryption: false, user: 'demo', pass: 'demo123', signinOnly: true },
  /* 压根没有签到接口的面板 —— 签到必须明确报 not_supported，不能假装成功 */
  '/nocheckin': { turnstile: false, encryption: false, user: 'demo', pass: 'demo123', nocheckin: true },
};

/* 各面板「今天已签到」的状态。key = 面板前缀 —— 同一份 token 在不同面板互不影响 */
const SIGNED_TODAY = {};

/* 真生成一对 RSA 密钥：公钥下发给客户端做 RSA-OAEP 加密，私钥用来解密。
   这样一来「前端加密是否真的对」不是靠猜，而是靠真解一遍来证明。 */
const RSA = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function selfUser() {
  return {
    id: 1,
    username: 'demo',
    display_name: '演示账号',
    group: 'default',
    quota: PANEL_QUOTA,
    used_quota: PANEL_USED_QUOTA,
    request_count: 42,
  };
}

/* 面板只认这几个具体路径。
   注意不能用「以 /api/ 开头」来判断 —— OpenRouter 的 /api/v1/key 也是 /api/ 开头，
   那样会被面板分支吞掉，官方余额查询就永远测不到了。 */
const PANEL_PATHS = [
  '/api/status', '/api/user/login', '/api/user/login/encryption-key', '/api/user/self',
  '/api/user/check_in', '/api/user/sign_in',
];

function panelOf(url) {
  const prefixes = Object.keys(PANELS);
  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i];
    for (let j = 0; j < PANEL_PATHS.length; j++) {
      if (url === prefix + PANEL_PATHS[j]) return prefix;
    }
  }
  return null;
}

function handlePanel(prefix, url, req, res, rawBody) {
  const rec = PANELS[prefix];
  const sub = url.slice(prefix.length);          // '/api/status' 之类

  if (req.method === 'GET' && sub === '/api/status') {
    return json(res, 200, {
      success: true,
      data: {
        turnstile_check: rec.turnstile,
        turnstile_site_key: rec.turnstile ? '0x4AAAAAA-mock-site-key' : '',
        quota_per_unit: PANEL_QUOTA_PER_UNIT,
        display_in_currency: false,
        password_login_encryption_enabled: rec.encryption,
        usd_exchange_rate: 7.3,
        version: 'v0.9.0-mock',
        system_name: 'Mock Relay',
        password_login_enabled: true,
      },
    });
  }

  if (req.method === 'GET' && sub === '/api/user/login/encryption-key') {
    if (!rec.encryption) return json(res, 200, { success: true, data: { enabled: false } });
    return json(res, 200, {
      success: true,
      data: { enabled: true, kid: 'mock-kid-1', public_key: RSA.publicKey },
    });
  }

  if (req.method === 'POST' && sub === '/api/user/login') {
    let body = {};
    try { body = JSON.parse(rawBody || '{}'); } catch (_) {}

    let password = String(body.password || '');

    if (rec.encryption) {
      if (!body.password_encrypted || !body.encryption_key_id) {
        return json(res, 200, { success: false, message: '参数错误：本站已开启密码加密登录' });
      }
      try {
        password = crypto.privateDecrypt(
          { key: RSA.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
          Buffer.from(String(body.password_encrypted), 'base64')
        ).toString('utf8');
      } catch (e) {
        return json(res, 200, { success: false, message: '密码解密失败：密文与本站公钥不匹配' });
      }
    }

    if (String(body.username || '') !== rec.user || password !== rec.pass) {
      return json(res, 401, { success: false, message: '用户名或密码错误' });
    }
    return json(res, 200, {
      success: true,
      message: '',
      data: {
        access_token: PANEL_TOKEN,
        token_type: 'Bearer',
        access_expires_at: Math.floor(Date.now() / 1000) + 86400,
        session: 'mock-session',
        user: selfUser(),
      },
    });
  }

  if (req.method === 'GET' && sub === '/api/user/self') {
    const auth = String(req.headers.authorization || '');
    if (auth !== 'Bearer ' + PANEL_TOKEN) {
      return json(res, 401, { success: false, message: '未登录或登录状态已过期' });
    }
    return json(res, 200, { success: true, message: '', data: selfUser() });
  }

  /* 签到：每天一次；同一天重复签返回「已经签到」而不是成功 —— 和真站点一个脾气 */
  if (req.method === 'POST' && (sub === '/api/user/check_in' || sub === '/api/user/sign_in')) {
    if (rec.nocheckin) {
      return json(res, 404, { success: false, message: 'no such panel route: ' + sub });
    }
    if (rec.signinOnly && sub === '/api/user/check_in') {
      return json(res, 404, { success: false, message: 'no such panel route: ' + sub });
    }
    const auth = String(req.headers.authorization || '');
    if (auth !== 'Bearer ' + PANEL_TOKEN) {
      return json(res, 401, { success: false, message: '无权进行此操作，未登录或登录已过期' });
    }
    if (SIGNED_TODAY[prefix]) {
      return json(res, 200, { success: false, message: '今天已经签到过了，明天再来' });
    }
    SIGNED_TODAY[prefix] = true;
    return json(res, 200, {
      success: true,
      message: '签到成功',
      data: { quota: 50000 },        // 奖励 50000 quota（≈$0.1）
    });
  }

  return json(res, 404, { success: false, message: 'no such panel route: ' + sub });
}

/* -------------------------------------------------------------------------- */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/* --------------------------------------------------------------------------
   流式（SSE）分支
   真实的「免费/中转」上游里，相当一部分即使收到 stream:false 也会硬吐 SSE。
   App 必须能认这种响应，否则会把 HTTP 200 的可用 Key 误判成失败。
   -------------------------------------------------------------------------- */

function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
}

function sseChunk(model, choice) {
  return {
    id: 'chatcmpl-mock-stream',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: model,
    choices: [Object.assign({ index: 0 }, choice || {})],
  };
}

function sseSend(res, obj) {
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
}

function sseEnd(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  const url = String(req.url || '').split('?')[0];
  const auth = String(req.headers.authorization || '');

  /* 面板路由不吃 Authorization（面板用自己签发的 token），必须排在鉴权前面 */
  const panel = panelOf(url);
  if (panel !== null) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => handlePanel(panel, url, req, res, raw));
    return;
  }

  /* 「有响应但压根不是面板」的地址：用来区分 404 口径（匿名访问也不 401） */
  if (url === '/plain/api/status') {
    return json(res, 404, { error: { message: 'no such route: ' + url, type: 'invalid_request_error' } });
  }

  /* 鉴权：模拟真实平台的 401 */
  if (!/^Bearer\s+sk-/.test(auth)) {
    return json(res, 401, {
      error: {
        message: 'Incorrect API key provided. You can find your API key at the console.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }

  /* 模型列表 */
  if (req.method === 'GET' && url === '/v1/models') {
    return json(res, 200, {
      object: 'list',
      data: MODELS.map((id) => ({ id: id, object: 'model', owned_by: 'mock' })),
    });
  }

  /* 对话补全 */
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (_) {}

      if (body.model === 'mock-unknown') {
        return json(res, 404, {
          error: { message: 'The model `mock-unknown` does not exist', type: 'invalid_request_error', code: 'model_not_found' },
        });
      }
      if (body.model === 'mock-ratelimit') {
        return json(res, 429, {
          error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' },
        });
      }

      const userMsg = ((body.messages || []).filter((m) => m.role === 'user').pop() || {}).content || '';
      const reply = '收到「' + String(userMsg).slice(0, 20) + '」。这是模拟上游返回的一句话，用于验证整条链路是否跑通。';

      /* --- 不守规矩的流式分支：注意这里完全不看 body.stream --- */

      if (body.model === 'mock-stream') {
        sseHead(res);
        sseSend(res, sseChunk(body.model, { delta: { role: 'assistant', content: '' } }));
        ['收到「', String(userMsg).slice(0, 20), '」。', '这是流式分片拼出来的回复。'].forEach((seg) => {
          sseSend(res, sseChunk(body.model, { delta: { content: seg } }));
        });
        sseSend(res, sseChunk(body.model, { delta: {}, finish_reason: 'stop' }));
        return sseEnd(res);
      }

      if (body.model === 'mock-stream-empty') {
        /* 只回推理内容、不给正文：验证「接口通但正文为空」这条路径 */
        sseHead(res);
        sseSend(res, sseChunk(body.model, { delta: { role: 'assistant', content: '' } }));
        sseSend(res, sseChunk(body.model, { delta: { reasoning_content: '先在心里盘算一下……' } }));
        sseSend(res, sseChunk(body.model, { delta: {}, finish_reason: 'stop' }));
        return sseEnd(res);
      }

      if (body.model === 'mock-stream-error') {
        /* HTTP 200，但错误藏在流里 */
        sseHead(res);
        sseSend(res, { error: { message: 'relay quota exhausted', type: 'insufficient_quota' } });
        return sseEnd(res);
      }

      return json(res, 200, {
        id: 'chatcmpl-mock-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'mock-chat-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 26, completion_tokens: 34, total_tokens: 60 },
      });
    });
    return;
  }

  /* ------------------------------------------------------------------
     各家官方余额接口，按真实平台的返回形状来
     ------------------------------------------------------------------ */

  /* DeepSeek */
  if (req.method === 'GET' && url === '/user/balance') {
    return json(res, 200, {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '88.60', granted_balance: '0.00', topped_up_balance: '88.60' }],
    });
  }

  /* Moonshot / Kimi */
  if (req.method === 'GET' && url === '/v1/users/me/balance') {
    return json(res, 200, {
      code: 0,
      data: { available_balance: 49.58894, voucher_balance: 46.58893, cash_balance: 3.00001 },
      scode: '0x0',
      status: true,
    });
  }

  /* 硅基流动 */
  if (req.method === 'GET' && url === '/v1/user/info') {
    return json(res, 200, {
      code: 20000,
      message: 'OK',
      status: true,
      data: {
        id: 'mock-user-id',
        name: 'mock-user',
        email: 'mock@example.com',
        isAdmin: false,
        balance: '0.88',
        chargeBalance: '88.00',
        totalBalance: '88.88',
        status: 'normal',
      },
    });
  }

  /* OpenRouter —— 设了额度上限的密钥走 /api/v1/key；充值型只能走 /api/v1/credits */
  if (req.method === 'GET' && url === '/api/v1/key') {
    const unlimited = auth.indexOf('sk-or-unlimited') >= 0;
    return json(res, 200, {
      data: {
        label: 'mock key',
        limit: unlimited ? null : 20,
        usage: unlimited ? 3.5 : 7.5,
        limit_remaining: unlimited ? null : 12.5,
        is_free_tier: false,
      },
    });
  }
  if (req.method === 'GET' && url === '/api/v1/credits') {
    return json(res, 200, { data: { total_credits: 10, total_usage: 0.5 } });
  }

  /* 永不响应的端点 —— 用来验证超时中断 */
  if (url === '/v1/hang') {
    return; // 故意不返回，挂住
  }

  return json(res, 404, { error: { message: 'no such route: ' + url, type: 'invalid_request_error' } });
});

server.listen(PORT, HOST, () => {
  console.log('mock upstream  http://' + HOST + ':' + PORT);
  console.log('  models    ' + MODELS.join(', '));
  console.log('  panels    ' + Object.keys(PANELS).map((k) => (k || '/').replace(/^$/, '/')).join(', '));
});
