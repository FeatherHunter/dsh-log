export interface LogFileService {
    resolve?: (pathStr: string) => Promise<unknown>;
    readText?: (target: unknown) => Promise<string>;
    writeText?: (target: unknown, text: string) => Promise<unknown>;
    mkdir?: (dir: string) => Promise<unknown>;
    unlink?: (target: unknown) => Promise<unknown>;
    listDir?: (dirTarget: unknown) => Promise<unknown>;
    rename?: (from: unknown, to: unknown) => Promise<unknown>;
    appendText?: (target: unknown, text: string) => Promise<unknown>;
    sizeOf?: (target: unknown) => Promise<number | null>;
}
export interface LogTimer {
    timeout: (fn: (...args: unknown[]) => void, ms: number) => unknown;
}
export interface LogPlatformPath {
    join: (...parts: string[]) => string;
}
export interface LogPlatformFs {
    resolve?: (pathStr: string) => Promise<unknown>;
    readText?: (target: unknown) => Promise<string>;
    writeText?: (target: unknown, text: string) => Promise<unknown>;
    mkdir?: (dir: string) => Promise<unknown>;
    unlink?: (target: unknown) => Promise<unknown>;
    listDir?: (dirTarget: unknown) => Promise<unknown>;
    rename?: (from: unknown, to: unknown) => Promise<unknown>;
    appendText?: (target: unknown, text: string) => Promise<unknown>;
    sizeOf?: (target: unknown) => Promise<number | null>;
}
export interface LogPlatform {
    os?: string;
    path?: LogPlatformPath;
    fs?: LogPlatformFs;
}
