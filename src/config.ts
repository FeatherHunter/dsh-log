// src/config.ts —— 日志包的公共配置面（门面）：只做 re-export，公开名与类型逐字不变。
//
// 以后谁改它：改导入路径、配置默认值、电话名拼法、文件名策略、失败语义、清单注入点位、版本策略的人。
// 改动前先看 #558 拍板结论：破坏性变更有 5 类（电话改名、增删改入参回参形状、改配置写法、
// 改事件清单字段形状、改文件名策略的默认形状），碰了任何一类就要升大版本号。
// 全程用「日志系统」指日志功能本身，用「日志包」指装着日志系统的这个 npm 包。
//
// 分层（0.3.0）：领域层 core/（零 IO）、平台层 platform/、引擎层 engine/、宿主面 host/、
// 客户端面 client/，配置面拆成 config/ 下的六个小件（校验 / 常量 / 电话名 / 文件名 / 配置补齐 / 事件清单），
// 本文件只把它们的公开名原样转出去——调用方与 0.3.0 之前的导入路径一字不差。
//
// 文件名解析的真源是 core/file-name.ts（读侧与写侧共用一个解析器；logFileNamePattern 不再转出口：
// 它认不出封存件，谁拿它当判据谁就重演 D1——封存件对读侧不可见的接缝缺陷）。
export type { FileNamePolicy } from './core/file-name.js'
export type { LogFileInfo } from './core/file-name.js'
export { listLogFiles, logFilesOfDate, matchExportFileName, parseLogFileName } from './core/file-name.js'
export { LOG_FORMAT_VERSION } from './core/row.js'
export type { LogRowV3 } from './core/row.js'

export {
  LOG_DEBOUNCE_MS,
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_SIZE,
  DEFAULT_MAX_DAYS,
  CLIENT_BATCH_MAX,
  CLIENT_BATCH_INTERVAL_MS,
  CLIENT_PACKET_BYTES,
  CLIENT_QUEUE_MAX,
  LEGACY_LOG_DIR_NAME,
  LEGACY_SWITCH_FILE_NAME,
  PHONE_ACTIONS,
  LOG_QUERY_ACTION_SUFFIX,
  EVENT_LEVELS,
  EVENT_KINDS
} from './config/constants.js'
export type { PhoneAction, LogEventLevel, LogEventKind } from './config/constants.js'

export { assertPluginId } from './config/validate.js'

export { resolveHostLogConfig, resolveClientLogConfig } from './config/resolve.js'
export type {
  HostLogConfigInput,
  ResolvedHostLogConfig,
  ClientLogConfigInput,
  ResolvedClientLogConfig,
  OnDropCallback
} from './config/resolve.js'

export { buildPhoneName, buildPhoneNames, buildLogQueryPhoneName } from './config/phones.js'
export type { PhoneNameMap } from './config/phones.js'

export { formatDailyFileName, formatFourSegmentFileName, resolveLogFileName } from './config/log-names.js'

export { parseEventListManifest, checkEventFields, lintEventFields, computeEventCounts } from './config/event-list.js'
export type {
  LogEventEntry,
  LogEventCounts,
  LogEventList,
  EventFieldCheck,
  LintEventFieldsResult
} from './config/event-list.js'
