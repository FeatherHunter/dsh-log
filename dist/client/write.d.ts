import type { LogOutcome } from '../core/outcome.js';
import type { ClientQueuedRow, ClientSendResult, ClientTimer } from './types.js';
export interface WriteStageInput {
    /** 开关状态（住组合根，读时取当下值）。 */
    getSwitchEnabled: () => unknown;
    /** 放行判定用的常驻事件集合（core/resident.ts 的 residentEventSet(config.eventList)）。 */
    residentEvents: ReadonlySet<string>;
    /** 待发队列（就地增删）。 */
    queue: ClientQueuedRow[];
    dropped: {
        count: number;
    };
    /** 丢弃原因（转发汇总用）。 */
    forward: {
        lastReason: string;
    };
    flushTimer: {
        id: unknown;
    };
    traceState: {
        traceId: string | null;
        spanId: string | null;
        seq: number;
        shadowWarns: number;
    };
    ensureSpanId: () => string | null;
    ensureTraceForLevel: (level: string) => string | null;
    sendLogBatch: () => Promise<ClientSendResult>;
    timer: ClientTimer | null;
}
export interface WriteStage {
    log: (level: string, event: string, fields?: Record<string, unknown>, isDiagnostic?: boolean) => LogOutcome;
    /** 记一行「库自己写的诊断行」：与 log 同路，但丢弃计数不把它算成用户的行。 */
    logDiagnostic: (level: string, event: string, fields?: Record<string, unknown>) => LogOutcome;
    isEnabled: (level: string, event?: string) => boolean;
    dropForRoom: (level: string) => void;
    scheduleLogFlush: (immediate: boolean) => void;
}
export declare function createWriteStage(input: WriteStageInput): WriteStage;
