/* 由 e2e.js 注入到页面里执行。返回一个结果对象。 */
(async () => {
  const R = { steps: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function ok(name, cond, detail) {
    R.steps.push({ name: name, pass: !!cond, got: detail === undefined ? null : detail });
  }

  /* ---------- 0. 运行环境识别 ---------- */
  const mode = Net.mode();
  ok('运行环境识别为 proxy（本地 Node 代理已生效）', mode === 'proxy', mode);

  /* ---------- 1. 造一个指向模拟上游的账号 ---------- */
  Store.wipe();
  const acct = Store.addAccount({
    platformId: 'custom',
    label: 'E2E 模拟号',
    apiKey: 'sk-mock-1234567890',
    baseUrl: 'http://127.0.0.1:8899/v1',
    defaultModel: 'mock-chat-mini',
  });
  ok('账号成功写入本地存储', !!Store.account(acct.id), acct.id);

  /* ---------- 2. 拉模型列表 ---------- */
  const lm = await Api.listModels(acct, 8000);
  ok('GET /v1/models 成功', lm.ok === true, { ok: lm.ok, kind: lm.kind, status: lm.status });
  ok('模型列表解析正确（6 个，含 3 个流式测试模型）', lm.ok && lm.models.length === 6 && lm.models[0] === 'mock-chat-mini', lm.models);

  /* ---------- 3. 坏密钥 → auth_invalid ---------- */
  const bad = await Api.listModels(Object.assign({}, acct, { apiKey: 'wrong-key' }), 8000);
  ok('坏密钥被归类为 auth_invalid', bad.ok === false && bad.kind === 'auth_invalid', { ok: bad.ok, kind: bad.kind });
  ok('401 有可读的错误文案', bad.ok === false && /API key|鉴权|密钥/i.test(String(bad.message)), bad.message);

  /* ---------- 4. 地址不通 → network ---------- */
  const dead = await Api.listModels(Object.assign({}, acct, { baseUrl: 'http://127.0.0.1:9/v1' }), 4000);
  ok('不可达地址被归类为 network', dead.ok === false && dead.kind === 'network', { ok: dead.ok, kind: dead.kind });

  /* ---------- 5. 超时中断 ---------- */
  const t0 = Date.now();
  const to = await Net.request({
    url: 'http://127.0.0.1:8899/v1/hang',
    method: 'GET',
    headers: { Authorization: 'Bearer sk-mock-1234567890' },
    timeoutMs: 1500,
  });
  const el = Date.now() - t0;
  ok('挂住的请求被主动中断，归为 timeout', to.ok === false && to.kind === 'timeout', { ok: to.ok, kind: to.kind });
  ok('中断耗时贴近设定的 1.5s', el >= 1200 && el < 4000, el + 'ms');

  /* ---------- 6. 对话成功 ---------- */
  const c1 = await Api.chat(acct, 'mock-chat-mini', [{ role: 'user', content: '你好' }], 64, 8000);
  ok('POST /v1/chat/completions 成功', c1.ok === true, { ok: c1.ok, kind: c1.kind, status: c1.status });
  ok('回复正文解析正确', c1.ok && String(c1.text).indexOf('你好') >= 0, String(c1.text).slice(0, 60));
  ok('usage 解析正确（26 / 34 / 60）', c1.inTok === 26 && c1.outTok === 34 && c1.totalTok === 60, [c1.inTok, c1.outTok, c1.totalTok]);
  ok('未收录单价时 cost=null 而非 0', c1.cost === null && c1.hasPrice === false, { cost: c1.cost, hasPrice: c1.hasPrice });

  /* ---------- 7. 已知单价的模型能算出费用 ---------- */
  const c2 = await Api.chat(acct, 'gpt-4o-mini', [{ role: 'user', content: 'hi' }], 64, 8000);
  const pr = priceOf('gpt-4o-mini');
  const want = (26 / 1e6) * pr.in + (34 / 1e6) * pr.out;
  ok('已知单价模型能算出费用', c2.ok && Math.abs(c2.cost - want) < 1e-9, { got: c2.cost, want: want });

  /* ---------- 8. 模型名前缀匹配 ---------- */
  ok('模型名前缀匹配（gpt-4o-2024-08-06 → gpt-4o）', !!priceOf('gpt-4o-2024-08-06'), priceOf('gpt-4o-2024-08-06'));

  /* ---------- 9. 走真实 UI 路径发一条消息 ---------- */
  VS.accountId = acct.id;
  VS.model = 'mock-chat-mini';
  VS.messages = [];
  VS.busy = false;
  VS.last = null;
  go('verify');
  await sendMessage('你好，测试一下');
  const lg = Store.logs()[0];
  ok('对话后自动写入调用日志', !!lg && lg.status === 'ok', lg ? { status: lg.status, model: lg.model } : null);
  ok('日志含 token 与耗时', !!lg && lg.inTok === 26 && lg.outTok === 34 && lg.latencyMs > 0, lg ? { in: lg.inTok, out: lg.outTok, ms: lg.latencyMs } : null);
  ok('日志含回复预览', !!lg && typeof lg.preview === 'string' && lg.preview.length > 0, lg && lg.preview);
  const vt1 = document.querySelector('#view').textContent;
  ok('界面上出现模型回复气泡', vt1.indexOf('模拟上游返回') >= 0, vt1.slice(0, 100));
  ok('界面出现成功结果卡（HTTP 200）', /HTTP\s*200/.test(vt1), '');

  /* ---------- 10. 失败路径：模型不存在 ---------- */
  VS.model = 'mock-unknown';
  await sendMessage('再来一次');
  const lg2 = Store.logs()[0];
  ok('失败调用同样进日志，status=err / kind=not_found', !!lg2 && lg2.status === 'err' && lg2.kind === 'not_found', lg2 ? { status: lg2.status, kind: lg2.kind } : null);
  ok('界面给出「地址不存在」的人话解释', document.querySelector('#view').textContent.indexOf('地址不存在') >= 0, '');

  /* ---------- 11. 失败路径：限流 ---------- */
  VS.model = 'mock-ratelimit';
  await sendMessage('再试');
  const lg3 = Store.logs()[0];
  ok('429 被归类为 rate_limited', !!lg3 && lg3.kind === 'rate_limited', lg3 ? { kind: lg3.kind } : null);

  /* ---------- 12. 余额自动查询 ---------- */
  const bal = await Api.balance(Object.assign({}, acct, { baseUrl: 'http://127.0.0.1:8899' }), { id: 'deepseek', balance: 'auto' });
  ok('自动查余额拿到 88.60', bal.ok === true && bal.balance === 88.6, { ok: bal.ok, balance: bal.balance });
  const bal2 = await Api.balance(acct, { id: 'openai', balance: 'manual' });
  ok('不支持自动查余额的平台返回 unsupported', bal2.ok === false && bal2.kind === 'unsupported', { ok: bal2.ok, kind: bal2.kind });

  /* ---------- 13. BaseURL 容错 ---------- */
  ok('BaseURL 带 /v1', apiUrl('https://api.openai.com/v1', '/v1/models') === 'https://api.openai.com/v1/models', apiUrl('https://api.openai.com/v1', '/v1/models'));
  ok('BaseURL 不带 /v1', apiUrl('https://api.openai.com', '/v1/models') === 'https://api.openai.com/v1/models', apiUrl('https://api.openai.com', '/v1/models'));
  ok('BaseURL 末尾多一个斜杠', apiUrl('https://x.com/v1/', '/v1/models') === 'https://x.com/v1/models', apiUrl('https://x.com/v1/', '/v1/models'));
  ok('BaseURL 缺协议头', apiUrl('api.deepseek.com/v1', '/v1/models') === 'https://api.deepseek.com/v1/models', apiUrl('api.deepseek.com/v1', '/v1/models'));

  /* ---------- 14. 导出 / 导入往返 ---------- */
  const dump = Store.exportJson();
  ok('导出 JSON 含账号与调用日志', !!dump && dump.indexOf('E2E 模拟号') >= 0 && dump.indexOf('mock-chat-mini') >= 0, dump ? String(dump).length + ' chars' : null);

  Store.wipe();
  let impErr = null;
  try { Store.importJson(dump); } catch (e) { impErr = String(e.message); }
  ok('导入自己导出的数据不报错', impErr === null, impErr);
  ok('导入后账号确实被还原', Store.accounts().length === 1 && Store.accounts()[0].label === 'E2E 模拟号', Store.accounts().length);
  ok('导入后调用日志也被还原', Store.logs().length === 3, Store.logs().length);

  let badErr = null;
  try { Store.importJson('{"nope":1}'); } catch (e) { badErr = String(e.message); }
  ok('导入垃圾数据会抛错（界面才能提示失败）', !!badErr && badErr.indexOf('accounts') >= 0, badErr);

  /* ---------- 15. 清空与限额 ---------- */
  Store.clearLogs();
  ok('清空调用记录生效', Store.logs().length === 0, Store.logs().length);

  const many = [];
  for (let i = 0; i < 60; i++) many.push({ accountId: acct.id, model: 'mock-chat-mini', status: 'ok' });
  many.forEach((m) => Store.addLog(m));
  ok('日志连续写入 60 条不掉数据', Store.logs().length === 60, Store.logs().length);
  Store.setSetting('logLimit', 5);
  Store.addLog({ accountId: acct.id, model: 'x', status: 'ok' });
  ok('logLimit 有 50 条下限（防止被设成极端值后疯狂截断）', Store.logs().length === 50, Store.logs().length);
  Store.setSetting('logLimit', 500);

  /* ===================================================================
     16. APK 专用通道 —— CapacitorHttp
     这是安卓包唯一的网络通道，必须单独验，否则装出来可能是个空壳。
     =================================================================== */
  delete window.Capacitor;
  const mBack = await Net.detect();
  ok('没有 Capacitor 时仍回落 proxy', mBack === 'proxy', mBack);

  const nativeCalls = [];
  window.Capacitor = {
    Plugins: {
      CapacitorHttp: {
        request: async (o) => {
          nativeCalls.push(o);
          if (o.data && o.data.model === 'boom-model') throw new Error('net::ERR_CONNECTION_REFUSED');
          if (o.data && o.data.model === 'unauth-model') {
            return { status: 401, data: { error: { message: 'Incorrect API key provided' } }, headers: {} };
          }
          if (/\/models$/.test(o.url)) {
            return { status: 200, data: { object: 'list', data: [{ id: 'mock-chat-mini' }, { id: 'mock-chat-pro' }, { id: 'mock-embed' }] }, headers: {} };
          }
          return {
            status: 200,
            data: {
              choices: [{ message: { role: 'assistant', content: '来自原生通道的回复' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 26, completion_tokens: 34, total_tokens: 60 },
            },
            headers: {},
          };
        },
      },
    },
  };

  const mNative = await Net.detect();
  ok('检测到 CapacitorHttp 后切到 native（APK 模式）', mNative === 'native', mNative);

  const nm = await Api.listModels(acct, 8000);
  ok('原生通道能拉到模型列表', nm.ok === true && nm.models.length === 3, nm.models);

  const nc = await Api.chat(acct, 'mock-chat-mini', [{ role: 'user', content: '原生测试' }], 64, 8000);
  ok('原生通道能完成一次对话', nc.ok === true && nc.text === '来自原生通道的回复', nc.text);
  ok('原生通道下 usage 同样被解析', nc.inTok === 26 && nc.outTok === 34 && nc.totalTok === 60, [nc.inTok, nc.outTok, nc.totalTok]);

  const call = nativeCalls[nativeCalls.length - 1];
  ok('原生请求带上了 Authorization 头', !!(call.headers && call.headers.Authorization), call.url);
  ok('请求体以对象交给原生层（避免二次转义）', !!(call.data && call.data.model === 'mock-chat-mini' && Array.isArray(call.data.messages)), call.data);
  ok('超时时间被透传给原生层', call.connectTimeout === 8000 && call.readTimeout === 8000, [call.connectTimeout, call.readTimeout]);

  const nboom = await Api.chat(acct, 'boom-model', [{ role: 'user', content: 'x' }], 16, 5000);
  ok('原生层连接被拒时归类为 network', nboom.ok === false && nboom.kind === 'network', { ok: nboom.ok, kind: nboom.kind });

  const n401 = await Api.chat(acct, 'unauth-model', [{ role: 'user', content: 'x' }], 16, 5000);
  ok('原生通道下的 401 同样归类 auth_invalid', n401.ok === false && n401.kind === 'auth_invalid', { ok: n401.ok, kind: n401.kind });

  /* ===================================================================
     17. 浏览器直连 —— 验证「跨域会被拦」这条提示是真的
     =================================================================== */
  delete window.Capacitor;
  const origFetch = window.fetch;
  window.fetch = function (u, o) {
    if (String(u).indexOf('/api/health') >= 0) return Promise.reject(new TypeError('Failed to fetch'));
    return origFetch.call(window, u, o);
  };
  const mDirect = await Net.detect();
  ok('没有本地服务时回落到 direct', mDirect === 'direct', mDirect);

  const dc = await Api.chat(acct, 'mock-chat-mini', [{ role: 'user', content: 'x' }], 16, 8000);
  ok('直连被跨域拦住，归类 cors', dc.ok === false && dc.kind === 'cors', { ok: dc.ok, kind: dc.kind });
  ok('cors 的指引指向「用 npm start 打开」', failInfo('cors').todo.join(' ').indexOf('npm start') >= 0, failInfo('cors').todo);

  window.fetch = origFetch;
  await Net.detect();

  /* ===================================================================
     18. 流式（SSE）响应 —— 真实中转站最常见的「不守规矩」行为
     请求体里写着 stream:false，它照样回 text/event-stream。
     早先的解析器不认这种响应，会把 HTTP 200 的可用 Key 误报成「请求失败」。
     =================================================================== */

  /* --- 18.1 纯函数：三种响应形状都要认 --- */
  const pStd = parseChatBody(JSON.stringify({
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: '标准回复' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  }));
  ok('解析器：标准非流式 completion', pStd.ok && pStd.text === '标准回复' && pStd.usage.total_tokens === 8, { text: pStd.text, shape: pStd.shape });

  const pChunk = parseChatBody(JSON.stringify({
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: '单个分片' }, finish_reason: 'stop' }],
  }));
  ok('解析器：单个 chunk（没被 SSE 包裹）', pChunk.ok && pChunk.text === '单个分片' && pChunk.streamed === false, { text: pChunk.text, shape: pChunk.shape });

  const sseSample = [
    'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
    '',
    'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"你"}}]}',
    'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"好"}}]}',
    '',
    'data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  ].join('\n');
  const pSse = parseChatBody(sseSample);
  ok('解析器：SSE 分片被拼接成完整正文', pSse.ok && pSse.streamed && pSse.text === '你好', { text: pSse.text, shape: pSse.shape });
  ok('解析器：SSE 的 finish_reason 被保留', pSse.finishReason === 'stop', pSse.finishReason);
  ok('解析器：SSE 里的 [DONE] 不会被当成内容', pSse.text.indexOf('DONE') < 0, pSse.text);

  /* 见过的畸形上游：把整个 chunk 又套一层塞进 delta */
  const pNest = parseChatBody('data: ' + JSON.stringify({
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', choices: [{ index: 0, delta: { content: '套娃正文' }, finish_reason: 'stop' }] } }],
  }));
  ok('解析器：能穿透被套娃的 delta', pNest.ok && pNest.text === '套娃正文', { text: pNest.text });

  const pErrInSse = parseChatBody('data: ' + JSON.stringify({ error: { message: 'boom' } }));
  ok('解析器：流内的 error 会被单独拎出来', !!pErrInSse.error && pErrInSse.error.message === 'boom', pErrInSse.error);

  ok('解析器：真垃圾（HTML 错误页）仍判为认不出', parseChatBody('<html><body>502 Bad Gateway</body></html>').ok === false, '');
  ok('解析器：空响应体不崩', parseChatBody('').ok === false && parseChatBody('').text === '', '');
  ok('解析器：null 响应体不崩', parseChatBody(null).ok === false, '');

  /* --- 18.2 真跑一次「硬吐 SSE」的上游 --- */
  const s1 = await Api.chat(acct, 'mock-stream', [{ role: 'user', content: '你好' }], 64, 8000);
  ok('SSE 上游：HTTP 200 判定为成功（不再误报失败）', s1.ok === true, { ok: s1.ok, kind: s1.kind, shape: s1.shape });
  ok('SSE 上游：分片正文被正确拼接', s1.ok && s1.text.indexOf('流式分片拼出来的回复') >= 0, String(s1.text).slice(0, 60));
  ok('SSE 上游：标记 streamed 与分片数', s1.ok && s1.streamed === true && s1.chunks >= 5, { streamed: s1.streamed, chunks: s1.chunks });
  ok('SSE 上游：无 usage 时给估算 token 并打标', s1.ok && s1.tokEstimated === true && s1.totalTok > 0, { est: s1.tokEstimated, total: s1.totalTok });

  /* --- 18.3 只回推理内容、没有正文 --- */
  const s2 = await Api.chat(acct, 'mock-stream-empty', [{ role: 'user', content: '你好' }], 64, 8000);
  ok('只回推理内容时仍算「接口连通」', s2.ok === true && s2.emptyText === true && s2.text === '', { ok: s2.ok, empty: s2.emptyText });
  ok('推理内容长度被记录下来', s2.ok && s2.reasoningLen > 0, s2.reasoningLen);

  /* --- 18.4 错误藏在 HTTP 200 的流里 --- */
  const s3 = await Api.chat(acct, 'mock-stream-error', [{ role: 'user', content: '你好' }], 64, 8000);
  ok('流内错误被抓出来，不当成功', s3.ok === false && s3.kind === 'upstream_error', { ok: s3.ok, kind: s3.kind });
  ok('流内错误文案透传到界面', s3.ok === false && /relay quota exhausted/.test(String(s3.message)), s3.message);

  /* --- 18.5 走真实 UI 路径：流式响应要能显示出来 --- */
  VS.accountId = acct.id;
  VS.model = 'mock-stream';
  VS.messages = [];
  VS.busy = false;
  VS.last = null;
  go('verify');
  await sendMessage('流式测试');
  const vt2 = document.querySelector('#view').textContent;
  ok('UI：流式回复出现在气泡里', vt2.indexOf('流式分片拼出来的回复') >= 0, '');
  ok('UI：成功卡标注了「流式响应」', vt2.indexOf('流式响应') >= 0, '');
  const lg4 = Store.logs()[0];
  ok('日志：记下 streamed 与估算标记', !!lg4 && lg4.streamed === true && lg4.tokEstimated === true, lg4 ? { s: lg4.streamed, e: lg4.tokEstimated } : null);

  /* --- 18.6 认不出格式时，不能再甩一个空的「可能的原因」 --- */
  ok('兜底文案非空（不会出现空白的原因列表）', failInfo('ok').todo.length > 0 && failInfo(undefined).todo.length > 0, failInfo('ok').todo);
  ok('parse 的指引指向「看请求诊断」', failInfo('parse').todo.join(' ').indexOf('诊断') >= 0, failInfo('parse').todo);

  /* ===================================================================
     19. 余额自动读取
     两条完全不同的路子：
       官方平台 —— 拿 API Key 直查，四家返回形状各异，都要能认；
       中转站面板 —— 先登录换 token，再读 /api/user/self，还要应付
                     人机验证与密码加密这两种站点配置。
     =================================================================== */

  const mk = (id, base, key) => Store.addAccount({
    platformId: id, label: 'E2E ' + id,
    apiKey: key || 'sk-mock-1234567890', baseUrl: base,
  });
  const P_CUSTOM = Store.platform('custom');

  /* --- 19.1 四家官方接口 --- */
  const aDS = mk('deepseek', 'http://127.0.0.1:8899');
  const bDS = await Balance.query(aDS, Store.platform('deepseek'));
  ok('余额·DeepSeek 官方接口读到 88.60', bDS.ok === true && bDS.amount === 88.6 && bDS.currency === 'CNY',
    { ok: bDS.ok, amount: bDS.amount, cur: bDS.currency, msg: bDS.message });

  const aMS = mk('moonshot', 'http://127.0.0.1:8899/v1');
  const bMS = await Balance.query(aMS, Store.platform('moonshot'));
  ok('余额·Moonshot 读 available_balance', bMS.ok === true && Math.abs(bMS.amount - 49.58894) < 1e-9,
    { ok: bMS.ok, amount: bMS.amount, msg: bMS.message });

  const aSF = mk('siliconflow', 'http://127.0.0.1:8899/v1');
  const bSF = await Balance.query(aSF, Store.platform('siliconflow'));
  ok('余额·硅基流动读 totalBalance', bSF.ok === true && bSF.amount === 88.88,
    { ok: bSF.ok, amount: bSF.amount, msg: bSF.message });

  const aOR = mk('openrouter', 'http://127.0.0.1:8899/api/v1', 'sk-or-limited');
  const bOR = await Balance.query(aOR, Store.platform('openrouter'));
  ok('余额·OpenRouter 限额密钥读 limit_remaining（$12.5）',
    bOR.ok === true && bOR.amount === 12.5 && bOR.currency === 'USD',
    { ok: bOR.ok, amount: bOR.amount, cur: bOR.currency, msg: bOR.message });

  const aOR2 = mk('openrouter', 'http://127.0.0.1:8899/api/v1', 'sk-or-unlimited-000');
  const bOR2 = await Balance.query(aOR2, Store.platform('openrouter'));
  ok('余额·OpenRouter 充值型密钥自动退回 credits（10 - 0.5 = $9.5）',
    bOR2.ok === true && Math.abs(bOR2.amount - 9.5) < 1e-9,
    { ok: bOR2.ok, amount: bOR2.amount, msg: bOR2.message });

  /* --- 19.2 官方接口的失败口径 --- */
  const aBadKey = mk('deepseek', 'http://127.0.0.1:8899', 'wrong-key');
  const qBadKey = await Balance.query(aBadKey, Store.platform('deepseek'));
  ok('余额·官方接口坏密钥归类 auth_invalid 且有可读文案',
    qBadKey.ok === false && qBadKey.kind === 'auth_invalid' && /密钥/.test(String(qBadKey.message)),
    { kind: qBadKey.kind, msg: qBadKey.message });

  const aOA = mk('openai', 'https://api.openai.com/v1', 'sk-mock');
  const qManual = await Balance.query(aOA, Store.platform('openai'));
  ok('余额·没有公开接口的平台归类 manual', qManual.ok === false && qManual.kind === 'manual', qManual.kind);
  ok('余额·manual 对外仍映射成 unsupported（老调用方认这个值）',
    (await Api.balance(aOA, Store.platform('openai'))).kind === 'unsupported', '');

  /* --- 19.3 中转站面板：明文密码 --- */
  const pPlain = mk('custom', 'http://127.0.0.1:8899', 'sk-mock-1234567890');
  const q1 = await Balance.query(pPlain, P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('余额·面板：账号密码登录成功', q1.ok === true, { ok: q1.ok, kind: q1.kind, msg: q1.message });
  ok('余额·面板：quota / quota_per_unit 折算出 $50',
    q1.ok && q1.amount === 50 && q1.currency === 'USD', { amount: q1.amount, cur: q1.currency });
  ok('余额·面板：拿到了可复用的 access_token', q1.ok && !!q1.token, q1.token);

  const qBadPwd = await Balance.query(pPlain, P_CUSTOM, { username: 'demo', password: 'wrong' });
  ok('余额·面板：密码错归类 auth_invalid',
    qBadPwd.ok === false && qBadPwd.kind === 'auth_invalid', { kind: qBadPwd.kind, http: qBadPwd.httpStatus });

  /* --- 19.4 中转站面板：站点开了人机验证（脚本过不去的硬边界） --- */
  const pTurn = mk('custom', 'http://127.0.0.1:8899/turnstile', 'sk-mock-1234567890');
  const qTurn = await Balance.query(pTurn, P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('余额·面板：人机验证站点被识别并归类 turnstile',
    qTurn.ok === false && qTurn.kind === 'turnstile', { kind: qTurn.kind, msg: qTurn.message });
  ok('余额·面板：人机验证的文案给出了替代做法（token / 手动填）',
    /token/.test(String(qTurn.message)) && /手动填/.test(String(qTurn.message)), qTurn.message);

  /* --- 19.5 中转站面板：站点开启密码加密
         这一条最有分量 —— mock 用的是真生成的 RSA 私钥，
         能解开就说明浏览器侧 RSA-OAEP(SHA-256) 的实现是字节级正确的。 --- */
  const pEnc = mk('custom', 'http://127.0.0.1:8899/enc', 'sk-mock-1234567890');
  const qEnc = await Balance.query(pEnc, P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('余额·面板：RSA-OAEP 加密密码被真私钥解开 → 登录成功', qEnc.ok === true,
    { ok: qEnc.ok, kind: qEnc.kind, msg: qEnc.message });
  ok('余额·面板：加密站点同样读到 $50', qEnc.ok && qEnc.amount === 50, qEnc.amount);

  /* --- 19.6 非面板地址 —— 两种情况都要归到 not_panel：
         ① 官方 API 域名（不带鉴权探测 → 401）
         ② 地址上确实没有这个路由（404，且 /api/status 本不该要鉴权）
         两者都不该被误报成 auth_invalid，否则会让人去查根本不存在的账号密码。 --- */
  const pNotPanel = mk('custom', 'http://127.0.0.1:8899/openai-compat', 'sk-mock-1234567890');
  const qNotPanel = await Balance.query(pNotPanel, P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('余额·面板：官方 API 域名（/api/status 要鉴权 → 401）归类 not_panel',
    qNotPanel.ok === false && qNotPanel.kind === 'not_panel', { kind: qNotPanel.kind, http: qNotPanel.httpStatus });
  ok('余额·面板：这条文案解释了「面板的 /api/status 本该公开」而不误导去查密码',
    /公开/.test(String(qNotPanel.message)), qNotPanel.message);

  const pNoRoute = mk('custom', 'http://127.0.0.1:8899/plain', 'sk-mock-1234567890');
  const qNoRoute = await Balance.query(pNoRoute, P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('余额·面板：地址上真没有 /api/status（404）同样归类 not_panel',
    qNoRoute.ok === false && qNoRoute.kind === 'not_panel', { kind: qNoRoute.kind, http: qNoRoute.httpStatus });

  /* --- 19.7 结果写回本地：折算、来源标记、凭据留存 --- */
  const applied = Balance.applyResult(pPlain.id, q1, { username: 'demo', rememberPassword: false });
  ok('余额·写回：外币按汇率折成本地金额', applied.ok === true && Math.abs(applied.cny - 365) < 0.01, applied);
  const acctAfter = Store.account(pPlain.id);
  ok('余额·写回：balance = ¥365.00', Math.abs(acctAfter.balance - 365) < 0.01, acctAfter.balance);
  ok('余额·写回：来源标记成 panel', acctAfter.balanceSource === 'panel', acctAfter.balanceSource);
  ok('余额·写回：原始美元金额留档可回溯',
    !!acctAfter.balanceNative && acctAfter.balanceNative.currency === 'USD' && acctAfter.balanceNative.amount === 50,
    acctAfter.balanceNative);
  ok('余额·凭据：登录 token 已落盘', !!(acctAfter.cred && acctAfter.cred.token), acctAfter.cred);
  ok('余额·凭据：没勾「记住密码」就绝不存密码',
    acctAfter.cred.password === '' && acctAfter.cred.savePassword === false, acctAfter.cred);

  const q2 = await Balance.query(acctAfter, P_CUSTOM);
  ok('余额·面板：已有 token 时免登录直接读', q2.ok === true && q2.via === 'token',
    { ok: q2.ok, via: q2.via, msg: q2.message });

  /* --- 19.8 换算函数 --- */
  ok('换算：人民币不做折算', toCNY(100, 'CNY', 7.3).cny === 100 && toCNY(100, 'CNY', 7.3).converted === false, '');
  ok('换算：美元按汇率折算（50 × 7.3 = 365）', Math.abs(toCNY(50, 'USD', 7.3).cny - 365) < 1e-9, toCNY(50, 'USD', 7.3).cny);
  ok('换算：汇率非法时退回 7.3', toCNY(1, 'USD', 0).cny === 7.3, toCNY(1, 'USD', 0).cny);

  /* --- 19.9 批量刷新 --- */
  const batch = await Balance.refreshAll([{ account: aDS, platform: Store.platform('deepseek') }]);
  ok('批量刷新：返回逐账号结果并已落盘',
    batch.length === 1 && batch[0].result.ok === true && Store.account(aDS.id).balance === 88.6,
    batch);

  /* --- 19.10 导出不能把面板密码带出去 --- */
  const dumpSafe = JSON.parse(Store.exportJson());
  const dSafe = (dumpSafe.accounts || []).filter((x) => x.id === pPlain.id)[0];
  ok('导出：默认剥掉面板密码', !!dSafe && dSafe.cred && !dSafe.cred.password, dSafe && dSafe.cred);
  ok('导出：token 也不跟着出去', !!dSafe && !dSafe.cred.token, dSafe && dSafe.cred);
  const dumpFull = JSON.parse(Store.exportJson({ includeCreds: true }));
  const dFull = (dumpFull.accounts || []).filter((x) => x.id === pPlain.id)[0];
  ok('导出：显式勾选「含凭据」时 token 保留', !!dFull && !!dFull.cred.token, dFull && dFull.cred);

  /* --- 19.11 底部提示文案 --- */
  ok('文案：need_login 指引到「填账号密码」', failInfo('need_login').todo.join(' ').indexOf('账号密码') >= 0, failInfo('need_login').todo);
  ok('文案：turnstile 明说脚本绕不过去', failInfo('turnstile').todo.join(' ').indexOf('无法绕过') >= 0, failInfo('turnstile').todo);
  ok('文案：manual 有明确标题', String(failInfo('manual').title).length > 0, failInfo('manual').title);

  /* --- 19.12 界面：账号详情里的余额与面板登录 --- */
  go('account', pPlain.id);
  const dv = document.querySelector('#view').textContent;
  ok('UI：账号详情显示余额来源标签「面板登录」', dv.indexOf('面板登录') >= 0, '');
  ok('UI：中转站账号出现「中转站面板」区块', dv.indexOf('中转站面板') >= 0, '');
  ok('UI：详情页有读取余额的按钮', !!document.querySelector('[data-bal]'), '');
  ok('UI：详情页保留手动填写入口', !!document.querySelector('[data-manual]'), '');
  ok('UI：详情页显示了折算前的原始美元金额', dv.indexOf('$50') >= 0, '');

  go('account', aOA.id);
  const dv2 = document.querySelector('#view').textContent;
  ok('UI：不支持的平台说明「没有开放余额查询接口」', dv2.indexOf('没有开放余额查询接口') >= 0, '');

  /* ===================================================================
     19B. 自动签到（中转站面板）
     签到只存在于 new-api 系面板；官方平台没有这回事。
     覆盖：能力判定、缺凭据、token 签到、本地幂等、站点「已签」、
           批量汇总、无签到接口的站点明确报 not_supported。
     =================================================================== */

  ok('签到：官方平台（DeepSeek）没有签到能力', !canCheckin(Store.platform('deepseek')), '');
  ok('签到：中转站平台有签到能力', canCheckin(Store.platform('custom')), '');

  /* 21.1 没留凭据 → 明确要登录，而不是闷头失败 */
  const aCk0 = mk('custom', 'http://127.0.0.1:8899');
  const cNoCred = await Checkin.checkin(Store.account(aCk0.id));
  ok('签到：没留凭据时明确提示要登录面板', cNoCred.ok === false && cNoCred.kind === 'need_login', cNoCred.kind);

  /* 21.2 面板登录拿到 token → 签到成功，账号上留下幂等键 */
  const aCk = mk('custom', 'http://127.0.0.1:8899');
  const qCk = await Balance.query(Store.account(aCk.id), P_CUSTOM, { username: 'demo', password: 'demo123' });
  Balance.applyResult(aCk.id, qCk, { username: 'demo', password: 'demo123' });   // 把 token 落到凭据里
  ok('签到：前置——面板登录成功拿到 token', qCk.ok === true, qCk.kind);
  const ck1 = await Checkin.checkin(Store.account(aCk.id));
  ok('签到：第一次签到成功（走的 check_in 路径）',
    ck1.ok === true && ck1.kind === 'ok' && ck1.via === '/api/user/check_in', ck1);
  Checkin.applyCheckin(aCk.id, ck1);
  const aCkAfter = Store.account(aCk.id);
  ok('签到：签到后账号上留下了今天的幂等键',
    aCkAfter.checkinDay === Checkin.todayKey() && !!aCkAfter.checkinLast, aCkAfter.checkinDay);

  /* 21.3 本地幂等：同一天再签，不再去打站点 */
  const ck2 = await Checkin.checkin(Store.account(aCk.id));
  ok('签到：同一天再签被本地跳过（already_today）',
    ck2.ok === true && ck2.kind === 'already_today' && ck2.via === 'local', ck2);

  /* 21.4 强制绕过本地幂等 → 站点回「已经签到」，也算成功 */
  const ck3 = await Checkin.checkin(Store.account(aCk.id), { force: true });
  ok('签到：绕过本地幂等后，站点说「已经签过」也按成功算',
    ck3.ok === true && ck3.kind === 'already', ck3.kind + ' / ' + ck3.message);

  /* 21.5 站点把签到挂在 sign_in 路径 → 候选路径要能回退 */
  const aSign = mk('custom', 'http://127.0.0.1:8899/signin');
  const qSign = await Balance.query(Store.account(aSign.id), P_CUSTOM, { username: 'demo', password: 'demo123' });
  Balance.applyResult(aSign.id, qSign, { username: 'demo', password: 'demo123' });
  const ck4 = await Checkin.checkin(Store.account(aSign.id));
  ok('签到：签到接口在 sign_in 路径的站点也能签上（候选路径回退生效）',
    ck4.ok === true && ck4.via === '/api/user/sign_in', ck4.via);

  /* 21.6 压根没有签到接口的站点 → 明确报 not_supported，绝不假装成功 */
  const aNone = mk('custom', 'http://127.0.0.1:8899/nocheckin');
  const qNone = await Balance.query(Store.account(aNone.id), P_CUSTOM, { username: 'demo', password: 'demo123' });
  Balance.applyResult(aNone.id, qNone, { username: 'demo', password: 'demo123' });
  const ck5 = await Checkin.checkin(Store.account(aNone.id));
  ok('签到：没有签到接口的站点明确报 not_supported',
    ck5.ok === false && ck5.kind === 'not_supported', ck5.kind);
  ok('签到：not_supported 有对应的界面文案',
    !!FAIL_HINT.not_supported && FAIL_HINT.not_supported.title.length > 0, FAIL_HINT.not_supported && FAIL_HINT.not_supported.title);

  /* 21.7 批量签到 + 汇总口径 */
  const ckBatch = await Checkin.checkinAll([
    { account: Store.account(aCk.id),   platform: Store.platform('custom') },  // 本地已签 → already_today
    { account: Store.account(aNone.id), platform: Store.platform('custom') },  // 站点没有签到接口
    { account: Store.account(aSign.id), platform: Store.platform('custom') },  // 本地已签（21.5 签过）→ already_today
  ]);
  const ckSum = Checkin.summarize(ckBatch);
  ok('签到：批量签到跑完整批（3 个可签账号）', ckBatch.length === 3, ckBatch.length);
  ok('签到：批量里本地已签的账号被跳过', ckBatch[0].result.kind === 'already_today', ckBatch[0].result.kind);
  ok('签到：批量里没有签到接口的账号如实报失败', ckBatch[1].result.kind === 'not_supported', ckBatch[1].result.kind);
  ok('签到：汇总口径正确（成功 0 · 已签 2 · 失败 1）',
    ckSum.ok === 0 && ckSum.already === 2 && ckSum.failed === 1, ckSum);

  /* 21.8 签到状态留在账号上，详情页有依据显示「今天已签到」。
     注意 checkinLast 记的是「最近一次尝试」—— 批量里该账号被本地幂等跳过，
     所以 kind 是 already_today 而不是 ok，这本身就是正确行为。 */
  const ckState = Store.account(aSign.id).checkinLast;
  ok('签到：账号上留下了上次签到状态（成功类）',
    !!ckState && ckState.ok === true && ckState.at > 0, ckState && ckState.kind);

  /* 21.9 /api/status 回一张网页（SPA 兜底）→ 如实归类 not_panel，
     而不是误导用户去查「返回格式」—— 这是真实用户撞到的场景 */
  const aHtml = mk('custom', 'http://127.0.0.1:8899/htmlfallback');
  const qHtml = await Balance.query(Store.account(aHtml.id), P_CUSTOM, { username: 'demo', password: 'demo123' });
  ok('面板：/api/status 回网页的站点归类为 not_panel（话要说准）',
    qHtml.ok === false && qHtml.kind === 'not_panel' && /网页/.test(qHtml.message),
    qHtml.kind + ' / ' + String(qHtml.message).slice(0, 50));
  const cHtml = await Checkin.checkin(Store.account(aHtml.id), { username: 'demo', password: 'demo123' });
  ok('签到：回网页的站点同样如实归类 not_panel',
    cHtml.ok === false && cHtml.kind === 'not_panel', cHtml.kind);

  /* ===================================================================
     20. 电脑端布局
     宽屏是左侧固定导航 + 表格；窄屏靠同一份 DOM 加 CSS 降级成卡片。
     =================================================================== */

  go('overview');
  const ovRoot = document.querySelector('#view');
  ok('布局：外层是 sidebar + stage 两栏骨架',
    !!document.querySelector('#shell > #sidebar') && !!document.querySelector('#shell > #stage'), '');
  ok('布局：侧栏导航渲染出 4 项',
    document.querySelectorAll('#sb-nav .sb-item').length === 4,
    document.querySelectorAll('#sb-nav .sb-item').length);
  ok('布局：侧栏当前页高亮',
    ((document.querySelector('#sb-nav .sb-item.on') || {}).textContent || '').indexOf('总览') >= 0,
    (document.querySelector('#sb-nav .sb-item.on') || {}).textContent);
  ok('布局：侧栏底部显示余额合计与网络模式',
    /余额合计/.test(document.querySelector('#sb-foot').textContent), '');
  ok('布局：窄屏抽屉的遮罩已就位', !!document.querySelector('#drawer-scrim'), '');
  ok('布局：窄屏顶部有汉堡按钮', !!document.querySelector('#menu-btn'), '');
  ok('布局：伪手机状态栏与桌面提示框都已移除',
    document.querySelectorAll('#desktop-hint, .notchbar').length === 0, '');

  ok('UI：总览用表格呈现账号', !!ovRoot.querySelector('table.tbl'), '');
  ok('UI：总览表格带表头', ovRoot.querySelectorAll('table.tbl thead th').length >= 5,
    ovRoot.querySelectorAll('table.tbl thead th').length);
  ok('UI：总览按平台分组，每组一个表格',
    ovRoot.querySelectorAll('.card .tbl-wrap').length >= 1, ovRoot.querySelectorAll('.card .tbl-wrap').length);
  ok('UI：窄屏卡片视图要用的 data-th 标签都写好了',
    ovRoot.querySelectorAll('table.tbl tbody td[data-th]').length > 0,
    ovRoot.querySelectorAll('table.tbl tbody td[data-th]').length);
  ok('UI：总览有四个数字块', ovRoot.querySelectorAll('.stats .stat').length === 4,
    ovRoot.querySelectorAll('.stats .stat').length);
  ok('UI：总览有力所能及的「刷新全部余额」入口', !!ovRoot.querySelector('[data-refresh-all]'), '');

  go('logs');
  const lgRoot = document.querySelector('#view');
  ok('UI：日志页用表格呈现', !!lgRoot.querySelector('table.tbl'), '');
  ok('UI：日志表带表头', lgRoot.querySelectorAll('table.tbl thead th').length >= 6,
    lgRoot.querySelectorAll('table.tbl thead th').length);

  go('settings');
  const stRoot = document.querySelector('#view');
  ok('UI：设置页有汇率输入', !!stRoot.querySelector('#f-rate'), '');
  ok('UI：设置页列出各平台的余额读取能力',
    /余额读取能力/.test(stRoot.textContent) && stRoot.querySelectorAll('table.tbl tbody tr').length >= 5,
    stRoot.querySelectorAll('table.tbl tbody tr').length);
  ok('UI：设置页有两个导出入口（含/不含凭据）',
    stRoot.querySelectorAll('[data-export]').length === 2, stRoot.querySelectorAll('[data-export]').length);

  /* 样式表里真的写了断点规则，否则「电脑端/手机端」只是嘴上说说 */
  let cssText = '';
  try { cssText = await (await fetch('app.css', { cache: 'no-store' })).text(); } catch (_) {}
  ok('布局：样式表包含 ≥900px 的侧栏固定规则', /min-width:\s*900px/.test(cssText), cssText.length);
  ok('布局：样式表包含 <900px 的表格降级为卡片规则', /max-width:\s*899px/.test(cssText), '');
  ok('布局：样式表里窄屏下隐藏了底部 Tab 之外的侧栏',
    /#sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/.test(cssText), '');

  /* --- 20.3 dvh 必须有 vh 兜底 ---
     `dvh` 是 Chrome 108+（2022-11）才有的单位，老安卓 WebView 整条声明会丢掉。
     曾经踩过：高度链全靠 dvh，老机器上一失效，底部 Tab 又被顶出屏幕 ——
     手机上表现为「进了总览退不出去」，而新浏览器里完全复现不出来。 */
  (function () {
    const chunks = cssText.split('}');
    const naked = chunks.filter((c) => /100dvh/.test(c) && !/100vh/.test(c));
    ok('样式表：每条 dvh 前面都有 vh 兜底（老 WebView 不认 dvh）',
      naked.length === 0,
      naked.length ? naked.slice(0, 2).map((s) => s.trim().slice(-40)) : '所有 dvh 都有 vh 兜底');
  })();

  /* --- 20.3b 界面显示的版本号必须等于正在跑的服务版本 ---
     这里曾经硬编码 '1.2.0' 一直不跟着发版走，用户装了新版却看到旧号，
     根本判断不出「我到底跑的是哪一版」。 */
  let srvVer = '';
  try { srvVer = (await (await fetch('/api/health', { cache: 'no-store' })).json()).version; } catch (_) {}
  for (let i = 0; i < 20 && APP_VERSION !== srvVer; i++) await sleep(150);
  ok('版本号：界面显示的版本 === 服务端正在跑的版本',
    !!srvVer && APP_VERSION === srvVer, { ui: APP_VERSION, server: srvVer });
  go('settings');
  await sleep(60);
  ok('版本号：设置页里显示的也是同一个版本',
    document.querySelector('#view').textContent.indexOf('v' + srvVer) >= 0, srvVer);
  go('overview');

  /* --- 20.4 窄屏「真实计算值」复核 ---
     光断言 DOM 里有没有元素是不够的：`#menu-btn` 曾经因为权重被 `.icon-btn`
     盖住，电脑端一直顶着一个无效汉堡，而 DOM 断言完全看不出来。
     这里读 getComputedStyle 的真实结果。当前窗口就是窄屏。 --- */
  function disp(sel) {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display : '(不存在)';
  }
  const narrow = window.matchMedia('(max-width: 899px)').matches;

  if (narrow) {
    go('overview');
    ok('窄屏计算值：顶栏的汉堡按钮是显示的', disp('#menu-btn') !== 'none', disp('#menu-btn'));
    ok('窄屏计算值：底部 Tab 是显示的', disp('#tabbar') !== 'none', disp('#tabbar'));
    /* 导航不靠外壳高度撑着：高度链失效（老 WebView 不认 dvh）时也必须够得着 */
    ok('窄屏计算值：顶栏是吸顶的（内容滚走它不动）',
      getComputedStyle(document.querySelector('#nav')).position === 'sticky',
      getComputedStyle(document.querySelector('#nav')).position);
    ok('窄屏计算值：底部 Tab 是 fixed 钉在屏幕底，不依赖外壳高度',
      getComputedStyle(document.querySelector('#tabbar')).position === 'fixed',
      getComputedStyle(document.querySelector('#tabbar')).position);
    ok('窄屏计算值：侧栏默认被推到屏幕外', disp('#sidebar') !== 'none', disp('#sidebar'));
    ok('窄屏计算值：侧栏 transform 把它移出视口',
      /matrix\(1,\s*0,\s*0,\s*1,\s*-|translateX\(-/.test(getComputedStyle(document.querySelector('#sidebar')).transform) ||
      document.querySelector('#sidebar').getBoundingClientRect().right <= 1,
      getComputedStyle(document.querySelector('#sidebar')).transform);
    ok('窄屏计算值：表格被降级成卡片（table 变成 block）',
      getComputedStyle(document.querySelector('table.tbl')).display === 'block',
      getComputedStyle(document.querySelector('table.tbl')).display);
    const firstLabel = document.querySelector('table.tbl tbody td[data-th]');
    ok('窄屏计算值：卡片视图把表头借 ::before 显示出来了',
      firstLabel && /attr\(data-th\)/.test(cssText), firstLabel ? firstLabel.getAttribute('data-th') : '');

    /* --- 20.5 窄屏「几何」复核：导航必须真的够得着 ---
       这是比计算值更狠的一层。外壳曾经用了 min-height 而不是 height，
       内容一长，底部 Tab 就被推出视口（实测被推到 y≈2300）。
       那时 display、DOM 全是对的，只有「它在不在视口内」这一条看得出来。
       用户报告的「进了总览退不出去」就是它。 */
    function r(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
    }
    const vh = window.innerHeight;

    go('logs');   // 日志页内容最长，最容易把导航推出去
    await sleep(80);
    const tab = r('#tabbar');
    ok('窄屏几何：底部 Tab 钉在视口内，没有被内容推出屏幕外',
      tab && tab.top < vh && tab.bottom <= vh + 1,
      { top: tab && tab.top, bottom: tab && tab.bottom, vh: vh });
    const nav2 = r('#nav');
    ok('窄屏几何：顶栏钉在视口顶部，没有跟着内容滚走',
      nav2 && nav2.top >= -1 && nav2.top <= 2, nav2 && nav2.top);
    ok('窄屏几何：底部 Tab 的中心命中的是它自己（没被透明层挡住）',
      (function () {
        const el = document.querySelector('#tabbar [data-tab]');
        if (!el) return false;
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return top === el || el.contains(top);
      })(), '');
    const view = document.querySelector('#view');
    ok('窄屏几何：只有 #view 自己滚（内容超长时 clientHeight < scrollHeight）',
      view.clientHeight < view.scrollHeight,
      view.clientHeight + ' < ' + view.scrollHeight);

    /* Tab 现在是 fixed 脱出文档流的，得确认内容给它让了位，
       否则最后几条日志会被压在胶囊按钮底下点不到 */
    const tabH = document.querySelector('#tabbar').getBoundingClientRect().height;
    const padB = parseFloat(getComputedStyle(view).paddingBottom) || 0;
    ok('窄屏几何：#view 的底部内边距给固定 Tab 让出了位置',
      padB >= tabH - 1, { paddingBottom: padB, tabHeight: Math.round(tabH) });

    /* --- 20.6 窄屏几何：卡片里的「值」必须落在视口内 ---
       `.tbl.wide { min-width: 900px }`（权重 (0,2,0)）曾盖过窄屏的
       `.tbl { min-width: 0 }`（(0,1,0)），日志表在 390 视口下仍保持 ~870 宽，
       td 里的值被 space-between 推到屏幕外，卡片只剩 ::before 的标签。 */
    const cw = document.documentElement.clientWidth;
    const cardTd = document.querySelector('table.tbl.wide tbody td[data-th]') ||
                   document.querySelector('table.tbl tbody td[data-th]');
    ok('窄屏几何：宽表单元格收敛到视口宽度内（min-width 已被清掉）',
      cardTd && cardTd.clientWidth <= cw + 1,
      { td: cardTd && cardTd.clientWidth, cw: cw });
    if (cardTd) {
      const rng = document.createRange();
      rng.selectNodeContents(cardTd);
      const cr = rng.getBoundingClientRect();
      ok('窄屏几何：卡片里的值真的落在视口内（标签之外还能看见值）',
        cr.left >= -1 && cr.right <= cw + 1 && cr.width > 0,
        { left: Math.round(cr.left), right: Math.round(cr.right), cw: cw });
    }

    /* 回到总览再确认一遍 —— 用户报的就是这个页面 */
    go('overview');
    await sleep(80);
    const tab2 = r('#tabbar');
    ok('窄屏几何：总览页底部 Tab 同样够得着',
      tab2 && tab2.top < vh && tab2.bottom <= vh + 1,
      { top: tab2 && tab2.top, bottom: tab2 && tab2.bottom, vh: vh });

    /* --- 20.7 破坏性复核：把高度链打断，导航还得在 ---
       老 WebView 不认 dvh，`height:100dvh` 会被整条丢掉 —— 效果等同于
       「外壳没有高度」。这里直接把 #shell / #stage 的高度强打成 auto 来复刻那个状态，
       检查底部 Tab 是否仍然钉在屏幕内。这条断言能不能过，取决于 Tab 是 fixed 而不是靠排流。 */
    const breaker = document.createElement('style');
    breaker.textContent = '#shell{height:auto !important}' +
      '#stage{height:auto !important;min-height:0 !important;overflow:visible !important}';
    document.head.appendChild(breaker);
    await sleep(80);
    const tab3 = r('#tabbar');
    const tabHit = (function () {
      const el = document.querySelector('#tabbar [data-tab]');
      if (!el) return false;
      const b = el.getBoundingClientRect();
      if (b.width === 0) return false;
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return top === el || el.contains(top);
    })();
    ok('窄屏破坏性复核：外壳高度被打成 auto（等于老 WebView 丢掉 dvh）后，底部 Tab 仍在视口内',
      tab3 && tab3.top < vh && tab3.bottom <= vh + 1,
      { top: tab3 && tab3.top, bottom: tab3 && tab3.bottom, vh: vh });
    ok('窄屏破坏性复核：这时底部 Tab 依然点得到（命中测试通过）', tabHit, tabHit);
    breaker.remove();
    await sleep(60);

    /* --- 20.8 系统返回键：手机上最本能的动作必须能逐层退出 ---
       曾经 go() 用的是 replaceState（只改地址、不产生历史），于是安卓返回键
       在 WebView 里 canGoBack() 恒为 false，一按就杀掉整个应用 ——
       这就是「进了总览出不去」在手机上的另一半原因。 --- */
    go('logs');
    await sleep(60);
    ok('返回键：进入子页面后历史里留下了一条（系统返回键才有得退）',
      !!(history.state && history.state.aihub === '#/logs'), history.state);
    ok('返回键：系统返回会先退一层，回到总览',
      systemBack() === 'up' && route.name === 'overview', { ret: route.name, hash: location.hash });

    stack = [];
    go('settings');
    await sleep(60);
    ok('返回键：从设置页返回同样退回总览（不是直接退出应用）',
      systemBack() === 'up' && route.name === 'overview', route.name);

    document.body.classList.add('nav-open');
    ok('返回键：抽屉开着时先关抽屉',
      systemBack() === 'drawer' && !document.body.classList.contains('nav-open'), '');

    UI.openSheet({ title: '返回键测试', html: '<div>内容</div>' });
    await sleep(60);
    const sheetBack = systemBack();
    ok('返回键：弹层开着时先关弹层', sheetBack === 'sheet', sheetBack);
    await sleep(320);            // closeSheet 有 240ms 动画，节点是之后才移除的
    ok('返回键：关掉之后弹层真的从 DOM 里消失了',
      !document.querySelector('#sheet-root .sheet'), '');

    /* 已经在根页面了：第一次只提示，不能把用户直接踢出去 */
    UI.closeSheet(true);
    stack = [];
    route = { name: 'overview', param: null, edit: null };
    render();
    await sleep(80);
    const rootBack = systemBack();
    ok('返回键：已在总览时先提示「再按一次退出」，不直接踢出去',
      rootBack === 'confirm-exit', rootBack);

    /* --- 20.9 「菜单」按钮必须自己说明自己是什么 --- */
    const mb2 = document.querySelector('#menu-btn');
    ok('窄屏计算值：「菜单」按钮带文字，不是一个光秃秃的汉堡',
      mb2 && /菜单/.test(mb2.textContent) && mb2.getBoundingClientRect().width > 40,
      { text: mb2 && mb2.textContent.trim(), w: mb2 && Math.round(mb2.getBoundingClientRect().width) });
    ok('窄屏计算值：点「菜单」会打开抽屉',
      (function () {
        mb2.click();
        const open = document.body.classList.contains('nav-open');
        document.body.classList.remove('nav-open');
        return open;
      })(), '');

    /* --- 20.10 「退出程序」必须在导航里直接看得见 ---
       它原来只藏在设置页最下面，用户找不到，反馈就是「没找到退出的地方」。 */
    const quitBtn = document.querySelector('#sb-foot [data-quit]');
    ok('导航：侧栏/抽屉底部有「退出程序」入口',
      !!quitBtn && /退出程序/.test(quitBtn.textContent), quitBtn && quitBtn.textContent.trim());
    if (quitBtn) {
      quitBtn.click();
      await sleep(80);
      const t = (document.querySelector('#sheet-root .sh-title') || {}).textContent || '';
      ok('导航：点「退出程序」会先弹确认框（不会直接退）', /退出程序/.test(t), t);
      UI.closeSheet(true);        // 只验证弹框，不点确认 —— 否则会把跑测试的服务关掉
      await sleep(60);
    }
    ok('导航：按钮在可视区内（抽屉底部不会溢出屏幕）',
      !!quitBtn && quitBtn.getBoundingClientRect().width > 0, quitBtn && Math.round(quitBtn.getBoundingClientRect().width));

    /* --- 20.11 演示数据必须「进得去，也出得来」 ---
       用户的原话是「点了载入演示数据，出现一堆 API，然后就无法退出这个了」。
       因为载入会把 demo 账号灌满，而界面上既没说明那是假的、也没一键清掉的地方
       （「清空全部数据」会连自己建的账号一起删）。 */
    Store.loadDemo();
    ok('演示数据：载入后能被识别出来（界面才有依据挂横幅）', Store.isDemo() === true, '');
    go('overview');
    await sleep(80);
    ok('演示数据：总览页出现「当前是演示数据」横幅与清除按钮',
      !!document.querySelector('#view [data-cleardemo]'), '');
    const mine = Store.addAccount({ platformId: 'custom', label: '我自己的号', apiKey: 'sk-keep-1234567890', baseUrl: 'https://x.example.com/v1' });
    const cleared = Store.clearDemo();
    ok('演示数据：清除只删演示账号（6 个），自己建的账号留着',
      Store.isDemo() === false && cleared.accounts === 6 && !!Store.account(mine.id), cleared);
    ok('演示数据：演示的那些假记录也一并清掉',
      Store.logs().every((l) => String(l.accountId).indexOf('ac_demo') !== 0), Store.logs().length);

    go('settings');
    await sleep(80);
    ok('演示数据：清除后设置页不再显示清除入口（入口只在有演示数据时出现）',
      !document.querySelector('#view [data-cleardemo]'), '');

    /* 复原成后续布局断言可用的干净状态 */
    Store.wipe();
    const keep = Store.addAccount({ platformId: 'openai', label: '布局用账号', apiKey: 'sk-layout-1234567890', baseUrl: 'https://api.openai.com/v1' });
    Store.addLog({ accountId: keep.id, platformId: 'openai', model: 'gpt-4o-mini', kind: 'chat', status: 'ok', code: 200, latencyMs: 900 });
    go('overview');
    await sleep(80);
  } else {
    ok('窄屏计算值：当前视口不是窄屏，跳过（由 e2e-desktop 复核电脑端）', true, window.innerWidth);
  }

  R.pass = R.steps.filter((s) => s.pass).length;
  R.total = R.steps.length;
  return R;
})()
