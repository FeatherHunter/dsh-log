// src/config/resolve.ts —— 建库配置的入参形状与补齐（#18 双必填：pluginId 与 prefix 缺一即抛中文错，不再回退）。
// 对象形式的 eventList 当场验形状（错了直接报错）；字符串（路径）形式只存不解析——日志包不读盘。

import type { FileNamePolicy } from '../core/file-name.js'
import { DEFAULT_MAX_DAYS, DEFAULT_MAX_QUEUE, DEFAULT_MAX_SIZE, LEGACY_LOG_DIR_NAME, LEGACY_SWITCH_FILE_NAME } from './constants.js'
import { parseEventListManifest } from './event-list.js'
import { assertPluginId } from './validate.js'

// 建日志库时调用方传入的配置（#18 双必填：插件标识 pluginId 与电话名前缀 prefix 均须显式传入，
// 缺任一即抛中文错；旧回退已删（旧前缀回退到标识、旧标识回退到默认已删，旧字面仅注释保留：如 'wf'）。
// 其余全可选且有默认值）。
export interface HostLogConfigInput {
  // 插件标识：必填，无默认。只能用小写英文字母、数字、中横线，长度 1 到 32。
  pluginId: string
  // 电话名前缀：必填，无默认，不再回退到插件标识（#18 双必填，缺即抛中文错）。
  // 约束与插件标识相同。
  prefix: string
  // 日志子目录名：默认派生，标识为 wf 时为 logs，其他标识时为 logs 加中横线加标识。允许显式覆盖。
  logDirName?: string
  // 开关文件名：默认派生，标识为 wf 时为 log-switch.json，
  // 其他标识时为 log-switch 加中横线加标识再加 .json。允许显式覆盖。
  switchFileName?: string
  // 文件名策略：默认 daily。四段式只作可选项。
  fileNamePolicy?: FileNamePolicy
  // 宿主内存队列上限：默认 1000 条。
  maxQueue?: number
  // 单文件封存阈值（字节，默认 5MB，见 DEFAULT_MAX_SIZE）：当日可写文件超过它就立封为
  // `<prefix>-YYYY-MM-DD.N.log`，另起一份当日的空文件继续写（#21 轮转，抄 daily-rotate-file 语义）。
  maxSize?: number
  // 保留天数（默认 14，含当日，见 DEFAULT_MAX_DAYS）：按文件名里的日期判断，早于 N 天前的封存件清掉。
  // 口径是「天」不是「文件数」：一天里封存 N 份也不会因此误清最近的 error 文件。
  maxDays?: number
  // 事件清单注入点位（#558 冻结的是点位本身：文件路径或对象两种方式二选一，本票 #561 定为对象形式；
  // 清单内部一条事件有哪些字段见本文件下方的事件清单一节）。
  // 传对象当场验形状，错了直接报错；传字符串（路径）只存不解析，由调用方自己读成对象再传入，
  // 日志包不读盘；不传为 null（当前插件主路径），行为零变化。
  eventList?: string | Record<string, unknown>
}

// 生效后的完整配置（无可选，调用处不再分支）。
export interface ResolvedHostLogConfig {
  pluginId: string
  prefix: string
  logDirName: string
  switchFileName: string
  fileNamePolicy: FileNamePolicy
  maxQueue: number
  maxSize: number
  maxDays: number
  eventList: string | Record<string, unknown> | null
}

// 客户端配置（#18 双必填：pluginId 与 prefix 均须显式传入，缺任一即抛中文错；旧回退已删，旧字面仅注释保留：如 'wf'）。
// 注：client.ts 内同名函数须同步为此口径（本文件为真源，client.ts 仅转调；未改前以本文件为准探针）。
export interface ClientLogConfigInput {
  pluginId: string
  prefix: string
  eventList?: string | Record<string, unknown> | null
}

export interface ResolvedClientLogConfig {
  pluginId: string
  prefix: string
  eventList: string | Record<string, unknown> | null
}

