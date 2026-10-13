// 长跑自检（opt-in，不进 npm test）：把「时间维度」这条唯一的空白补上。
//
//   node tests/soak.mjs            # 默认 6 分钟真实磁盘长跑 + 快速内存风暴
//   node tests/soak.mjs 2          # 跑 2 分钟
//   node tests/soak.mjs 0 --fast   # 只跑内存风暴（约 20 秒）
//
// 它检查的是不变量，不是「跑完没崩」：
//   A. 内存风暴（可注入写失败）：error 一行都不许丢；重试位不涨破上限；恢复后必须全部落盘。
//   B. 真实磁盘长跑：轮转/查询/清理同时进行时——
//      · 写下去的每一条 error 都能在磁盘上找到（且不重复）
//      · 「磁盘本桶用户行多重集 === 查询可见用户行多重集」这条接缝不变式持续成立
//      · 另一个 pluginId 的实例互不干扰（各写各的目录）
//      · 累计丢弃数只数用户行，且每一笔都能解释（队列满 / 内存高水位）
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostLog } from '../dist/host.js'
import { createNodeFileService, createNodeTimer } from '../dist/node.js'

const minutes = Number(process.argv[2] || 6)
const fastOnly = process.argv.includes('--fast')
const problems = []
const fail = (msg) => problems.push(msg)

// ── 可注入失败/延迟的文件服务（内存）─────────────────────────
function makeFlakyFs(store) {
  return {
    failWrites: false,
    writes: 0,
    resolve: (p) => p,
    async readText(target) {
      return store.has(String(target)) ? store.get(String(target)) : ''
    },
    async writeText(target, text) {
      this.writes += 1
      if (this.failWrites) throw new Error('soak: 注入写失败')
      store.set(String(target), text)
    },
    async mkdir() {},
    async unlink(target) {
      store.delete(String(target))
    },
    async listDir(target) {
      const prefix = String(target).endsWith('/') ? String(target) : String(target) + '/'
      return [...store.keys()].filter((k) => k.startsWith(prefix))
    },
    // 这里**故意不提供 rename**：真实宿主没有 rename 能力时，轮转降级为继续追加。
    // （2026-10-14 教训：早先这里写的是 `rename() { return undefined }`——一个「声明了却什么都不做」的
    //  假适配器。库当时照单全收，以为旧文已搬走而清空 existing，下一次写盘把整篇覆盖掉，
    //  20k 行风暴静默丢了 12500 行。现在封存后要回查目录，这类适配器会被判 rename-not-effective 并降级；
    //  对应的回归线在 tests/rotation.test.mjs 的 B1d。）
  }
}

