/* 电脑端视口专项复核 —— 由 e2e.js 在把视口切成 1440×900 之后注入执行。
 *
 * 为什么单独有一份：
 *   主套件跑在窄屏默认窗口里，读到的都是窄屏分支。
 *   而「电脑端」这一侧曾经出过一个 DOM 断言抓不到的 bug ——
 *   `#nav .icon-btn` 的权重 (1,1,0) 盖掉了 `#menu-btn` 的 display:none，
 *   于是电脑端顶栏一直挂着一个点不动的汉堡。元素在 DOM 里、getElementById 也找得到，
 *   只有读 getComputedStyle 才看得见。所以这里全部按真实计算值断言。
 */
(async () => {
  const R = { steps: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function ok(name, cond, detail) {
    R.steps.push({ name: name, pass: !!cond, got: detail === undefined ? null : detail });
  }
  function cs(sel, prop) {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : '(不存在)';
  }
  function rect(sel) {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }

  /* ---------- 0. 视口确实是宽屏 ---------- */
  ok('电脑端：视口宽度确实落在 ≥900px 这一侧',
    window.matchMedia('(min-width: 900px)').matches, window.innerWidth);
  ok('电脑端：当前不是窄屏分支',
    !window.matchMedia('(max-width: 899px)').matches, window.innerWidth);

  /* ---------- 1. 两栏骨架真的成立 ---------- */
  const sb = rect('#sidebar');
  const st = rect('#stage');
  ok('电脑端：侧栏占据最左侧', sb && sb.x === 0, sb);
  ok('电脑端：侧栏是固定宽度（不是被压成 0）', sb && sb.w >= 180 && sb.w <= 320, sb && sb.w);
  ok('电脑端：内容区紧挨在侧栏右边，没有叠在侧栏上',
    sb && st && Math.abs(st.x - (sb.x + sb.w)) <= 2, { sidebarRight: sb && sb.x + sb.w, stageX: st && st.x });
  /* 基准要用 clientWidth 而不是 innerWidth：桌面浏览器有经典滚动条时，
     innerWidth 是 1440 但真正可用于布局的只有 1425 —— 差的那 15px 就是滚动条。 */
  const layoutW = document.documentElement.clientWidth;
  ok('电脑端：内容区吃满剩余宽度', st && sb && Math.abs(st.w - (layoutW - sb.w)) <= 2,
    { stageW: st && st.w, layoutW: layoutW, sidebarW: sb && sb.w, expect: sb && layoutW - sb.w });

  /* ---------- 2. 顶栏：汉堡必须消失（这就是当初那个 bug） ---------- */
  ok('电脑端：顶栏的汉堡按钮 display 不是 flex（曾经被 .icon-btn 的权重盖住）',
    cs('#menu-btn', 'display') === 'none', cs('#menu-btn', 'display'));
  ok('电脑端：汉堡按钮不占布局位置',
    !rect('#menu-btn') || rect('#menu-btn').w === 0 || rect('#menu-btn').x > window.innerWidth,
    rect('#menu-btn'));
  ok('电脑端：底部 Tab 隐藏（改用侧栏导航）',
    cs('#tabbar', 'display') === 'none', cs('#tabbar', 'display'));

  /* 顺带确认汉堡不是「被藏起来了、但返回按钮也一起没了」 */
  go('account', 'ac_demo5');
  await sleep(60);
  ok('电脑端：详情页的返回按钮照常显示（隐藏汉堡没有误伤返回）',
    !!document.querySelector('#nav [data-back]') &&
    document.querySelector('#nav [data-back]').getBoundingClientRect().width > 0,
    document.querySelector('#nav [data-back]') ? document.querySelector('#nav [data-back]').getBoundingClientRect().width : '(不存在)');

  /* ---------- 3. 侧栏导航本身 ---------- */
  ok('电脑端：侧栏以 flex 布局呈现', cs('#sidebar', 'display') === 'flex', cs('#sidebar', 'display'));
  ok('电脑端：侧栏用的是 sticky 定位而不是抽屉式的 fixed',
    cs('#sidebar', 'position') === 'sticky', cs('#sidebar', 'position'));
  ok('电脑端：侧栏没有被 translate 推到屏幕外',
    (function () {
      const t = cs('#sidebar', 'transform');
      return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
    })(), cs('#sidebar', 'transform'));
  ok('电脑端：侧栏导航 4 个入口都在可视区内',
    (function () {
      const items = document.querySelectorAll('#sb-nav [data-sb]');
      if (items.length !== 4) return false;
      return Array.prototype.every.call(items, function (el) {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.left >= 0 && r.right <= window.innerWidth;
      });
    })(), document.querySelectorAll('#sb-nav [data-sb]').length);
  ok('电脑端：侧栏底部信息条可见', !!document.querySelector('#sb-foot') &&
    document.querySelector('#sb-foot').getBoundingClientRect().height > 0, '');

  /* ---------- 4. 内容区不再降级成卡片 ---------- */
  go('overview');
  await sleep(60);
  const tbl = cs('table.tbl', 'display');
  ok('电脑端：总览的表格没有降级成卡片（display 不是 block）', tbl !== 'block', tbl);
  const tdDisp = cs('table.tbl tbody td', 'display');
  ok('电脑端：单元格没有被强制成 block', tdDisp !== 'block', tdDisp);
  ok('电脑端：窄屏卡片用的 ::before 表头不会冒出来',
    (function () {
      const td = document.querySelector('table.tbl tbody td[data-th]');
      if (!td) return false;
      const c = getComputedStyle(td, '::before').content;
      return !c || c === 'none' || c === 'normal' || c.indexOf('attr') < 0;
    })(),
    (function () {
      const td = document.querySelector('table.tbl tbody td[data-th]');
      return td ? getComputedStyle(td, '::before').content : '(无)';
    })());

  /* ---------- 5. 超宽屏的收窄规则没把内容挤没 ---------- */
  ok('电脑端：内容区宽度合理（>600px，不会被收窄规则压扁）',
    rect('#view') && rect('#view').w > 600, rect('#view'));

  R.pass = R.steps.filter((s) => s.pass).length;
  R.total = R.steps.length;
  return R;
})()
