// src/host/types.ts —— 宿主电话面的类型契约（S5 从 phones.ts 原样搬出，零改写）。
// 以后谁改它：改电话入参/回参形状的人。
import type { ResolvedHostLogConfig } from '../config.js'
import type { LogFileService, LogPlatform } from '../platform/ports.js'

export interface LogQueryTimeRange {
  start?: unknown
  end?: unknown
}

export interface LogQueryPageArg {
  cursor?: unknown
  limit?: unknown
}

export interface LogQueryArgs {
  timeRange?: LogQueryTimeRange | null
  pluginId?: unknown
  level?: unknown
  keyword?: unknown
  traceId?: unknown
  page?: LogQueryPageArg | null
  [key: string]: unknown
}

export interface LogQueryEntry {
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
}

export interface LogQueryResult {
  ok: boolean
  entries: LogQueryEntry[]
  denied?: boolean
  expired?: boolean
  nextCursor?: string | null
  skipped?: number
  traceChain?: boolean
}

export interface LogPhonesContext {
  fs?: LogFileService | null
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null
  DEFAULT_CWD?: string
  config: ResolvedHostLogConfig
  joinPath: (a: string, b: string) => string
  joinLogPath: (dir: string, name: string) => Promise<string>
  resolveTarget: (pathStr: string) => Promise<unknown>
  readTarget: (target: unknown) => Promise<string>
  writeTarget: (target: unknown, text: string) => Promise<unknown>
  log: (level: string, event: string, fields: Record<string, unknown>) => void
  getSwitchState: () => { enabled: boolean }
  getHeaderInfo: () => { pid: number; startedAt: string; dir: string } | null
  loadSwitch: () => Promise<{ enabled: boolean }>
  setSwitch: (enabled: boolean) => Promise<{ enabled: boolean }>
  getPid?: () => number
  getStartedAt?: () => string
  // 只读：本实例是否已被判目录冲突（非空＝冲突，值为那个目录）。冲突态下破坏性/读取路径一律降级，
  // 绝不碰共享目录（#19 审查必改 5：logClear 曾在冲突态把别人的目录删空）。
  getDirConflict?: () => string
}

export interface LogQuerySource {
  pluginId: string
  query: (args?: unknown) => Promise<unknown>
}

export interface LogQueryAggregateResult {
  ok: true
  entries: LogQueryEntry[]
  /** 本次请求里被拒的来源插件标识（调用方必须显式处理，别把空结果当健康）。 */
  denied: string[]
  expired: boolean
  /** 聚合视图不做跨源游标（合并列表随时被写盘改变，游标会重/漏）：要翻页请对单个插件查询。 */
  nextCursor: null
  skipped: number
  traceChain?: boolean
}
