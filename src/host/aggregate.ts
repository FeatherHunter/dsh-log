// src/host/aggregate.ts —— 查时授权聚合（S5 从 phones.ts 原样搬出）。
// 跨插件查看只发生在宿主这一层：持授权表逐个去问对应实例的只读电话，再并成一页。
import type { LogQueryAggregateResult, LogQueryArgs, LogQueryEntry, LogQuerySource } from './types.js'

function seqOf(e: LogQueryEntry): number {
  try {
    const f = e && e.fields && typeof e.fields === 'object' ? (e.fields as Record<string, unknown>) : {}
    const s = typeof f.seq === 'number' && isFinite(f.seq) ? (f.seq as number) : 0
    return Math.floor(s)
  } catch (eS) {
    void eS
    return 0
  }
}

export async function aggregateLogQuery(
  requester: string,
  sources: readonly LogQuerySource[],
  grants: readonly string[] | null | undefined,
  args?: LogQueryArgs | null
): Promise<LogQueryAggregateResult> {
  const a: LogQueryArgs = args && typeof args === 'object' ? args : {}
  const allowed = new Set<string>()
  if (typeof requester === 'string' && requester) allowed.add(requester)
  if (grants) {
    for (const g of Array.from(grants)) {
      if (typeof g === 'string' && g) allowed.add(g)
    }
  }
  const wanted = typeof a.pluginId === 'string' && a.pluginId ? a.pluginId : ''
  const denied: string[] = []
  const targets: LogQuerySource[] = []
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || typeof s.query !== 'function' || typeof s.pluginId !== 'string' || !s.pluginId) continue
    if (wanted && s.pluginId !== wanted) continue
    if (allowed.has(s.pluginId)) targets.push(s)
    else denied.push(s.pluginId)
  }
  if (wanted && !allowed.has(wanted)) {
    // 点名要看一个无权看的插件：空集 + denied（哪怕本地正好有同名来源也不给）。
    return { ok: true, entries: [], denied: [wanted], expired: false, nextCursor: null, skipped: 0 }
  }
  const traceId = typeof a.traceId === 'string' && a.traceId ? a.traceId : ''
  let limit = 100
  try {
    const pg = a.page
    if (pg && typeof pg === 'object' && typeof pg.limit === 'number' && isFinite(pg.limit) && pg.limit > 0) {
      limit = Math.floor(pg.limit)
    }
  } catch (eL) {
    void eL
  }
  if (limit > 100) limit = 100
  const entries: LogQueryEntry[] = []
  let expired = false
  let skipped = 0
  for (const s of targets) {
    let r: unknown = null
    try {
      r = await s.query(Object.assign({}, a, { pluginId: s.pluginId }))
    } catch (eQ) {
      void eQ
      continue
    }
    if (!r || typeof r !== 'object') continue
    const rr = r as { entries?: unknown; expired?: unknown; skipped?: unknown }
    if (Array.isArray(rr.entries)) {
      for (const e of rr.entries) {
        if (e && typeof e === 'object') entries.push(e as LogQueryEntry)
      }
    }
    if (rr.expired === true) expired = true
    if (typeof rr.skipped === 'number' && isFinite(rr.skipped)) skipped += Math.floor(rr.skipped)
  }
  if (traceId) {
    entries.sort((x, y) => {
      const sx = seqOf(x)
      const sy = seqOf(y)
      return sx !== sy ? sx - sy : Number(x.ts || 0) - Number(y.ts || 0)
    })
    return { ok: true, entries: entries, denied: denied, expired: expired, nextCursor: null, skipped: skipped, traceChain: true }
  }
  entries.sort((x, y) => Number(y.ts || 0) - Number(x.ts || 0))
  return {
    ok: true,
    entries: entries.slice(0, limit),
    denied: denied,
    expired: expired,
    nextCursor: null,
    skipped: skipped
  }
}
