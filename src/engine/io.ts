// src/engine/io.ts —— 引擎的 IO 端口（路径拼接、目标解析、读/写）。
//
// S4 第二块：从 store.ts 原样搬出，行为零变化。它把两件事收在一处：
//   ① 「路径 → 目标对象」的转换：宿主平台对象优先，其次入口注入的文件服务，都没有就原样返回路径字符串；
//   ② 读/写的服务选择：注入的 fs 优先，其次平台对象的 fs，两者都没有就抛中文错（绝不假装写成功）。
// 调用点仍用同名局部引用（组合根接线），所以这次搬迁对 store.ts 的其余代码零扰动。
import type { LogFileService, LogPlatform } from '../platform/ports.js'
import { utf8Bytes } from '../core/row.js'

// 单次追加的字节上限（2026-10-14 对抗审查实测后定）。
//
// 为什么要有它：`appendText` 走的是 O_APPEND 写，而**大块写不保证原子**——两个进程各自
// `appendFile` 一大段时，一个的字节会被插进另一个中间，落成半行 JSON。实测
// （`.local/probe-append-big.mjs`，两个真子进程、各 20 行、每行 pad 到 64KB）：40 行里 2 行读不出来；
// 把行缩到 4KB（60×2 行）则 0 条坏行。
//
// 所以在**行边界**上把批次切成 ≤ 4096 字节的块、一块一次追加：块与块之间只会在「行与行之间」交错，
// 不会把某一行撕成两半。代价是多几次系统调用（写量仍是 O(新增)）；换来的是一条不变量：
// 同一目录里的多个写者不会互相写出半边 JSON。
export const APPEND_ATOMIC_MAX = 4096

/**
 * 把一个批次按行边界切成 ≤ APPEND_ATOMIC_MAX 字节的若干块（块内至少一整行）。
 *
 * 单行自己就超过上限时它自成一个块——切开必然产生半行，不切只是「这一行大了点」，
 * 两害相权取其轻（这条边界写在 README 的追加路段里）。
 */
export function splitForAppend(text: string): string[] {
  if (utf8Bytes(text) <= APPEND_ATOMIC_MAX) return [text]
  const pieces: string[] = []
  let buf = ''
  let line = ''
  for (let i = 0; i < text.length; i += 1) {
    line += text[i]
    if (text.charCodeAt(i) !== 10) continue // 只按 '\n' 断行；行内字符（含代理对）原样保留
    if (buf !== '' && utf8Bytes(buf + line) > APPEND_ATOMIC_MAX) {
      pieces.push(buf)
      buf = ''
    }
    buf += line
    line = ''
    if (utf8Bytes(buf) >= APPEND_ATOMIC_MAX) {
      pieces.push(buf)
      buf = ''
    }
  }
  if (line !== '') {
    // 末尾没有换行的残段（正常批次不会出现，留着防手写调用）
    if (buf !== '' && utf8Bytes(buf + line) > APPEND_ATOMIC_MAX) {
      pieces.push(buf)
      buf = ''
    }
    buf += line
  }
  if (buf !== '') pieces.push(buf)
  return pieces.length > 0 ? pieces : [text]
}

export interface EngineIoInput {
  fs?: LogFileService | null
  getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null
}

export interface EngineIo {
  joinPath: (a: string, b: string) => string
  joinLogPath: (dir: string, name: string) => Promise<string>
  resolveTarget: (pathStr: string) => Promise<unknown>
  readTarget: (target: unknown) => Promise<string>
  writeTarget: (target: unknown, text: string) => Promise<unknown>
  // 追加写能力（2026-10-14 补）：canAppend 先问「有没有」，appendTarget 才真的追加——
  // 用能力查询而不是「抛错再兜底」，因为「没有追加原语」是正常形态（宿主只给读写时就走读改写）。
  canAppend: () => Promise<boolean>
  appendTarget: (target: unknown, text: string) => Promise<unknown>
  // 文件长度查询（可选能力，2026-10-14 对抗审查补）：追加路要能**独立**确认「我写进去的字节真的在文件里」。
  // `appendText` 的返回值不算独立证据（适配器可以撒谎），`stat` 是。没有它就退回「按需回读」，
  // 见 pipeline 里的 APPEND_VERIFY_EVERY：有 stat 每次追加都核对，没有就每 N 次回读一次。
  canSize: () => Promise<boolean>
  sizeOfTarget: (target: unknown) => Promise<number | null>
}

