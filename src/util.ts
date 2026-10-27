import fs from 'node:fs'
import path from 'node:path'
import type { AutomatorError, WaitOptions, WaitResult } from './types'

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function normalizePath(value: string): string {
  const resolved = path.resolve(value)
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved
}

export function error(code: string, message: string): AutomatorError {
  return Object.assign(new Error(message), { code })
}

export async function waitFor<T>(
  check: () => T,
  { timeout = 15000, interval = 100, message = 'Condition timed out' }: WaitOptions = {},
): Promise<WaitResult<T>> {
  const deadline = Date.now() + timeout
  do {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.resolve().then(check),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(error('ERR_TIMEOUT', message)), remaining)
        }),
      ])
      if (result) return result as WaitResult<T>
    } finally {
      clearTimeout(timer)
    }
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw error('ERR_TIMEOUT', message)
}
