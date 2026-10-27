import automator = require('alipay-miniprogram-automator')

async function usePublicAPI() {
  const app = await automator.launch({ projectPath: '/tmp/native-miniapp', timeout: 90000 })
  const page: automator.Page = await app.reLaunch('/pages/index/index')
  const input: automator.Element = await page.waitFor('.message input', 5000)
  await input.fill('中文')
  const value: string | undefined = await input.value()
  const attribute: string | null = await input.attribute('class')
  const bounds: automator.Bounds = await input.bounds()
  const image: Buffer = await app.screenshot()
  const evaluated: string = await app.evaluate(
    (prefix: string, count: number) => prefix + count,
    'x',
    1,
  )
  const expression: number = await app.evaluate<number>('1 + 1')
  const found: automator.Element = await app.waitFor(() => page.$('.counter'))
  const stable: automator.Bounds = await input.waitForStable({ timeout: 1000 })
  const current: automator.Page | null = await app.currentPage()
  await app.waitFor(() => true, 'not ready', 1000)
  app.disconnect()
  await app.close()
  return { value, attribute, bounds, image, evaluated, expression, found, stable, current }
}

automator.connect({ host: '::1', port: 19387, simulatorId: 4 })
automator.MiniProgram.connect({ profilePath: '/tmp/profile' })

// @ts-expect-error projectPath is required.
automator.launch({})
// @ts-expect-error Remote inspector hosts are unsupported.
automator.connect({ host: 'example.com' })
// @ts-expect-error evaluate argument types must match the function.
automator.connect().then((app) => app.evaluate((count: number) => count, 'wrong'))

void usePublicAPI
