import { type ParsedLogRow } from '../core/read-row.js';
import { type LogFileInfo } from '../core/file-name.js';
import type { CliOptions } from './args.js';
export declare const DEFAULT_LIMIT = 200;
export declare const DEFAULT_FOLLOW_LIMIT = 20;
export declare const POLL_MS = 400;
export interface LogDir {
    dir: string;
    files: LogFileInfo[];
}
/** 一行一行的切分：末尾没有换行的碎片是**半行**（写者可能正写到一半），单独交回由调用方决定。 */
export declare function splitLogLines(text: string): {
    lines: string[];
    partial: string;
};
export declare function colorEnabled(options: CliOptions, isTty: boolean | undefined): boolean;
export declare function matches(row: ParsedLogRow, options: CliOptions, nowMs: number): boolean;
/** 一行的输出文本：`--json` 给原始行（管道给 jq 用），否则给人话。 */
export declare function outputOf(line: string, options: CliOptions, useColor: boolean): string | null;
/** 认目录：给日志目录就用它；给根目录就往下看一层；再不行列为「没找到」。 */
export declare function discoverLogDirs(paths: readonly string[]): Promise<{
    dirs: LogDir[];
    missing: string[];
}>;
/** 一次性显示：把命中的行按写入顺序拼起来，只显示**最后 N 行**（看日志的人要的是最近的事）。 */
export declare function runOnce(dirs: readonly LogDir[], options: CliOptions, useColor: boolean): Promise<number>;
/** 跟读：先显示最后 N 行，然后每 400ms 看一次有没有新内容。 */
export declare function runFollow(paths: readonly string[], dirs: readonly LogDir[], options: CliOptions, useColor: boolean): Promise<number>;
