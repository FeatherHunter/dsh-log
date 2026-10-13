// src/client/write.ts —— 主写路径：准入、腾位、记行、安排转发（S6 从 client.ts 原样搬出）。
// 口径：error/warn 与常驻事件恒放行（开关拦不住）；队列满时按级别腾位——error/warn 挤最旧普通行，
// 普通行丢新并计数（客户端无 onDrop，只记 lastReason 供转发汇总）；保留字冲突进 fields._shadow
// 并附记一行影子 warn（不占主行配额）；urgent 级别直通转发，其余 1000 毫秒防抖合并。

import { CLIENT_BATCH_INTERVAL_MS, CLIENT_QUEUE_MAX } from '../config.js'
import { findEvictableIndex } from '../core/admission.js'
import { isUrgentLevel } from '../core/level.js'
import { LOG_FORMAT_VERSION } from '../core/row.js'
import { relocateReservedFields, SHADOW_FIELD } from '../core/trace.js'
import type { ClientQueuedRow, ClientSendResult, ClientTimer } from './types.js'

// 包内不引 @types/node / DOM：全局计时函数按最小形状自己声明（与 client.ts 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

// 与 client.ts 的公开常量同源（配置面），本地取同名以免搬动函数体。
const LOG_FLUSH_MS = CLIENT_BATCH_INTERVAL_MS
const LOG_QUEUE_MAX = CLIENT_QUEUE_MAX

const RESIDENT_EVENTS: ReadonlySet<string> = new Set([
    'snapshot.request', 'snapshot.cache.miss', 'repo.resolve.tier', 'gh.exec',
    'gh.timeout', 'gh.resolve.fail', 'graphql.fallback', 'issues.fallback',
    'snapshot.built', 'panelSync.dirty', 'registry.select', 'detection.detect',
    'skill.probe', 'skill.pending.cap', 'host.call', 'host.call.fail',
    'snapshot.hydrate', 'backend.switch', 'naming.guard', 'naming.lock',
    'panel.open', 'statusbar.fallback', 'dock.rehydrate', 'storage.fail',
    'chain.derive.error', 'fallback.chain', 'client.snapshot.miss', 'host.start',
    'update.install.exec', 'labelColors.write', 'guide.inject', 'healthCheck.inject',
    'choiceStore.file.bad', 'choiceStore.write.fail', 'issues.page', 'sessionTickets.chain',
    'chain.backoff', 'host.dispatch.empty', 'naming.summary', 'cwd.persisted',
    'update.install.manifestSync',
    'git.exec', 'git.exec.fail',
  ])

export interface WriteRigInput {
  /** 开关状态（住组合根，读时取当下值）。 */
  getSwitchEnabled: () => unknown
  /** 待发队列（就地增删）。 */
  queue: ClientQueuedRow[]
  dropped: { count: number }
  /** 丢弃原因（转发汇总用）。 */
  forward: { lastReason: string }
  flushTimer: { id: unknown }
  traceState: { traceId: string | null; spanId: string | null; seq: number; shadowWarns: number }
  ensureSpanId: () => string | null
  ensureTraceForLevel: (level: string) => string | null
  sendLogBatch: () => Promise<ClientSendResult>
  timer: ClientTimer | null
}

export interface WriteRig {
  log: (level: string, event: string, fields?: Record<string, unknown>) => void
  isEnabled: (level: string, event?: string) => boolean
  dropForRoom: (level: string) => void
  scheduleLogFlush: (immediate: boolean) => void
}

