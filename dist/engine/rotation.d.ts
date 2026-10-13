import type { LogFileService } from '../platform/ports.js';
import type { ResolvedHostLogConfig } from '../config.js';
import type { EngineIo } from './io.js';
export interface RotationInput {
    config: ResolvedHostLogConfig;
    fs?: LogFileService | null;
    io: EngineIo;
    sealSeq: Map<string, number>;
}
/** 封存结果：成功给封存名；失败给原因（调用方按原因记 log.rotate.degraded 并继续追加）。 */
export type SealOutcome = {
    ok: true;
    sealed: string;
} | {
    ok: false;
    reason: string;
};
export interface Rotation {
    listLogNames: (logDir: string) => Promise<string[] | null>;
    sealCurrentFile: (logDir: string, fileName: string, dayKey: string) => Promise<SealOutcome>;
    appendAudit: (logDir: string, record: Record<string, unknown>) => Promise<void>;
    retainSweep: (logDir: string, fileName: string, dayKey: string) => Promise<string>;
}
export declare function createRotation(input: RotationInput): Rotation;
