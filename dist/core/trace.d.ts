import type { LogOutcome } from './outcome.js';
export declare const RESERVED_TRACE_FIELDS: readonly ["traceId", "spanId", "seq"];
export declare const SHADOW_FIELD = "_shadow";
export interface RelocatedFields {
    fields: Record<string, unknown>;
    shadow: Record<string, unknown> | null;
    /**
     * 调用方**真的传了保留字**（traceId/spanId/seq）而被搬走——只有这种情况才算一次「保留字冲突」。
     * 只带 `_shadow`（自己归档自己的字段）不算冲突：那不是我们搬的，计数跟着它涨会把
     * 「冲突次数」变成「用过 _shadow 的次数」。
     */
    reservedMoved: boolean;
}
export declare function isReservedTraceField(key: string): boolean;
export declare function relocateReservedFields(userFields: Record<string, unknown>): RelocatedFields;
export interface HostTraceInput {
    /** 真正落行的动作：宿主侧传 `store.log`，测试可传假实现。 */
    emit: (level: string, event: string, fields: Record<string, unknown>) => LogOutcome;
    /** 显式链路 id（缺省自造 16 位十六进制）。 */
    traceId?: string;
    /** 显式 span id（缺省自造 8 位十六进制）。 */
    spanId?: string;
    /** id 生成器（缺省 core/ids 的 genHex；测试传固定序列即可不靠随机）。 */
    genId?: (length: number) => string;
}
export interface HostTrace {
    readonly traceId: string;
    readonly spanId: string;
    /** 保留字冲突次数：只数调用方**真的传了** traceId/spanId/seq 而被搬进 `fields._shadow` 的次数（只带 `_shadow` 不算）。 */
    readonly shadowWarns: number;
    /** 记一行：自动带 traceId/spanId/seq。被开关挡下的行**不**消耗 seq（与客户端同口径）。 */
    log: (level: string, event: string, fields?: Record<string, unknown>) => LogOutcome;
    /** 下一步：换 spanId、seq 从 0 起，traceId 不变（与客户端 child() 同语义）。 */
    child: (overrides?: {
        traceId?: string;
        spanId?: string;
    }) => HostTrace;
}
export declare function createHostTrace(input: HostTraceInput): HostTrace;
