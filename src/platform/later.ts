// src/platform/later.ts —— 「稍后执行一次」的计时器适配（平台层）。
//
// 为什么单列一处：引擎（刷盘防抖/退避）与组合根（等目录租约的预算轮询）都需要它，
// 两边各写一份就会各自漂移（一处 unref 了、另一处没 unref，进程退出行为就不一样）。
//
// 只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（本包 `types: []`）。
import type { LogTimer } from './ports.js'

declare function setTimeout(fn: () => void, ms: number): unknown

/** 造一个 `later(fn, ms)`：优先用注入的计时器（宿主可 unref），否则退回全局 setTimeout。 */
export function createLater(timer?: LogTimer | null): (fn: () => void, ms: number) => unknown {
  return function later(fn: () => void, ms: number): unknown {
    try {
      if (timer !== undefined && timer !== null && typeof timer.timeout === 'function') {
        return timer.timeout(fn, ms)
      }
    } catch (e) {
      void e
    }
    return setTimeout(fn, ms)
  }
}
