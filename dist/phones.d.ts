import { LOG_QUERY_ACTION_SUFFIX, buildLogQueryPhoneName } from './config.js';
import type { LogPhonesContext, LogQueryArgs, LogQueryResult } from './host/types.js';
export { LOG_QUERY_ACTION_SUFFIX, buildLogQueryPhoneName };
export { aggregateLogQuery } from './host/aggregate.js';
export type { LogQueryTimeRange, LogQueryPageArg, LogQueryArgs, LogQueryEntry, LogQueryResult, LogQuerySource, LogQueryAggregateResult, LogPhonesContext } from './host/types.js';
export declare function createLogPhones(ctx: LogPhonesContext): {
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
            header: import("./core/startup-header.js").StartupHeader | null;
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
    handleLogQuery: (rawArgs?: LogQueryArgs | null) => Promise<LogQueryResult>;
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
};
export type LogPhones = ReturnType<typeof createLogPhones>;