/**
 * 按 UTF-8 字节偏移取后缀（`sliceUtf8Tail`）——修补「只写了一部分」时用它算出还没落地的剩余。
 *
 * 偏移落在多字节字符中间时，从该字符的开头返回（宁可多写一个字符，也不写出半个字符）。
 */
export function sliceUtf8Tail(text: string, byteOffset: number): string {
  if (byteOffset <= 0) return text
  let bytes = 0
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    if (bytes + size > byteOffset) return text.slice(i)
    bytes += size
    i += cp > 0xffff ? 2 : 1
  }
  return ''
}

export function createEngineIo(input: EngineIoInput): EngineIo {
  const fs = input.fs
  const getPlatform = input.getPlatform

  function joinPath(a: string, b: string): string {
    return String(a).replace(/\/+$/, '') + '/' + String(b).replace(/^\/+/, '')
  }
  async function joinLogPath(dir: string, name: string): Promise<string> {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.path && typeof platform.path.join === 'function') {
        return platform.path.join(dir, name)
      }
    } catch (e) {
      void e
    }
    return joinPath(dir, name)
  }
  async function resolveTarget(pathStr: string): Promise<unknown> {
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.resolve === 'function') {
        return await platform.fs.resolve(pathStr)
      }
    } catch (e) {
      void e
    }
    try {
      if (fs !== undefined && fs !== null && typeof fs.resolve === 'function') {
        return await fs.resolve(pathStr)
      }
    } catch (e2) {
      void e2
    }
    return pathStr
  }
  async function readTarget(target: unknown): Promise<string> {
    if (fs !== undefined && fs !== null && typeof fs.readText === 'function') {
      return await fs.readText(target)
    }
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.readText === 'function') {
      return await platform.fs.readText(target)
    }
    throw new Error('文件服务不可读')
  }
  async function writeTarget(target: unknown, text: string): Promise<unknown> {
    if (fs !== undefined && fs !== null && typeof fs.writeText === 'function') {
      return await fs.writeText(target, text)
    }
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.writeText === 'function') {
      return await platform.fs.writeText(target, text)
    }
    throw new Error('文件服务不可写')
  }

  // 追加能力的选择顺序与读/写一致：入口注入的 fs 优先，其次平台对象的 fs。
  async function canAppend(): Promise<boolean> {
    if (fs !== undefined && fs !== null && typeof fs.appendText === 'function') return true
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    return Boolean(platform && platform.fs && typeof platform.fs.appendText === 'function')
  }
  async function appendTarget(target: unknown, text: string): Promise<unknown> {
    if (fs !== undefined && fs !== null && typeof fs.appendText === 'function') {
      return await fs.appendText(target, text)
    }
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    if (platform && platform.fs && typeof platform.fs.appendText === 'function') {
      return await platform.fs.appendText(target, text)
    }
    throw new Error('文件服务不支持追加')
  }

  // 长度查询的选择顺序同上；查不到（没能力、文件还不存在、stat 抛错）一律回 null —— 意思是「观察不到」，
  // 由调用方决定是回读补看还是沿用记账，绝不把「观察不到」当成「写成功了」。
  async function canSize(): Promise<boolean> {
    if (fs !== undefined && fs !== null && typeof fs.sizeOf === 'function') return true
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    return Boolean(platform && platform.fs && typeof platform.fs.sizeOf === 'function')
  }
  async function sizeOfTarget(target: unknown): Promise<number | null> {
    const pick = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
    try {
      if (fs !== undefined && fs !== null && typeof fs.sizeOf === 'function') {
        return pick(await fs.sizeOf(target))
      }
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.sizeOf === 'function') {
        return pick(await platform.fs.sizeOf(target))
      }
    } catch (e) {
      void e
    }
    return null
  }

  return {
    joinPath,
    joinLogPath,
    resolveTarget,
    readTarget,
    writeTarget,
    canAppend,
    appendTarget,
    canSize,
    sizeOfTarget,
  }
}
