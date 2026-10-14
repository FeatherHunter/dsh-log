import type { TraceState } from './types.js';
export interface TraceStage {
    ensureSpanId: () => string;
    ensureForLevel: (level: string) => string | null;
}
export declare function createTraceStage(input: {
    state: TraceState;
}): TraceStage;
