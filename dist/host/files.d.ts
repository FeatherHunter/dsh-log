import type { LogPhonesContext } from './types.js';
export declare function createLogFileHandlers(ctx: LogPhonesContext): {
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
            header: import("../core/startup-header.js").StartupHeader | null;
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
};
