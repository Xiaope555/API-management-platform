/* ==========================================================================
   本地模拟「上游大模型平台」——仅用于端到端自测
   兼容 OpenAI /v1 的接口形状，方便验证 App 的请求构造、解析、日志与计费。
   用法：node tools/mock-upstream.js   （默认 127.0.0.1:8899）
   ========================================================================== */

'use strict';

const http = require('http');

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
