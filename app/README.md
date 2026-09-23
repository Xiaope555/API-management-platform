# AI API Hub

把你散落在各家平台的大模型 API，集中到一处管理。

对应画布上的设计稿：12 屏完整界面 → `../exports/*.png`
设计文件：`AI API Hub · 移动端 App 设计稿`

**这是一份能跑起来的软件，不是稿子。** 填进真实密钥就能真发请求。

---

## 两种形态，一份代码

| 形态 | 怎么用 | 怎么绕开跨域 |
| --- | --- | --- |
| **Web 版**（推荐先用这个） | `npm start`，浏览器打开 `http://127.0.0.1:8787` | 本地 Node 服务做转发代理 |
| **Android APK** | 装到手机上 | Capacitor 原生 HTTP，浏览器根本不参与 |

前端代码只有一套（`www/`），运行时自动识别自己在哪个壳里：

```
window.Capacitor.Plugins.CapacitorHttp 存在？ → native（APK）
/api/health 有响应且是本站？              → proxy （Web，本地服务）
都没有                                    → direct（会被跨域拦，界面明确提示）
```

为什么非得这么绕：**浏览器里直接对 `api.openai.com` 发请求，一定会被 CORS 拦死。** 这不是配置问题，是浏览器的安全模型。所以「填 Key 就能真发请求」必须有个东西替它发——要么本地服务，要么原生壳。两条路我都搭好了。

---

## 跑起来

### Web 版

```bash
cd app
npm install        # 只装 Capacitor，Web 版本身零依赖
npm start          # → http://127.0.0.1:8787
```

想换个端口：`set PORT=9000 && npm start`

也可以双击 `start.bat`，它会起服务并自动开浏览器。

> 直接双击 `www/index.html` 也能打开，但会进 direct 模式——界面会弹提示告诉你调 API 可能被拦。要真发请求就得走 `npm start`。

### Android APK

**已经编译好了：`dist/API-Hub-1.0-debug.apk`**（4.06 MB）

装到手机：

```bash
adb install -r dist/API-Hub-1.0-debug.apk
```

没有 adb？把 apk 传到手机上直接点开装（需要在系统设置里允许「安装未知来源应用」）。

包信息：`com.aihub.app` · 版本 1.0 · minSdk 24（Android 7.0 起）· targetSdk 36 · 4.06 MB · 只需 INTERNET 权限

#### 重新编译

需要 **JDK 21**（不是 25）+ **Android SDK 36**。本机原本只有 JDK 25，Gradle 8.14 跑不了，所以工具链装在 `../.toolchain/`：

```bash
# 一次性准备（约 1GB，只需跑一次）
powershell -ExecutionPolicy Bypass -File ../.toolchain/setup-android.ps1

# 编译
cd app
npm run apk          # 产物 → android/app/build/outputs/apk/debug/app-debug.apk
```

两个环境相关的注意点：

- **依赖仓库走了阿里云镜像。** 直连 Maven Central 在国内实测只有约 0.2MB/分钟，依赖根本拉不完（我实测卡了 20 分钟只涨了 7MB）。镜像约 1.4MB/秒。想改回官方源：把 `android/gradle.properties` 里的 `useAliyunMirrors` 设为 `false`。
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

## 里面有什么

四件事，全都能真跑通：

**1. 平台与账号管理**
一个平台下可以挂多个账号（主号 / 备用号 / 测试号）。总览页按平台合并显示余额——一个平台的全账号总额，点开看每个账号各剩多少。顶上那条总计刻意压低了存在感，只在需要时扫一眼。

**2. 密钥保管与复制**
密钥只写在本机 `localStorage`，不上传任何服务器。默认打码显示，一键复制密钥、复制 BaseURL、或把整套凭证一次复制走。

**3. 接口验证（真调 API）**
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
| 跨域 | 浏览器拦住了，用 `npm start` 打开 |

**4. 调用日志**
每次调用都留档：模型、输入/输出 token、响应耗时、估算费用、回复预览。

费用按内置参考单价算（单位：元 / 百万 token），模型名支持前缀匹配，所以 `gpt-4o-2024-08-06` 会命中 `gpt-4o` 的单价。**查不到单价的模型会显示「未知单价」而不是 0** —— 报 0 是在骗自己。

底部始终有一行小字提醒：估算值，与平台账单可能有出入。

---

## 工程结构

```
app/
├── server.js                 本地服务：静态托管 + /api/proxy 转发 + /api/health
├── capacitor.config.json     APK 配置（webDir=www，CapacitorHttp 已开）
├── start.bat                 双击起服务
├── dist/
│   └── API-Hub-1.0-debug.apk 编译好的安卓包
├── www/
│   ├── index.html            单页外壳（360×800 手机容器）
│   ├── app.css               设计系统变量 + 全部组件样式
│   └── js/
│       ├── core.js           数据层 / 价格表 / 三级网络抽象 / 接口封装 / UI 工具
│       ├── screens.js        五个页面：总览 · 验证 · 日志 · 设置 · 账号详情 · 添加
│       └── main.js           路由、导航、发送逻辑
├── tools/
│   ├── mock-upstream.js      模拟上游平台（自测用，不参与运行）
│   ├── e2e.js                端到端自测驱动（无头 Chrome + CDP，零依赖）
│   ├── e2e-page.js           注入到页面里跑的 50 条断言
│   └── build-android.ps1     跑 APK 编译
└── android/                  Capacitor 生成的安卓工程
```

`server.js` 只监听 `127.0.0.1`，局域网里别的机器连不上。静态服务带目录穿越防护。

---

## 自测

```bash
cd app
npm start                    # 另开一个终端
node tools/e2e.js
```

会自己拉起模拟上游、用无头 Chrome 驱动真实页面、跑完 50 条断言再收尾：

```
  OK  运行环境识别为 proxy（本地 Node 代理已生效）
  OK  坏密钥被归类为 auth_invalid
  OK  挂住的请求被主动中断，归为 timeout
  OK  usage 解析正确（26 / 34 / 60）
  OK  界面上出现模型回复气泡
  OK  原生通道能完成一次对话          ← APK 唯一的网络通道
  OK  直连被跨域拦住，归类 cors
  ...
结果：50 / 50 通过
```

覆盖：模型列表拉取、对话补全、usage 解析、费用估算、前缀匹配、日志写入与截断、导入导出往返、失败分类（401/404/429/超时/域名不通/跨域）、BaseURL 四种写法容错、以及三条网络通道各自的正确性。

---

## 数据与隐私

- 密钥、账号、日志全部存在本机 `localStorage`，键名 `aihub.v1`
- 不联网、不上传、无遥测
- 唯一的对外请求就是你自己配置的那些 API 地址
- 设置页可以导出成 JSON 备份，也可以一键清空

**这意味着密钥是明文的。** 别在共用设备上保存生产密钥。APK 版可以考虑后续接 Android Keystore，Web 版没有太好的办法——这是纯前端方案的固有代价。
