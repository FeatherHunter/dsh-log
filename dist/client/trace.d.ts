import type { TraceState } from './types.js';
export interface TraceRig {
    ensureSpanId: () => string;
    ensureForLevel: (level: string) => string | null;
}
export declare function createTraceRig(input: {
    state: TraceState;
}): TraceRig;
