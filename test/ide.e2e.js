const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const automator = require('..')

test(
  'installed official IDE runs the independent native mini-program',
  { timeout: 240000 },
  async (t) => {
    const output = path.resolve('.artifacts')
    fs.mkdirSync(output, { recursive: true })
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-native-link-'))
    const projectLink = path.join(fixture, 'project')
    fs.symlinkSync(path.resolve('examples/native-miniapp'), projectLink, 'dir')
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }))
    let miniProgram, outerError
    const results = []
    const step = async (name, run) =>
      t.test(name, async () => {
        try {
          await run()
          results.push({ name, status: 'passed' })
        } catch (cause) {
          results.push({ name, status: 'failed', error: cause.message })
          throw cause
        }
      })
    try {
      miniProgram = await automator.launch({
        projectPath: projectLink,
        idePath: process.env.ALIPAY_IDE_PATH || undefined,
        logPath: path.join(output, 'ide.log'),
        timeout: 90000,
      })
      await step(
        'launch supports immediate navigation without a caller startup sleep',
        async () => {
          const initial = await miniProgram.navigateTo('/pages/detail/index?count=boot')
          assert.equal(initial.query.count, 'boot')
          assert.equal((await miniProgram.pageStack()).length, 2)
          await miniProgram.navigateBack()
        },
      )
      const main = await miniProgram.currentPage()
      await step('launch imports the local project without Computer Use', async () => {
        assert(miniProgram instanceof automator.MiniProgram)
        assert(main instanceof automator.Page)
        assert.equal(main.path, 'pages/index/index')
        assert.equal(miniProgram.info.ideVersion, '3.10.5')
        assert.equal(miniProgram.info.projectPath, fs.realpathSync(projectLink))
      })
      await step(
        'worker evaluation reads the built-in my API and serializes Chinese arguments',
        async () => {
          const info = await miniProgram.evaluate(
            (value) => ({
              value,
              version: my.SDKVersion,
              width: my.getSystemInfoSync().windowWidth,
            }),
            '中文参数',
          )
          assert.equal(info.value, '中文参数')
          assert(info.version)
          assert.equal(info.version, '2.10.15')
          assert(info.width > 0)
        },
      )
      let counter
      await step('selectors find the actual native page elements', async () => {
        counter = await main.waitFor('.counter')
        assert(counter instanceof automator.Element)
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
        assert.equal(detail.query.count, '1')
        await assert.rejects(main.$('.counter'), { code: 'ERR_INACTIVE_PAGE' })
      })
      await step('navigateBack restores the previous native page state', async () => {
        const returned = await miniProgram.navigateBack()
        assert.equal(returned.path, main.path)
        assert.match(await (await returned.waitFor('.counter')).text(), /计数：1/)
      })
      await step('screenshots return PNG bytes and write the requested file', async () => {
        // The worker's route updates before the IDE finishes its back animation.
        await new Promise((resolve) => setTimeout(resolve, 800))
        const buffer = await miniProgram.screenshot({ path: path.join(output, 'native-main.png') })
        assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        assert(buffer.length > 5000)
      })
      await step('reLaunch resets state and old elements become stale', async () => {
        const fresh = await miniProgram.reLaunch('/pages/index/index')
        assert.match(await (await fresh.waitFor('.counter')).text(), /计数：0/)
        await assert.rejects(counter.text(), { code: 'ERR_STALE_ELEMENT' })
      })
      let firstDetail, nextDetail
      await step('same-route navigation scopes selectors to the active page instance', async () => {
        firstDetail = await miniProgram.navigateTo(
          '/pages/detail/index?count=41&word=%E4%B8%AD%E6%96%87',
        )
        assert.deepEqual(firstDetail.query, { count: '41', word: '中文' })
        nextDetail = await miniProgram.navigateTo('/pages/detail/index?count=42')
        assert.equal((await miniProgram.pageStack()).length, 3)
        assert.equal(nextDetail.query.count, '42')
        assert.match(await (await nextDetail.waitFor('.detail-count')).text(), /计数：42/)
        assert.equal((await nextDetail.$$('.detail-count')).length, 1)
        assert.equal((await miniProgram.queryAll('.detail-count')).length, 1)
        await assert.rejects(firstDetail.$('.detail-count'), { code: 'ERR_INACTIVE_PAGE' })
        const returned = await miniProgram.navigateBack()
        assert.equal((await miniProgram.pageStack()).length, 2)
        assert.deepEqual(returned.identity, firstDetail.identity)
        assert.deepEqual(returned.query, firstDetail.query)
        assert.match(await (await returned.waitFor('.detail-count')).text(), /计数：41/)
        await assert.rejects(nextDetail.$('.detail-count'), { code: 'ERR_INACTIVE_PAGE' })
      })
      await step(
        'native same-route clicks and a new connection preserve actual page query',
        async () => {
          await (await firstDetail.waitFor('.open-next')).tap()
          nextDetail = await miniProgram.waitFor(async () => {
            const current = await miniProgram.currentPage()
            return current?.query.count === '43' ? current : null
          })
          assert.match(await (await nextDetail.waitFor('.detail-count')).text(), /计数：43/)
          const connected = await automator.connect({ port: miniProgram.info.inspectorPort })
          try {
            const current = await connected.currentPage()
            assert.deepEqual(current.query, { count: '43', word: '中文' })
            assert.equal((await current.$$('.detail-count')).length, 1)
            assert.match(await (await current.$('.detail-count')).text(), /计数：43/)
          } finally {
            connected.disconnect()
          }
        },
      )
      await step('same-route reLaunch replaces the instance and preserves new query', async () => {
        const fresh = await miniProgram.reLaunch('/pages/detail/index?count=44')
        assert.equal((await miniProgram.pageStack()).length, 1)
        assert.equal(fresh.query.count, '44')
        assert.notDeepEqual(fresh.identity, nextDetail.identity)
        assert.match(await (await fresh.waitFor('.detail-count')).text(), /计数：44/)
        await assert.rejects(nextDetail.$('.detail-count'), { code: 'ERR_INACTIVE_PAGE' })
      })
      await step('native navigation failure rejects instead of returning an old page', async () => {
        await assert.rejects(miniProgram.navigateTo('/pages/missing/index'), {
          code: 'ERR_NAVIGATION',
        })
        const current = await miniProgram.currentPage()
        assert.equal(current.query.count, '44')
        assert.equal((await miniProgram.pageStack()).length, 1)
      })
    } catch (cause) {
      outerError = cause.message
      throw cause
    } finally {
      const info = miniProgram?.info
      if (miniProgram) await miniProgram.close()
      fs.writeFileSync(
        path.join(output, 'e2e-report.json'),
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            runtime: 'Official installed Alipay IDE simulator',
            status:
              outerError ||
              results.some((item) => item.status === 'failed') ||
              results.length !== 15
                ? 'failed'
                : 'passed',
            startupError: outerError,
            required: 15,
            executed: results.length,
            ideVersion: info?.ideVersion,
            passed: results.filter((item) => item.status === 'passed').length,
            failed: results.filter((item) => item.status === 'failed').length,
            results,
            computerUse: false,
            businessProject: false,
            webBuild: false,
            physicalDevice: false,
            androidEmulator: false,
            plugins: false,
            login: false,
            payment: false,
          },
          null,
          2,
        ),
      )
    }
  },
)

