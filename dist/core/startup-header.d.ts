export interface StartupHeader {
    /** 写这一版日志的进程标识。 */
    pid: number;
    /** 进程启动时刻（ISO 字符串）。 */
    startedAt: string;
    /** 日志根目录（写侧建库时定下来的那个）。 */
    dir: string;
    /** 插件版本：调用方给了才记，没记就是空串。 */
    pluginVersion: string;
    /** 系统标识：平台对象报得出才记，没记就是空串。 */
    os: string;
}
