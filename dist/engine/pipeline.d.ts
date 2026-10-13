import type { LogFileService, LogTimer } from '../platform/ports.js';
import type { OnDropCallback, ResolvedHostLogConfig } from '../config.js';
import type { LogOutcome } from '../core/outcome.js';
import type { EngineIo } from './io.js';
import type { Rotation } from './rotation.js';
export interface PipelineInput {
    config: ResolvedHostLogConfig;
    fs?: LogFileService | null;
    io: EngineIo;
    rotation: Rotation;
    timer?: LogTimer | null;
    getSwitchEnabled: () => boolean;
    isConflictLive: () => boolean;
    getCacheDir?: () => Promise<string | null | ''> | string | null | '';
    ensureLogDir: (logDir: string) => Promise<void>;
    currentPid: () => number;
    currentStartedAt: () => string;
    acquireDirForWrite: (dir: string, op: string) => Promise<{
        key: string;
        held: boolean;
    } | null>;
    beginWrite: () => void;
    endWrite: (use: {
        key: string;
        held: boolean;
    } | null) => void;
    conflictMessage: () => string;
}
export interface LogBatchReply {
    ok: boolean;
    accepted: number;
    skipped: number;
    rejected: number;
    dropped: number;
}
export interface Pipeline {
    log: (level: string, event: string, fields: Record<string, unknown>) => LogOutcome;
    isEnabled: (level: string, event?: string) => boolean;
    flush: () => {
        ok: boolean;
    };
    handleLogBatch: (args: {
        entries?: unknown;
        droppedCount?: unknown;
    }) => Promise<LogBatchReply>;
    notePersistFail: (op: string, reason: string, dir: string) => void;
    flushNow: () => Promise<void>;
    synced: () => Promise<void>;
    beforeExit: () => void;
    getDroppedCount: () => number;
    getPendingCount: () => number;
    getLastPersistFail: () => {
        op: string;
        reason: string;
        dirHash: string;
        at: number;
    } | null;
    setOnDrop: (cb: OnDropCallback | null) => void;
}
export declare function createPipeline(input: PipelineInput): Pipeline;
