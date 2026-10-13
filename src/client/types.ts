// src/client/types.ts —— 客户端日志器的类型契约（S6 从 client.ts 原样搬出，零改写）。
// 以后谁改它：改客户端公共类型形状的人。运行期实现分别在 client.ts（组装）与后续拆出的子模块里。

import type { LogEventList } from '../config.js'
import type { PhoneNameMap } from '../config.js'



// ---- 四依赖的最小形状（调用方传入什么，本包就用什么，不自己抓全局） ----

// 宿主调用器：只用 call 一个方法（转发一批、开关读写都走它）。
export interface ClientHost {
  call: (name: string, args?: unknown) => Promise<unknown>
}



// 计时器：只用 timeout 一个方法（防抖合并与看门狗都走它，没有就回退全局函数）。
export interface ClientTimer {
  timeout: (fn: () => void, ms: number) => unknown
}



// 本地存储：只用读写两个方法（开关持久化走它，没有就每次用默认）。
export interface ClientStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}



// 开关广播：开关落定后通知全组，一个无参函数（没有就不广播，不报错）。
export type ClientBroadcast = () => void



// 建日志器时调用方传入的四个依赖（全可选，缺了走退化路，不抛错）。
export interface ClientLogDeps {
  host?: ClientHost | null
  timer?: ClientTimer | null
  // 存储：传 storage 即够；旧闭包名 localStorage 也认（迁移期兼容，两者都传以 storage 为准）。
  storage?: ClientStorage | null
  localStorage?: ClientStorage | null
  broadcastLogSwitch?: ClientBroadcast | null
  // 散列注入（0.3.0 #19：删全局裸函数，不再认 globalThis.dswsLogHash/dswsLogTrunc；
  // 如需与旧模块一字相同的截断散列，调用方把自己的散列函数经此传入；缺省用包内 hash8）。
  hashFn?: ((s: string) => string) | null
}



// ---- 配置面（只收插件标识与前缀，批量口径与存储键沿现状不参数化） ----

// 建日志器时调用方传入的配置（#19 双必填：pluginId 与 prefix 均须显式传入，缺任一即抛中文错，不回退）。
export interface ClientLogConfigInput {
  pluginId: string
  // 电话名前缀：必填，无默认，不再回退到插件标识（缺即抛中文错）。
  prefix: string
  // 事件清单注入点位（与宿主同一口径：对象当场验形状，字符串只存不解析，默认 null 零变化；
  // 客户端运行时不拿清单做字段拦截，检查跑在通用门禁里）。
  eventList?: string | Record<string, unknown> | null
}



export interface ResolvedClientLogConfig {
  pluginId: string
  prefix: string
  eventList: string | Record<string, unknown> | null
}



export interface ClientDebugSwitch {
  enabled: boolean
  rev: number
}



export interface ClientQueuedRow {
  // 落盘行格式版本（0.3.0 起为 3；读侧先认 v，v!=3 旧行跳过+计数不抛错）。
  v?: number
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
  truncated?: boolean
}



export interface ClientSendResult {
  ok: boolean
  sent: number
}



export interface ClientSwitchResult {
  ok: boolean
  enabled: boolean
}



export interface ClientSetSwitchResult {
  ok: boolean
  enabled: boolean
  error?: string
}



// 追踪三来源（0.3.0 #20+#24 写侧）：traceId 从哪来只可能是这三处之一。
// explicit=child(ctx) 显式传入；inherited=从父实例继承；auto=缺链自动建链；
// refreshed=child 每次刷新 spanId；none=尚未建链。
export type TraceSource = 'explicit' | 'inherited' | 'auto' | 'refreshed' | 'none'



export interface TraceState {
  traceId: string | null
  spanId: string | null
  // 本实例内单调序号（子实例从 0 起；无链时仍单调，用于 (seq,ts) 排序）。
  seq: number
  traceSource: TraceSource
  spanSource: TraceSource
  // 保留字冲突计数（traceId/spanId/seq 进 fields._shadow 的次数，warn 级计数）。
  shadowWarns: number
}



export interface ChildCtx {
  traceId?: unknown
  [key: string]: unknown
}



export interface TraceWhy {
  traceId: string | null
  spanId: string | null
  seq: number
  sources: { traceId: TraceSource; spanId: TraceSource; seq: string }
  shadowWarns: number
  detail: string
}



// log 函数本体 + 命名空间化挂载（log.child / log.why 与顶层 child/why 同体）。
export interface ClientLogFn {
  (level: string, event: string, fields?: Record<string, unknown>): void
  child: (ctx?: ChildCtx) => ClientLog
  why: () => TraceWhy
}



export interface LogQueryClientArgs {
  timeRange?: { start?: unknown; end?: unknown } | null
  pluginId?: unknown
  level?: unknown
  keyword?: unknown
  traceId?: unknown
  page?: { cursor?: unknown; limit?: unknown } | null
  [key: string]: unknown
}



// 日志器：工厂一次调用得到一个独立实例（内存队列、累计丢弃数、开关状态各自独立，互不串）。
// 方法名与旧模块同名同参同语义，默认配置下行为零变化。
export interface ClientLog {
  config: ResolvedClientLogConfig
  phoneNames: PhoneNameMap
  // 下面四份状态是活引用（测试与调用处可直接读，改开关请走 setLogSwitch 与 reconcileLogSwitch）。
  logSwitch: ClientDebugSwitch
  logQueue: ClientQueuedRow[]
  logDroppedState: { count: number }
  logForwardState: { lastSummaryAt: number; lastSummaryDropped: number; lastReason: string }
  logFlushTimer: { id: unknown }
  // 追踪状态活引用（traceId/spanId/seq；子实例 seq 从 0）。
  traceState: TraceState
  isEnabled: (level: string) => boolean
  log: ClientLogFn
  child: (ctx?: ChildCtx) => ClientLog
  why: () => TraceWhy
  queryLogs: (args?: LogQueryClientArgs) => Promise<unknown>
  scheduleLogFlush: (immediate: boolean) => void
  estimateBatchBytes: (entries: ClientQueuedRow[]) => number
  maybeForwardSummary: () => void
  hash8: (value: unknown) => string
  logExportFail: (op: string, reason: string, err: unknown) => void
  watchSwitchOp: (op: string, pending: unknown) => void
  sendLogBatch: () => Promise<ClientSendResult>
  flush: () => { ok: boolean }
  getDroppedCount: () => number
  readLocalDebugSwitch: () => ClientDebugSwitch
  persistLocalDebugSwitch: (state: ClientDebugSwitch) => boolean
  reconcileLogSwitch: () => Promise<ClientSwitchResult>
  setLogSwitch: (enabled: boolean) => Promise<ClientSetSwitchResult>
}
