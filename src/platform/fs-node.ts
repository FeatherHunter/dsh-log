// src/platform/fs-node.ts —— node:fs/promises 适配器。
//
// 日志包按「目标对象」读写文件（resolve 出来的是个薄对象），Node 标准库按路径字符串读写，
// 这一层就是那个转接点。全包只有这里 import node:fs。

import { readFile, readdir, mkdir, unlink, writeFile, rename, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LogFileService } from './ports.js'

// 把路径装成一个薄对象。
function resolvePath(pathStr: string): Promise<{ path: string }> {
  return Promise.resolve({ path: String(pathStr) })
}

function targetPath(target: unknown): string {
  if (target && typeof target === 'object' && typeof (target as { path?: unknown }).path === 'string') {
    return (target as { path: string }).path
  }
  return String(target)
}

/**
 * 用 Node 标准库拼出日志包要的文件服务。
 *
 * 两个要点：写之前先建父目录（开关文件写在缓存根目录下，包不建它的父目录），
 * 以及不存在的文件读成空串而不是抛错（第一次运行时当天日志文件还不存在）。
 */
export function createNodeFileService(): LogFileService {
  return {
    resolve: resolvePath,
    async readText(target: unknown): Promise<string> {
      try {
        return await readFile(targetPath(target), 'utf8')
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return ''
        throw e
      }
    },
    async writeText(target: unknown, text: string): Promise<void> {
      const target2 = targetPath(target)
      await mkdir(dirname(target2), { recursive: true })
      await writeFile(target2, text, 'utf8')
    },
    // 追加写（2026-10-14 补）：一次 appendFile 就是一次 O_APPEND 写，不读旧文、不覆写别人的行。
    // 引擎用它把稳态刷盘的写量从 O(全文) 降到 O(新增)。
    async appendText(target: unknown, text: string): Promise<void> {
      const target2 = targetPath(target)
      await mkdir(dirname(target2), { recursive: true })
      await appendFile(target2, text, 'utf8')
    },
    async mkdir(dir: string): Promise<void> {
      await mkdir(String(dir), { recursive: true })
    },
    async unlink(target: unknown): Promise<void> {
      try {
        await unlink(targetPath(target))
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return
        throw e
      }
    },
    async listDir(target: unknown): Promise<string[]> {
      try {
        return await readdir(targetPath(target))
      } catch (e) {
        if (e && (e as { code?: string }).code === 'ENOENT') return []
        throw e
      }
    },
    // #21 封存：rename 是唯一原子动作（同目录内改名），失败就往上抛，由 store 决定降级。
    async rename(from: unknown, to: unknown): Promise<void> {
      await rename(targetPath(from), targetPath(to))
    }
  }
}
