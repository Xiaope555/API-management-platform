/* ==========================================================================
   本地模拟「上游大模型平台」——仅用于端到端自测
   兼容 OpenAI /v1 的接口形状，方便验证 App 的请求构造、解析、日志与计费。
   用法：node tools/mock-upstream.js   （默认 127.0.0.1:8899）
   ========================================================================== */

'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_PORT) || 8899;

const MODELS = ['mock-chat-mini', 'mock-chat-pro', 'mock-embed'];

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = String(req.url || '').split('?')[0];
  const auth = String(req.headers.authorization || '');

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

  /* 余额（DeepSeek 形状） */
  if (req.method === 'GET' && url === '/user/balance') {
    return json(res, 200, {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '88.60', granted_balance: '0.00', topped_up_balance: '88.60' }],
    });
  }

  /* 永不响应的端点 —— 用来验证超时中断 */
  if (url === '/v1/hang') {
    return; // 故意不返回，挂住
  }

  return json(res, 404, { error: { message: 'no such route: ' + url, type: 'invalid_request_error' } });
});

server.listen(PORT, HOST, () => {
  console.log('mock upstream  http://' + HOST + ':' + PORT + '  models=' + MODELS.join(','));
});
