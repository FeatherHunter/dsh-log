import type { LogFileService } from '../platform/ports.js';
import type { ResolvedHostLogConfig } from '../config.js';
import type { EngineIo } from './io.js';
export interface RotationInput {
    config: ResolvedHostLogConfig;
    fs?: LogFileService | null;
    io: EngineIo;
    sealSeq: Map<string, number>;
}
export interface Rotation {
    listLogNames: (logDir: string) => Promise<string[] | null>;
    sealCurrentFile: (logDir: string, fileName: string, dayKey: string) => Promise<string | null>;
    appendAudit: (logDir: string, record: Record<string, unknown>) => Promise<void>;
    retainSweep: (logDir: string, fileName: string, dayKey: string) => Promise<string>;
}
export declare function createRotation(input: RotationInput): Rotation;
