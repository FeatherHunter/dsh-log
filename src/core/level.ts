// src/core/level.ts —— 级别语义（领域层：零 IO、不依赖上层）。
//
// 「哪些级别永不丢」是 0.3.0 的头号不变量（error 永不丢）。同一条语义同时决定四件事：
//   ① 开关是否放行（error/warn 恒放行）
//   ② 队列满时怎么腾位（error/warn 挤最旧普通行，普通行丢新）
//   ③ 刷盘走直通还是防抖（error/warn 立即刷）
//   ④ 同形连击折叠认哪一级（只有 error 折叠）
// 这四件事从前在 store.ts 与 client.ts 里各写一遍 'error'/'warn' 字面（8 处）。
// 哪天加一个 fatal 级别，就得六处同步改，漏一处就是「新级别被静默丢掉」——
// 最不该靠「记得改」保证的一条，单源一份在这里。

// 级别全表，从最严重到最不严重。config.ts 的 EVENT_LEVELS 直接引用它（公开名与元组类型不变）。
export const LOG_LEVEL_ORDER = ['error', 'warn', 'info', 'debug'] as const

export type LogLevelName = (typeof LOG_LEVEL_ORDER)[number]

// 严重度数值：越小越严重。要排序/比较用这个，别拿字符串比大小（'debug' < 'error' 是字母序，不是严重度）。
export const LEVEL_SEVERITY: Readonly<Record<string, number>> = { error: 0, warn: 1, info: 2, debug: 3 }

// 是不是我们认识的级别。调用方与事件清单都可能传进任意字符串（清单是外部文件），
// 不认识的级别一律按普通行处理，绝不当成 error 放行。
export function isKnownLevel(level: unknown): boolean {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(LEVEL_SEVERITY, level)
}

// 紧急级别：error 与 warn。开关关了也放行、队列满时挤掉普通行、刷盘不等防抖。
export function isUrgentLevel(level: unknown): boolean {
  return level === 'error' || level === 'warn'
}

// 最高保护级：只有 error。三处用到它，理由不同、判据同一个：
//   ① 同形连击折叠只折 error（warn 重复了多少次本身就是信息，折掉等于抹平）
//   ② 客户端超包裁剪只裁普通行，error 不因体积被丢
//   ③ 客户端积压裁剪同理
// 一句话：error 是唯一「配额、体积、重复都不许动它」的级别。
export function isErrorLevel(level: unknown): boolean {
  return level === 'error'
}
