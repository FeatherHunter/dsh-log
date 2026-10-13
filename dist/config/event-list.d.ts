import type { LogEventKind, LogEventLevel } from './constants.js';
export interface LogEventEntry {
    level: LogEventLevel;
    kind: LogEventKind;
    fields: string[];
    codes?: string[];
    rules?: string[];
    guard?: string;
}
export interface LogEventCounts {
    resident: number;
    ondemand: number;
    selfmon: number;
}
export interface LogEventList {
    version: 1;
    pluginId: string;
    counts: LogEventCounts;
    events: Record<string, LogEventEntry>;
}
export declare function parseEventListManifest(value: unknown): LogEventList;
export interface EventFieldCheck {
    ok: boolean;
    unknownEvent: boolean;
    unknownFields: string[];
}
export declare function checkEventFields(manifest: LogEventList, eventName: string, fieldNames: string[]): EventFieldCheck;
export interface LintEventFieldsResult {
    ok: boolean;
    severity: 'warn' | 'error' | 'none';
    unknownEvent: boolean;
    unknownFields: string[];
}
export declare function lintEventFields(manifest: LogEventList, eventName: string, fieldNames: string[]): LintEventFieldsResult;
export declare function computeEventCounts(manifest: LogEventList): LogEventCounts;