// 把调用方传入的配置补齐为完整配置（#18 双必填：pluginId 与 prefix 缺一即抛中文错，不再回退；
// 其余缺省走 #558 默认派生；非法才抛错。旧回退已删，旧字面仅注释保留：如 'wf'）。
export function resolveHostLogConfig(input: HostLogConfigInput): ResolvedHostLogConfig {
  if (!input || typeof input !== 'object') throw new Error('[dsh-log] 建日志库缺少配置：插件标识 pluginId 与电话名前缀 prefix 双必填，均须显式传入')
  const raw = input as unknown as Record<string, unknown>
  if (raw['pluginId'] === undefined || raw['pluginId'] === null) throw new Error('[dsh-log] 建日志库缺少配置：插件标识 pluginId 必填（须显式传入，不再回退）')
  if (raw['prefix'] === undefined || raw['prefix'] === null) throw new Error('[dsh-log] 建日志库缺少配置：电话名前缀 prefix 必填（须显式传入，不再回退到 pluginId）')
  const pluginId = assertPluginId(input.pluginId, '插件标识 pluginId')
  const prefix = assertPluginId(input.prefix, '电话名前缀 prefix')
  // 目录与开关文件名默认派生（非 #18 回退：此处 'wf' 分支是 legacy 兼容派生，非缺参回退，缺参已在上抛错）；
  const logDirName =
    input.logDirName !== undefined
      ? input.logDirName
      : pluginId === 'wf'
        ? LEGACY_LOG_DIR_NAME
        : LEGACY_LOG_DIR_NAME + '-' + pluginId
  const switchFileName =
    input.switchFileName !== undefined
      ? input.switchFileName
      : pluginId === 'wf'
        ? LEGACY_SWITCH_FILE_NAME
        : 'log-switch-' + pluginId + '.json'
  const fileNamePolicy = input.fileNamePolicy === undefined ? 'daily' : input.fileNamePolicy
  if (fileNamePolicy !== 'daily' && fileNamePolicy !== 'four-segment') {
    throw new Error('[dsh-log] 文件名策略 fileNamePolicy 非法：只许 daily 或 four-segment')
  }
  const maxQueue = input.maxQueue === undefined ? DEFAULT_MAX_QUEUE : input.maxQueue
  if (typeof maxQueue !== 'number' || !isFinite(maxQueue) || maxQueue < 1) {
    throw new Error('[dsh-log] 内存队列上限 maxQueue 非法：必须是不小于 1 的数字')
  }
  const maxSize = input.maxSize === undefined ? DEFAULT_MAX_SIZE : input.maxSize
  if (typeof maxSize !== 'number' || !isFinite(maxSize) || maxSize < 1) {
    throw new Error('[dsh-log] 单文件封存阈值 maxSize 非法：必须是不小于 1 的数字（单位字节）')
  }
  const maxDays = input.maxDays === undefined ? DEFAULT_MAX_DAYS : input.maxDays
  if (typeof maxDays !== 'number' || !isFinite(maxDays) || maxDays < 1) {
    throw new Error('[dsh-log] 保留天数 maxDays 非法：必须是不小于 1 的数字（含当日）')
  }
  let eventList: string | Record<string, unknown> | null = input.eventList === undefined ? null : input.eventList
  if (eventList !== null && typeof eventList === 'object') {
    // 对象形式的清单当场验形状，错了直接报错（与插件标识非法的处理一致）；
    // 数组形式同样走验形口径被拦下（只收对象，数组多半是把事件表直接当成了清单）；
    // 字符串（路径）形式仍只存不解析，由调用方自己读成对象再传入，日志包不读盘；
    // 默认 null 原样透过；#18 counts删除：对象存自算后清单（输入 counts 忽略，输出恒为自算）。
    eventList = parseEventListManifest(eventList) as unknown as Record<string, unknown>
  }
  return {
    pluginId: pluginId,
    prefix: prefix,
    logDirName: logDirName,
    switchFileName: switchFileName,
    fileNamePolicy: fileNamePolicy,
    maxQueue: Math.floor(maxQueue),
    maxSize: Math.floor(maxSize),
    maxDays: Math.floor(maxDays),
    eventList: eventList
  }
}

// 客户端配置补齐（#18 双必填口径与宿主一致）。
export function resolveClientLogConfig(input: ClientLogConfigInput): ResolvedClientLogConfig {
  if (!input || typeof input !== 'object') throw new Error('[dsh-log] 建客户端日志库缺少配置：插件标识 pluginId 与电话名前缀 prefix 双必填，均须显式传入')
  const raw = input as unknown as Record<string, unknown>
  if (raw['pluginId'] === undefined || raw['pluginId'] === null) throw new Error('[dsh-log] 建客户端日志库缺少配置：插件标识 pluginId 必填（须显式传入，不再回退）')
  if (raw['prefix'] === undefined || raw['prefix'] === null) throw new Error('[dsh-log] 建客户端日志库缺少配置：电话名前缀 prefix 必填（须显式传入，不再回退到 pluginId）')
  const pluginId = assertPluginId(input.pluginId, '插件标识 pluginId')
  const prefix = assertPluginId(input.prefix, '电话名前缀 prefix')
  let eventList: string | Record<string, unknown> | null = (input as { eventList?: unknown }).eventList === undefined ? null : (input as { eventList?: string | Record<string, unknown> | null }).eventList as string | Record<string, unknown> | null
  if (eventList !== null && typeof eventList === 'object') {
    eventList = parseEventListManifest(eventList) as unknown as Record<string, unknown>
  }
  return { pluginId: pluginId, prefix: prefix, eventList: eventList }
}

// 队列满丢弃回调：dev 首丢可借此发声，prod 只计数（见 #18 Q5）。
export type OnDropCallback = (dropped: number, reason: string) => void
