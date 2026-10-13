import type { LogFileService, LogPlatform } from '../platform/ports.js';
export declare const APPEND_ATOMIC_MAX = 4096;
/**
 * 把一个批次按行边界切成 ≤ APPEND_ATOMIC_MAX 字节的若干块（块内至少一整行）。
 *
 * 单行自己就超过上限时它自成一个块——切开必然产生半行，不切只是「这一行大了点」，
 * 两害相权取其轻（这条边界写在 README 的追加路段里）。
 */
export declare function splitForAppend(text: string): string[];
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
    canSize: () => Promise<boolean>;
    sizeOfTarget: (target: unknown) => Promise<number | null>;
}
/**
 * 按 UTF-8 字节偏移取后缀（`sliceUtf8Tail`）——修补「只写了一部分」时用它算出还没落地的剩余。
 *
 * 偏移落在多字节字符中间时，从该字符的开头返回（宁可多写一个字符，也不写出半个字符）。
 */
export declare function sliceUtf8Tail(text: string, byteOffset: number): string;
export declare function createEngineIo(input: EngineIoInput): EngineIo;
