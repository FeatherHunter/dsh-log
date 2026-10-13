import type { LogFileService, LogPlatform } from '../platform/ports.js';
export interface EngineIoInput {
    fs?: LogFileService | null;
    getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null;
}
export interface EngineIo {
    joinPath: (a: string, b: string) => string;
    joinLogPath: (dir: string, name: string) => Promise<string>;
    resolveTarget: (pathStr: string) => Promise<unknown>;
    readTarget: (target: unknown) => Promise<string>;
    writeTarget: (target: unknown, text: string) => Promise<unknown>;
    canAppend: () => Promise<boolean>;
    appendTarget: (target: unknown, text: string) => Promise<unknown>;
}
export declare function createEngineIo(input: EngineIoInput): EngineIo;
