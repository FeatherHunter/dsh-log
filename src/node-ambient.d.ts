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
  // 2026-10-15 读侧工具补 isFile/isDirectory/ino：CLI 要用它区分目录与文件，并靠 ino 认出「rename 后还是同一个文件」。
  // 本包只用到这几个成员——`types: []` 下声明越窄越不会与真 @types/node 冲突。
  export function stat(path: string): Promise<{ size: number; ino?: number; isFile(): boolean; isDirectory(): boolean }>
  export function unlink(path: string): Promise<void>
  export function writeFile(path: string, data: string, encoding: string): Promise<void>
}

declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}

declare module 'node:url' {
  // 只声明读侧工具用到的那一个：把 import.meta.url 变成文件路径（找 package.json 取版本号）。
  export function fileURLToPath(url: string | URL): string
}

// 计时器用运行环境自带的全局函数（与包内 store.ts 同口径，不引入 Node 专属类型）。
declare function setTimeout(fn: (...args: unknown[]) => void, ms: number): unknown

// 读侧 CLI 用到的最小 process 形状：参数、退出、stdout/stderr、终端判定、环境变量。
// 引擎两侧（宿主与浏览器闭包）都不用 process，所以这些声明只服务于入口层与 platform。
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  exit(code?: number): void
  exitCode?: number
  stdout: { write(text: string): boolean; isTTY?: boolean }
  stderr: { write(text: string): boolean }
}

// URL 由运行环境提供（Node 与浏览器都有），但 `lib: ["ES2020"]` 里没有它，故声明最小形状。
declare class URL {
  constructor(input: string, base?: string | URL)
  readonly pathname: string
  readonly href: string
}

// `import.meta.url` 同样不在 lib: ["ES2020"] 里（它由 DOM 或 @types/node 提供）。
// 本包只用它一次：读侧 CLI 由自己所在位置往上找 package.json 取版本号。
interface ImportMeta {
  readonly url: string
}
