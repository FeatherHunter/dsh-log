// src/config/log-names.ts —— 文件名拼装（写侧）：按天 / 四段式两套策略，按策略选一个。
// 读侧解析（认不认得出封存件）在 core/file-name.ts，两侧只共用同一个解析器，不许各写一份。

import type { ResolvedHostLogConfig } from './resolve.js'
import { assertPluginId } from './validate.js'

// 按天文件名：每个自然天一个文件，命名 YYYY-MM-DD.log（如 2026-09-06.log）。只分桶，不自动清理。
export function formatDailyFileName(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
}

// 四段式文件名（#558 Q2b 定死）：日期点插件标识点进程号点启动时间。
// 插件名取配置里的插件标识，进程号取不到时回退 0，
// 启动时间取宿主建日志库那一刻（以启动头写入的 startedAt 为准）。
// 启动时间里的冒号与斜杠在文件名里不合法，转写为中横线后才拼入。
export function formatFourSegmentFileName(
  date: Date | string | number,
  pluginId: string,
  pid: number,
  startedAt: string
): string {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const safeId = assertPluginId(pluginId, '插件标识 pluginId')
  const safePid = typeof pid === 'number' && isFinite(pid) && pid > 0 ? Math.floor(pid) : 0
  const safeStartedAt = String(startedAt || '').replace(/[:/\\]/g, '-')
  return day + '.' + safeId + '.' + safePid + '.' + safeStartedAt + '.log'
}

// 按策略算出当天文件名（默认 daily，与现状同形）。
export function resolveLogFileName(
  config: ResolvedHostLogConfig,
  date: Date | string | number,
  pid: number,
  startedAt: string
): string {
  if (config.fileNamePolicy === 'four-segment') {
    return formatFourSegmentFileName(date, config.pluginId, pid, startedAt)
  }
  return formatDailyFileName(date)
}
