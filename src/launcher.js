const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { Inspector } = require('./inspector')
const { MiniProgram, VERIFIED_IDE_VERSIONS } = require('./mini-program')
const { waitFor, error } = require('./util')

function availablePort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', cause => reject(error('ERR_IDE_PORT', `Inspector port is not available: ${cause.message}`)))
    server.listen(port, '127.0.0.1', () => {
      const selected = server.address().port
      server.close(() => resolve(selected))
    })
  })
}

async function renderer(inspector, expression) {
  return inspector.evaluate(`(() => {
    const windows = process.mainModule.require('electron').webContents.getAllWebContents()
      .filter(w => w.getType() === 'window' && w.getURL().includes('/mini-studio-core/out/browser/index.html'))
    if (windows.length !== 1) return null
    return windows[0].executeJavaScript(${JSON.stringify(expression)})
  })()`)
}

async function openProject(inspector, projectPath, timeout) {
  await waitFor(async () => {
    try { return await renderer(inspector, `document.readyState === 'complete' && document.body.innerText.includes('打开项目')`) }
    catch (_) { return false }
  }, { timeout, message: 'IDE startup screen did not become ready for project import' })

  // Select the caller-provided local directory through the IDE's normal import UI.
  // The one-shot file chooser response is scoped to this newly launched process.
  await inspector.evaluate(`(() => {
    const dialog = process.mainModule.require('electron').dialog
    const state = global.__alipayAutomatorFileChooser = { original: dialog.showOpenDialog, originalSync: dialog.showOpenDialogSync, used: false }
    const matches = args => args.some(value => value && Array.isArray(value.properties) && value.properties.includes('openDirectory'))
    dialog.showOpenDialog = function(...args) {
      if (!matches(args)) return state.original.apply(this, args)
      state.used = true
      dialog.showOpenDialog = state.original
      dialog.showOpenDialogSync = state.originalSync
      return Promise.resolve({ canceled: false, filePaths: [${JSON.stringify(projectPath)}] })
    }
    dialog.showOpenDialogSync = function(...args) {
      if (!matches(args)) return state.originalSync.apply(this, args)
      state.used = true
      dialog.showOpenDialog = state.original
      dialog.showOpenDialogSync = state.originalSync
      return [${JSON.stringify(projectPath)}]
    }
    return true
  })()`)
  try {
    const clicked = await renderer(inspector, String.raw`(() => {
      const normalize = text => text.replace(/\s+/g, '')
      const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
      const entry = Array.from(document.querySelectorAll('*')).find(node => visible(node) && normalize(node.textContent) === '打开项目')
        || Array.from(document.querySelectorAll('button')).find(node => visible(node) && normalize(node.innerText) === '打开')
      if (!entry) return false
      entry.click()
      return true
    })()`)
    if (!clicked) throw error('ERR_PROJECT_OPEN', 'IDE project import control was not found')
    await waitFor(async () => {
      const selected = await inspector.evaluate(`global.__alipayAutomatorFileChooser?.used === true`)
      if (!selected) return false
      return renderer(inspector, String.raw`Array.from(document.querySelectorAll('input')).some(node => node.value === ${JSON.stringify(projectPath)}) && Array.from(document.querySelectorAll('button')).some(node => node.innerText.replace(/\s+/g, '') === '完成' && !node.disabled)`)
    }, { timeout, message: 'IDE did not accept the project directory; its import UI may have changed' })
    const completed = await renderer(inspector, String.raw`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(node => node.innerText.replace(/\s+/g, '') === '完成')
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    if (!completed) throw error('ERR_PROJECT_OPEN', 'IDE project import could not be completed')
  } finally {
    await inspector.evaluate(`(() => {
      const state = global.__alipayAutomatorFileChooser
      if (state) {
        const dialog = process.mainModule.require('electron').dialog
        dialog.showOpenDialog = state.original
        dialog.showOpenDialogSync = state.originalSync
        delete global.__alipayAutomatorFileChooser
      }
      return true
    })()`).catch(() => {})
  }
}

/** Launch the installed IDE with an isolated profile and import a native Alipay project. */
async function launch(options = {}) {
  const timeout = options.timeout || 90000
  if (!options.projectPath) throw error('ERR_OPTIONS', 'launch requires projectPath containing the Alipay build output')
  const projectPath = path.resolve(options.projectPath)
  if (!fs.existsSync(path.join(projectPath, 'app.json')) || !fs.existsSync(path.join(projectPath, 'app.js'))) {
    throw error('ERR_OPTIONS', 'projectPath must contain app.json and app.js; compile framework projects with the alipay target first')
  }
  const idePath = options.idePath || (process.platform === 'darwin' ? '/Applications/小程序开发者工具.app/Contents/MacOS/小程序开发者工具' : null)
  if (!idePath || !fs.existsSync(idePath)) throw error('ERR_OPTIONS', 'Installed Alipay IDE executable was not found; pass idePath')
  const port = await availablePort(options.port)
  let profilePath = options.profilePath ? path.resolve(options.profilePath) : fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-automator-'))
  fs.mkdirSync(profilePath, { recursive: true })
  profilePath = fs.realpathSync(profilePath)
  const logPath = path.resolve(options.logPath || path.join(profilePath, 'ide.log'))
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  const log = fs.openSync(logPath, 'a')
  let child
  try {
    child = spawn(idePath, [`--inspect=127.0.0.1:${port}`, `--user-data-dir=${profilePath}`], {
      cwd: projectPath, detached: process.platform !== 'win32', stdio: ['ignore', log, log]
    })
  } finally { fs.closeSync(log) }
  let startError
  child.on('error', cause => { startError = cause })
  let inspector
  const checkProcess = () => {
    if (startError) throw startError
    if (child.exitCode !== null || child.signalCode !== null) throw error('ERR_IDE_EXIT', `IDE exited before startup; see ${logPath}`)
  }
  try {
    inspector = await waitFor(async () => {
      checkProcess()
      try { return await Inspector.connect({ port, timeout: 1000 }) } catch (_) { return null }
    }, { timeout, message: `IDE inspector did not start; see ${logPath}` })
    const actual = await waitFor(async () => {
      checkProcess()
      try {
        return await inspector.evaluate(`(() => {
          if (!process.mainModule?.require) return null
          const app = process.mainModule.require('electron').app
          return app.isReady() ? {pid:process.pid,profilePath:app.getPath('userData'),ideVersion:app.getVersion()} : null
        })()`)
      } catch (_) { return null }
    }, { timeout, message: `IDE main process did not initialize; see ${logPath}` })
    if (actual.pid !== child.pid || path.resolve(actual.profilePath) !== profilePath) throw error('ERR_IDE_PROCESS', 'Launched IDE identity did not match the isolated process')
    if (!options.allowUnverifiedVersion && !VERIFIED_IDE_VERSIONS.includes(actual.ideVersion)) {
      throw error('ERR_UNSUPPORTED_IDE', `IDE ${actual.ideVersion} is unverified; tested: ${VERIFIED_IDE_VERSIONS.join(', ')}. Set allowUnverifiedVersion to try explicitly.`)
    }
    await openProject(inspector, projectPath, timeout)
    inspector.close()
    inspector = null
    const miniProgram = await waitFor(async () => {
      checkProcess()
      try {
        return await MiniProgram.connect({ ...options, port, profilePath, idePid: child.pid, timeout: Math.min(timeout, 15000) })
      } catch (cause) {
        if (['ERR_UNSUPPORTED_IDE', 'ERR_IDE_PROFILE', 'ERR_IDE_PROCESS'].includes(cause.code)) throw cause
        return null
      }
    }, { timeout, message: `IDE simulator did not start; see ${logPath}` })
    miniProgram._owned = { child, profilePath, port, logPath }
    miniProgram.info.inspectorPort = port
    miniProgram.info.projectPath = projectPath
    miniProgram.info.logPath = logPath
    try {
      await miniProgram.waitFor(async () => {
        try { return await miniProgram.currentPage() } catch (_) { return null }
      }, { timeout, message: `Mini-program did not load; see ${logPath}` })
    } catch (cause) { await miniProgram.close(); throw cause }
    return miniProgram
  } catch (cause) {
    inspector?.close()
    try {
      if (process.platform === 'win32') child.kill('SIGTERM')
      else process.kill(-child.pid, 'SIGTERM')
    } catch (_) {}
    throw cause
  }
}

module.exports = { launch }
