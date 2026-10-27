# alipay-miniprogram-automator

实验性的第三方支付宝小程序自动化 SDK。直接驱动**已安装的支付宝官方开发者工具内置模拟器**，提供页面跳转、元素查询、实际点击、文本输入与截图能力。

本项目不是支付宝官方 SDK，与支付宝无隶属关系。它不提供小程序运行时，不打包或修改官方 IDE，也不把小程序重新编译成 H5。运行时仍由官方 IDE 提供。SDK 不依赖 Codex、Computer Use、Jest、物理手机或 Android 模拟器；可以由普通 Node.js 脚本、Jest 或其他测试运行器调用。

## 状态与运行要求

- Alpha 版本；当前明确验证的环境是 **macOS arm64、支付宝 IDE 3.10.5、Node.js 24.14.0**。
- SDK 要求 Node.js >=22。旧版 Taro 项目的构建可以继续使用自己的 Node 版本，测试进程单独使用本 SDK 要求的版本。
- 官方 IDE 必须自行安装，并在有桌面会话的环境中运行；本工具不是无界面浏览器或 Docker 中的支付宝运行时。
- 当前按单个 IDE 实例串行测试；多实例并行尚未验证。`profilePath` 隔离 Electron 用户数据，不保证隔离 IDE 自身的全局缓存和后台服务。
- 接入的是 IDE 的内部调试能力，IDE 升级可能导致失效。默认拒绝未经验证的版本；显式传入 `allowUnverifiedVersion: true` 可自行尝试，不代表已兼容。
- 原生支付宝项目可以直接加载。Taro 等框架项目应先生成 `alipay` 目标产物，将含 `app.json` 和 `app.js` 的目录作为 `projectPath`。
- 官方模拟器不支持的 API，本库不会补齐；真机一致性、授权登录、支付和硬件能力不在当前验证承诺内。

## 获取代码

当前尚未发布到 npm。可以克隆本仓库安装依赖：

```bash
git clone https://github.com/iplaycodex/alipay-miniprogram-automator.git
cd alipay-miniprogram-automator
npm ci
npm run lint
npm test
npm run test:types
npm run test:package
npm run test:e2e
```

也可以在自己的测试工程里从 GitHub 安装：

```bash
npm install --save-dev github:iplaycodex/alipay-miniprogram-automator
```

## 快速使用

```js
const automator = require('alipay-miniprogram-automator')

async function main() {
  const miniProgram = await automator.launch({
    projectPath: '/absolute/path/to/dist/alipay',
  })

  try {
    const page = await miniProgram.reLaunch('/pages/index/index')
    const button = await page.waitFor('.increment')
    await button.tap()
    const input = await page.waitFor('.message input')
    await input.fill('自动化测试')
    await miniProgram.screenshot({ path: './artifacts/page.png' })
  } finally {
    await miniProgram.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
```

选择器对应官方模拟器的**实际渲染 DOM**，不保证与微信 automator 的选择器语义完全一致。例如支付宝 Input 的实际可编辑节点可能是 `.message input`，占位提示可能由单独的节点渲染。

包内包含 TypeScript 声明；TypeScript 测试工程需安装 `@types/node`。ESM 工程可以使用 `import automator from 'alipay-miniprogram-automator'`。

拉取源码或从 Git 安装时，若显式禁用了 npm 生命周期脚本，需要手动执行 `npm run build`。安装已打包的 tarball 无需本地构建。

## `launch(options)`

启动自己的 IDE 实例，使用独立用户目录与本机调试端口，通过官方 IDE 的项目导入界面加载项目，然后等待小程序就绪。

| 选项                     | 说明                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `projectPath`            | 必填，原生支付宝项目或支付宝编译产物目录                                                                |
| `idePath`                | IDE 可执行文件路径；macOS 默认查找 `/Applications/小程序开发者工具.app/Contents/MacOS/小程序开发者工具` |
| `profilePath`            | 可选的 IDE 用户目录；默认新建临时目录                                                                   |
| `port`                   | 可选的 Inspector 端口；默认选择可用端口                                                                 |
| `logPath`                | IDE 日志路径；默认位于该实例用户目录                                                                    |
| `timeout`                | 启动阶段等待时间，默认 90000ms                                                                          |
| `allowUnverifiedVersion` | 是否显式尝试未经验证的 IDE 版本，默认 false                                                             |

项目导入适配器使用 IDE 的正常导入界面，并在当前新进程内临时为目录选择器提供 `projectPath`，完成后恢复原选择器。不会自动登录、关联应用、接受协议、下载插件或改变项目配置。业务插件若要求关联应用，应由使用者按官方流程准备。