test(
  'fresh IDE profiles support immediate navigation repeatedly',
  { timeout: 240000 },
  async (t) => {
    const results = []
    const output = path.resolve('.artifacts')
    fs.mkdirSync(output, { recursive: true })
    try {
      for (let run = 1; run <= 2; run++) {
        await t.test(`cold start ${run}`, async () => {
          let app
          try {
            app = await automator.launch({
              projectPath: path.resolve('examples/native-miniapp'),
              idePath: process.env.ALIPAY_IDE_PATH || undefined,
              logPath: path.join(output, `cold-start-${run}.log`),
            })
            const page = await app.navigateTo(`/pages/detail/index?count=cold-${run}`)
            assert.equal(page.query.count, `cold-${run}`)
            assert.equal((await app.pageStack()).length, 2)
            assert.match(
              await (await page.waitFor('.detail-count')).text(),
              new RegExp(`cold-${run}`),
            )
            results.push({ run, status: 'passed' })
          } catch (cause) {
            results.push({ run, status: 'failed', error: cause.message })
            throw cause
          } finally {
            if (app) await app.close()
          }
        })
      }
    } finally {
      fs.writeFileSync(
        path.join(output, 'cold-start-report.json'),
        JSON.stringify(
          {
            required: 2,
            passed: results.filter((result) => result.status === 'passed').length,
            results,
          },
          null,
          2,
        ),
      )
    }
  },
)

test(
  'cold launch tolerates worker initialization beyond the 15-second command timeout',
  { timeout: 150000 },
  async () => {
    const output = path.resolve('.artifacts')
    fs.mkdirSync(output, { recursive: true })
    const directory = fs.mkdtempSync(path.join(output, 'slow-start-'))
    const projectPath = path.join(directory, 'project')
    fs.cpSync(path.resolve('examples/native-miniapp'), projectPath, { recursive: true })
    // A deliberately slow fixture reproduces the worker being unable to answer startup probes.
    fs.writeFileSync(
      path.join(projectPath, 'app.js'),
      'App({ onLaunch() { const end = Date.now() + 18000; while (Date.now() < end) {} } })\n',
    )
    let app
    const started = Date.now()
    const report = { status: 'failed', simulatedWorkerStartupMs: 18000 }
    try {
      app = await automator.launch({
        projectPath,
        profilePath: path.join(directory, 'profile'),
        logPath: path.join(directory, 'ide.log'),
        timeout: 120000,
      })
      report.launchDurationMs = Date.now() - started
      assert(report.launchDurationMs >= 18000)
      assert(report.launchDurationMs < 120000)
      const page = await app.navigateTo('/pages/detail/index?count=slow-start')
      assert.equal(page.query.count, 'slow-start')
      assert.match(await (await page.waitFor('.detail-count')).text(), /slow-start/)
      assert.equal(await app.evaluate(() => my.SDKVersion), '2.10.15')
      report.status = 'passed'
    } catch (cause) {
      report.error = cause.message
      throw cause
    } finally {
      if (app) await app.close()
      fs.writeFileSync(path.join(output, 'slow-start-report.json'), JSON.stringify(report, null, 2))
    }
  },
)
