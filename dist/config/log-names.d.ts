import type { ResolvedHostLogConfig } from './resolve.js';
export declare function formatDailyFileName(date: Date | string | number): string;
export declare function formatFourSegmentFileName(date: Date | string | number, pluginId: string, pid: number, startedAt: string): string;
export declare function resolveLogFileName(config: ResolvedHostLogConfig, date: Date | string | number, pid: number, startedAt: string): string;
