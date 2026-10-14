// src/core/trace.ts —— 追踪三件套的保留字与影子搬迁（领域层：零 IO、不依赖上层）。
//
// #24 契约：fields 里的 traceId/spanId/seq 是**保留字**。调用方自己传了同名键时，
// 不拒收整行，而是把冲突的值搬进 fields._shadow 并计数（error 本体照落）。
// 这条规则从前写在 client.ts 的 log() 体内，现在单源一份——谁要给别的写入路径
// （宿主侧、电话侧）也做同样的搬迁，读这里就够了，不必去抄一遍循环。

import { genHex } from './ids.js'
import type { LogOutcome } from './outcome.js'

// 保留字：客户端追踪链路自己要用这三个键，调用方传的同名值让位。
export const RESERVED_TRACE_FIELDS = ['traceId', 'spanId', 'seq'] as const

// 让位后的落脚点：`fields._shadow.{traceId,spanId,seq}`。
export const SHADOW_FIELD = '_shadow'

export interface RelocatedFields {
  fields: Record<string, unknown>
  shadow: Record<string, unknown> | null
}

export function isReservedTraceField(key: string): boolean {
  return key === 'traceId' || key === 'spanId' || key === 'seq'
}

// 搬迁：返回「留给主行的字段」与「影子对象」（没有冲突时 shadow 为 null）。
// 整段包 try/catch：字段值可能来自带 getter 的对象，取键/取值抛错时宁可少搬字段，也绝不整行丢。
export function relocateReservedFields(userFields: Record<string, unknown>): RelocatedFields {
  const fields: Record<string, unknown> = {}
  let shadow: Record<string, unknown> | null = null
  try {
    for (const k of Object.keys(userFields)) {
      if (isReservedTraceField(k)) {
        if (!shadow) shadow = {}
        shadow[k] = userFields[k]
      } else if (k === SHADOW_FIELD) {
        // 调用方自带的 _shadow 不当普通字段：下面是它的合并规则（先来先占，保留字优先级更高）。
        continue
      } else {
        fields[k] = userFields[k]
      }
    }
    const userShadow = userFields[SHADOW_FIELD]
    if (userShadow !== undefined) {
      if (userShadow && typeof userShadow === 'object' && !Array.isArray(userShadow)) {
        if (!shadow) shadow = {}
        const src = userShadow as Record<string, unknown>
        const target = shadow
        for (const sk of Object.keys(src)) {
          if (target[sk] === undefined) target[sk] = src[sk]
        }
      } else if (!shadow) {
        // 不是对象（或没有保留字冲突）时按普通值原样保留，不吞掉调用方写的东西。
        fields[SHADOW_FIELD] = userShadow
      }
    }
  } catch (e) {
    void e
  }
  return { fields, shadow }
}

// ---- 宿主侧链上下文（0.4.0：把 #24 的约定补齐到宿主写入路径） --------------------------
//
// 为什么要有它：客户端每一行都自带链（自动建链 + child() 继承），宿主侧却只有低层
// store.log(level, event, fields) —— 字段里当然能带 traceId（fields 是原样透传的），
// 但没人负责建链、没人负责继承，「一次更新 = 一条链」只能靠调用方手抄字符串。
// 实测见 research/18 §1：宿主行手动塞 traceId 今天就能落盘、--trace 也能命中，
// 缺的是 SDK 层面的上下文与一致的保留字规则。
//
// 所有权规则（与客户端同一条）：**谁声明了链路，谁拥有保留字**。用了这个上下文，
// 调用方再传 traceId/spanId/seq 就搬进 fields._shadow（不拒收、不静默覆盖）；
// 不经上下文直接 store.log(level, event, fields) 的行一律原样透传——那是既有行为，
// 不在这条改动里悄悄改掉。

export interface HostTraceInput {
  /** 真正落行的动作：宿主侧传 `store.log`，测试可传假实现。 */
  emit: (level: string, event: string, fields: Record<string, unknown>) => LogOutcome
  /** 显式链路 id（缺省自造 16 位十六进制）。 */
  traceId?: string
  /** 显式 span id（缺省自造 8 位十六进制）。 */
  spanId?: string
  /** id 生成器（缺省 core/ids 的 genHex；测试传固定序列即可不靠随机）。 */
  genId?: (length: number) => string
}

export interface HostTrace {
  readonly traceId: string
  readonly spanId: string
  /** 保留字冲突次数（冲突值搬进 `fields._shadow`；宿主侧不额外写诊断行，行本身就是证据）。 */
  readonly shadowWarns: number
  /** 记一行：自动带 traceId/spanId/seq。被开关挡下的行**不**消耗 seq（与客户端同口径）。 */
  log: (level: string, event: string, fields?: Record<string, unknown>) => LogOutcome
  /** 下一步：换 spanId、seq 从 0 起，traceId 不变（与客户端 child() 同语义）。 */
  child: (overrides?: { traceId?: string; spanId?: string }) => HostTrace
}

export function createHostTrace(input: HostTraceInput): HostTrace {
  const genId = input.genId ?? genHex
  const traceId = input.traceId ?? genId(16)
  const spanId = input.spanId ?? genId(8)
  let seq = 0
  let shadowWarns = 0

  const trace: HostTrace = {
    get traceId(): string {
      return traceId
    },
    get spanId(): string {
      return spanId
    },
    get shadowWarns(): number {
      return shadowWarns
    },
    log(level: string, event: string, fields?: Record<string, unknown>): LogOutcome {
      const userFields: Record<string, unknown> = fields && typeof fields === 'object' ? fields : {}
      const relocated = relocateReservedFields(userFields)
      const out = relocated.fields
      if (relocated.shadow) {
        out[SHADOW_FIELD] = relocated.shadow
        shadowWarns += 1
      }
      out.traceId = traceId
      out.spanId = spanId
      const current = seq
      out.seq = current
      const outcome = input.emit(level, event, out)
      // 被开关挡下的行不算进序号（客户端同口径：skip 不消耗 seq）；丢掉/写失败的行照样消耗
      // —— 那个序号已经给出去了，回头补写会让两条行撞号。
      if (outcome !== 'skipped') seq = current + 1
      return outcome
    },
    child(overrides?: { traceId?: string; spanId?: string }): HostTrace {
      return createHostTrace({
        emit: input.emit,
        genId: genId,
        traceId: overrides?.traceId ?? traceId,
        spanId: overrides?.spanId ?? genId(8)
      })
    }
  }
  return trace
}
