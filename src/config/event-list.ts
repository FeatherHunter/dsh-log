// src/config/event-list.ts —— 事件清单（#561）：清单格式与通用检查器（离线自查用，运行期不拦行）。
//
// 一句话背景：#558 只冻了清单的注入点位（配置键 eventList），清单内部一条事件有哪些字段由本票定。
// 本票选对象形式：调用方把清单拼成对象传进来，日志包不读盘，包内永不出现仓库路径的字面量。
//
// 清单长这样（空模板见包内的 event-list.template.json）：
//
//   {
//     "version": 1,
//     "pluginId": "wf",
//     "counts": { "resident": 30, "ondemand": 20, "selfmon": 5 },
//     "events": {
//       "gh.exec": {
//         "level": "info",
//         "kind": "resident",
//         "fields": ["argv0", "cwdHash", "latencyMs", "kind", "exitCode"],
//         "codes": ["H_CWD", "B_TOKEN"],
//         "rules": ["R_TOKEN_BEARER", "R_GH_TOKEN"]
//       }
//     }
//   }
//
// 每条事件四样东西：事件名（events 的键）、级别（level）、允许字段（fields，清单内登记、自查用；
// 运行期原样透传、不裁剪）、脱敏引用（codes 是截断或散列代号、rules 是具名正则名，都是引用名，
// 命中只记规则名不记原文）。kind 说明这条归哪类计数：resident 常驻（始终落盘的轻量轨迹）、
// ondemand 按需（只在调试开关打开时记）、selfmon 自监控（日志管道自己的故障行，错误与告警级、
// 始终落盘）。guard 可选，一句话写清守卫（如百分之一采样、节流），无特殊守卫不写。
//
// 通用检查器只收对象、不读文件：checkEventFields 做字段白名单检查，lintEventFields 分「黄/红」两档
// （未知字段黄、未知事件与非法信封红），computeEventCounts 自算计数（counts 字段已删：手填的计数
// 与自算的计数核对＝同义反复）。检查器是纯函数（不跨进程、不碰磁盘、无定时器、无新电话），
// 不触发日志埋点纪律里的五种变动，所以不新增日志点。

import { EVENT_KINDS, EVENT_LEVELS } from './constants.js'
import type { LogEventKind, LogEventLevel } from './constants.js'
import { assertPluginId } from './validate.js'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function assertStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 必须是字符串数组')
  const seen: string[] = []
  for (const item of value) {
    if (!isNonEmptyString(item)) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 里有空字段名')
    if (seen.indexOf(item) >= 0) throw new Error('[dsh-log] 事件清单 eventList 非法：' + what + ' 里字段名重复：' + item)
    seen.push(item)
  }
  return seen
}

export interface LogEventEntry {
  // 级别：error、warn、info、debug 四选一。
  level: LogEventLevel
  // 归类：resident、ondemand、selfmon 三选一。
  kind: LogEventKind
  // 允许字段：该事件能记的全部字段键，清单内登记、自查用；运行期原样透传、不裁剪。
  fields: string[]
  // 脱敏引用：截断或散列代号（如 H_CWD、T120），无则不写或空数组。
  codes?: string[]
  // 脱敏引用：具名正则名（如 R_WIN_ABS），该事件无自由文本则不写或空数组。
  rules?: string[]
  // 守卫说明：一句话写清采样或节流，无特殊守卫不写。
  guard?: string
}

export interface LogEventCounts {
  resident: number
  ondemand: number
  selfmon: number
}

export interface LogEventList {
  // 清单格式版本：现在只有 1，收到别的数字直接报错。
  version: 1
  // 清单属于哪个插件：与建日志库的插件标识同一约束。
  pluginId: string
  // 自算计数：输出恒为实现自算（#18 counts删除后输入 counts 忽略，唯一真源为 computeEventCounts）。
  counts: LogEventCounts
  // 事件表：键是事件名，值是该事件的级别、归类、允许字段与脱敏引用。
  events: Record<string, LogEventEntry>
}

// 把调用方传进来的值验成可用的事件清单：错了直接报错，不静默修补。
// 字符串（路径）形式在这里就被拦下：调用方先把清单文件读成对象再传入，日志包不读盘。
// #18 counts删除：输入的 counts 缺失/不对数不再抛，忽略并自算（唯一真源为 computeEventCounts）。
export function parseEventListManifest(value: unknown): LogEventList {
  if (typeof value === 'string') {
    throw new Error('[dsh-log] 事件清单 eventList 非法：路径形式请调用方自己读成对象再传入，日志包不读盘')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：只收对象形式（空模板见包内的 event-list.template.json）')
  }
  const input = value as Record<string, unknown>
  if (input['version'] !== 1) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：version 现在只认 1（收到 ' + JSON.stringify(input['version']) + '）')
  }
  const pluginId = assertPluginId(input['pluginId'], '事件清单 pluginId')
  const eventsRaw = input['events']
  if (!eventsRaw || typeof eventsRaw !== 'object' || Array.isArray(eventsRaw)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：events 必须是事件名到条目的对象')
  }
  const events: Record<string, LogEventEntry> = {}
  for (const name of Object.keys(eventsRaw as Record<string, unknown>)) {
    events[name] = parseEventEntry(name, (eventsRaw as Record<string, unknown>)[name])
  }
  // counts 输入忽略：缺失/错数/错形一律不抛，按 events 自算（与 computeEventCounts 同口径，唯一真源）。
  const counts = computeEventCounts({ version: 1, pluginId: pluginId, counts: { resident: 0, ondemand: 0, selfmon: 0 }, events: events })
  return { version: 1, pluginId: pluginId, counts: counts, events: events }
}

