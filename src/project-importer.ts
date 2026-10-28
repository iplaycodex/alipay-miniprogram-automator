import { waitFor, error } from './util'
import type { InspectorConnection } from './types'

async function renderer<T = unknown>(
  inspector: InspectorConnection,
  expression: string,
): Promise<T | null> {
  return inspector.evaluate(`(() => {
    const windows = process.mainModule.require('electron').webContents.getAllWebContents()
      .filter(w => w.getType() === 'window' && w.getURL().includes('/mini-studio-core/out/browser/index.html'))
    if (windows.length !== 1) return null
    return windows[0].executeJavaScript(${JSON.stringify(expression)})
  })()`)
}

/** Send real pointer events to a visible control in this owned IDE's import window. */
async function clickControl(
  inspector: InspectorConnection,
  selector: string,
  text: string | undefined,
  remaining: () => number,
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
    {
      timeout: remaining(),
      message: `Visible IDE import control was not found: ${text || selector}`,
    },
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

async function selectMiniProgramType(
  inspector: InspectorConnection,
  remaining: () => number,
): Promise<void> {
  // IDE 3.10.5 has opened Unity projects despite displaying the mini-program default.
  // Change the unsubmitted form and explicitly select Alipay's first mini-program option.
  await clickControl(inspector, '.ant-select-selector', undefined, remaining)
  await clickControl(inspector, '.ant-select-item-option', '小程序插件', remaining)
  await clickControl(inspector, '.ant-select-selector', undefined, remaining)
  await clickControl(inspector, '.ant-select-item-option', '小程序', remaining)
  await waitFor(
    () =>
      renderer<boolean>(
        inspector,
        String.raw`document.querySelector('.ant-select-selection-item')?.innerText.replace(/\s+/g, '') === '小程序' && Array.from(document.querySelectorAll('button')).some(node => node.getBoundingClientRect().width > 0 && node.innerText.replace(/\s+/g, '') === '完成' && !node.disabled)`,
      ),
    { timeout: remaining(), message: 'IDE did not commit the Alipay mini-program project type' },
  )
}

export async function openProject(
  inspector: InspectorConnection,
  projectPath: string,
  remaining: () => number,
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
    { timeout: remaining(), message: 'IDE startup screen did not become ready for project import' },
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
        timeout: remaining(),
        message: 'IDE did not accept the project directory; its import UI may have changed',
      },
    )
    await selectMiniProgramType(inspector, remaining)
    await clickControl(inspector, 'button', '完成', remaining)
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
