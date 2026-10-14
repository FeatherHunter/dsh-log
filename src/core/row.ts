// src/core/row.ts —— 落盘行：格式版本、行形状、行文本构造、字节数（领域层：零 IO）。
//
// 五键行 `{v,ts,level,event,fields}` 是 0.3.0 的对外承诺，读侧（查询/导出/快照门禁）与写侧
// （普通行、自监控行）都必须从**同一处**取形状：否则某天写侧多一个键、读侧少认一个键，
// 就是「磁盘有、查询看不见」那类缺陷的翻版（#25 的教训）。
//
// `buildRowText` 是**唯一**的行文本构造点（自监控行也走它，只是不经过队列）。

/** 落盘行格式版本：0.3.0 起为 3（五键）；0.2.x 旧行无 v 键，读侧跳过并计数。 */
export const LOG_FORMAT_VERSION = 3 as const

/** 0.3.0 落盘行形状（解析分支永远唯一：先认 v，再读其余四键）。 */
export interface LogRowV3 {
  v: 3
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
}

/**
 * 拼一行文本（含末尾换行）：五键 + JSON.stringify。
 *
 * 串化失败（循环引用、BigInt 等）回空串——调用方按「这行没写成」处理，**不许**因此抛错打断整批。
 */
export function buildRowText(level: string, event: string, fields: Record<string, unknown>): string {
  try {
    return JSON.stringify({ v: LOG_FORMAT_VERSION, ts: Date.now(), level: level, event: event, fields: fields || {} }) + '\n'
  } catch (e) {
    void e
    return ''
  }
}

/**
 * UTF-8 字节数：本包 `types: []`，不能碰 Buffer，手算即可（代理对按 4 字节）。
 *
 * 轮转阈值（`maxSize`）与单批超阈值判定都读它——算错就会「文件已经超了还不封存」。
 */
export function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i += 1
    } else n += 3
  }
  return n
}

/** 排队中的一行（= 落盘行 + 一个内部标记）。引擎与组合根都从 core 取，避免各写一份。 */
export interface QueuedRow {
  ts: number
  level: string
  event: string
  fields: Record<string, unknown>
  // 自监控行（log.persist.fail 这类内部诊断）：不占用户配额、不算进 dropped、冲突期可留在待办位
  // 等闸门解除再落盘（#19 审查必改 R3：把它算进 dropped 会把「用户丢了几行」报大）。
  isDiagnostic?: boolean
}

/** 记录电话（handleLogBatch）入参里的一条：调用方给的原始四元组，级别与事件名都还没验。 */
export interface LogEntry {
  level: string
  event: string
  fields: Record<string, unknown>
}