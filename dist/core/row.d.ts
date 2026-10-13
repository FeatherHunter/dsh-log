/** 落盘行格式版本：0.3.0 起为 3（五键）；0.2.x 旧行无 v 键，读侧跳过并计数。 */
export declare const LOG_FORMAT_VERSION: 3;
/** 0.3.0 落盘行形状（解析分支永远唯一：先认 v，再读其余四键）。 */
export interface LogRowV3 {
    v: 3;
    ts: number;
    level: string;
    event: string;
    fields: Record<string, unknown>;
}
/**
 * 拼一行文本（含末尾换行）：五键 + JSON.stringify。
 *
 * 串化失败（循环引用、BigInt 等）回空串——调用方按「这行没写成」处理，**不许**因此抛错打断整批。
 */
export declare function buildRowText(level: string, event: string, fields: Record<string, unknown>): string;
/**
 * UTF-8 字节数：本包 `types: []`，不能碰 Buffer，手算即可（代理对按 4 字节）。
 *
 * 轮转阈值（`maxSize`）与单批超阈值判定都读它——算错就会「文件已经超了还不封存」。
 */
export declare function utf8Bytes(s: string): number;
/** 排队中的一行（= 落盘行 + 一个内部标记）。引擎与组合根都从 core 取，避免各写一份。 */
export interface QueuedRow {
    ts: number;
    level: string;
    event: string;
    fields: Record<string, unknown>;
    selfMon?: boolean;
}
/** 记录电话（handleLogBatch）入参里的一条：调用方给的原始四元组，级别与事件名都还没验。 */
export interface LogEntry {
    level: string;
    event: string;
    fields: Record<string, unknown>;
}
