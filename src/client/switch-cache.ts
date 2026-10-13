// src/client/switch-cache.ts —— 本地开关缓存（S6 从 client.ts 原样搬出）。
// 为什么单独一层：开关要在界面首屏秒显，所以先读本地存储、随后再与宿主对账；
// 这一层只管「本地那份」，与宿主通信在 client.ts 的 reconcile/setLogSwitch 里。

import type { ClientDebugSwitch, ClientStorage } from './types.js'

export interface SwitchCacheInput {
  storage: ClientStorage | null
  debugKey: string
  rev: number
}

export interface SwitchCache {
  read: () => ClientDebugSwitch
  persist: (state: ClientDebugSwitch) => boolean
}

export function createSwitchCache(input: SwitchCacheInput): SwitchCache {
  // 三个名字与搬运前的闭包自由变量同名，函数体一字不改。
  const storage = input.storage
  const debugKey = input.debugKey
  const LOG_REV = input.rev
function readLocalDebugSwitch(): ClientDebugSwitch {
    const fallback: ClientDebugSwitch = { enabled: false, rev: LOG_REV }
    try {
      if (!storage || typeof storage.getItem !== 'function') return fallback
      const raw = storage.getItem(debugKey)
      if (!raw) return fallback
      const saved = JSON.parse(raw) as { enabled?: unknown; rev?: unknown } | null
      if (!saved || typeof saved !== 'object') return fallback
      return {
        enabled: saved.enabled === true,
        rev: typeof saved.rev === 'number' && isFinite(saved.rev) ? saved.rev : LOG_REV
      }
    } catch (e) {
      void e
      return fallback
    }
  }

function persistLocalDebugSwitch(state: ClientDebugSwitch): boolean {
    try {
      if (!storage || typeof storage.setItem !== 'function') return false
      storage.setItem(
        debugKey,
        JSON.stringify({
          enabled: !!(state && state.enabled),
          rev: state && typeof state.rev === 'number' && isFinite(state.rev) ? state.rev : LOG_REV
        })
      )
      return true
    } catch (e) {
      void e
      return false
    }
  }

  return { read: readLocalDebugSwitch, persist: persistLocalDebugSwitch }
}
