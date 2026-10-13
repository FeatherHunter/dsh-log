// src/engine/io.ts —— 引擎的 IO 端口（路径拼接、目标解析、读/写）。
//
// S4 第二块：从 store.ts 原样搬出，行为零变化。它把两件事收在一处：
//   ① 「路径 → 目标对象」的转换：宿主平台对象优先，其次入口注入的文件服务，都没有就原样返回路径字符串；
//   ② 读/写的服务选择：注入的 fs 优先，其次平台对象的 fs，两者都没有就抛中文错（绝不假装写成功）。
// 调用点仍用同名局部引用（组合根接线），所以这次搬迁对 store.ts 的其余代码零扰动。
import type { LogFileService, LogPlatform } from '../platform/ports.js'

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

  return { joinPath, joinLogPath, resolveTarget, readTarget, writeTarget, canAppend, appendTarget }
}
