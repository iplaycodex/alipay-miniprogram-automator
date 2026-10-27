const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** Create a disposable compiled-project copy with a quiet native bootstrap page. */
function prepareProject(projectPath) {
  const source = fs.realpathSync(projectPath)
  const config = JSON.parse(fs.readFileSync(path.join(source, 'app.json'), 'utf8'))
  if (!fs.existsSync(path.join(source, 'app.js')) || !Array.isArray(config.pages)) {
    throw new Error('Pass an Alipay build output containing app.js and an app.json pages array')
  }
  const bootstrapPath = '__automator_boot__/index'
  if (fs.existsSync(path.join(source, '__automator_boot__'))) {
    throw new Error('The source project already contains __automator_boot__')
  }
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-e2e-project-')))
  const destination = path.join(directory, 'project')
  try {
    const relative = path.relative(source, destination)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      throw new Error('The temporary destination must be outside the source project')
    }
    fs.cpSync(source, destination, { recursive: true, dereference: true })
    const bootstrap = path.join(destination, '__automator_boot__')
    fs.mkdirSync(bootstrap)
    fs.writeFileSync(path.join(bootstrap, 'index.js'), 'Page({})\n')
    fs.writeFileSync(path.join(bootstrap, 'index.axml'), '<view>自动化测试准备</view>\n')
    fs.writeFileSync(path.join(bootstrap, 'index.json'), '{"defaultTitle":"自动化测试准备"}\n')
    // Replace the copied entry instead of ever writing through a source symlink.
    fs.unlinkSync(path.join(destination, 'app.json'))
    fs.writeFileSync(
      path.join(destination, 'app.json'),
      JSON.stringify({ ...config, pages: [bootstrapPath, ...config.pages] }, null, 2) + '\n',
      { flag: 'wx' },
    )
    return { directory, projectPath: destination, bootstrapPath }
  } catch (cause) {
    fs.rmSync(directory, { recursive: true, force: true })
    throw cause
  }
}

module.exports = { prepareProject }

if (require.main === module) {
  console.log(JSON.stringify(prepareProject(process.argv[2])))
}
