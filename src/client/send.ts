// src/client/send.ts —— 发送面：取批、裁剪、发、重试位（S6 从 client.ts 原样搬出）。
// 口径（0.3.0 Track 1）：失败先进重试位、有界重试（次数上限 + 线性退避），到顶才如实计数；
// 宿主明确拒收时只算它拒的那几行，传输失败才算整批——「一行被拒」不再报成「整批丢」。
// 裁剪分级保 error：单包超限或队列积压都只裁普通行，error 行不被裁掉。

import { CLIENT_BATCH_MAX, CLIENT_PACKET_BYTES, CLIENT_QUEUE_MAX } from '../config.js'
import { findTrimmableIndex } from '../core/admission.js'
import type { PhoneNameMap } from '../config.js'
import { estimateBatchBytes, LOG_RETRY_BACKOFF_MS, LOG_RETRY_MAX_ATTEMPTS } from './transport.js'
import type { ForwardState } from './forward.js'
import type { ClientHost, ClientQueuedRow, ClientSendResult, ClientTimer } from './types.js'

// 包内不引 @types/node / DOM：全局计时函数按最小形状自己声明（与 client.ts 同口径）。
declare function clearTimeout(handle: unknown): void

// 与 client.ts 的公开常量同源（配置面），本地取同名以免搬动函数体。
const LOG_BATCH_MAX = CLIENT_BATCH_MAX
const LOG_PACKET_BYTES = CLIENT_PACKET_BYTES
const LOG_QUEUE_MAX = CLIENT_QUEUE_MAX

export interface SendRigInput {
  host: ClientHost | null
  phoneNames: PhoneNameMap
  /** 待发队列（就地取批）。 */
  queue: ClientQueuedRow[]
  /** 重试位与重试计数（就地更新）。 */
  retry: { rows: ClientQueuedRow[]; rejectCount: number; attempts: number; timer: unknown }
  dropped: { count: number }
  forward: ForwardState
  flushTimer: { id: unknown }
  timer: ClientTimer | null
  log: (level: string, event: string, fields: Record<string, unknown>) => void
  laterRun: (fn: () => void, ms: number) => unknown
  maybeForwardSummary: () => void
  scheduleLogFlush: (immediate: boolean) => void
}

export interface SendRig {
  sendLogBatch: () => Promise<ClientSendResult>
  flush: () => { ok: boolean }
  getDroppedCount: () => number
}

