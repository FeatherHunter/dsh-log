export declare const RESERVED_TRACE_FIELDS: readonly ["traceId", "spanId", "seq"];
export declare const SHADOW_FIELD = "_shadow";
export interface RelocatedFields {
    fields: Record<string, unknown>;
    shadow: Record<string, unknown> | null;
}
export declare function isReservedTraceField(key: string): boolean;
export declare function relocateReservedFields(userFields: Record<string, unknown>): RelocatedFields;
