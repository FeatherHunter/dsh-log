// src/platform/timer-node.ts —— Node 全局定时函数适配器。

import type { LogTimer } from './ports.js'

/** 用 Node 的全局定时函数拼出日志包要的计时器形状。 */
export function createNodeTimer(): LogTimer {
  return {
    timeout: (fn: (...args: unknown[]) => void, ms: number) => setTimeout(fn, ms)
  }
}
