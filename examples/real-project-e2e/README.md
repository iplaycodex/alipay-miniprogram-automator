# 已有项目的 E2E 初始化

适用于已有支付宝编译产物的页面流程测试。此示例通过添加测试专用原生引导页，避免默认首页的自动跳转、网络请求和权限弹窗干扰目标页。原始源码和编译目录不会被修改；测试副本中的 app.js、业务页面及接口实现保留原样。

```js
const fs = require('node:fs')
const automator = require('alipay-miniprogram-automator')
const { prepareProject } = require('./prepare-project')

async function main() {
  const prepared = prepareProject('/absolute/path/to/dist/alipay')
  let app
  try {
    app = await automator.launch({ projectPath: prepared.projectPath })
    const version = await app.evaluate(() => my.SDKVersion)
    if (version !== '2.10.15') throw new Error(`Unexpected simulator SDK: ${version}`)
    const page = await app.reLaunch('/pages/your-page/index')
    // Replace the selector and budget with the target page's actual readiness contract.
    // With a 100-second business request timeout, allow that request plus render time.
    await page.waitFor('.your-ready-content', { timeout: 110000, interval: 500 })
    // Run the actual tap, input and state assertions after prerequisites succeed.
  } finally {
    if (app) await app.close()
    fs.rmSync(prepared.directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
```

把上面的初始化放到测试运行器的 async beforeAll 中，并让 beforeAll 的超时覆盖 IDE 启动和业务请求的总预算。具体定位、登录等授权弹窗应由测试用例按预期显式处理；SDK 不替使用者授予权限。权限请求可能在网络响应之后出现，应在等待页面就绪和执行交互前检查已知弹窗，不能只在启动后的固定几秒内检查一次。匹配按钮时注意实际 DOM 文字可能含空白，例如“拒 绝”；应按已知按钮文字规范化后匹配，通过真实 tap 操作处理，不能绕过遮挡检查。

若项目已有请求观测机制，应先验证目标请求的 HTTP 状态、业务码及数据，再等待对应页面内容。没有观测机制时，应等待业务成功后才会显示的元素，而不是固定 sleep 或删除业务断言。接口返回失败时应直接报告失败。

该方案验证目标页面，不覆盖默认首页启动流程。包含必须关联应用的插件时，仍需按官方流程准备应用与插件配置；本例不会去除插件或模拟平台 API。
