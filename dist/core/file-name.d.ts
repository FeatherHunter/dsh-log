/**
 * core/file-name.ts —— 日志文件名的唯一解析器（领域层，零 IO）
 *
 * 为什么单独成模块：写侧封存会把当日可写文件改名成 `<当日名>.<N>.log`，读侧（查询、导出、清空、
 * 保留清理）曾经各自写一套正则，daily 下只认 `YYYY-MM-DD.log`。结果是文件一被封存，那些行对读侧
 * 整体消失——磁盘上 14 行、查询只回 5 行，而且不报错（.local/probe-seam.mjs 实测）。
 *
 * 从此以后，凡是要「从文件名判断它是不是本桶的日志、属于哪天、是不是封存件」的地方都只走这一个解析器，
 * 读侧与写侧的文件名形状不可能再分叉（tests/seam-invariant.test.mjs 钉住这条不变式）。
 *
 * 分层约束：本文件属于 core/，不许 import 上层模块（engine/host/client/entries）也不许碰 IO。
 * 入参只取结构上需要的那一个字段（`fileNamePolicy`），所以任何带这个字段的配置对象都能直接传进来。
 *
 * 形状（与 config.ts 的 formatDailyFileName / formatFourSegmentFileName 一一对应）：
 *   daily         可写 `YYYY-MM-DD.log`；封存 `YYYY-MM-DD.<N>.log`（N ≥ 1）
 *   four-segment  可写 `YYYY-MM-DD.<标识>.<pid>.<启动时间>.log`
 *                 封存 `YYYY-MM-DD.<标识>.<pid>.<启动时间>.<N>.log`
 * 四段式的启动时间里允许出现点（ISO 毫秒），所以末尾的 `.N` 只在「去掉它之后仍解析得通」时才认。
 * 已知边界：启动时间恰好以裸整数结尾（如 `...T00-00-00.5`）会被读成封存件；写侧启动时间来自 ISO 串，
 * 末尾是 `Z` 或「数字+字母」，撞不上。
 */
export type FileNamePolicy = 'daily' | 'four-segment';
/** 解析器只需要这一个字段：任何带 `fileNamePolicy` 的配置对象（含 ResolvedHostLogConfig）都满足。 */
export interface FileNameConfig {
    fileNamePolicy: FileNamePolicy;
}
export interface LogFileInfo {
    name: string;
    date: string;
    seq: number;
    sealed: boolean;
    policy: FileNamePolicy;
}
export declare function parseLogFileName(config: FileNameConfig, name: unknown): LogFileInfo | null;
export declare function logFileDate(config: FileNameConfig, name: unknown): string;
export declare function logFilesOfDate(config: FileNameConfig, names: readonly unknown[], date: string): LogFileInfo[];
export declare function listLogFiles(config: FileNameConfig, names: readonly unknown[]): LogFileInfo[];
export declare function matchExportFileName(config: FileNameConfig, candidates: string[], wantDate: string, fallbackFileName: string): string;
