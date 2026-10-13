// src/config/phones.ts —— 电话名拼装（宿主 5 个动作名 + 1 个只读查询名）。
// 前缀参数化（#558 冻结：动作名不变，只许前缀参数化），撞名与否由注册表在运行期判定。

import { LOG_QUERY_ACTION_SUFFIX, PHONE_ACTIONS } from './constants.js'
import type { PhoneAction } from './constants.js'
import { assertPluginId } from './validate.js'

// 新电话名 = 前缀 + 点 + 动作名（#558 Q1：默认前缀 wf 下 5 个字面与现状一字不差）。
export function buildPhoneName(prefix: string, action: PhoneAction): string {
  return assertPluginId(prefix, '电话名前缀 prefix') + '.' + action
}

export type PhoneNameMap = Record<PhoneAction, string>

// 一次拼出 5 个电话名（前缀只隔离电话名，磁盘隔离靠目录与开关文件名的默认派生）。
export function buildPhoneNames(prefix: string): PhoneNameMap {
  const checked = assertPluginId(prefix, '电话名前缀 prefix')
  const names = {} as PhoneNameMap
  for (const action of PHONE_ACTIONS) names[action] = checked + '.' + action
  return names
}

export function buildLogQueryPhoneName(prefix: string): string {
  return assertPluginId(prefix, '电话名前缀 prefix') + '.' + LOG_QUERY_ACTION_SUFFIX
}
