// src/client/forward.ts —— 转发面的自监控（S6 从 client.ts 原样搬出）。
// 三件事：丢弃汇总行（有新增丢弃才记一行）、导出失败行（只散列不记原文）、开关看门狗（5 秒未落定记一行）。
// 都不改变主流程的返回值：只旁观、只记录，失败自己吞掉。

import { hash8 } from '../core/ids.js'
import type { ClientTimer } from './types.js'

export interface ForwardState {
  lastSummaryAt: number
  lastSummaryDropped: number
  lastReason: string
  lastAccepted: number
  lastSkipped: number
  lastRejected: number
}

export interface ForwardStageInput {
  /** 记一行诊断行（write 面的 logDiagnostic：同一条队列，但丢弃计数不算用户行）。 */
  logDiagnostic: (level: string, event: string, fields: Record<string, unknown>) => void
  /** 累计丢弃数（只读）。 */
  dropped: { count: number }
  /** 汇总状态（就地更新）。 */
  forward: ForwardState
  timer: ClientTimer | null
  watchdogMs: number
  /** 调用方注入的散列（缺省用包内 hash8）：只记指纹、不记原文。 */
  hashFn: ((s: string) => string) | null
}

export interface ForwardStage {
  maybeForwardSummary: () => void
  logExportFail: (op: string, reason: string, err: unknown) => void
  watchSwitchOp: (op: string, pending: unknown) => void
}

export function createForwardStage(input: ForwardStageInput): ForwardStage {
  // 下面这些名字与搬运前的闭包自由变量同名，函数体一字不改（只有 logExportFail 的 hashFn 一行刻意改写，见上）。
  const logDiagnostic = input.logDiagnostic
  const logDroppedState = input.dropped
  const logForwardState = input.forward
  const timer = input.timer
  const LOG_WATCHDOG_MS = input.watchdogMs
  const hashFn = input.hashFn
  // 转发汇总行：批量发送落定后，有新增丢弃才记一行；无丢弃的窗口不打扰。
  // 汇总行本身走告警直通再触发下一次发送，下一次无新增丢弃即止，链条自然终止。
  // 字段带上宿主最近一次回包的 accepted/skipped/rejected（#26 验收线 A1：宿主如实报了，
  // 客户端就不能把它塌成一个布尔——「收了几行、按开关跳了几行、拒了几行」要在日志里看得见）。
  // 未知（宿主没回这个键）时不写该键，不给读者一个假的 0。
  function maybeForwardSummary(): void {
    const delta = logDroppedState.count - logForwardState.lastSummaryDropped
    if (delta <= 0) return
    logForwardState.lastSummaryDropped = logDroppedState.count
    const now = Date.now()
    const windowMs = now - logForwardState.lastSummaryAt
    logForwardState.lastSummaryAt = now
    const fields: Record<string, unknown> = {
      droppedDelta: delta,
      totalDropped: logDroppedState.count,
      reason: logForwardState.lastReason || 'send-fail',
      windowMs: windowMs
    }
    if (logForwardState.lastAccepted >= 0) fields.accepted = logForwardState.lastAccepted
    if (logForwardState.lastSkipped >= 0) fields.skipped = logForwardState.lastSkipped
    if (logForwardState.lastRejected >= 0) fields.rejected = logForwardState.lastRejected
    try {
      logDiagnostic('warn', 'log.forward.summary', fields)
    } catch (e) {
      void e
    }
  }
  // 散列小函数已下沉 core/ids.ts（hash8 单源：不记原文，只记指纹）。
  // 导出链路行：状态栏菜单与设置页两处复用；成功路径不调用，失败分支才记一行。
  // 0.3.0（#19）：删全局裸函数，不再认 globalThis.dswsLogHash/dswsLogTrunc；
  // 改为经 ClientLogDeps 可选注入 hashFn?(s:string)=>string，缺省用包内 hash8。
  // 截断固定为前 120 字切片（旧 trunc 注入位不再保留），只散列不记原文。
  function logExportFail(op: string, reason: string, err: unknown): void {
    try {
      const hash = (hashFn && typeof hashFn === 'function' ? hashFn : hash8) as (s: string) => string
      const raw = err && typeof err === 'object' && 'message' in (err as Record<string, unknown>)
        ? String((err as { message?: unknown }).message)
        : String(err || reason)
      const sliced = String(raw || '').slice(0, 120)
      let hashed = ''
      try {
        hashed = hash(sliced)
      } catch (eH) {
        void eH
        hashed = hash8(sliced)
      }
      logDiagnostic('warn', 'log.export.fail', { op: op, reason: reason, errorHash: hashed })
    } catch (e) {
      void e
    }
  }
  // 开关看门狗：操作与 5 秒计时竞跑，计时先到记一行告警；原调用不取消、不重试、不改返回值。
  function watchSwitchOp(op: string, pending: unknown): void {
    let settled = false
    try {
      if (pending && typeof (pending as Promise<unknown>).then === 'function') {
        ;(pending as Promise<unknown>).then(
          function () {
            settled = true
          },
          function () {
            settled = true
          }
        )
      }
    } catch (e) {
      void e
    }
    const fire = function (): void {
      if (!settled) {
        settled = true
        try {
          logDiagnostic('warn', 'log.switch.watchdog', { op: op, timeoutMs: LOG_WATCHDOG_MS, stage: 'waiting-host' })
        } catch (e) {
          void e
        }
      }
    }
    try {
      if (timer !== null && timer !== undefined && typeof timer.timeout === 'function') {
        timer.timeout(fire, LOG_WATCHDOG_MS)
        return
      }
    } catch (e) {
      void e
    }
    try {
      setTimeout(fire, LOG_WATCHDOG_MS)
    } catch (e2) {
      void e2
    }
  }

  return {
    maybeForwardSummary: maybeForwardSummary,
    logExportFail: logExportFail,
    watchSwitchOp: watchSwitchOp
  }
}