# AI API Hub

把你散落在各家平台的大模型 API，集中到一处管理。

**这是一份能跑起来的软件，不是稿子。** 填进真实密钥就能真发请求。
对应画布上的设计稿：`../exports/*.png` · 实机截图：`../screenshots/*.png`

---

## 两种形态，一份代码

| 形态 | 怎么用 | 怎么绕开跨域 |
| --- | --- | --- |
| **电脑端网页版** | 双击 `start.bat`（或 `npm start`），浏览器自动打开 `http://127.0.0.1:8787` | 本地 Node 服务做转发代理 |
| **Android APK** | 从 [Releases](https://github.com/Xiaope555/API-management-platform/releases) 下载，点开就装 | Capacitor 原生 HTTP，浏览器根本不参与 |

前端代码只有一套（`www/`），运行时自动识别自己在哪个壳里：

```
window.Capacitor.Plugins.CapacitorHttp 存在？ → native（APK）
/api/health 有响应且是本站？              → proxy （Web，本地服务）
都没有                                    → direct（会被跨域拦，界面明确提示）
```

为什么非得这么绕：**浏览器里直接对 `api.openai.com` 发请求，一定会被 CORS 拦死。** 这不是配置问题，是浏览器的安全模型。所以「填 Key 就能真发请求」必须有个东西替它发 —— 要么本地服务，要么原生壳。两条路都搭好了。

---

## 跑起来

### 电脑端网页版

```powershell
cd app
node server.js
```

或者直接**双击 `start.bat`** —— 它会先检查有没有 Node（没有就提示装 Node 18+ 或直接用 APK），然后起服务并自动打开浏览器。

**不需要 `npm install`。** 网页版本身零依赖，只用 Node 内置模块。`npm install` 只在你要重新编译 APK 时才需要（装 Capacitor）。

命令行参数：

| 参数 | 作用 |
| --- | --- |
| `--open` | 启动后自动打开浏览器 |
| `--port=9000` | 指定端口（默认 8787） |

端口被占用会**自动往后试**（8787 → 8788 → …共 12 次），不用改代码。

**怎么关**：关掉那个黑窗口；或在页面「设置 → 运行环境 → 退出程序」点一下（前端调 `POST /api/shutdown`）。

> 直接双击 `www/index.html` 也能打开，但会进 direct 模式 —— 界面会弹提示告诉你调 API 可能被拦。要真发请求就得起本地服务。

### Android APK

**从 [Releases](https://github.com/Xiaope555/API-management-platform/releases) 下载最新的 `API-Hub-*.apk`。**

传到手机点开装（需要在系统设置里允许「安装未知来源应用」）。也可以用 adb：

```bash
adb install -r API-Hub-1.2-debug.apk
```

包信息：`com.aihub.app` · 版本 1.2 · minSdk 24（Android 7.0 起）· targetSdk 36 · 只需 INTERNET 权限

本地也会留一份编译产物：`dist/API-Hub-1.2-debug.apk`。

#### 重新编译

需要 **JDK 21**（不是 25）+ **Android SDK 36**。本机原本只有 JDK 25，Gradle 8.14 跑不了，所以工具链装在 `../.toolchain/`：

```powershell
# 一次性准备（约 1GB，只需跑一次）
powershell -ExecutionPolicy Bypass -File ../.toolchain/setup-android.ps1

# 编译
npm run apk          # 产物 → android/app/build/outputs/apk/debug/app-debug.apk
```

两个环境相关的注意点：

- **依赖仓库走了阿里云镜像。** 直连 Maven Central 在国内实测只有约 0.2MB/分钟，依赖根本拉不完（实测卡了 20 分钟只涨了 7MB）。镜像约 1.4MB/秒。想改回官方源：把 `android/gradle.properties` 里的 `useAliyunMirrors` 设为 `false`。
- **编译走的是 `.toolchain/gradle-8.14.3`，不是 `gradlew`。** Gradle wrapper 的 `networkTimeout` 硬编码 10 秒，慢链路上永远下不完发行包。`tools/build-android.ps1` 会优先用本地 Gradle，没有才回落到 wrapper。

#### 手机上会不会被跨域拦住？

不会。这一版走的是 Capacitor 的原生 HTTP，请求由原生层发出，浏览器根本不参与。这是「一份前端喂两个壳」的核心理由。

另外做了两处只有装到手机才会暴露的适配：

- **导出数据**：Android WebView 里 `<a download>` 点了没反应，所以在原生壳里改成弹出内容 + 一键复制。
- **「去平台申请密钥」外链**：走官方 Browser 插件交给系统浏览器打开。

#### 明文 HTTP

清单里开了 `usesCleartextTraffic="true"`。中转站、自建网关常用 `http://`，关着的话会撞上一个很难懂的报错。介意的话可以关掉，但那样就只能用 `https://` 的地址。

#### 想调试 APK 里跑的页面

把 `capacitor.config.json` 里的 `webContentsDebuggingEnabled` 改成 `true` 重新打包，然后电脑 Chrome 打开 `chrome://inspect` 就能看到设备上的 WebView。正式发布要记得改回 `false`。

---

## 布局：一套结构，两种形态

`index.html` 里只有一份 DOM，宽窄切换全交给 CSS（断点 **900px**）：

```
#shell
├── #sidebar        侧栏（电脑端常驻 / 手机端抽屉）
└── #stage
    ├── #nav        顶栏（手机端多个汉堡按钮）
    ├── #view       内容区
    └── #tabbar     底部 Tab（仅手机端）
```

| | ≥900px 电脑端 | <900px 手机端 |
| --- | --- | --- |
| 导航 | 左侧固定侧栏，带余额合计与网络模式 | 顶部栏 + 抽屉 + 底部 Tab |
| 账号/日志列表 | 表格 | 表格降级成卡片，表头借 `td[data-th]::before` 挪到卡片上 |
| 弹层 | 居中对话框 | 底部上滑面板 |
| 侧栏 | `position: sticky` + `100dvh` | `fixed` + `translateX(-100%)`，`body.nav-open` 时滑入 |
| 顶部栏 / 底部 Tab | Tab 隐藏 | `#nav` 吸顶、`#tabbar` `fixed` 钉在屏幕底 |

**手机端的导航不靠外壳高度撑着。** 一开始手机端外壳用的是 `min-height`，内容一长，底部 Tab 就被顶到视口外（实测 y≈2329），表现就是「进了总览退不出去」。改用固定高度后仍然出过问题——因为高度链全建立在 `dvh` 上，而 `dvh` 只有 Chrome 108+（2022-11）才认，**老安卓 WebView 会把整条声明丢掉**，等于没修。所以现在两件事一起做：

1. 每条 `dvh` 前面都补一条 `vh` 兜底（同一规则里后写的覆盖前面的）；
2. `#nav` 吸顶、`#tabbar` 改 `fixed` 钉在屏幕底，`#view` 用 `padding-bottom` 给它让位——**哪怕外壳高度算错，导航照样够得着**。

测试里有一条破坏性断言专门复刻这个场景：把 `#shell` / `#stage` 的高度强打成 `auto`（等价于老 WebView 丢掉 `dvh`），再检查底部 Tab 是否仍在视口内、是否仍能点中（`elementFromPoint` 命中测试）。

**手机上的「离开这一页」有三条路，全部真的能走通：**

| 操作 | 行为 |
| --- | --- |
| 点底部 Tab / 侧栏项 | 直接切到目标页面 |
| 点顶栏「☰ 菜单」 | 左边滑出导航抽屉，选一项即走 |
| 系统返回键 / 侧滑返回 / 浏览器返回键 | 关弹层 → 关抽屉 → 退一层 → 回总览 → 再按一次才退出应用 |
| 点侧栏 / 抽屉底部的「退出程序」 | 网页版停掉本地服务；APK 里回到桌面 |

**演示数据是一条「进得去也出得来」的路。** 空状态那个「载入演示数据看看」会写入 6 个假账号 + 8 条假记录；数据在的时候总览页顶部常驻一条横幅说明「这些是假的」，并就地给一个「清除演示数据」按钮——只删演示的那几个，你后来自己添加的账号不受影响。设置页的数据区也能清。（早先没有这个出口，用户载入后就出不来了，只能挨个删账号，或者用「清空全部数据」把自己的真账号一起删掉。）

第三行是后来补的：`go()` 早先用 `history.replaceState`（只改地址、不产生历史），于是安卓 WebView 的 `canGoBack()` 恒为 false，**返回键一按就杀掉整个应用**——用户感受到的就是「进去就出不来」。现在每层页面都会推进一条真实历史，`popstate`（系统返回/侧滑）与 `systemBack()`（Capacitor 返回键）走同一套顺序。

**这套断点是被测试盯住的** —— `tools/e2e-desktop.js` 会把视口切到 1440×900，用 `getComputedStyle` 断言真实计算值。之所以要这么较真：`#menu-btn` 曾经被 `#nav .icon-btn`（权重 `(1,1,0)` > `(1,0,0)`）的 `display:flex` 盖掉，电脑端顶栏一直挂着一个点不动的汉堡，而「元素在不在 DOM 里」这种断言完全看不出来。

---

## 里面有什么

五件事，全都能真跑通：

**1. 平台与账号管理**
一个平台下可以挂多个账号（主号 / 备用号 / 测试号）。总览页按平台分组，每组的表头就是该平台的全账号合计，点进详情看每个账号各剩多少。

**2. 密钥保管与复制**
密钥只写在本机 `localStorage`，不上传任何服务器。默认打码显示，一键复制密钥、复制 BaseURL、或把整套凭证一次复制走。

**3. 余额自动读取**

不用再手动抄余额。按平台分两条路径，工具自己判断：

**A. 平台自带余额接口** —— 用 API Key 直接查，不需要登录：

| 平台 | 接口 | 取值 | 币种 |
| --- | --- | --- | --- |
| DeepSeek | `GET /user/balance` | `balance_infos[].total_balance` | 人民币 |
| Moonshot / Kimi | `GET /v1/users/me/balance` | `data.available_balance` | 人民币 |
| 硅基流动 | `GET /v1/user/info` | `data.totalBalance` | 人民币 |
| OpenRouter | `GET /api/v1/key` | `limit_remaining` | 美元 |

OpenRouter 有个坑：**充值型密钥的 `/key` 不返回剩余额度**（`limit` 是 `null`）。这时自动退回 `GET /api/v1/credits`，用 `total_credits - total_usage` 算 —— 那条路需要 Management Key，普通 Key 会返回 401，界面会照实说。

**B. 中转站（New API / One API 系面板）** —— 余额只在面板后台，必须登录：

```
GET /api/status                      探站点：人机验证？密码加密？quota_per_unit？
GET /api/user/login/encryption-key   开了密码加密才取公钥
POST /api/user/login                 明文密码，或 RSA-OAEP(SHA-256) 加密后提交
   → access_token
GET /api/user/self                   Authorization: Bearer <token>
   → quota ÷ quota_per_unit = 美元余额
```

几个实测得到的细节：

- **`/api/user/self` 只要 `Authorization: Bearer <access_token>`**，不需要 `New-Api-User` 头（源码 `middleware/auth.go` 的 `authorizationToken()` 只取 Bearer）。
- **`/api/status` 是公开端点**，匿名就能读。所以**探测时拿到 401 恰恰说明「这里不是面板」** —— 工具据此归为「不是面板站点」并提示检查地址，而不是误导你去查一个根本不存在的面板账号密码。
- **拿到 token 之后就免登录**。凭据链只在第一次需要账号密码。
- **密码超长时不静默降级。** 官方前端在密码超出 RSA-OAEP 长度时会走 v2 格式（RSA-OAEP 包 AES-GCM），本实现没做 v2，而是直接报错「密码过长」—— 静默改成别的格式会提交出服务器解不开的密文，比报错更糟。

**金额换算**：统一存人民币，外币按「设置 → 金额换算」里的汇率折算（默认 `¥7.3/$`），**原始金额同时留档**在 `balanceNative`，详情页会显示「接口原始值 $29.60 USD，按 ¥7.3/$ 折算」。改汇率不会让历史数据失真。

**关于密码的两条硬规矩：**

- **默认不保存。** 登录成功后只留 token，密码不落盘。想省事可以勾「在本机记住密码」，界面上写明代价：*密码会明文存在浏览器本地存储里 —— 共用电脑时别勾。*
- **导出数据默认把 `cred.password` 和 `cred.token` 一起剥掉。** 想连凭据一起备份，得走「含凭据」那个入口（`exportData({includeCreds: true})`），是显式选择。

**一条绕不过去的边界：** 部分中转站开了 Cloudflare 人机验证（`/api/status` 返回 `turnstile_check: true`）。**这种情况脚本登录不了 —— 验证码存在的意义就是挡住自动化。** 工具会在动登录之前就识别出来并直接告知，同时给两条替代路径：① 自己在浏览器登录后把 access token 粘进登录框；② 直接手动填余额。不假装成功、不静默降级、不无限重试。

**4. 接口验证（真调 API）**
选账号 → 选模型（真去拉 `/v1/models`，不是写死的列表）→ 发一句话。能正常收到回复，这把密钥就是可用的。

失败时不说「请求错误」，而是告诉你该干什么：

| 情况 | 界面会说什么 |
| --- | --- |
| 401 | 密钥无效或已被撤销 |
| 403 | 密钥有效，但没这个模型的权限 |
| 404 | BaseURL 或接口路径不对 |
| 429 | 被限流了 / 额度耗尽 |
| 5xx | 上游服务异常，不是你的配置问题 |
| 超时 | 请求在 N 秒内没有响应，已主动中断 |
| 域名不通 | 请求没能发出去 |
| 跨域 | 浏览器拦住了，用 `node server.js` 打开 |
| 认不出 | HTTP 通了但格式不认识 —— 附原始返回，可直接拿去适配 |

**5. 调用日志**
每次调用都留档：模型、输入/输出 token、响应耗时、估算费用、回复预览。

费用按内置参考单价算（单位：元 / 百万 token），模型名支持前缀匹配，所以 `gpt-4o-2024-08-06` 会命中 `gpt-4o` 的单价。**查不到单价的模型会显示「未知单价」而不是 0** —— 报 0 是在骗自己。

底部始终有一行小字提醒：估算值，与平台账单可能有出入。

---

## 工程结构

```
app/
├── server.js                 本地服务：静态托管 + /api/proxy + /api/health + /api/shutdown
├── start.bat                 双击起服务并自动开浏览器
├── capacitor.config.json     APK 配置（webDir=www，CapacitorHttp 已开）
├── dist/
│   └── API-Hub-1.2-debug.apk 编译好的安卓包
├── www/
│   ├── index.html            外壳：#sidebar + #stage
│   ├── app.css               设计系统变量 + 组件样式 + 900px 断点
│   └── js/
│       ├── core.js           数据层 / 价格表 / 三级网络抽象 / 余额引擎 / UI 工具
│       ├── screens.js        总览 · 验证 · 日志 · 设置 · 账号详情 · 添加
│       └── main.js           路由、导航、发送逻辑
├── tools/
│   ├── mock-upstream.js      模拟上游 + 三套中转站面板（自测用，不参与运行）
│   ├── e2e.js                端到端自测驱动（无头 Chrome + CDP，零依赖）
│   ├── e2e-page.js           注入页面跑的主套件（171 条断言）
│   ├── e2e-desktop.js        切到 1440×900 复核电脑端真实计算值（22 条）
│   ├── shot.js               出 README 截图（桌面 1440 / 手机 390 两组）
│   └── build-android.ps1     跑 APK 编译
└── android/                  Capacitor 生成的安卓工程
```

`server.js` 只监听 `127.0.0.1`，局域网里别的机器连不上。静态服务带目录穿越防护。

---

## 自测

```powershell
cd app
node server.js               # 另开一个终端
node tools/e2e.js
```

会自己拉起模拟上游、用无头 Chrome 驱动真实页面、跑完 **193 条断言**再收尾：

```
  OK  坏密钥被归类为 auth_invalid
  OK  挂住的请求被主动中断，归为 timeout
  OK  原生通道能完成一次对话                     ← APK 唯一的网络通道
  OK  直连被跨域拦住，归类 cors
  OK  解析器：SSE 分片被拼接成完整正文
  OK  SSE 上游：HTTP 200 判定为成功（不再误报失败）
  OK  余额·DeepSeek 官方接口读到 88.60
  OK  余额·OpenRouter 充值型密钥自动退回 credits（10 - 0.5 = $9.5）
  OK  余额·面板：账号密码登录成功
  OK  余额·面板：RSA-OAEP 加密密码被真私钥解开 → 登录成功
  OK  余额·面板：人机验证站点被识别并归类 turnstile
  OK  余额·凭据：没勾「记住密码」就绝不存密码
  OK  电脑端：顶栏的汉堡按钮 display 不是 flex     ← 曾经被权重盖住过
  OK  窄屏计算值：表格被降级成卡片（table 变成 block）
  OK  窄屏几何：底部 Tab 钉在视口内，没有被内容推出屏幕外
  OK  窄屏几何：卡片里的值真的落在视口内
  OK  窄屏破坏性复核：外壳高度被打成 auto（等于老 WebView 丢掉 dvh）后，底部 Tab 仍在视口内
  OK  返回键：系统返回会先退一层，回到总览
  OK  返回键：已在总览时先提示「再按一次退出」，不直接踢出去
  OK  导航：侧栏/抽屉底部有「退出程序」入口
  OK  版本号：界面显示的版本 === 服务端正在跑的版本
结果：193 / 193 通过
```

**「RSA-OAEP 被真私钥解开」是怎么验的**：模拟面板启动时用 `crypto.generateKeyPairSync` 现生成一对真 RSA 密钥，公钥下发给页面、私钥留在服务端。页面用 WebCrypto 按 `RSA-OAEP(SHA-256)` 加密密码提交，服务端拿私钥去解 —— **解得开，才说明浏览器侧的实现是字节级正确的**，而不是「看着像对」。这条路径在真站点上没法调试，只能在本地把它证明出来。

**两个视口各跑一遍**：主套件跑在默认窄屏窗口里（覆盖 `<900px`），随后 `e2e.js` 把视口切成 1440×900 再跑 `e2e-desktop.js`（覆盖 `≥900px`）。两边读的都是 `getComputedStyle`。

**模拟上游是刻意做歪的**：

- `mock-stream` / `mock-stream-empty` / `mock-stream-error` 三个模型**收到 `stream: false` 也照样回 SSE**，最后一个还把错误藏在 HTTP 200 的流里 —— 真实中转站就这么不守规矩。
- 中转站面板挂了三套，各自覆盖一种站点配置：`/`（普通）、`/turnstile`（开人机验证）、`/enc`（开密码加密）。另有一个 `/plain` 用来验证「地址上真没有 `/api/status`」这条 404 路径。

覆盖：模型列表拉取、对话补全、三种响应形状的解析、流内错误识别、usage 解析与缺失时的估算、费用估算与前缀匹配、日志写入与截断、导入导出往返、失败分类（401/403/404/429/超时/域名不通/跨域）、BaseURL 四种写法容错、三条网络通道各自的正确性、四家官方余额接口、中转站面板四种登录形态、凭据落盘与导出脱敏、以及电脑端与手机端两侧的真实计算样式。

---

## 数据与隐私

- 密钥、账号、日志全部存在本机 `localStorage`，键名 `aihub.v1`
- 不联网、不上传、无遥测
- 唯一的对外请求就是你自己配置的那些 API 地址（以及读余额时的平台接口）
- 设置页可以导出成 JSON 备份（默认剥掉密码与 token），也可以一键清空

**这意味着 API 密钥是明文的。** 别在共用设备上保存生产密钥。中转站登录密码默认不落盘，但登录换来的 token 会留 —— 详情页有「清除凭据」。APK 版以后可以接 Android Keystore，网页版没有太好的办法 —— 这是纯前端方案的固有代价。
