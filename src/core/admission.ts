// src/core/admission.ts —— 准入与裁剪的「该动哪一行」（领域层：零 IO、不依赖上层）。
//
// 三处队列（宿主队列、宿主重试位、客户端队列）都要回答同一个问题：满了要腾位时该动哪一行。
// 从前 store.ts 与 client.ts 各写一遍循环（5 处），判据一样、写法不同——改一处漏一处，
// 丢行口径就分叉了（宿主与客户端对「丢谁」的说法不一致，是最难查的一类 bug）。
//
// 这里只回答「动哪一行」，不动手：splice 与计数留给调用方（宿主响 onDrop、客户端记 lastReason）。

import { isErrorLevel, isUrgentLevel } from './level.js'

// 被挤的第一顺位：**最旧的普通行**（非 error/warn）。没有普通行可挤时返 -1，由调用方决定
// 是「越过配额硬塞」（宿主：保 error/warn 不丢）还是「挤最旧一行」（客户端）。
export function findEvictableIndex(rows: readonly { level: string }[]): number {
  for (let i = 0; i < rows.length; i += 1) if (!isUrgentLevel(rows[i].level)) return i
  return -1
}

// 裁剪方向：超包裁剪从尾部裁（与修前的 pop 同序），积压裁剪从头部裁（最旧的先走）。
export type ScanDirection = 'oldest-first' | 'newest-first'

// 可裁行：只保护 error——体积与积压都能裁 warn/info/debug，error 不因体积被丢。
// 返 -1 表示没有可裁行（全 error），调用方就此收手。
export function findTrimmableIndex(rows: readonly { level: string }[], direction: ScanDirection): number {
  if (direction === 'newest-first') {
    for (let i = rows.length - 1; i >= 0; i -= 1) if (!isErrorLevel(rows[i].level)) return i
    return -1
  }
  for (let i = 0; i < rows.length; i += 1) if (!isErrorLevel(rows[i].level)) return i
  return -1
}
