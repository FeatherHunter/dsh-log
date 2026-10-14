// src/core/startup-header.ts —— 启动头（`host.start` 行的载荷形状）。
//
// 它是「目录自述」的唯一形状：写侧（store.writeStartupHeader）往里记，读侧（宿主导出摘要、
// CLI 摘要）按它读。两边共用一份定义——各写一份形状，就会出现「写侧加了字段、读侧不认」
// 这种只有第三方拿目录时才发现的哑巴亏（research/18 §2.2）。
//
// 约定：拿不到的事实留空串，读侧如实写 unknown；**绝不用「读日志那个进程」的环境顶替**。

export interface StartupHeader {
  /** 写这一版日志的进程标识。 */
  pid: number
  /** 进程启动时刻（ISO 字符串）。 */
  startedAt: string
  /** 日志根目录（写侧建库时定下来的那个）。 */
  dir: string
  /** 插件版本：调用方给了才记，没记就是空串。 */
  pluginVersion: string
  /** 系统标识：平台对象报得出才记，没记就是空串。 */
  os: string
}
