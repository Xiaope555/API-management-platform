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
  ok('模型列表解析正确（3 个）', lm.ok && lm.models.length === 3 && lm.models[0] === 'mock-chat-mini', lm.models);

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

  R.pass = R.steps.filter((s) => s.pass).length;
  R.total = R.steps.length;
  return R;
})()
