export declare const LOG_LEVEL_ORDER: readonly ["error", "warn", "info", "debug"];
export type LogLevelName = (typeof LOG_LEVEL_ORDER)[number];
export declare const LEVEL_SEVERITY: Readonly<Record<string, number>>;
export declare function isKnownLevel(level: unknown): boolean;
export declare function isUrgentLevel(level: unknown): boolean;
export declare function isErrorLevel(level: unknown): boolean;
