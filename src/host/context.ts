// src/host/context.ts —— 电话上下文的公共判定（S5 从 phones.ts 原样搬出）。
// 冲突态查询、目标对象拆盒、目录清单、今天日期、pid/启动时间：三个电话实现共用这一份，各自不再抄一遍。
import { formatDailyFileName } from '../config.js'
import type { LogPhonesContext } from './types.js'

export function dirConflictOf(ctx: LogPhonesContext): string {
  try {
    return typeof ctx.getDirConflict === 'function' ? String(ctx.getDirConflict() || '') : ''
  } catch (e) {
    void e
    return ''
  }
}

export function targetToPath(t: unknown, fb: string): string {
  if (typeof t === 'string') return t
  if (t && typeof t === 'object') {
    const c = (t as Record<string, unknown>).displayPath || (t as Record<string, unknown>).path
    if (typeof c === 'string' && c) return c
  }
  return typeof fb === 'string' && fb ? fb : ''
}

export async function listFileNames(
  ctx: LogPhonesContext,
  logDir: string
): Promise<string[]> {
  const { fs, getPlatform, resolveTarget } = ctx
  try {
    const platform = typeof getPlatform === 'function' ? await getPlatform() : null
    const listFn =
      platform && platform.fs && typeof platform.fs.listDir === 'function'
        ? platform.fs.listDir.bind(platform.fs)
        : fs && typeof fs.listDir === 'function'
          ? fs.listDir.bind(fs)
          : null
    if (!listFn) return []
    const dirTarget = await resolveTarget(logDir)
    const entries = (await listFn(dirTarget)) as Array<string | { name?: unknown }>
    if (!Array.isArray(entries)) return []
    return entries.map((x) => (typeof x === 'string' ? x : (x && typeof x.name === 'string' ? x.name : '')))
  } catch (e) {
    void e
    return []
  }
}

export function todayDateStr(): string {
    try {
      return formatDailyFileName(new Date()).replace(/\.log$/, '')
    } catch (e) {
      void e
      return ''
    }
  }

export function pidOf(ctx: LogPhonesContext): number {
    try {
      if (typeof ctx.getPid === 'function') return ctx.getPid()
      const header = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
      if (header && typeof header.pid === 'number') return header.pid
      const g = globalThis as { process?: { pid?: unknown } }
      return (g.process && typeof g.process.pid === 'number' ? g.process.pid : 0) || 0
    } catch (e) {
      void e
      return 0
    }
  }

export function startedAtOf(ctx: LogPhonesContext): string {
    try {
      if (typeof ctx.getStartedAt === 'function') return ctx.getStartedAt()
      const header = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
      return (header && header.startedAt) || ''
    } catch (e) {
      void e
      return ''
    }
  }
