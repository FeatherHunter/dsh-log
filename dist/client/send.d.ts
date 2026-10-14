import type { PhoneNameMap } from '../config.js';
import type { ForwardState } from './forward.js';
import type { ClientHost, ClientQueuedRow, ClientSendResult, ClientTimer } from './types.js';
export interface SendStageInput {
    host: ClientHost | null;
    phoneNames: PhoneNameMap;
    /** 待发队列（就地取批）。 */
    queue: ClientQueuedRow[];
    /** 重试位与重试计数（就地更新）。 */
    retry: {
        rows: ClientQueuedRow[];
        rejectCount: number;
        attempts: number;
        timer: unknown;
    };
    dropped: {
        count: number;
    };
    forward: ForwardState;
    flushTimer: {
        id: unknown;
    };
    timer: ClientTimer | null;
    laterRun: (fn: () => void, ms: number) => unknown;
    maybeForwardSummary: () => void;
    scheduleLogFlush: (immediate: boolean) => void;
}
export interface SendStage {
    sendLogBatch: () => Promise<ClientSendResult>;
    flush: () => {
        ok: boolean;
    };
    getDroppedCount: () => number;
}
export declare function createSendStage(input: SendStageInput): SendStage;
