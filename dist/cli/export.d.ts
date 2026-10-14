import { type LogDigest } from '../core/log-digest.js';
import { type LogDir } from './tail.js';
import type { CliOptions } from './args.js';
/** 开关文件是日志目录的**兄弟**：`logs-<id>/` 旁边是 `log-switch-<id>.json`，`logs/` 旁边是 `log-switch.json`。 */
export declare function switchCandidates(dir: string): string[];
export interface LogExport {
    digest: LogDigest;
    /** 原始行（原样，按写入顺序：先旧文件后新文件）。 */
    rows: string[];
}
/** 把一个日志目录收成「摘要 + 原始行」；读不到的文件按 0 行记，绝不抛错。 */
export declare function collectExport(entry: LogDir): Promise<LogExport>;
/**
 * 交日志：默认输出「摘要 + 原始行」（贴工单、当附件都够）；
 * `--json` 只输出摘要对象（一个 JSON，给脚本用；要行就用 `tail --json`）。
 */
export declare function runExport(dirs: readonly LogDir[], options: CliOptions): Promise<number>;
