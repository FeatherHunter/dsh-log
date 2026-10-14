// src/host/files.ts —— 导出与清空电话（S5 从 phones.ts 原样搬出）。
// 碰文件系统的破坏性/读取路径：冲突态一律降级为失败形状，绝不碰共享目录。
import { formatDailyFileName, listLogFiles, logFilesOfDate, matchExportFileName, parseLogFileName, resolveLogFileName } from '../config.js'
import { hash8 } from '../core/ids.js'
import { dirConflictOf, listFileNames, pidOf as pidOfOf, startedAtOf as startedAtOfOf, targetToPath } from './context.js'
import type { LogPhonesContext } from './types.js'

export function createLogFileHandlers(ctx: LogPhonesContext) {
  const config = ctx.config
  // context.ts 里的 pidOf / startedAtOf 收 ctx 显式传入（原为闭包）：这里包回原名，搬运的函数体一字不改。
  const pidOf = (): number => pidOfOf(ctx)
  const startedAtOf = (): string => startedAtOfOf(ctx)
  function isProtectedLogFile(name: string, todayDate: string): boolean {
    try {
      if (name === config.switchFileName) return true
      if (name === 'audit.json') return true
      if (name.length > 10 && name.indexOf('audit.json') === name.length - 10) return true
      // 当天（含当天已封存的分段）一律保护：走解析器取日期，不靠字符串前缀猜。
      const info = parseLogFileName(config, name)
      if (info && todayDate && info.date === todayDate) return true
      return false
    } catch (e) {
      void e
      return false
    }
  }

  function todayDateStr(): string {
    try {
      return formatDailyFileName(new Date()).replace(/\.log$/, '')
    } catch (e) {
      void e
      return ''
    }
  }

  async function handleLogExport(args: { date?: unknown; [key: string]: unknown }) {
    // 冲突态（#19 隔离）：本实例不是这个目录的活跃写者，导出不读共享目录（回失败形状、不抛）。
    if (dirConflictOf(ctx)) {
      return { ok: false, fileName: '', bytes: 0, fallback: true, text: '', summary: null, dir: '', path: '' }
    }
    const headerInfo = typeof ctx.getHeaderInfo === 'function' ? ctx.getHeaderInfo() : null
    const now = new Date()
    const fallbackFileName = resolveLogFileName(config, now, pidOf(), startedAtOf())
    const want = args && args.date ? String(args.date) : formatDailyFileName(now).replace(/\.log$/, '')
    // 多余字段现状忽略（例如多传 format:'zip' 也不改变行为），保零变化。
    void (args && (args as Record<string, unknown>).format)
    try {
      const dir = typeof ctx.getCacheDir === 'function' ? await ctx.getCacheDir() : null
      if (!dir) {
        try {
          ctx.log('warn', 'host.call.fail', { method: config.prefix + '.logExport', kind: 'export', errorHash: hash8('no-dir') })
        } catch (eL) {
          void eL
        }
      }
      const baseDir = dir || (headerInfo && headerInfo.dir) || ctx.DEFAULT_CWD || ''
      const logDir = baseDir ? await ctx.joinLogPath(baseDir, config.logDirName) : ''
      let fileName = fallbackFileName
      let text = ''
      // 0.3.0 接缝修复：导出某一天要导出**那一天的全部文件**，按写入先后拼接（可写文件在前、封存件按序号）。
      // 旧实现只读 `want + '.log'` 一个名字——文件一旦被封存，那个名字就不存在了，导出静默回空文本。
      try {
        if (/^\d{4}-\d{2}-\d{2}$/.test(want) && logDir) {
          const files = logFilesOfDate(config, await listFileNames(ctx, logDir), want)
          if (files.length > 0) {
            fileName = files[files.length - 1].name
            const parts: string[] = []
            for (let i = 0; i < files.length; i += 1) {
              try {
                const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, files[i].name))
                const one = await ctx.readTarget(target)
                if (one) parts.push(String(one))
              } catch (eOne) {
                void eOne
              }
            }
            text = parts.join('')
          } else {
            // 该日期一个文件都没有：保留旧回退形状（fileName 用回退名、文本为空）。
            fileName = matchExportFileName(config, [], want, fallbackFileName)
          }
        } else if (logDir) {
          const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, fileName))
          text = await ctx.readTarget(target)
        }
      } catch (e) {
        void e
        text = ''
      }
      let osName = ''
      try {
        const platform = typeof ctx.getPlatform === 'function' ? await ctx.getPlatform() : null
        const g = globalThis as { process?: { platform?: unknown } }
        osName = (platform && platform.os) || (typeof g.process !== 'undefined' ? String(g.process.platform) : '') || ''
      } catch (e2) {
        void e2
      }
      let cwdNow = ctx.DEFAULT_CWD || ''
      try {
        const g = globalThis as { process?: { cwd?: () => string } }
        cwdNow = g.process && g.process.cwd ? g.process.cwd() : ctx.DEFAULT_CWD || ''
      } catch (e3) {
        void e3
      }
      const summary = {
        // 版本只认真记下来的：启动头里记了就用它，没记就 unknown——
        // 拿「读日志那个进程」的版本顶替就是写错事实（research/18 §2.2）。
        pluginVersion: (headerInfo && headerInfo.pluginVersion) || 'unknown',
        os: osName,
        cwd: cwdNow,
        logSwitch: ctx.getSwitchState(),
        header: headerInfo
      }
      let dirOut = logDir
      let pathOut = ''
      try {
        dirOut = targetToPath(await ctx.resolveTarget(logDir), logDir)
        pathOut = targetToPath(await ctx.resolveTarget(await ctx.joinLogPath(logDir, fileName)), ctx.joinPath(logDir, fileName))
      } catch (e4) {
        void e4
        try {
          pathOut = ctx.joinPath(logDir, fileName)
        } catch (e5) {
          void e5
          pathOut = ''
        }
      }
      if (!dirOut && !pathOut && baseDir) {
        try {
          dirOut = ctx.joinPath(baseDir, config.logDirName)
          pathOut = ctx.joinPath(dirOut, fileName)
        } catch (e6) {
          void e6
        }
      }
      // 上两处拆盒与回退链只产字符串，类型另由门禁断言。
      return {
        ok: true,
        fileName: fileName,
        bytes: String(text || '').length,
        fallback: true,
        text: String(text || ''),
        summary: summary,
        dir: dirOut,
        path: pathOut
      }
    } catch (e) {
      try {
        ctx.log('warn', 'host.call.fail', {
          method: config.prefix + '.logExport',
          kind: 'export',
          errorHash: hash8(String((e as Error && (e as Error).message) || e))
        })
      } catch (eL) {
        void eL
      }
      return { ok: false, fileName: fallbackFileName, bytes: 0, fallback: true }
    }
  }

  async function handleLogClear(args: { date?: unknown }) {
    const want = args && args.date ? String(args.date) : ''
    const today = todayDateStr()
    // 冲突态（#19 隔离）：本实例不是这个目录的活跃写者，破坏性路径一律不碰共享文件。
    // 曾漏过这里：冲突态下 logClear 照样 listDir + unlink，把别人正在写的目录删空（#19 审查必改 5）。
    if (dirConflictOf(ctx)) return { ok: false, removed: 0 }
    try {
      const dir = typeof ctx.getCacheDir === 'function' ? await ctx.getCacheDir() : null
      if (!dir) return { ok: true, removed: 0 }
      const logDir = await ctx.joinLogPath(dir, config.logDirName)
      if (want === 'all') {
        let removedAll = 0
        const files = listLogFiles(config, await listFileNames(ctx, logDir))
        for (let i = 0; i < files.length; i++) {
          if (isProtectedLogFile(files[i].name, today)) continue
          if (await deleteOneFile(logDir, files[i].name)) removedAll += 1
        }
        return { ok: true, removed: removedAll }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) {
        try {
          ctx.log('warn', 'host.call.fail', { method: config.prefix + '.logClear', kind: 'clear', errorHash: hash8('bad-date') })
        } catch (eL) {
          void eL
        }
        return { ok: false, removed: 0 }
      }
      // 当日文件永不删：点名删今天直接回空成功，不碰文件。
      if (want === today) return { ok: true, removed: 0 }
      // 点名某一天：删那一天**全部**日志文件（可写文件 + 全部封存件）。旧实现按策略分两支、daily 只删
      // `want + '.log'` 一个名字——那天被轮转过的话文件早改名了，清空会静默删 0 个（0.3.0 接缝修复）。
      let removed = 0
      const filesOfDay = logFilesOfDate(config, await listFileNames(ctx, logDir), want)
      for (let i = 0; i < filesOfDay.length; i++) {
        if (isProtectedLogFile(filesOfDay[i].name, today)) continue
        if (await deleteOneFile(logDir, filesOfDay[i].name)) removed += 1
      }
      return { ok: true, removed: removed }
    } catch (e) {
      try {
        ctx.log('warn', 'host.call.fail', {
          method: config.prefix + '.logClear',
          kind: 'clear',
          errorHash: hash8(String((e as Error && (e as Error).message) || e))
        })
      } catch (eL) {
        void eL
      }
      return { ok: false, removed: 0 }
    }
  }

  async function deleteOneFile(logDir: string, name: string): Promise<boolean> {
    const { fs, getPlatform } = ctx
    try {
      const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, name))
      try {
        if (fs && typeof fs.unlink === 'function') {
          await fs.unlink(target)
          return true
        }
      } catch (e) {
        void e
      }
      try {
        const platform = typeof getPlatform === 'function' ? await getPlatform() : null
        if (platform && platform.fs && typeof platform.fs.unlink === 'function') {
          await platform.fs.unlink(target)
          return true
        }
      } catch (e2) {
        void e2
      }
      try {
        await ctx.writeTarget(target, '')
        return true
      } catch (e3) {
        void e3
        return false
      }
    } catch (e) {
      void e
      return false
    }
  }

  return { handleLogExport: handleLogExport, handleLogClear: handleLogClear }
}
