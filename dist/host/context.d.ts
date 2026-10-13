import type { LogPhonesContext } from './types.js';
export declare function dirConflictOf(ctx: LogPhonesContext): string;
export declare function targetToPath(t: unknown, fb: string): string;
export declare function listFileNames(ctx: LogPhonesContext, logDir: string): Promise<string[]>;
export declare function todayDateStr(): string;
export declare function pidOf(ctx: LogPhonesContext): number;
export declare function startedAtOf(ctx: LogPhonesContext): string;
