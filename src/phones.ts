// src/phones.ts —— 宿主日志电话组（0.3.0 S5：实现已按职责拆进 ./host/，这里只做组装与转出口）。
// 以后谁改它：加/减一个电话动作的人。接线：由 ./store.ts 静态引入。
import { LOG_QUERY_ACTION_SUFFIX, buildLogQueryPhoneName } from './config.js'
import { createLogFileHandlers } from './host/files.js'
import { createLogQueryHandler } from './host/query.js'
import type { LogPhonesContext, LogQueryArgs, LogQueryEntry, LogQueryResult } from './host/types.js'

// 只读查询电话名单源见 config.ts（本文件转出口供兼容，不再手拼 prefix + '.logQuery'）。
export { LOG_QUERY_ACTION_SUFFIX, buildLogQueryPhoneName }
export { aggregateLogQuery } from './host/aggregate.js'
export type {
  LogQueryTimeRange,
  LogQueryPageArg,
  LogQueryArgs,
  LogQueryEntry,
  LogQueryResult,
  LogQuerySource,
  LogQueryAggregateResult,
  LogPhonesContext
} from './host/types.js'

export function createLogPhones(ctx: LogPhonesContext) {
  // 三个电话族各建一次：查询（只读本桶）与文件（导出/清空）实现分别在 host/query.ts、host/files.ts。
  const query = createLogQueryHandler(ctx)
  const files = createLogFileHandlers(ctx)
  async function handleLogGetSwitch() {
    const state = await ctx.loadSwitch()
    return { ok: true, enabled: state.enabled }
  }
  async function handleLogSetSwitch(args: { enabled?: unknown }) {
    const enabled = !!(args && args.enabled)
    const state = await ctx.setSwitch(enabled)
    return { ok: true, enabled: state.enabled }
  }
  return {
    handleLogExport: files.handleLogExport,
    handleLogClear: files.handleLogClear,
    handleLogQuery: query.handleLogQuery,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch
  }
}

export type LogPhones = ReturnType<typeof createLogPhones>
