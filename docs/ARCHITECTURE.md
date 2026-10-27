# 架构与发布约定

本次参考对象是官方发布的 `miniprogram-automator@0.13.0`。其 [npm 元数据](https://registry.npmjs.org/miniprogram-automator/0.13.0) 中的仓库指向腾讯内网 `git.code.oa.com:devtools/automator.git`，没有将第三方 GitHub 项目当作官方源码。

实际检查了官方发布包的 `package.json`、`out/*.js` 和 `out/*.d.ts`。其中可确认的组织方式包括 Automator/Launcher、Connection/Transport、MiniProgram/Page/Element 分工，`main` 和 `types` 指向 `out/`，构建脚本为 `tsc && gulp build`，并配置 Prettier、TSLint 和 ESLint。原始仓库的完整 tsconfig、Gulp 配置和 Prettier 规则没有随包发布，因此不对这些文件的具体选项作推断。

## 本项目的对应方式

| 参考点           | 本项目采用方式                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 按对象和职责拆分 | `mini-program.ts`、`page.ts`、`element.ts` 分别维护对象行为                                                                   |
| 启动与会话分开   | `launcher.ts` 管理进程生命周期，`project-importer.ts` 适配官方 IDE 导入界面，`inspector.ts` 处理 Node Inspector 通信          |
| 公共入口统一     | `src/index.ts` 定义原有的 connect、launch、MiniProgram、Page、Element 导出                                                    |
| 发布构建目录     | `main` 与 `exports` 指向 `out/index.js`，`files` 只允许构建产物、文档和许可证                                                 |
| 提供类型声明     | `src/*.ts` 同时承载实现和类型，由 tsc 自动生成 `out/*.d.ts`，通过 CJS/ESM 消费示例验证                                        |
| 一致代码风格     | 明确配置 Prettier；保留本项目已有的单引号和无分号风格，展开多语句单行代码                                                     |
| 本地检查可复现   | `lint` 检查格式、严格 TypeScript 类型及辅助 JavaScript 语法，`test:types` 检查类型声明，`test:package` 检查生产依赖安装和入口 |

SDK 实现使用 TypeScript，开启 strict、noEmitOnError 和 declaration。构建脚本调用 TypeScript 编译器，将 JavaScript 与声明一起生成到临时目录，成功后替换 out/，类型错误不会覆盖上次成功构建。目标设为 ES2022，输出仍为 CommonJS；不压缩、不将异步函数降级为依赖外部 helper 的代码，保证发送给 IDE 的函数可独立序列化。

版本保护集中在 `ide-version.ts`，launch 和 connect 复用同一项检查。元素点击、输入、iframe 遮挡判断、失效元素检测、实际 worker 求值及进程归属检查沿用已验证的实现。

## 目录

```text
src/
  index.ts                 公共导出和兼容的类型命名空间
  launcher.ts              IDE 启动与失败清理
  project-importer.ts      IDE 项目导入适配
  ide-version.ts           已验证版本保护
  inspector.ts             Inspector 发现和请求通信
  mini-program.ts          会话、路由、逻辑求值和输入协议
  page.ts                  页面查询和等待
  element.ts               元素读取、定位、点击和输入
  util.ts                  等待、错误和路径工具
  types.ts                 共享选项、结果和连接类型
  runtime-globals.d.ts      仅构建期使用的 worker 平台声明
tsconfig.json              strict 编译及声明生成配置
scripts/                   构建、语法检查
test/                      通信、类型、打包与原生 IDE E2E
examples/native-miniapp/    独立原生示例
out/                       自动生成，忽略 Git
```

## 构建与消费

`npm ci`、`npm pack` 和从 GitHub 安装时，通过 prepare 调用 tsc 生成 `out/`，避免发布过期产物。开发和源码打包需要 devDependencies 中的 TypeScript、Node 和 ws 类型，构建不启动 IDE。npm 在准备 Git 依赖时会安装其构建依赖（见 [npm prepare 文档](https://docs.npmjs.com/cli/v11/using-npm/scripts/#life-cycle-scripts)）。

打包测试在源码副本中使用开发工具链执行 prepare，检查旧产物清理，再在全新消费目录中仅安装生产依赖。发布的 tarball 已带 CommonJS JavaScript 和自动生成的声明，不需要 TypeScript 编译器、ts-node 或 TS 运行时。`runtime-globals.d.ts` 不进入消费者的全局类型环境；公开声明也不要求 DOM lib。

源码检查、类型工具和格式化器只在 devDependencies。运行时依赖继续只有 `ws`。公共 CommonJS 用法保持 `require('alipay-miniprogram-automator')`，ESM 可以通过默认导入消费同一个 CommonJS 对象。`exports` 继续限制私有子路径，不承诺 src/out 内部文件的直接导入。

这次调整改善职责边界、编辑器提示和发布可重复性，没有以未经基准测试的速度提升作为目标，也没有引入官方微信协议或改变支付宝运行时接入路径。