// 验清单里的一条事件：级别与归类必须是枚举值，条目里不认多余的键（多半是拼写错误）。
function parseEventEntry(name: string, value: unknown): LogEventEntry {
  if (!isNonEmptyString(name)) throw new Error('[dsh-log] 事件清单 eventList 非法：事件名不能为空')
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 必须是对象')
  }
  const input = value as Record<string, unknown>
  if (EVENT_LEVELS.indexOf(input['level'] as LogEventLevel) < 0) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 level 只许 error、warn、info、debug')
  }
  if (EVENT_KINDS.indexOf(input['kind'] as LogEventKind) < 0) {
    throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 kind 只许 resident、ondemand、selfmon')
  }
  for (const key of Object.keys(input)) {
    if (['level', 'kind', 'fields', 'codes', 'rules', 'guard'].indexOf(key) < 0) {
      throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 有不认识的键 ' + key)
    }
  }
  const entry: LogEventEntry = {
    level: input['level'] as LogEventLevel,
    kind: input['kind'] as LogEventKind,
    fields: assertStringArray(input['fields'], '事件 ' + name + ' 的 fields')
  }
  if (input['codes'] !== undefined) entry.codes = assertStringArray(input['codes'], '事件 ' + name + ' 的 codes')
  if (input['rules'] !== undefined) entry.rules = assertStringArray(input['rules'], '事件 ' + name + ' 的 rules')
  if (input['guard'] !== undefined) {
    if (typeof input['guard'] !== 'string') {
      throw new Error('[dsh-log] 事件清单 eventList 非法：事件 ' + name + ' 的 guard 必须是字符串')
    }
    entry.guard = input['guard'] as string
  }
  return entry
}

export interface EventFieldCheck {
  ok: boolean
  // 事件名根本不在清单里（调用方拼错名或清单漏登记）。
  unknownEvent: boolean
  // 在清单里但不在该事件允许字段里的键。
  unknownFields: string[]
}

// 字段白名单检查：拿插件自己的清单当尺子，量一批实际字段键。
// 未知事件名、未知字段键都算不通过，并把名单带回给调用方。
export function checkEventFields(
  manifest: LogEventList,
  eventName: string,
  fieldNames: string[]
): EventFieldCheck {
  const entry = manifest.events[eventName]
  if (!entry) return { ok: false, unknownEvent: true, unknownFields: [] }
  const allowed = new Set(entry.fields)
  const unknownFields = (Array.isArray(fieldNames) ? fieldNames : []).filter(
    (field) => !allowed.has(field)
  )
  return { ok: unknownFields.length === 0, unknownEvent: false, unknownFields: unknownFields }
}

export interface LintEventFieldsResult {
  ok: boolean
  // 未知字段只黄（warn），未知事件名才红（error）；红不拦上线、不进运行期（见 #18 Q6）。
  severity: 'warn' | 'error' | 'none'
  unknownEvent: boolean
  unknownFields: string[]
}

// 离线 lint（0.3.0 门禁口径）：未知字段 warn、未知事件 error；老 checkEventFields 原样保留。
export function lintEventFields(
  manifest: LogEventList,
  eventName: string,
  fieldNames: string[]
): LintEventFieldsResult {
  const entry = manifest.events[eventName]
  if (!entry) return { ok: false, severity: 'error', unknownEvent: true, unknownFields: [] }
  const allowed = new Set(entry.fields)
  const unknownFields = (Array.isArray(fieldNames) ? fieldNames : []).filter(
    (field) => !allowed.has(field)
  )
  if (unknownFields.length === 0) return { ok: true, severity: 'none', unknownEvent: false, unknownFields: [] }
  return { ok: false, severity: 'warn', unknownEvent: false, unknownFields: unknownFields }
}

// 自算计数（#18 counts删除后的唯一真源：清单条数由实现自算，不再让人手改；parse 已调此处忽略输入 counts）。
export function computeEventCounts(manifest: LogEventList): LogEventCounts {
  const actual: LogEventCounts = { resident: 0, ondemand: 0, selfmon: 0 }
  for (const name of Object.keys(manifest.events)) {
    actual[manifest.events[name].kind] += 1
  }
  return actual
}
