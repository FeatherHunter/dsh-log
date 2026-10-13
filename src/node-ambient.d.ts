/**
 * packages/dsh-log/src/node-ambient.d.ts —— Node 程序入口（node.ts）实际用到的 Node 内建能力最小形状。
 *
 * 为什么不用 @types/node：本包至今不引入任何 Node 专属类型（tsconfig 的 types 为空），
 * 引擎两侧要保持「宿主与浏览器闭包都能跑」；加 @types/node 等于给每个消费者带一份类型依赖。
 * 所以这里只声明 node.ts 真正用到的几个函数形状，类型检查只认这里写的形状。
 * 新增 Node 能力先补这里，再在实现里用；其余源文件不许引用本文件声明的模块。
 */

declare module 'node:fs' {
  // 只声明本包用到的那一个：realpathSync.native 把目录键归一到真实路径
  // （同一目录的不同写法/符号链接必须撞同一个键，见 store.ts 的 normalizeLogDir）。
  export const realpathSync: { (path: string): string; native(path: string): string }
}

declare module 'node:fs/promises' {
  // 追加写（2026-10-14 补）：引擎用它把稳态刷盘的写量从 O(全文) 降到 O(新增)。
  export function appendFile(path: string, data: string, encoding: string): Promise<void>
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>
  export function readFile(path: string, encoding: string): Promise<string>
  export function readdir(path: string): Promise<string[]>
  // #21 封存用的原子改名（同目录内 from -> to）。
  export function rename(from: string, to: string): Promise<void>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  // 文件长度（2026-10-14 对抗审查补）：追加路用它独立核对「刚追加的字节真的在文件里」。
  // 本包只用到 size，其余 stat 字段不声明——`types: []` 下声明越窄越不会与真 @types/node 冲突。
  export function stat(path: string): Promise<{ size: number }>
  export function unlink(path: string): Promise<void>
  export function writeFile(path: string, data: string, encoding: string): Promise<void>
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

// 计时器用运行环境自带的全局函数（与包内 store.ts 同口径，不引入 Node 专属类型）。
declare function setTimeout(fn: (...args: unknown[]) => void, ms: number): unknown
