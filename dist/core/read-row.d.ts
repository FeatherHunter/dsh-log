/** 解析后的行：只保留渲染真正需要的四样东西（v 不进渲染，它是格式版本）。 */
export interface ParsedLogRow {
    ts: number;
    level: string;
    event: string;
    fields: Record<string, unknown>;
}
export interface FormatRowOptions {
    /** 时间样式：local 是本地时区 `YYYY-MM-DD HH:mm:ss.SSS`（默认），iso 是 UTC 的 ISO 串。 */
    timeStyle?: 'local' | 'iso';
    /** 人话放在哪个字段（默认 `message`）；找不到就不显示人话，只显示事件名。 */
    messageField?: string;
    /** 是否把 message 之外的字段以 `k=v` 附在行尾（默认 true）。 */
    withFields?: boolean;
    /** 是否给级别上色（默认 false：只有终端才该开）。 */
    color?: boolean;
    /** 事件名对齐宽度（默认 22）：让连续多行的 message 起点齐平。 */
    eventWidth?: number;
    /** 单个字段值的渲染上限（默认 200 字符），超出截断加 `…`。 */
    maxValueChars?: number;
}
/**
 * 解析一行落盘文本；不是本包日志行（空行、半行、audit.json 那种没有 level/event 的 JSON、非 JSON）一律返回 null。
 * 判据就一条：有字符串型 `level` 与 `event`。这样 `audit.json` 里的 `{"ts":…,"op":"rotate.seal",…}` 会被自然跳过。
 */
export declare function parseLogLine(line: unknown): ParsedLogRow | null;
/**
 * 一行人话：`<时间> <级别> <事件> <message>  (k=v, …)`。
 * 级别未知也照常渲染（日志里出现了新级别，读侧不该装作没看见）。
 */
export declare function formatRow(row: ParsedLogRow, options?: FormatRowOptions): string;
/** 便捷批量渲染（CLI 与使用者都用得上）；null 行原样跳过。 */
export declare function formatRows(rows: readonly (ParsedLogRow | null)[], options?: FormatRowOptions): string[];
