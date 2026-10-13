// src/host/query.ts —— 只读查询电话（S5 从 phones.ts 原样搬出）。
// 本实例只读自己的桶：跨插件看只能经 aggregate.ts 的授权聚合。
import { LOG_FORMAT_VERSION, listLogFiles } from '../config.js'
import { hash8 } from '../core/ids.js'
import { listFileNames, todayDateStr } from './context.js'
import type { LogPhonesContext, LogQueryArgs, LogQueryEntry, LogQueryPageArg, LogQueryResult, LogQueryTimeRange } from './types.js'

export function createLogQueryHandler(ctx: LogPhonesContext) {
  const config = ctx.config
  async function handleLogQuery(rawArgs?: LogQueryArgs | null): Promise<LogQueryResult> {
    const args: LogQueryArgs = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
    let wantPlugin = config.pluginId
    try {
      if (typeof args.pluginId === 'string' && args.pluginId) wantPlugin = args.pluginId
    } catch (e) {
      void e
      wantPlugin = config.pluginId
    }
    if (wantPlugin !== config.pluginId) return { ok: true, entries: [], denied: true }
    const nowMs = Date.now()
    let endMs = nowMs
    let startMs = nowMs - 24 * 3600 * 1000
    try {
      const tr = args.timeRange as { start?: unknown; end?: unknown } | null | undefined
      if (tr && typeof tr === 'object') {
        if (typeof tr.end === 'number' && isFinite(tr.end)) endMs = Math.floor(tr.end)
        else if (typeof tr.end === 'string' && tr.end) {
          const t = Date.parse(tr.end)
          if (isFinite(t)) endMs = t
        }
        if (typeof tr.start === 'number' && isFinite(tr.start)) startMs = Math.floor(tr.start)
        else if (typeof tr.start === 'string' && tr.start) {
          const t2 = Date.parse(tr.start)
          if (isFinite(t2)) startMs = t2
        }
      }
    } catch (e2) {
      void e2
    }
    if (!(startMs <= endMs)) return { ok: true, entries: [], denied: false, expired: false, nextCursor: null, skipped: 0 }
    let levelSet: Set<string> | null = null
    try {
      const lv = args.level as unknown
      if (typeof lv === 'string' && lv) levelSet = new Set([lv])
      else if (Array.isArray(lv) && lv.length > 0) {
        const parts = (lv as unknown[]).filter((x) => typeof x === 'string') as string[]
        if (parts.length > 0) levelSet = new Set(parts)
      }
    } catch (e3) {
      void e3
      levelSet = null
    }
    let keyword: string | null = null
    try {
      if (typeof args.keyword === 'string' && args.keyword) keyword = args.keyword
    } catch (e4) {
      void e4
    }
    let traceId: string | null = null
    try {
      if (typeof args.traceId === 'string' && args.traceId) traceId = args.traceId
    } catch (e5) {
      void e5
    }
    const isTraceChain = !!traceId
    let limit = isTraceChain ? 1000000 : 50
    let cursor: string | null = null
    try {
      const pg = args.page as { cursor?: unknown; limit?: unknown } | null | undefined
      if (pg && typeof pg === 'object') {
        if (typeof pg.cursor === 'string' && pg.cursor) cursor = pg.cursor
        if (typeof pg.limit === 'number' && isFinite(pg.limit) && (pg.limit as number) > 0) limit = Math.floor(pg.limit as number)
        else if (typeof pg.limit === 'string' && pg.limit) {
          const n = parseInt(pg.limit as string, 10)
          if (isFinite(n) && n > 0) limit = Math.floor(n)
        }
      }
    } catch (e6) {
      void e6
    }
    if (!isTraceChain && limit > 100) limit = 100
    if (!(limit >= 1)) limit = isTraceChain ? 1000000 : 50
    try {
      const dir = typeof ctx.getCacheDir === 'function' ? await ctx.getCacheDir() : null
      if (!dir) return { ok: true, entries: [], denied: false, expired: false, nextCursor: null, skipped: 0 }
      const logDir = await ctx.joinLogPath(dir, config.logDirName)
      const names = await listFileNames(ctx, logDir)
      // 本桶日志文件＝解析得通的文件（封存件也在内），按写入先后排。旧实现用 daily 正则只认
      // `YYYY-MM-DD.log`，文件一封存那些行就对查询整体不可见（0.3.0 接缝修复，tests/seam-invariant.test.mjs 钉住）。
      const matched = listLogFiles(config, names).map((info) => info.name)
      const todayQ = todayDateStr()
      // epoch＝一天的文件集合指纹（#20 A3）：旋转/封存/清理都会改这份指纹，旧游标一律 expired。
      const epoch = todayQ + '#' + hash8(matched.join('|'))
      // 游标＝「上一页最后一行的物理位置」：`epoch|ts|文件名|行号`（keyset 分页）。
      // 为什么不用行偏移：排序键是 ts 倒序，翻页途中追加一行更新的行会把整表下移一格，
      // 偏移游标必然把上一页的最后一行再发一次（.local/probe-paging.mjs 实测复现）。
      // 物理位置在「只追加」的当天文件里不随追加改变，而且天然唯一——同 ts 同内容的重复行也分得清。
      let cursorKey: { ts: number; file: string; line: number } | null = null
      let expired = false
      if (cursor) {
        try {
          const sep = cursor.indexOf('|')
          const cEpoch = sep > 0 ? cursor.slice(0, sep) : ''
          const rest = sep > 0 ? cursor.slice(sep + 1) : ''
          const parts = rest.split('|')
          const cTs = parseInt(parts[0], 10)
          const cLine = parseInt(parts[2], 10)
          if (cEpoch !== epoch || parts.length !== 3 || !parts[1] || !isFinite(cTs) || !isFinite(cLine)) {
            expired = true
          } else {
            cursorKey = { ts: Math.floor(cTs), file: parts[1], line: Math.floor(cLine) }
          }
        } catch (eC) {
          void eC
          expired = true
        }
      }
      const bag: Array<{ ts: number; level: string; event: string; fields: Record<string, unknown>; seq: number; file: string; line: number }> = []
      let skipped = 0
      for (let fi = 0; fi < matched.length; fi++) {
        let text = ''
        try {
          const target = await ctx.resolveTarget(await ctx.joinLogPath(logDir, matched[fi]))
          text = await ctx.readTarget(target)
        } catch (eR) {
          void eR
          continue
        }
        if (!text) continue
        const lines = String(text).split('\n')
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]
          if (!line) continue
          let row: Record<string, unknown> | null = null
          try {
            row = JSON.parse(line) as Record<string, unknown>
          } catch (eP) {
            void eP
            skipped += 1
            continue
          }
          if (!row || typeof row !== 'object') {
            skipped += 1
            continue
          }
          if ((row as { v?: unknown }).v !== LOG_FORMAT_VERSION) {
            skipped += 1
            continue
          }
          const rawTs = (row as { ts?: unknown }).ts
          const ts = typeof rawTs === 'number' && isFinite(rawTs) ? Math.floor(rawTs) : NaN
          if (!isFinite(ts)) {
            skipped += 1
            continue
          }
          if (ts < startMs || ts > endMs) continue
          const lv2 = typeof (row as { level?: unknown }).level === 'string' ? ((row as { level: string }).level) : ''
          if (levelSet && !levelSet.has(lv2)) continue
          const ev = typeof (row as { event?: unknown }).event === 'string' ? ((row as { event: string }).event) : ''
          const flRaw = (row as { fields?: unknown }).fields
          const fl: Record<string, unknown> = flRaw && typeof flRaw === 'object' && !Array.isArray(flRaw)
            ? (flRaw as Record<string, unknown>)
            : {}
          if (traceId) {
            const fTid = typeof fl.traceId === 'string'
              ? (fl.traceId as string)
              : (typeof (row as { traceId?: unknown }).traceId === 'string' ? ((row as { traceId: string }).traceId) : null)
            if (fTid !== traceId) continue
          }
          if (keyword) {
            let hay = ''
            try {
              hay = ev + ' ' + JSON.stringify(fl)
            } catch (eH) {
              void eH
              hay = ev
            }
            if (hay.indexOf(keyword) < 0) continue
          }
          let seq = 0
          try {
            const sRaw = typeof fl.seq === 'number' && isFinite(fl.seq)
              ? (fl.seq as number)
              : (typeof (row as { seq?: unknown }).seq === 'number' && isFinite((row as { seq: number }).seq)
                ? ((row as { seq: number }).seq)
                : 0)
            seq = Math.floor(sRaw)
            if (!isFinite(seq)) seq = 0
          } catch (eS) {
            void eS
            seq = 0
          }
          bag.push({ ts: ts, level: lv2, event: ev, fields: fl, seq: seq, file: matched[fi], line: li })
        }
      }
      if (isTraceChain) {
        bag.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.ts - b.ts))
        const entries: LogQueryEntry[] = bag.map((r) => ({ ts: r.ts, level: r.level, event: r.event, fields: r.fields }))
        return { ok: true, entries: entries, denied: false, expired: false, nextCursor: null, skipped: skipped, traceChain: true }
      }
      bag.sort((a, b) => b.ts - a.ts)
      // keyset 分页：先按物理位置找回上一页最后一行，从它的下一行接着发。
      let start = 0
      if (cursorKey) {
        const idx = bag.findIndex(
          (r) => r.ts === cursorKey.ts && r.file === cursorKey.file && r.line === cursorKey.line
        )
        if (idx < 0) {
          // 游标那行不在了（封存改名、被清理）：不猜位置，回第一页并显式报 expired。
          expired = true
          start = 0
        } else {
          start = idx + 1
        }
      }
      const slice = bag.slice(start, start + limit)
      const entries: LogQueryEntry[] = slice.map((r) => ({ ts: r.ts, level: r.level, event: r.event, fields: r.fields }))
      const last = slice.length > 0 ? slice[slice.length - 1] : null
      const nextCursor =
        last && start + slice.length < bag.length
          ? epoch + '|' + String(last.ts) + '|' + last.file + '|' + String(last.line)
          : null
      if (expired) return { ok: true, entries: entries, denied: false, expired: true, nextCursor: nextCursor, skipped: skipped }
      return { ok: true, entries: entries, denied: false, expired: false, nextCursor: nextCursor, skipped: skipped }
    } catch (e) {
      void e
      return { ok: true, entries: [], denied: false, expired: false, nextCursor: null, skipped: 0 }
    }
  }

  return { handleLogQuery: handleLogQuery }
}
