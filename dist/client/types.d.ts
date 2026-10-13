import type { PhoneNameMap } from '../config.js';
import type { LogOutcome } from '../core/outcome.js';
export interface ClientHost {
    call: (name: string, args?: unknown) => Promise<unknown>;
}
export interface ClientTimer {
    timeout: (fn: () => void, ms: number) => unknown;
}
export interface ClientStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}
export type ClientBroadcast = () => void;
export interface ClientLogDeps {
    host?: ClientHost | null;
    timer?: ClientTimer | null;
    storage?: ClientStorage | null;
    localStorage?: ClientStorage | null;
    broadcastLogSwitch?: ClientBroadcast | null;
    hashFn?: ((s: string) => string) | null;
}
export interface ClientLogConfigInput {
    pluginId: string;
    prefix: string;
    eventList?: string | Record<string, unknown> | null;
}
export interface ResolvedClientLogConfig {
    pluginId: string;
    prefix: string;
    eventList: string | Record<string, unknown> | null;
}
export interface ClientDebugSwitch {
    enabled: boolean;
    rev: number;
}
export interface ClientQueuedRow {
    v?: number;
    ts: number;
    level: string;
    event: string;
    fields: Record<string, unknown>;
    truncated?: boolean;
}
export interface ClientSendResult {
    ok: boolean;
    sent: number;
}
export interface ClientSwitchResult {
    ok: boolean;
    enabled: boolean;
}
export interface ClientSetSwitchResult {
    ok: boolean;
    enabled: boolean;
    error?: string;
}
export type TraceSource = 'explicit' | 'inherited' | 'auto' | 'refreshed' | 'none';
export interface TraceState {
    traceId: string | null;
    spanId: string | null;
    seq: number;
    traceSource: TraceSource;
    spanSource: TraceSource;
    shadowWarns: number;
}
export interface ChildCtx {
    traceId?: unknown;
    [key: string]: unknown;
}
export interface TraceWhy {
    traceId: string | null;
    spanId: string | null;
    seq: number;
    sources: {
        traceId: TraceSource;
        spanId: TraceSource;
        seq: string;
    };
    shadowWarns: number;
    detail: string;
}
export interface ClientLogFn {
    (level: string, event: string, fields?: Record<string, unknown>): LogOutcome;
    child: (ctx?: ChildCtx) => ClientLog;
    why: () => TraceWhy;
}
export interface LogQueryClientArgs {
    timeRange?: {
        start?: unknown;
        end?: unknown;
    } | null;
    pluginId?: unknown;
    level?: unknown;
    keyword?: unknown;
    traceId?: unknown;
    page?: {
        cursor?: unknown;
        limit?: unknown;
    } | null;
    [key: string]: unknown;
}
export interface ClientLog {
    config: ResolvedClientLogConfig;
    phoneNames: PhoneNameMap;
    logSwitch: ClientDebugSwitch;
    logQueue: ClientQueuedRow[];
    logDroppedState: {
        count: number;
    };
    logForwardState: {
        lastSummaryAt: number;
        lastSummaryDropped: number;
        lastReason: string;
    };
    logFlushTimer: {
        id: unknown;
    };
    traceState: TraceState;
    isEnabled: (level: string) => boolean;
    log: ClientLogFn;
    child: (ctx?: ChildCtx) => ClientLog;
    why: () => TraceWhy;
    queryLogs: (args?: LogQueryClientArgs) => Promise<unknown>;
    scheduleLogFlush: (immediate: boolean) => void;
    estimateBatchBytes: (entries: ClientQueuedRow[]) => number;
    maybeForwardSummary: () => void;
    hash8: (value: unknown) => string;
    logExportFail: (op: string, reason: string, err: unknown) => void;
    watchSwitchOp: (op: string, pending: unknown) => void;
    sendLogBatch: () => Promise<ClientSendResult>;
    flush: () => {
        ok: boolean;
    };
    getDroppedCount: () => number;
    readLocalDebugSwitch: () => ClientDebugSwitch;
    persistLocalDebugSwitch: (state: ClientDebugSwitch) => boolean;
    reconcileLogSwitch: () => Promise<ClientSwitchResult>;
    setLogSwitch: (enabled: boolean) => Promise<ClientSetSwitchResult>;
}
