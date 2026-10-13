import { LOG_DEBOUNCE_MS, LOG_FORMAT_VERSION, formatDailyFileName, type HostLogConfigInput, type ResolvedHostLogConfig, type OnDropCallback } from './config.js';
import type { LogOutcome } from './core/outcome.js';
import type { LogFileService, LogPlatform, LogTimer } from './platform/ports.js';
export type { LogFileService, LogPlatform, LogPlatformFs, LogPlatformPath, LogTimer } from './platform/ports.js';
export { LOG_DEBOUNCE_MS, LOG_FORMAT_VERSION, formatDailyFileName };
export type { OnDropCallback } from './config.js';
export declare const LOG_DIR_NAME = "logs";
export declare const LOG_SWITCH_FILE = "log-switch.json";
export declare const formatLogFileName: typeof formatDailyFileName;
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export interface LogStoreDeps {
    fs?: LogFileService | null;
    timer?: LogTimer | null;
    getCacheDir?: () => Promise<string | null | ''> | string | null | '';
    getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null;
    DEFAULT_CWD?: string;
    syncCacheDir?: string;
}
export type { LogEntry } from './core/row.js';
export declare function createLogStore(deps: LogStoreDeps, configInput?: HostLogConfigInput): {
    config: ResolvedHostLogConfig;
    isEnabled: (level: string, event?: string) => boolean;
    log: (level: string, event: string, fields: Record<string, unknown>) => LogOutcome;
    flush: () => {
        ok: boolean;
    };
    flushNow: () => Promise<void>;
    synced: () => Promise<void>;
    beforeExit: () => void;
    release: () => void;
    getDroppedCount: () => number;
    getLastPersistFail: () => {
        op: string;
        reason: string;
        dirHash: string;
        at: number;
    } | null;
    getPendingCount: () => number;
    setOnDrop: (cb: OnDropCallback | null) => void;
    loadSwitch: () => Promise<{
        enabled: boolean;
    }>;
    setSwitch: (enabled: boolean) => Promise<{
        enabled: boolean;
    }>;
    getSwitchState: () => {
        enabled: boolean;
    };
    writeStartupHeader: () => Promise<{
        pid: number;
        startedAt: string;
        dir: string;
    } | null>;
    getHeaderInfo: () => {
        pid: number;
        startedAt: string;
        dir: string;
    } | null;
    handleLogBatch: (args: {
        entries?: unknown;
        droppedCount?: unknown;
    }) => Promise<import("./engine/pipeline.js").LogBatchReply>;
    handleLogExport: (args: {
        date?: unknown;
        [key: string]: unknown;
    }) => Promise<{
        ok: boolean;
        fileName: string;
        bytes: number;
        fallback: boolean;
        text: string;
        summary: null;
        dir: string;
        path: string;
    } | {
        ok: boolean;
        fileName: string;
        bytes: number;
        fallback: boolean;
        text: string;
        summary: {
            pluginVersion: string;
            os: string;
            cwd: string;
            logSwitch: {
                enabled: boolean;
            };
            header: {
                pid: number;
                startedAt: string;
                dir: string;
            } | null;
        };
        dir: string;
        path: string;
    } | {
        ok: boolean;
        fileName: string;
        bytes: number;
        fallback: boolean;
        text?: undefined;
        summary?: undefined;
        dir?: undefined;
        path?: undefined;
    }>;
    handleLogClear: (args: {
        date?: unknown;
    }) => Promise<{
        ok: boolean;
        removed: number;
    }>;
    handleLogGetSwitch: () => Promise<{
        ok: boolean;
        enabled: boolean;
    }>;
    handleLogSetSwitch: (args: {
        enabled?: unknown;
    }) => Promise<{
        ok: boolean;
        enabled: boolean;
    }>;
    handleLogQuery: (args?: unknown) => Promise<import("./phones.js").LogQueryResult>;
};
export type LogStore = ReturnType<typeof createLogStore>;