用户目录会保留以便排查问题。不要提交或分发包含登录态的用户目录、日志或测试产物。`close()` 只关闭本库 `launch()` 创建的实例，并核对 PID 和用户目录；不会关闭其他 IDE。

## `connect(options)`

连接已经通过 Node Inspector 启动且已打开项目的 IDE：

```js
const miniProgram = await automator.connect({
  port: 19387,
  profilePath: '/absolute/path/to/isolated-profile',
})
try {
  const page = await miniProgram.currentPage()
  console.log(page.path)
} finally {
  miniProgram.disconnect()
}
```

IDE 需要通过可执行文件参数 `--inspect=127.0.0.1:19387 --user-data-dir=/absolute/path/to/isolated-profile` 启动。仅给普通已启动 IDE 开启 Chromium 远程调试端口并不等价于 Node Inspector。

`connect` 支持 `host`（仅回环地址）、`port`、`timeout`、`profilePath`、`inspectorTargetId`、`simulatorId` 和 `allowUnverifiedVersion`。存在多个目标时要求明确选择，避免连接到错误窗口。对 `connect()` 返回的实例调用 `close()` 仅断开连接，不退出用户原有的 IDE。

Inspector 具有在 IDE 中执行代码的权限。本库启动时只绑定回环地址，不应将该端口公开到网络。

## API 摘要

| 对象          | 方法                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `miniProgram` | `currentPage()`、`pageStack()`、`reLaunch(url)`、`navigateTo(url)`、`navigateBack()`                      |
| `miniProgram` | `evaluate(fn, ...args)`、`waitFor(check, options)`、`query(selector, text?)`、`queryAll(selector, text?)` |
| `miniProgram` | `screenshot({ path? })` 返回 PNG Buffer、`disconnect()`、`close()`                                        |
| `page`        | `path`、`query`、`$(selector)`、`$$(selector)`、`waitFor(selector, { timeout? })`                         |
| `element`     | `text()`、`value()`、`attribute(name)`、`bounds()`、`waitForStable(options)`                              |
| `element`     | `tap(options)`、`input(text)` 追加输入、`fill(text)` 全选后替换                                           |

`evaluate` 的函数和参数必须能以源码/JSON 传入独立的小程序逻辑环境，不能捕获 Node.js 侧闭包变量：

```js
const result = await miniProgram.evaluate(
  (value) => ({
    value,
    SDKVersion: my.SDKVersion,
    pages: getCurrentPages().map((page) => page.route),
  }),
  '测试参数',
)
```

元素操作通过真正的调试协议输入事件完成，不调用业务事件处理函数来代替点击，不直接修改 input.value 或框架状态。点击前检查位置稳定和逐层 iframe 遮挡。页面重建后旧元素可能失效，应重新查询。当前还未提供拖拽、多点触摸、复杂滚动和完整的微信 automator API 兼容层。

## 测试

- `npm run build`：校验源码语法，生成 CommonJS 与类型声明到 `out/`；`npm ci`、从 GitHub 安装和 `npm pack` 会自动构建。
- `npm run format` / `npm run lint`：统一格式，以及检查格式和 JavaScript 语法。
- `npm test`：本地 HTTP/WebSocket 通信测试，覆盖乱序响应、异常、断线、超时、目标选择、隔离目录及版本校验。
- `npm run test:types`：验证 TypeScript 中的 CommonJS 与 ESM 默认导入、参数与返回类型。
- `npm run test:package`：本地打包后在全新目录仅安装生产依赖，检查发布白名单、公共入口和运行时依赖；需要访问 npm registry。
- `npm run test:e2e`：自行启动官方 IDE，自动导入仓库内 `examples/native-miniapp`，验证计数、中文输入、替换/清空、跳转传参、返回、截图及旧元素失效。结果和 IDE 日志写入 gitignored 的 `.artifacts/`。
- `npm run check:package`：预览 npm 包文件清单，不发布。

完整验证环境和范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。公开包的 `files` 白名单只包含自研库、说明文档和许可证，不包含业务项目、IDE 文件、测试用户目录和日志。

模块划分、与官方微信 SDK 的参考关系及打包约定见 [docs/ARCHITECTURE.md](https://github.com/iplaycodex/alipay-miniprogram-automator/blob/main/docs/ARCHITECTURE.md)。

## 许可证

本仓库自研代码使用 MIT 许可证。该许可证不授予支付宝 IDE、其运行时或其他第三方组件的再分发权；使用官方工具仍应遵守对应许可。仓库不包含从官方安装包提取的实现源码。
