// src/platform/ports.ts —— 平台端口（能力形状）单源。
//
// 日志包不 import 任何 IO：它只声明「我需要什么能力」，由入口层把具体实现注入进来
// （node:fs、宿主自己给的对象、测试里的内存实现）。能力**全是可选的**——缺 rename 就不封存、
// 缺 listDir 就不做保留清理，一律降级并把降级写进 info 自监控行，绝不假装成功
// （#21/#23 审查钉下的口径：宁可少做一件事并说出来，也不许「复制+截断」冒充原子改名）。
//
// 这里只放形状，不放实现：实现见同目录 fs-node.ts / timer-node.ts。

// 文件服务最小形状（与宿主文件服务同形：resolve 给目标对象，读写按目标读写）。
export interface LogFileService {
  resolve?: (pathStr: string) => Promise<unknown>
  readText?: (target: unknown) => Promise<string>
  writeText?: (target: unknown, text: string) => Promise<unknown>
  mkdir?: (dir: string) => Promise<unknown>
  unlink?: (target: unknown) => Promise<unknown>
  listDir?: (dirTarget: unknown) => Promise<unknown>
  // #21 封存用的原子改名（可选能力）：没有它就降级为「不封存、继续追加」，并记一行 info 自监控，
  // 绝不用「复制 + 截断」冒充原子——那会在中途失败时真丢数据。
  rename?: (from: unknown, to: unknown) => Promise<unknown>
  // 追加写（可选能力，2026-10-14 补）：把 text 接到文件末尾，不读旧文、不覆写。
  // 有它时每次刷盘的写量从 O(全文) 降到 O(新增)；并且两个写者撞上时只会交错、不会整篇覆写
  // （读改写那条路才是「后写者吃掉对方刚写的行」的来源）。缺它就退回读改写，行为不变。
  appendText?: (target: unknown, text: string) => Promise<unknown>
}

// 计时器最小形状（与宿主计时器同形）。
export interface LogTimer {
  timeout: (fn: (...args: unknown[]) => void, ms: number) => unknown
}

export interface LogPlatformPath {
  join: (...parts: string[]) => string
}

// 宿主平台对象里那份 fs 形状（与 LogFileService 同形，分开命名是因为它由 getPlatform() 提供，
// 不是入口注入的那一份）。
export interface LogPlatformFs {
  resolve?: (pathStr: string) => Promise<unknown>
  readText?: (target: unknown) => Promise<string>
  writeText?: (target: unknown, text: string) => Promise<unknown>
  mkdir?: (dir: string) => Promise<unknown>
  unlink?: (target: unknown) => Promise<unknown>
  listDir?: (dirTarget: unknown) => Promise<unknown>
  rename?: (from: unknown, to: unknown) => Promise<unknown>
  appendText?: (target: unknown, text: string) => Promise<unknown>
}

export interface LogPlatform {
  os?: string
  path?: LogPlatformPath
  fs?: LogPlatformFs
}