export function createSendRig(rig: SendRigInput): SendRig {
  // 下面这些名字与搬运前的闭包自由变量同名，函数体一字不改。
  const host = rig.host
  const phoneNames = rig.phoneNames
  const logQueue = rig.queue
  const logRetryState = rig.retry
  const logDroppedState = rig.dropped
  const logForwardState = rig.forward
  const logFlushTimer = rig.flushTimer
  const timer = rig.timer
  const log = rig.log
  const laterRun = rig.laterRun
  const maybeForwardSummary = rig.maybeForwardSummary
  const scheduleLogFlush = rig.scheduleLogFlush
  // 失败落定：能重试就排一次退避重试（次数有界），到顶才如实计入丢弃并清空重试位。
  // 计数口径（诚实）：宿主明确拒收时只算它拒的那几行（rejected），传输失败才算整批。
  function settleSendFailure(reason: string, entries: ClientQueuedRow[], onlySummary: boolean): ClientSendResult {
    logForwardState.lastReason = reason
    if (logRetryState.attempts < LOG_RETRY_MAX_ATTEMPTS) {
      logRetryState.rows = entries.slice()
      logRetryState.attempts += 1
      if (logRetryState.timer === null) {
        const wait = LOG_RETRY_BACKOFF_MS * logRetryState.attempts
        logRetryState.timer = laterRun(function () {
          logRetryState.timer = null
          try {
            sendLogBatch()
          } catch (e) {
            void e
          }
        }, wait)
      }
    } else {
      const rc = logRetryState.rejectCount
      logDroppedState.count += rc >= 0 ? Math.min(rc, entries.length) : entries.length
      logRetryState.rows = []
      logRetryState.rejectCount = -1
      logRetryState.attempts = 0
    }
    if (!onlySummary) maybeForwardSummary()
    return { ok: false, sent: 0 }
  }
  // 发一批：一次最多 50 条；单包超 128KB 或队列超 100 条时先到先截，
  // 裁掉的记入丢弃数并在包尾最后一条记截断标记；失败进重试位（有界重试），到顶才记丢弃。
  // 重试位优先发：里面是更早的行，先发它们才不乱序。
  function sendLogBatch(): Promise<ClientSendResult> {
    let entries: ClientQueuedRow[]
    if (logRetryState.rows.length > 0) {
      entries = logRetryState.rows.splice(0, LOG_BATCH_MAX)
    } else {
      if (logQueue.length === 0) return Promise.resolve({ ok: true, sent: 0 })
      entries = logQueue.splice(0, LOG_BATCH_MAX)
    }
    let trimmed = 0
    // 超包裁剪分级保 error：error 行不被裁掉，只裁普通行（warn/info/debug 均为可裁行）；
    // 尾部优先（与修前 pop 同序，全普通行时与修前一字不差）；全 error 超包也不裁，整包发出。
    while (entries.length > 1 && estimateBatchBytes(entries) > LOG_PACKET_BYTES) {
      const victim = findTrimmableIndex(entries, 'newest-first')
      if (victim < 0) break
      entries.splice(victim, 1)
      trimmed += 1
    }
    // 队列里还压着超过 100 条说明消费跟不上：只留 100 条，其余丢弃并计数（不无界缓冲）。
    // 积压裁剪同样分级保 error：只裁最旧普通行，全 error 积压也不裁。
    while (logQueue.length > LOG_QUEUE_MAX) {
      const victim = findTrimmableIndex(logQueue, 'oldest-first')
      if (victim < 0) break
      logQueue.splice(victim, 1)
      trimmed += 1
    }
    if (trimmed > 0) {
      logDroppedState.count += trimmed
      logForwardState.lastReason = 'packet-trim'
      try {
        entries[entries.length - 1].truncated = true
      } catch (e) {
        void e
      }
    }
    const args = { entries: entries, droppedCount: logDroppedState.count }
    // 防自激：这一批如果只剩上一行汇总自己，失败只计数不再记新汇总，否则汇总会自己养活自己停不下来。
    const onlySummary = entries.length === 1 && entries[0] && entries[0].event === 'log.forward.summary'
    if (!host || typeof host.call !== 'function') {
      // 压根没有宿主可发（不是暂时不可用）：重试没意义，如实整批计数。
      logDroppedState.count += entries.length
      logForwardState.lastReason = 'send-fail'
      if (!onlySummary) maybeForwardSummary()
      return Promise.resolve({ ok: false, sent: 0 })
    }
    try {
      return host
        .call(phoneNames.logBatch, args)
        .then(function (res: unknown) {
          const obj = res && typeof res === 'object' ? (res as { ok?: unknown; accepted?: unknown; skipped?: unknown; rejected?: unknown }) : null
          const ok = !!obj && obj.ok === true
          // 三档计数一律先过「是不是可信的非负整数」这一关：不可信就记 -1（未知），不许编。
          const countOf = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : -1)
          const acceptedRaw = countOf(obj ? obj.accepted : undefined)
          const skippedRaw = countOf(obj ? obj.skipped : undefined)
          const rejectedRaw = countOf(obj ? obj.rejected : undefined)
          // 宿主如实报了三档计数（accepted/skipped/rejected）：照原样存下来给汇总行用，
          // 不许再塌成一个布尔（#26 D2：一行被拒曾报成整批丢）。
          logForwardState.lastAccepted = acceptedRaw
          logForwardState.lastSkipped = skippedRaw
          // 被拒条数：宿主报了就用它（夹在 0..entries.length 内）；**没报或报 0 却回了 ok:false** 时，
          // 用 entries.length - accepted 兜底，两个数都不可信才按整批计——宁可多算丢，也绝不允许
          // 「整批行被丢掉了而丢弃计数不动」（2026-10-14 终局审查 277d5b3e 必改 3：非规范宿主
          // 回 {ok:false} 时是静默丢账）。
          let rejected =
            rejectedRaw > 0 ? Math.min(rejectedRaw, entries.length) : 0
          if (!ok && rejected === 0) {
            rejected =
              acceptedRaw >= 0 ? Math.max(0, Math.min(entries.length - acceptedRaw, entries.length)) : entries.length
          }
          logForwardState.lastRejected = rejected
          if (ok && rejected === 0) {
            logRetryState.attempts = 0
            logRetryState.rejectCount = -1
            maybeForwardSummary()
            return { ok: true, sent: entries.length }
          }
          // 宿主回包说「有行没进队列」：按它说的数记下来（回包诚实计数 R1 的客户端一半——从前一律
          // 按整批计，一行被拒报成整批丢），这批仍进重试位：宿主队列满通常是暂时的。
          logRetryState.rejectCount = rejected
          return settleSendFailure('host-reject', entries, onlySummary)
        })
        .catch(function () {
          return settleSendFailure('send-fail', entries, onlySummary)
        })
    } catch (e) {
      void e
      return Promise.resolve(settleSendFailure('send-fail', entries, onlySummary))
    }
  }
  // 立刻转发一次（取消本次防抖等待）；客户端侧的 flush 只管转发，不管落盘。
  function flush(): { ok: boolean } {
    if (logFlushTimer.id !== null) {
      try {
        clearTimeout(logFlushTimer.id)
      } catch (e) {
        void e
      }
      logFlushTimer.id = null
    }
    try {
      sendLogBatch()
    } catch (e) {
      void e
    }
    return { ok: true }
  }
  // 读累计丢弃数（队列满与转发失败都只计数不抛错，与宿主同名同参）。
  function getDroppedCount(): number {
    return logDroppedState.count
  }

  return { sendLogBatch: sendLogBatch, flush: flush, getDroppedCount: getDroppedCount }
}
