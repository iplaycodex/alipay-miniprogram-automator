const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

test(
  'packed SDK installs with production dependencies and preserves its public entry',
  { timeout: 120000 },
  (t) => {
    const root = path.resolve(__dirname, '..')
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-package-test-'))
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
    const npm = process.env.npm_execpath
    assert(npm, 'Run this check with npm run test:package')
    const packageRoot = path.join(temporary, 'package-source')
    fs.mkdirSync(packageRoot)
    for (const name of [
      'package.json',
      'README.md',
      'LICENSE',
      'src',
      'tsconfig.json',
      'scripts',
      'docs',
    ]) {
      fs.cpSync(path.join(root, name), path.join(packageRoot, name), { recursive: true })
    }
    // Build inputs include TypeScript tooling; the published tarball must not require it.
    fs.symlinkSync(
      path.join(root, 'node_modules'),
      path.join(packageRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    fs.mkdirSync(path.join(packageRoot, 'out'))
    fs.writeFileSync(path.join(packageRoot, 'out/obsolete.js'), 'throw new Error("stale artifact")')
    const invalidSource = path.join(packageRoot, 'src/intentional-type-error.ts')
    fs.writeFileSync(invalidSource, 'const invalid: number = "type error"\nexport { invalid }\n')
    const failedBuild = spawnSync(process.execPath, [path.join(packageRoot, 'scripts/build.js')], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.notEqual(failedBuild.status, 0)
    assert.match(failedBuild.stdout + failedBuild.stderr, /TS2322/)
    assert(fs.existsSync(path.join(packageRoot, 'out/obsolete.js')))
    fs.rmSync(invalidSource)
    const pack = JSON.parse(
      execFileSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', temporary], {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout: 30000,
      }),
    )[0]
    const files = pack.files.map((file) => file.path)
    assert(files.includes('out/index.js'))
    assert(files.includes('out/index.d.ts'))
    assert(files.includes('LICENSE'))
    assert(!files.includes('out/obsolete.js'))
    assert(
      files.every(
        (name) =>
          name.startsWith('out/') ||
          ['package.json', 'README.md', 'LICENSE', 'docs/VALIDATION.md'].includes(name),
      ),
    )

    const consumer = path.join(temporary, 'consumer')
    fs.mkdirSync(consumer)
    fs.writeFileSync(
      path.join(consumer, 'package.json'),
      JSON.stringify({ name: 'automator-package-test', version: '1.0.0', private: true }),
    )
    execFileSync(
      process.execPath,
      [
        npm,
        'install',
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--registry=https://registry.npmjs.org',
        path.join(temporary, pack.filename),
      ],
      {
        cwd: consumer,
        stdio: 'pipe',
        timeout: 90000,
      },
    )
    const result = execFileSync(
      process.execPath,
      [
        '-e',
        `
    const assert = require('node:assert/strict')
    const sdk = require('alipay-miniprogram-automator')
    assert.deepEqual(Object.keys(sdk).sort(), ['connect', 'launch', 'MiniProgram', 'Page', 'Element'].sort())
    assert.throws(() => require.resolve('alipay-miniprogram-automator/src/mini-program'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'})
    import('alipay-miniprogram-automator').then(module => {
      assert.equal(module.default, sdk)
      console.log('CJS and ESM default entry work')
    }).catch(cause => { console.error(cause); process.exitCode = 1 })
  `,
      ],
      { cwd: consumer, encoding: 'utf8', timeout: 10000 },
    )
    assert.match(result, /CJS and ESM default entry work/)
    assert(!fs.existsSync(path.join(consumer, 'node_modules/prettier')))
    assert(!fs.existsSync(path.join(consumer, 'node_modules/typescript')))
    assert(fs.existsSync(path.join(consumer, 'node_modules/ws')))
  },
)
