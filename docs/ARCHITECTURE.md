# 架构与发布约定

本次参考对象是官方发布的 `miniprogram-automator@0.13.0`。其 [npm 元数据](https://registry.npmjs.org/miniprogram-automator/0.13.0) 中的仓库指向腾讯内网 `git.code.oa.com:devtools/automator.git`，没有将第三方 GitHub 项目当作官方源码。

实际检查了官方发布包的 `package.json`、`out/*.js` 和 `out/*.d.ts`。其中可确认的组织方式包括 Automator/Launcher、Connection/Transport、MiniProgram/Page/Element 分工，`main` 和 `types` 指向 `out/`，构建脚本为 `tsc && gulp build`，并配置 Prettier、TSLint 和 ESLint。原始仓库的完整 tsconfig、Gulp 配置和 Prettier 规则没有随包发布，因此不对这些文件的具体选项作推断。

## 本项目的对应方式

| 参考点           | 本项目采用方式                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| 按对象和职责拆分 | `mini-program.js`、`page.js`、`element.js` 分别维护对象行为                                                          |
| 启动与会话分开   | `launcher.js` 管理进程生命周期，`project-importer.js` 适配官方 IDE 导入界面，`inspector.js` 处理 Node Inspector 通信 |
| 公共入口统一     | `src/index.js` 定义原有的 connect、launch、MiniProgram、Page、Element 导出                                           |
| 发布构建目录     | `main` 与 `exports` 指向 `out/index.js`，`files` 只允许构建产物、文档和许可证                                        |
| 提供类型声明     | `types/index.d.ts` 描述已有 API，构建时复制为 `out/index.d.ts`，通过 CJS/ESM 消费示例验证                            |
| 一致代码风格     | 明确配置 Prettier；保留本项目已有的单引号和无分号风格，展开多语句单行代码                                            |
| 本地检查可复现   | `lint` 检查格式及 JavaScript 语法，`test:types` 检查类型声明，`test:package` 检查生产依赖安装和入口                  |

目前仍使用 JavaScript/CommonJS。构建脚本使用 Node 内置模块校验并复制源码，不转译、不合并、不压缩远程执行的代码。官方项目的 TypeScript/Gulp 工具链服务于其自身源码，本项目没有为模仿配置而引入相同的运行要求。

版本保护集中在 `ide-version.js`，launch 和 connect 复用同一项检查。元素点击、输入、iframe 遮挡判断、失效元素检测、实际 worker 求值及进程归属检查沿用已验证的实现。

## 目录

```text
src/
  index.js                 公共导出
  launcher.js              IDE 启动与失败清理
  project-importer.js      IDE 项目导入适配
  ide-version.js           已验证版本保护
  inspector.js             Inspector 发现和请求通信
  mini-program.js          会话、路由、逻辑求值和输入协议
  page.js                  页面查询和等待
  element.js               元素读取、定位、点击和输入
  util.js                  等待、错误和路径工具
types/index.d.ts           公共 API 类型声明源文件
scripts/                   构建、语法检查
test/                      通信、类型、打包与原生 IDE E2E
examples/native-miniapp/    独立原生示例
out/                       自动生成，忽略 Git
```

## 构建与消费

`npm ci`、`npm pack` 和从 GitHub 安装时，通过 prepare 生成 `out/`，避免发布过期产物。构建本身不依赖开发工具或 IDE。打包测试在没有 node_modules 的源码副本中验证 prepare 构建和过期产物清理，再安装 tarball。发布的 tarball 已带构建产物，使用者无需编译 SDK。

源码检查、类型工具和格式化器只在 devDependencies。运行时依赖继续只有 `ws`。公共 CommonJS 用法保持 `require('alipay-miniprogram-automator')`，ESM 可以通过默认导入消费同一个 CommonJS 对象。`exports` 继续限制私有子路径，不承诺 src/out 内部文件的直接导入。

这次调整改善职责边界、编辑器提示和发布可重复性，没有以未经基准测试的速度提升作为目标，也没有引入官方微信协议或改变支付宝运行时接入路径。
