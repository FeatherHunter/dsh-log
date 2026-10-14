import type { ClientTimer } from './types.js';
export interface ForwardState {
    lastSummaryAt: number;
    lastSummaryDropped: number;
    lastReason: string;
    lastAccepted: number;
    lastSkipped: number;
    lastRejected: number;
}
export interface ForwardStageInput {
    /** 记一行诊断行（write 面的 logDiagnostic：同一条队列，但丢弃计数不算用户行）。 */
    logDiagnostic: (level: string, event: string, fields: Record<string, unknown>) => void;
    /** 累计丢弃数（只读）。 */
    dropped: {
        count: number;
    };
    /** 汇总状态（就地更新）。 */
    forward: ForwardState;
    timer: ClientTimer | null;
    watchdogMs: number;
    /** 调用方注入的散列（缺省用包内 hash8）：只记指纹、不记原文。 */
    hashFn: ((s: string) => string) | null;
}
export interface ForwardStage {
    maybeForwardSummary: () => void;
    logExportFail: (op: string, reason: string, err: unknown) => void;
    watchSwitchOp: (op: string, pending: unknown) => void;
}
export declare function createForwardStage(input: ForwardStageInput): ForwardStage;
