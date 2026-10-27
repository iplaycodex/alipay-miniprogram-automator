import { waitFor, error } from './util'
import type { Inspector } from './inspector'

async function renderer<T = unknown>(inspector: Inspector, expression: string): Promise<T | null> {
  return inspector.evaluate<T | null>(`(() => {
    const windows = process.mainModule.require('electron').webContents.getAllWebContents()
      .filter(w => w.getType() === 'window' && w.getURL().includes('/mini-studio-core/out/browser/index.html'))
    if (windows.length !== 1) return null
    return windows[0].executeJavaScript(${JSON.stringify(expression)})
  })()`)
}

/** Send real pointer events to a visible control in this owned IDE's import window. */
async function clickControl(
  inspector: Inspector,
  selector: string,
  text: string | undefined,
  timeout: number,
): Promise<void> {
  const point = await waitFor(
    () =>
      renderer<{ x: number; y: number }>(
        inspector,
        String.raw`(() => {
      const expected = ${JSON.stringify(text)}
      const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(node => {
        const rect = node.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && (expected === undefined || node.innerText.replace(/\s+/g, '') === expected)
      })
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })()`,
      ),
    { timeout, message: `Visible IDE import control was not found: ${text || selector}` },
  )
  await inspector.evaluate(`(async () => {
    const windows = process.mainModule.require('electron').webContents.getAllWebContents()
      .filter(w => w.getType() === 'window' && w.getURL().includes('/mini-studio-core/out/browser/index.html'))
    if (windows.length !== 1) throw new Error('Expected one IDE import window')
    const target = windows[0]
    const alreadyAttached = target.debugger.isAttached()
    if (!alreadyAttached) target.debugger.attach('1.3')
    try {
      for (const event of [
        {type:'mouseMoved'},
        {type:'mousePressed',button:'left',buttons:1,clickCount:1},
        {type:'mouseReleased',button:'left',buttons:0,clickCount:1}
      ]) await target.debugger.sendCommand('Input.dispatchMouseEvent', {x:${point.x},y:${point.y},...event})
    } finally {
      if (!alreadyAttached && !target.isDestroyed() && target.debugger.isAttached()) target.debugger.detach()
    }
    return true
  })()`)
}

async function selectMiniProgramType(inspector: Inspector, timeout: number): Promise<void> {
  // IDE 3.10.5 has opened Unity projects despite displaying the mini-program default.
  // Change the unsubmitted form and explicitly select Alipay's first mini-program option.
  await clickControl(inspector, '.ant-select-selector', undefined, timeout)
  await clickControl(inspector, '.ant-select-item-option', '小程序插件', timeout)
  await clickControl(inspector, '.ant-select-selector', undefined, timeout)
  await clickControl(inspector, '.ant-select-item-option', '小程序', timeout)
  await waitFor(
    () =>
      renderer<boolean>(
        inspector,
        String.raw`document.querySelector('.ant-select-selection-item')?.innerText.replace(/\s+/g, '') === '小程序' && Array.from(document.querySelectorAll('button')).some(node => node.getBoundingClientRect().width > 0 && node.innerText.replace(/\s+/g, '') === '完成' && !node.disabled)`,
      ),
    { timeout, message: 'IDE did not commit the Alipay mini-program project type' },
  )
}

export async function openProject(
  inspector: Inspector,
  projectPath: string,
  timeout: number,
): Promise<void> {
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
    await selectMiniProgramType(inspector, timeout)
    await clickControl(inspector, 'button', '完成', timeout)
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