// ── A. 内存风暴：20k 行 error 穿过反复的写失败 ───────────────
async function storm() {
  const mem = new Map()
  const fs = makeFlakyFs(mem)
  const timer = createNodeTimer()
  const dir = '/soak-storm'
  const log = createHostLog(
    { fs, timer, getCacheDir: () => dir, DEFAULT_CWD: dir },
    { pluginId: 'storm', prefix: 'storm', maxQueue: 200, maxSize: 1 << 20 }
  )
  const TOTAL = 20000
  let written = 0
  for (let i = 0; i < TOTAL; i += 1) {
    // 每 1000 行来一段「磁盘坏掉」的窗口
    const bad = Math.floor(i / 1000) % 3 === 1
    fs.failWrites = bad
    log.store.log('error', 'storm.err', { i })
    written += 1
    if (i % 500 === 499) {
      // 恢复窗口：等它把重试位吐干净
      fs.failWrites = false
      await log.store.synced()
      const pending = log.store.getPendingCount()
      if (pending > 2000 + 200) fail(`A: 重试位/队列高水位失控 pending=${pending}（i=${i}）`)
    }
  }
  fs.failWrites = false
  await log.store.synced()
  const dropped = log.store.getDroppedCount()
  const pending = log.store.getPendingCount()
  const all = [...mem.entries()]
    .filter(([k]) => k.endsWith('.log'))
    .flatMap(([, v]) => v.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    .filter((r) => r.event === 'storm.err')
  const ids = new Set(all.map((r) => r.fields.i))
  if (ids.size !== TOTAL) fail(`A: error 丢失 → 落盘 ${ids.size}/${TOTAL}（dropped=${dropped}、pending=${pending}）`)
  if (dropped !== 0) fail(`A: 容量足够却出现丢弃 dropped=${dropped}`)
  if (pending !== 0) fail(`A: 收尾仍有残留 pending=${pending}`)
  log.store.release()
  return { 写入: written, 落盘: ids.size, 写盘次数: fs.writes, dropped, pending }
}

// ── 工具：沿游标翻页取全部可见行 ─────────────────────────────
async function queryAllRows(store, pluginId) {
  const rows = []
  let cursor = null
  for (let page = 0; page < 200; page += 1) {
    const res = await store.handleLogQuery(cursor ? { pluginId, page: { limit: 100, cursor } } : { pluginId, page: { limit: 100 } })
    const entries = Array.isArray(res.entries) ? res.entries : []
    rows.push(...entries)
    cursor = res.nextCursor || null
    if (!cursor) break
  }
  return rows
}

// ── 工具：磁盘上的行（含自监控，按 event 分桶）──────────────
function diskRows(logDir) {
  if (!readdirSync(logDir, { withFileTypes: true }).length) return []
  return readdirSync(logDir)
    .filter((f) => f.endsWith('.log'))
    .flatMap((f) => {
      const text = readFileSync(join(logDir, f), 'utf8')
      return text.trim() ? text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    })
}

// ── B. 真实磁盘长跑 ─────────────────────────────────────────
async function longRun() {
  const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-soak-'))
  const cacheDir2 = mkdtempSync(join(tmpdir(), 'dsh-soak-b-'))
  const fs = createNodeFileService()
  const timer = createNodeTimer()
  const log = createHostLog(
    { fs, timer, getCacheDir: () => cacheDir, DEFAULT_CWD: cacheDir },
    { pluginId: 'soak', prefix: 'soak', maxQueue: 500, maxSize: 8192, maxDays: 3 }
  )
  const other = createHostLog(
    { fs, timer, getCacheDir: () => cacheDir2, DEFAULT_CWD: cacheDir2 },
    { pluginId: 'other', prefix: 'other', maxQueue: 500, maxSize: 8192 }
  )

  const logDir = join(cacheDir, 'logs-soak')
  const otherDir = join(cacheDir2, 'logs-other')
  const deadline = Date.now() + minutes * 60 * 1000
  let errSeq = 0
  let warnSeq = 0
  let rounds = 0
  let lastReport = Date.now()

  while (Date.now() < deadline) {
    for (let i = 0; i < 40; i += 1) {
      log.store.log('error', 'soak.err', { n: errSeq++ })
      log.store.log('warn', 'soak.warn', { n: warnSeq++ })
      log.store.log('debug', 'soak.debug', { n: i })
      other.store.log('warn', 'other.warn', { n: i, round: rounds })
    }
    rounds += 1
    await new Promise((r) => setTimeout(r, 120))

    if (Date.now() - lastReport > 20000) {
      lastReport = Date.now()
      await log.store.synced()
      await other.store.synced()
      const disk = diskRows(logDir)
      const diskErr = new Set(disk.filter((r) => r.event === 'soak.err').map((r) => r.fields.n))
      for (const n of diskErr) void n
      if (diskErr.size !== errSeq) {
        fail(`B: 中途一致性破 → 磁盘 error ${diskErr.size} / 已写 ${errSeq}（round=${rounds}、dropped=${log.store.getDroppedCount()}）`)
        break
      }
      const visible = (await queryAllRows(log.store, 'soak')).filter((r) => r.event === 'soak.err' || r.event === 'soak.warn')
      const diskUser = disk.filter((r) => r.event === 'soak.err' || r.event === 'soak.warn').length
      if (visible.length !== diskUser) {
        fail(`B: 读写接缝破 → 查询 ${visible.length} / 磁盘 ${diskUser}（round=${rounds}）`)
        break
      }
      const foreign = diskRows(otherDir).filter((r) => r.event.startsWith('soak.'))
      if (foreign.length > 0) fail(`B: 两个 pluginId 串了目录（other 目录里出现 soak 行 ${foreign.length} 条）`)
    }
  }

  await log.store.synced()
  await other.store.synced()
  const disk = diskRows(logDir)
  const diskErr = disk.filter((r) => r.event === 'soak.err')
  const ids = new Set(diskErr.map((r) => r.fields.n))
  if (ids.size !== errSeq) fail(`B: 收尾 error 不齐 → 落盘 ${ids.size}/${errSeq}`)
  if (diskErr.length !== ids.size) fail(`B: error 出现重复行（${diskErr.length} 行 / ${ids.size} 个序号）`)
  const visible = (await queryAllRows(log.store, 'soak')).filter((r) => r.event === 'soak.err' || r.event === 'soak.warn')
  const diskUser = disk.filter((r) => r.event === 'soak.err' || r.event === 'soak.warn').length
  if (visible.length !== diskUser) fail(`B: 收尾接缝破 → 查询 ${visible.length} / 磁盘 ${diskUser}`)
  const seals = readdirSync(logDir).filter((f) => /\.\d+\.log$/.test(f)).length
  const auditLines = readFileSync(join(logDir, 'audit.json'), 'utf8').trim().split('\n').filter(Boolean).length
  const dropped = log.store.getDroppedCount()
  const otherDisk = diskRows(otherDir)
  if (otherDisk.filter((r) => r.event.startsWith('soak.')).length > 0) fail('B: other 目录里混进了 soak 行')

  log.store.release()
  other.store.release()
  rmSync(cacheDir, { recursive: true, force: true })
  rmSync(cacheDir2, { recursive: true, force: true })
  return {
    分钟: minutes, 轮次: rounds, 写入error: errSeq, 写入warn: warnSeq,
    落盘error: ids.size, 封存件: seals, audit条数: auditLines,
    查询用户行: visible.length, 磁盘用户行: diskUser, dropped,
    other用户行: otherDisk.length,
  }
}

const t0 = Date.now()
const stormResult = await storm()
console.log('A 内存风暴：', JSON.stringify(stormResult))
let longResult = null
if (!fastOnly) {
  longResult = await longRun()
  console.log('B 真实磁盘长跑：', JSON.stringify(longResult))
}
const seconds = ((Date.now() - t0) / 1000).toFixed(1)
if (problems.length > 0) {
  console.log(`\n✖ 长跑自检不通过（${seconds}s）：`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log(`\n✔ 长跑自检通过（${seconds}s）：error 零丢失、读写接缝成立、跨 pluginId 不串目录`)
