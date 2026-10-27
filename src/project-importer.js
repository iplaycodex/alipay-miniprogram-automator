const { waitFor, error } = require('./util')

async function renderer(inspector, expression) {
  return inspector.evaluate(`(() => {
    const windows = process.mainModule.require('electron').webContents.getAllWebContents()
      .filter(w => w.getType() === 'window' && w.getURL().includes('/mini-studio-core/out/browser/index.html'))
    if (windows.length !== 1) return null
    return windows[0].executeJavaScript(${JSON.stringify(expression)})
  })()`)
}

async function openProject(inspector, projectPath, timeout) {
  await waitFor(
    async () => {
      try {
        return await renderer(
          inspector,
          `document.readyState === 'complete' && document.body.innerText.includes('打开项目')`,
        )
      } catch (_) {
        return false
      }
    },
    { timeout, message: 'IDE startup screen did not become ready for project import' },
  )

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
    const clicked = await renderer(
      inspector,
      String.raw`(() => {
      const normalize = text => text.replace(/\s+/g, '')
      const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
      const entry = Array.from(document.querySelectorAll('*')).find(node => visible(node) && normalize(node.textContent) === '打开项目')
        || Array.from(document.querySelectorAll('button')).find(node => visible(node) && normalize(node.innerText) === '打开')
      if (!entry) return false
      entry.click()
      return true
    })()`,
    )
    if (!clicked) throw error('ERR_PROJECT_OPEN', 'IDE project import control was not found')
    await waitFor(
      async () => {
        const selected = await inspector.evaluate(
          `global.__alipayAutomatorFileChooser?.used === true`,
        )
        if (!selected) return false
        return renderer(
          inspector,
          String.raw`Array.from(document.querySelectorAll('input')).some(node => node.value === ${JSON.stringify(projectPath)}) && Array.from(document.querySelectorAll('button')).some(node => node.innerText.replace(/\s+/g, '') === '完成' && !node.disabled)`,
        )
      },
      {
        timeout,
        message: 'IDE did not accept the project directory; its import UI may have changed',
      },
    )
    const completed = await renderer(
      inspector,
      String.raw`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(node => node.innerText.replace(/\s+/g, '') === '完成')
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`,
    )
    if (!completed) throw error('ERR_PROJECT_OPEN', 'IDE project import could not be completed')
  } finally {
    await inspector
      .evaluate(
        `(() => {
      const state = global.__alipayAutomatorFileChooser
      if (state) {
        const dialog = process.mainModule.require('electron').dialog
        dialog.showOpenDialog = state.original
        dialog.showOpenDialogSync = state.originalSync
        delete global.__alipayAutomatorFileChooser
      }
      return true
    })()`,
      )
      .catch(() => {})
  }
}

module.exports = { openProject }
