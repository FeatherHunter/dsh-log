// src/core/trace.ts —— 追踪三件套的保留字与影子搬迁（领域层：零 IO、不依赖上层）。
//
// #24 契约：fields 里的 traceId/spanId/seq 是**保留字**。调用方自己传了同名键时，
// 不拒收整行，而是把冲突的值搬进 fields._shadow 并计数（error 本体照落）。
// 这条规则从前写在 client.ts 的 log() 体内，现在单源一份——谁要给别的写入路径
// （宿主侧、电话侧）也做同样的搬迁，读这里就够了，不必去抄一遍循环。

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
