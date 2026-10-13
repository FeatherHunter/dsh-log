/**
 * 一行日志的去向（记录电话按它如实回包，不许把丢行报成接收）。
 *
 * - `queued`  真进了队列（还没落盘，但已在落盘路径上）
 * - `skipped` 被开关或采样挡下（**不是丢**：本来就不该记）
 * - `dropped` 满了被丢新 / 目录冲突被拒（**是真丢**，计入 dropped）
 */
export type LogOutcome = 'queued' | 'skipped' | 'dropped';
/**
 * 写盘结果三态：写失败与「常驻冲突/取不到目录」必须分开。
 *
 * - `ok`      写成功
 * - `retry`   写失败（磁盘问题）：行进重试位，**不丢**，等恢复后补写
 * - `dropped` 目录冲突或能力缺失：按允许的例外计数丢弃
 */
export type WriteOutcome = 'ok' | 'retry' | 'dropped';
