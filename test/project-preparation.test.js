const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { prepareProject } = require('../examples/real-project-e2e/prepare-project')

test('real-project preparation isolates startup without changing application code or source routes', (t) => {
  const source = path.resolve(__dirname, '../examples/native-miniapp')
  const originalConfig = fs.readFileSync(path.join(source, 'app.json'))
  const originalApp = fs.readFileSync(path.join(source, 'app.js'))
  const prepared = prepareProject(source)
  t.after(() => fs.rmSync(prepared.directory, { recursive: true, force: true }))
  assert.equal(path.relative(source, prepared.projectPath).startsWith('..'), true)
  assert.deepEqual(fs.readFileSync(path.join(source, 'app.json')), originalConfig)
  assert.deepEqual(fs.readFileSync(path.join(prepared.projectPath, 'app.js')), originalApp)
  const config = JSON.parse(fs.readFileSync(path.join(prepared.projectPath, 'app.json')))
  assert.equal(config.pages[0], prepared.bootstrapPath)
  assert.deepEqual(config.pages.slice(1), JSON.parse(originalConfig).pages)
  for (const suffix of ['js', 'json', 'axml']) {
    assert(fs.existsSync(path.join(prepared.projectPath, prepared.bootstrapPath + '.' + suffix)))
  }
})

test('preparation snapshots symlinked configuration without writing through to the source', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-preparation-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  fs.mkdirSync(source)
  const configPath = path.join(directory, 'app.json')
  const original = JSON.stringify({ pages: ['pages/index/index'] })
  fs.writeFileSync(configPath, original)
  fs.symlinkSync(configPath, path.join(source, 'app.json'))
  fs.writeFileSync(path.join(source, 'app.js'), 'App({})')
  const prepared = prepareProject(source)
  t.after(() => fs.rmSync(prepared.directory, { recursive: true, force: true }))
  assert.equal(prepared.projectPath, fs.realpathSync(prepared.projectPath))
  assert.equal(fs.readFileSync(configPath, 'utf8'), original)
  assert.equal(fs.lstatSync(path.join(prepared.projectPath, 'app.json')).isSymbolicLink(), false)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(prepared.projectPath, 'app.json'))).pages[0],
    prepared.bootstrapPath,
  )
})
