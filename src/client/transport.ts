// src/client/transport.ts —— 转发面的纯计算与重试策略（S6 从 client.ts 原样搬出）。
// 这里不放状态：包体积估算与重试节奏是常量与纯函数，谁接线谁持有状态。

import { CLIENT_PACKET_BYTES } from '../config.js'
import type { ClientQueuedRow } from './types.js'

// 与 client.ts 的 LOG_PACKET_BYTES 同源（配置面常量），本地取同名以免搬动函数体。
const LOG_PACKET_BYTES = CLIENT_PACKET_BYTES
// 重试策略：有界重试（次数上限）+ 线性退避；到顶就如实计数，不再排程。
export const LOG_RETRY_MAX_ATTEMPTS = 3
export const LOG_RETRY_BACKOFF_MS = 500

export function estimateBatchBytes(entries: ClientQueuedRow[]): number {
    try {
      const text = JSON.stringify(entries)
      const g = globalThis as { TextEncoder?: new () => { encode: (value: string) => { length: number } } }
      if (typeof g.TextEncoder !== 'undefined') return new g.TextEncoder().encode(text).length
      return String(text).length
    } catch (e) {
      void e
      return LOG_PACKET_BYTES + 1
    }
  }
