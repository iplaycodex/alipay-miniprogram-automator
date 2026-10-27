const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automator = require('..')

test('installed official IDE runs the independent native mini-program', { timeout: 240000 }, async t => {
  const output = path.resolve('.artifacts')
  fs.mkdirSync(output, { recursive: true })
  let miniProgram, outerError
  const results = []
  const step = async (name, run) => t.test(name, async () => {
    try { await run(); results.push({ name, status: 'passed' }) }
    catch (cause) { results.push({ name, status: 'failed', error: cause.message }); throw cause }
  })
  try {
    miniProgram = await automator.launch({
      projectPath: path.resolve('examples/native-miniapp'),
      idePath: process.env.ALIPAY_IDE_PATH || undefined,
      logPath: path.join(output, 'ide.log'), timeout: 90000
    })
    const main = await miniProgram.currentPage()
    await step('launch imports the local project without Computer Use', async () => {
      assert.equal(main.path, 'pages/index/index')
      assert.equal(miniProgram.info.ideVersion, '3.10.5')
    })
    await step('worker evaluation reads the built-in my API and serializes Chinese arguments', async () => {
      const info = await miniProgram.evaluate(value => ({ value, version: my.SDKVersion, width: my.getSystemInfoSync().windowWidth }), '中文参数')
      assert.equal(info.value, '中文参数')
      assert(info.version)
      assert(info.width > 0)
    })
    let counter
    await step('selectors find the actual native page elements', async () => {
      counter = await main.waitFor('.counter')
      assert.match(await counter.text(), /计数：0/)
      assert.equal((await main.$$('.card')).length, 2)
    })
    await step('native pointer events increment page state', async () => {
      const button = await main.waitFor('.increment')
      await button.tap()
      await miniProgram.waitFor(async () => (await counter.text()).includes('计数：1'))
    })
    let input
    await step('native input updates the controlled page value', async () => {
      input = await main.waitFor('.message input')
      await input.input('自动化中文')
      await miniProgram.waitFor(async () => (await input.value()) === '自动化中文')
      assert.match(await (await main.$('.message-value')).text(), /自动化中文/)
    })
    await step('fill replaces existing text and can clear it', async () => {
      await input.fill('替换')
      await miniProgram.waitFor(async () => (await input.value()) === '替换')
      await input.fill('')
      await miniProgram.waitFor(async () => (await input.value()) === '')
    })
    await step('actual page button navigates and passes route parameters', async () => {
      await (await main.waitFor('.open-detail')).tap()
      const detail = await miniProgram.waitFor(async () => {
        const page = await miniProgram.currentPage()
        return page?.path === 'pages/detail/index' ? page : null
      })
      assert.match(await (await detail.waitFor('.detail-count')).text(), /传入计数：1/)
      await assert.rejects(main.$('.counter'), { code: 'ERR_INACTIVE_PAGE' })
    })
    await step('navigateBack restores the previous native page state', async () => {
      const returned = await miniProgram.navigateBack()
      assert.equal(returned.path, main.path)
      assert.match(await (await returned.waitFor('.counter')).text(), /计数：1/)
    })
    await step('screenshots return PNG bytes and write the requested file', async () => {
      // The worker's route updates before the IDE finishes its back animation.
      await new Promise(resolve => setTimeout(resolve, 800))
      const buffer = await miniProgram.screenshot({ path: path.join(output, 'native-main.png') })
      assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert(buffer.length > 5000)
    })
    await step('reLaunch resets state and old elements become stale', async () => {
      const fresh = await miniProgram.reLaunch('/pages/index/index')
      assert.match(await (await fresh.waitFor('.counter')).text(), /计数：0/)
      await assert.rejects(counter.text(), { code: 'ERR_STALE_ELEMENT' })
    })
  } catch (cause) {
    outerError = cause.message
    throw cause
  } finally {
    const info = miniProgram?.info
    if (miniProgram) await miniProgram.close()
    fs.writeFileSync(path.join(output, 'e2e-report.json'), JSON.stringify({
      generatedAt: new Date().toISOString(), runtime: 'Official installed Alipay IDE simulator',
      status: outerError || results.some(item => item.status === 'failed') || results.length !== 10 ? 'failed' : 'passed',
      startupError: outerError, required: 10, executed: results.length,
      ideVersion: info?.ideVersion, passed: results.filter(item => item.status === 'passed').length,
      failed: results.filter(item => item.status === 'failed').length, results,
      computerUse: false, businessProject: false, webBuild: false, physicalDevice: false,
      androidEmulator: false, plugins: false, login: false, payment: false
    }, null, 2))
  }
})
