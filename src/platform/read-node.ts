// src/platform/read-node.ts —— 读侧工具（CLI）需要的文件能力：只读、可失败、不抛错。
//
// 为什么单开一个 platform 文件：本包的纪律是「`node:` 内置只出现在 platform 层与入口 node.ts」
// （tests/arch.test.mjs 钉着）。CLI 要列目录/读文件，那是 IO，属于 platform；
// CLI 自己只做参数、筛选与渲染，于是它能被单测喂假数据跑，也能在浏览器里被复用（渲染部分在 core）。
//
// 第一性原理：读侧工具面对的是**外部输入**——目录可能没有、文件可能正被写、可能刚被改名。
// 所以这一层的每个函数都以「观察不到就返回 null」为契约，绝不用异常当控制流：
// 「读不到」与「读到了空」是两件不同的事，调用方必须能区分（前者该说「没找到」，后者该正常跳过）。

import { fileURLToPath } from 'node:url'
import { readFile, readdir, stat } from 'node:fs/promises'

export type PathKind = 'file' | 'dir' | 'missing'

/** 文件身份与大小：follow 模式靠 `ino` 认「还是不是同一个文件」（rename 后 ino 不变、path 变）。 */
export interface FileStat {
  size: number
  ino: string
  kind: PathKind
}

export async function pathKind(path: string): Promise<PathKind> {
  try {
    const info = await stat(path)
    if (info.isDirectory()) return 'dir'
    if (info.isFile()) return 'file'
    return 'missing'
  } catch {
    return 'missing'
  }
}

export async function statFile(path: string): Promise<FileStat | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    // ino 在部分文件系统上可能缺失（0）；缺失时退化成用路径当身份，功能仍在，只是改名后会被当成新文件。
    const ino = typeof info.ino === 'number' && info.ino > 0 ? String(info.ino) : `path:${path}`
    return { size: info.size, ino: ino, kind: 'file' }
  } catch {
    return null
  }
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function listDirNames(path: string): Promise<string[] | null> {
  try {
    const names = await readdir(path)
    return Array.isArray(names) ? names : null
  } catch {
    return null
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms)
  })
}

/** 从某个模块 URL 往上找一份 package.json 的版本号（CLI 的 `--version` 用它，避免版本号写第二份）。 */
export async function packageVersionNear(moduleUrl: string): Promise<string | null> {
  const text = await readTextFile(fileURLToPath(new URL('../package.json', moduleUrl)))
  if (text === null) return null
  try {
    const pkg = JSON.parse(text) as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}
