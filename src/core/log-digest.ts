// src/core/log-digest.ts —— 目录摘要（领域层：纯函数、零 IO、零依赖）。
//
// 第一性原理：一份日志要能**被交出去**（贴进工单、当附件、在别人的机器上打开），就得自带
// 「这是谁写的、什么版本、什么系统、有多少行、从什么时候到什么时候」。这些事实一半能从行里
// 读出来（`host.start` 自述行、ts 范围、级别与事件分布），另一半**读不出来**——
// 旧目录没记环境自述，那就不记。
//
// 规则只有一条，也是本文件存在的理由：**读不出来的写 unknown，绝不用「读日志那个进程」的
// 环境顶替**。把读者的 cwd / 平台当成写者的事实，是写错事实，比留空更糟（research/18 §2.2）。
//
// 形状是**累加器**而不是「一次吃完整个目录」：CLI 逐文件喂进来，内存只压着一个文件，
// 目录里有几天的日志都不会把内存吃爆。

import { parseLogLine, formatLocalTime } from './read-row.js'
import { utf8Bytes } from './row.js'
import type { StartupHeader } from './startup-header.js'

export interface LogDigestFile {
  name: string
  bytes: number
  /** 能解析成本包日志行的行数。 */
  rows: number
  /** 解析不了的行数（半行、坏 JSON、audit.json 那种没有 level/event 的 JSON）。 */
  bad: number
}

export interface LogDigest {
  dir: string
  files: LogDigestFile[]
  rows: number
  bad: number
  /** 级别分布（按次数降序、同次数按名字升序，保证同一份日志每次输出一样）。 */
  byLevel: Record<string, number>
  byEvent: Record<string, number>
  firstTs: number | null
  lastTs: number | null
  header: StartupHeader | null
  logSwitch: { enabled: boolean } | null
  /** 读不出来的格子（值是 unknown 的那些），逐个点名，便于交接时说明「为什么这里是 unknown」。 */
  unknown: string[]
}

export interface LogDigestAccumulator {
  /** 喂一个文件的全文（按写入顺序喂：先旧后新）。 */
  addFile: (name: string, text: string) => void
  /** 喂开关文件的原文（读不到就传 null）。 */
  setSwitch: (text: string | null) => void
  finish: () => LogDigest
}

