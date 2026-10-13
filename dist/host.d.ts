import { type HostLogConfigInput, type PhoneNameMap } from './config.js';
import { type LogStore, type LogStoreDeps } from './store.js';
export { buildPhoneName, buildPhoneNames, resolveHostLogConfig } from './config.js';
export type { HostLogConfigInput, PhoneAction, PhoneNameMap, ResolvedHostLogConfig } from './config.js';
export { lintEventFields, computeEventCounts, LOG_FORMAT_VERSION, buildLogQueryPhoneName, LOG_QUERY_ACTION_SUFFIX, parseLogFileName, listLogFiles, logFilesOfDate } from './config.js';
export type { LintEventFieldsResult, LogFileInfo, LogRowV3, OnDropCallback } from './config.js';
export { parseEventListManifest, checkEventFields } from './config.js';
export type { LogEventLevel, LogEventKind, LogEventEntry, LogEventCounts, LogEventList, EventFieldCheck } from './config.js';
export { LOG_DEBOUNCE_MS, LOG_DIR_NAME, LOG_SWITCH_FILE, formatDailyFileName, formatLogFileName, createLogStore } from './store.js';
export type { LogEntry, LogLevel, LogStore, LogStoreDeps } from './store.js';
export { aggregateLogQuery } from './phones.js';
export type { LogQueryArgs, LogQueryAggregateResult, LogQueryEntry, LogQueryResult, LogQuerySource } from './phones.js';
export interface HostLog {
    store: LogStore;
    phoneNames: PhoneNameMap;
}
export declare function createHostLog(deps: LogStoreDeps, configInput: HostLogConfigInput): HostLog;
export interface PhoneRegistry {
    has: (name: string) => boolean;
    set: (name: string, handler: (args: never) => Promise<unknown>) => void;
}
export declare const HOST_LOG_PHONE_ACTIONS: readonly ["logBatch", "logExport", "logClear", "logGetSwitch", "logSetSwitch", "logQuery"];
export type HostLogPhoneAction = (typeof HOST_LOG_PHONE_ACTIONS)[number];
export declare function registerHostLogPhones(registry: PhoneRegistry, hostLog: HostLog): PhoneNameMap;
