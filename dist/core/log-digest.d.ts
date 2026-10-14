import type { StartupHeader } from './startup-header.js';
export interface LogDigestFile {
    name: string;
    bytes: number;
    /** 能解析成本包日志行的行数。 */
    rows: number;
    /** 解析不了的行数（半行、坏 JSON、audit.json 那种没有 level/event 的 JSON）。 */
    bad: number;
    /**
     * 这个文件**读不出来**（列目录时还在、真读的时候没了/读不动：轮转、保留清理、别的写者删了它）。
     * 必须与「真的空文件」分开：`bytes: 0, rows: 0` 的空文件是事实，读不出来是缺口——
     * 收日志的人看到「0 字节」会以为没事，看到 `unreadable` 才知道要去找。
     */
    unreadable?: boolean;
}
export interface LogDigest {
    dir: string;
    files: LogDigestFile[];
    rows: number;
    bad: number;
    /** 读不出来的文件个数（`files` 里带 `unreadable` 的那些）。 */
    unreadable: number;
    /** 级别分布（按次数降序、同次数按名字升序，保证同一份日志每次输出一样）。 */
    byLevel: Record<string, number>;
    byEvent: Record<string, number>;
    firstTs: number | null;
    lastTs: number | null;
    header: StartupHeader | null;
    logSwitch: {
        enabled: boolean;
    } | null;
    /** 读不出来的格子（值是 unknown 的那些），逐个点名，便于交接时说明「为什么这里是 unknown」。 */
    unknown: string[];
}
export interface LogDigestAccumulator {
    /** 喂一个文件的全文（按写入顺序喂：先旧后新）；读不出来就传 `null`，别拿空串冒充。 */
    addFile: (name: string, text: string | null) => void;
    /** 喂开关文件的原文（读不到就传 null）。 */
    setSwitch: (text: string | null) => void;
    finish: () => LogDigest;
}
/** 开关文件原文 → `{enabled}`；解析不出布尔就返回 null（= unknown，不猜）。 */
export declare function parseLogSwitch(text: unknown): {
    enabled: boolean;
} | null;
export declare function createLogDigest(dir: string): LogDigestAccumulator;
/** 摘要的人话形态（CLI 的默认输出；机器要的是 JSON 形态，见 `--json`）。 */
export declare function formatLogDigest(digest: LogDigest): string;