export function createWriteRig(rig: WriteRigInput): WriteRig {
  // 下面这些名字与搬运前的闭包自由变量同名，函数体除开关判定外一字不改。
  const getSwitchEnabled = rig.getSwitchEnabled
  const logQueue = rig.queue
  const logDroppedState = rig.dropped
  const logForwardState = rig.forward
  const logFlushTimer = rig.flushTimer
  const traceState = rig.traceState
  const ensureSpanId = rig.ensureSpanId
  const ensureTraceForLevel = rig.ensureTraceForLevel
  const sendLogBatch = rig.sendLogBatch
  const timer = rig.timer

  // 读当前级别与事件名是否允许产生日志；关闭时调用处直接返回。错误与告警始终允许；
  // 信息级里落在常驻名单的也始终允许（#731 根因：从前只看级别，常驻信息全被开关拦掉）。
  function isEnabled(level: string, event?: string): boolean {
    if (isUrgentLevel(level)) return true
    try {
      if (typeof event === 'string' && RESIDENT_EVENTS.has(event)) return true
      return getSwitchEnabled() === true
    } catch (e) {
      void e
      return false
    }
  }

  // 队列满时按级别腾位（与宿主 store.dropForRoom 同口径：error/warn 永不丢，新到的 error/warn
  // 满时挤掉最旧普通行，全 error/warn 无普通可挤时挤掉最旧一行腾位；普通行满时直接丢新并计数；
  // 都只计数不抛错，客户端无 onDrop 回调，只记 lastReason 供转发汇总）。
  function dropForRoom(level: string): void {
    if (isUrgentLevel(level)) {
      const victim = findEvictableIndex(logQueue)
      if (victim >= 0) {
        logQueue.splice(victim, 1)
        logDroppedState.count += 1
        logForwardState.lastReason = 'queue-full'
        return
      }
      // 满且全是 error/warn、无普通可挤：为保新到的 error/warn 不丢，挤掉最旧一行腾位（仍计数）。
      if (logQueue.length > 0) {
        logQueue.splice(0, 1)
        logDroppedState.count += 1
        logForwardState.lastReason = 'queue-full'
        return
      }
    }
    logDroppedState.count += 1
    logForwardState.lastReason = 'queue-full'
  }

  // 记一行日志：体内仍先判断一次再写，做漏加外层判断的兜底；
  // 但兜底拦不住调用前已求值的拼接，所以高频调用处仍必须写外层判断，不许省略。
  // 0.3.0 追踪：保留字 traceId/spanId/seq 永不拒收——冲突重命名进 fields._shadow 并 warn 计数，
  // error 本体照落；落盘行带 v:3（读侧先认 v，v!=3 跳过+计数不抛错）。
  function log(level: string, event: string, fields?: Record<string, unknown>): void {
    if (!isEnabled(level, event)) return
    if (logQueue.length >= LOG_QUEUE_MAX) {
      dropForRoom(level)
      if (logQueue.length >= LOG_QUEUE_MAX) return
    }
    const userFields: Record<string, unknown> = fields && typeof fields === 'object' ? fields : {}
    // 保留字搬迁走 core/trace.ts 单源（#24：保留字永不整行拒收，冲突进 fields._shadow）。
    const relocated = relocateReservedFields(userFields)
    const out = relocated.fields
    const shadow = relocated.shadow
    if (shadow) {
      out[SHADOW_FIELD] = shadow
      traceState.shadowWarns += 1
      // warn 计数之外再记一行可检索的 warn 行（error 本体照落，不拒收；本行不含保留字，不递归）。
      // 影子行不占主行配额：只在富余一格以上时附记，满时舍影子保主行（影子行不挤掉主行）；
      // 舍掉的影子行不计入丢弃数（与主行丢弃计数独立，冲突次数只走 shadowWarns）。
      try {
        if (logQueue.length + 1 < LOG_QUEUE_MAX) {
          logQueue.push({
            v: LOG_FORMAT_VERSION,
            ts: Date.now(),
            level: 'warn',
            event: 'log.trace.shadow',
            fields: { event: String(event || ''), shadowed: Object.keys(shadow as Record<string, unknown>) }
          })
        }
      } catch (e2) {
        void e2
      }
    }
    // 自动建链（见 ensureTraceForLevel 注释）；序号本实例单调，子实例从 0。
    try {
      ensureTraceForLevel(level)
    } catch (e3) {
      void e3
    }
    if (traceState.traceId) {
      try {
        ensureSpanId()
      } catch (e4) {
        void e4
      }
      out.traceId = traceState.traceId
      out.spanId = traceState.spanId
    }
    try {
      out.seq = traceState.seq
      traceState.seq += 1
    } catch (e5) {
      void e5
    }
    // 主行二次容量检查：影子行已占一格时主行仍须有位；error/warn 可再挤一格保新，普通行满则丢新。
    if (logQueue.length >= LOG_QUEUE_MAX) {
      dropForRoom(level)
      if (logQueue.length >= LOG_QUEUE_MAX) return
    }
    logQueue.push({
      v: LOG_FORMAT_VERSION,
      ts: Date.now(),
      level: level,
      event: String(event || ''),
      fields: out
    })
    if (isUrgentLevel(level)) scheduleLogFlush(true)
    else scheduleLogFlush(false)
  }

  // 安排一次转发：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次等待立刻发，
  // 但调用处仍只进队列就返回，不等转发完成，崩溃窗口只剩毫秒级）。
  function scheduleLogFlush(immediate: boolean): void {
    const later = function (fn: () => void, ms: number): unknown {
      try {
        if (timer !== null && timer !== undefined && typeof timer.timeout === 'function') return timer.timeout(fn, ms)
      } catch (e) {
        void e
      }
      return setTimeout(fn, ms)
    }
    if (immediate) {
      if (logFlushTimer.id !== null) {
        try {
          clearTimeout(logFlushTimer.id)
        } catch (e) {
          void e
        }
        logFlushTimer.id = null
      }
      later(sendLogBatch, 0)
      return
    }
    if (logFlushTimer.id !== null) return
    logFlushTimer.id = later(function () {
      logFlushTimer.id = null
      sendLogBatch()
    }, LOG_FLUSH_MS)
  }

  return { log: log, isEnabled: isEnabled, dropForRoom: dropForRoom, scheduleLogFlush: scheduleLogFlush }
}
