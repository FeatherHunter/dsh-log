import type { ClientQueuedRow, ClientSendResult, ClientTimer } from './types.js';
export interface WriteRigInput {
    /** 开关状态（住组合根，读时取当下值）。 */
    getSwitchEnabled: () => unknown;
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
export interface WriteRig {
    log: (level: string, event: string, fields?: Record<string, unknown>) => void;
    isEnabled: (level: string, event?: string) => boolean;
    dropForRoom: (level: string) => void;
    scheduleLogFlush: (immediate: boolean) => void;
}
export declare function createWriteRig(rig: WriteRigInput): WriteRig;