function countOf(map: Map<string, number>): Record<string, number> {
  const entries = Array.from(map.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const out: Record<string, number> = {}
  for (const [key, value] of entries) out[key] = value
  return out
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// 从 host.start 行里读环境自述：字段缺了就是空串（读侧如实写 unknown），不猜、不补。
function headerFromFields(fields: Record<string, unknown>): StartupHeader {
  return {
    pid: typeof fields.pid === 'number' && Number.isFinite(fields.pid) ? fields.pid : 0,
    startedAt: readString(fields.startedAt),
    dir: readString(fields.dir),
    pluginVersion: readString(fields.pluginVersion),
    os: readString(fields.os)
  }
}

/** 开关文件原文 → `{enabled}`；解析不出布尔就返回 null（= unknown，不猜）。 */
export function parseLogSwitch(text: unknown): { enabled: boolean } | null {
  if (typeof text !== 'string') return null
  let raw: unknown
  try {
    raw = JSON.parse(text.trim())
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const enabled = (raw as Record<string, unknown>).enabled
  return typeof enabled === 'boolean' ? { enabled: enabled } : null
}

export function createLogDigest(dir: string): LogDigestAccumulator {
  const files: LogDigestFile[] = []
  const byLevel = new Map<string, number>()
  const byEvent = new Map<string, number>()
  let rows = 0
  let bad = 0
  let firstTs: number | null = null
  let lastTs: number | null = null
  let header: StartupHeader | null = null
  let logSwitch: { enabled: boolean } | null = null
  let switchSeen = false

  function addFile(name: string, text: string): void {
    let fileRows = 0
    let fileBad = 0
    for (const line of text.split('\n')) {
      if (line === '') continue
      const row = parseLogLine(line)
      if (row === null) {
        fileBad += 1
        continue
      }
      fileRows += 1
      rows += 1
      byLevel.set(row.level, (byLevel.get(row.level) ?? 0) + 1)
      byEvent.set(row.event, (byEvent.get(row.event) ?? 0) + 1)
      if (row.ts > 0) {
        if (firstTs === null || row.ts < firstTs) firstTs = row.ts
        if (lastTs === null || row.ts > lastTs) lastTs = row.ts
      }
      // 自述行取**最后一条**：同一目录可能被多个实例写过，最新的那次说明最贴近现状。
      if (row.event === 'host.start') header = headerFromFields(row.fields)
    }
    bad += fileBad
    files.push({ name: name, bytes: utf8Bytes(text), rows: fileRows, bad: fileBad })
  }

  function setSwitch(text: string | null): void {
    switchSeen = true
    logSwitch = parseLogSwitch(text)
  }

  function finish(): LogDigest {
    const unknown: string[] = []
    if (header === null) unknown.push('header')
    else {
      if (header.pluginVersion === '') unknown.push('pluginVersion')
      if (header.os === '') unknown.push('os')
    }
    if (!switchSeen || logSwitch === null) unknown.push('logSwitch')
    return {
      dir: dir,
      files: files.slice(),
      rows: rows,
      bad: bad,
      byLevel: countOf(byLevel),
      byEvent: countOf(byEvent),
      firstTs: firstTs,
      lastTs: lastTs,
      header: header,
      logSwitch: logSwitch,
      unknown: unknown
    }
  }

  return { addFile: addFile, setSwitch: setSwitch, finish: finish }
}

function pairsOf(map: Record<string, number>): string {
  const keys = Object.keys(map)
  if (keys.length === 0) return '（无）'
  return keys.map((k) => `${k}=${map[k]}`).join(' ')
}

/** 摘要的人话形态（CLI 的默认输出；机器要的是 JSON 形态，见 `--json`）。 */
export function formatLogDigest(digest: LogDigest): string {
  const lines: string[] = []
  lines.push('# dsh-log 目录摘要')
  lines.push('目录: ' + (digest.dir || 'unknown'))
  lines.push('文件: ' + digest.files.length + ' 个（' + digest.rows + ' 行可解析，' + digest.bad + ' 行读不出）')
  for (const file of digest.files) {
    lines.push('  - ' + file.name + '  ' + file.bytes + ' 字节  ' + file.rows + ' 行')
  }
  if (digest.firstTs !== null && digest.lastTs !== null) {
    // 本地时区（与 `tail` 的渲染同一份格式函数）；精确时间在原始行里，摘要只负责「大概什么时候」。
    lines.push('时间: ' + formatLocalTime(digest.firstTs) + ' ~ ' + formatLocalTime(digest.lastTs))
  } else {
    lines.push('时间: unknown（没有带 ts 的行）')
  }
  lines.push('级别: ' + pairsOf(digest.byLevel))
  lines.push('事件: ' + pairsOf(digest.byEvent))
  if (digest.header === null) {
    lines.push('启动头: unknown（这个目录没有 host.start 自述行）')
  } else {
    const h = digest.header
    lines.push(
      '启动头: pid=' + h.pid +
      ' startedAt=' + (h.startedAt || 'unknown') +
      ' dir=' + (h.dir || 'unknown') +
      ' pluginVersion=' + (h.pluginVersion || 'unknown') +
      ' os=' + (h.os || 'unknown')
    )
  }
  lines.push('开关: ' + (digest.logSwitch === null ? 'unknown' : JSON.stringify(digest.logSwitch)))
  lines.push('读不出来: ' + (digest.unknown.length === 0 ? '（无）' : digest.unknown.join(', ') + '（unknown 就是没记下来，不用读者环境顶替）'))
  return lines.join('\n')
}
