// tests/paging-20.test.mjs —— #20 A3 分页确定性验收（0.3.0）。
//
// A3 原文：「rotate 瞬间旧游标 expired 回退；并发写翻页无重无漏」。
// 为什么单独一片：分页正确性是「跨两次查询」的性质，散在单次查询的断言里看不到；
// 而 0.2.x 的行偏移游标在 ts 倒序 + 翻页途中追加时必然重复上一页的行
// （.local/probe-paging.mjs 实测复现过），所以这条必须有独立回归线咬住。
//
// 0.3.0 的游标语义：`epoch|ts|文件名|行号`＝上一页最后一行的**物理位置**（keyset 分页）。
// 保证：开始翻页那一刻已存在的行，翻完不重、不漏；翻页途中新追加的行属于下一轮查询。
// 文件集合一变（封存改名 / 清理 / 跨天）→ 旧游标 expired，回第一页重来，不猜位置。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (entry) =>
  import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())
const nodeMod = await load('node.js')
const cfg = (id, extra) => Object.assign({ pluginId: id, prefix: id }, extra || {})
async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-paging-'))
}
// 从第一页一路翻到底，返回「见过的行」与「每页的 expired 标记」。
async function pageThrough(store, limit, cursor) {
  const seen = []
  const expiredFlags = []
  let next = cursor
  for (let guard = 0; guard < 200; guard++) {
    const page = await store.handleLogQuery({ page: { limit: limit, cursor: next } })
    expiredFlags.push(page.expired === true)
    for (const e of page.entries) seen.push(e.event)
    next = page.nextCursor
    if (!next) break
  }
  return { seen: seen, expiredFlags: expiredFlags }
}

describe('#20 A3 分页确定性（0.3.0 keyset 游标）', () => {
  it('翻页途中追加新行：第二页不重复第一页的行，开始翻页时已存在的行一行不漏', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('pg-a'))
      await a.ready
      const before = []
      for (let i = 0; i < 5; i++) {
        a.store.log('warn', 'pg.row.' + String(i), { n: i })
        before.push('pg.row.' + String(i))
      }
      await a.store.synced()

      const p1 = await a.store.handleLogQuery({ page: { limit: 2 } })
      assert.equal(p1.entries.length, 2)
      assert.ok(p1.nextCursor, '还有下一页就该给游标')

      // 翻页途中追加一行更新的行——正是「并发写」的形态（旧偏移游标会在这里重复上一页）。
      a.store.log('warn', 'pg.row.new', { n: 99 })
      await a.store.synced()

      const rest = await pageThrough(a.store, 2, p1.nextCursor)
      const seen = p1.entries.map((e) => e.event).concat(rest.seen)
      assert.equal(new Set(seen).size, seen.length, '任何一行都不得重复出现：' + JSON.stringify(seen))
      for (const ev of before) {
        assert.equal(
          seen.filter((x) => x === ev).length,
          1,
          '开始翻页时已存在的行必须恰好出现一次：' + ev
        )
      }
      assert.ok(!seen.includes('pg.row.new'), '翻页途中追加的行属于下一轮查询，不得插进本次翻页')
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('同 ts 同内容的重复行也能翻完：不重不漏（物理位置天然唯一）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('pg-dup'))
      await a.ready
      for (let i = 0; i < 3; i++) a.store.log('warn', 'dup.same', { k: 1 })
      await a.store.synced()
      const p1 = await a.store.handleLogQuery({ page: { limit: 1 } })
      const rest = await pageThrough(a.store, 1, p1.nextCursor)
      const seen = p1.entries.map((e) => e.event).concat(rest.seen)
      assert.deepEqual(seen, ['dup.same', 'dup.same', 'dup.same'], '三行同内容行都要发出来，且只发一次')
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('封存改名后旧游标 expired 回退第一页（文件集合指纹变了）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const b = await nodeMod.createNodeHostLog({ cacheDir }, cfg('pg-rot', { maxSize: 400 }))
      await b.ready
      for (let i = 0; i < 3; i++) b.store.log('warn', 'pg.b.' + String(i), { pad: 'x'.repeat(60) })
      await b.store.synced()
      const p1 = await b.store.handleLogQuery({ page: { limit: 1 } })
      assert.ok(p1.nextCursor, '第一页应有游标')

      // 再写三行把当天文件顶过 maxSize → 封存（rename 成 .N.log）→ 文件集合变了。
      for (let i = 3; i < 6; i++) b.store.log('warn', 'pg.b.' + String(i), { pad: 'x'.repeat(60) })
      await b.store.synced()

      const p2 = await b.store.handleLogQuery({ page: { limit: 1, cursor: p1.nextCursor } })
      assert.equal(p2.expired, true, '封存后旧游标必须显式 expired')
      assert.ok(p2.entries.length >= 1, 'expired 时从第一页重给，不许回空')
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('旧格式游标（行偏移）安全降级：expired 回第一页，不抛错', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('pg-old'))
      await a.ready
      a.store.log('warn', 'pg.old.row', {})
      await a.store.synced()
      for (const bad of ['2026-10-13#deadbeef|2', 'garbage', 'a|b|c|d|e']) {
        const page = await a.store.handleLogQuery({ page: { limit: 2, cursor: bad } })
        assert.equal(page.ok, true, '坏游标不得让查询失败：' + bad)
        assert.equal(page.expired, true, '认不出的游标一律按过期处理：' + bad)
        assert.ok(page.entries.some((e) => e.event === 'pg.old.row'), '过期即回第一页')
      }
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('清理封存区后旧游标 expired（被删掉的行不猜位置）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const b = await nodeMod.createNodeHostLog({ cacheDir }, cfg('pg-clr', { maxSize: 250 }))
      await b.ready
      // 先塞一份「昨天」的日志文件：清空只删非当日的日志文件（当日 + switch + audit 永不删，见 #21 B2），
      // 所以要有真被删掉的文件，才能验证「文件集合变了 → 旧游标 expired」。
      // 为什么必须落在保留窗口内（昨天，而不是更早）：保留清理（maxDays 缺省 14）在当天第一次写盘时就会清掉
      // 更早的文件，那时清空只能回 removed 0，这条用例就测不到东西（实测：种子 2026-09-01 必被保留清理吃掉）。
      const y = new Date()
      y.setDate(y.getDate() - 1)
      const pad2 = (n) => String(n).padStart(2, '0')
      const pastDate = y.getFullYear() + '-' + pad2(y.getMonth() + 1) + '-' + pad2(y.getDate())
      await mkdir(path.join(cacheDir, 'logs-pg-clr'), { recursive: true })
      await writeFile(path.join(cacheDir, 'logs-pg-clr', pastDate + '.log'), '{"v":3,"ts":1,"level":"warn","event":"pg.past.row","fields":{}}\n')
      b.store.log('warn', 'pg.c.0', { pad: 'x'.repeat(60) })
      await b.store.synced()
      b.store.log('warn', 'pg.c.1', { pad: 'x'.repeat(60) })
      await b.store.synced()
      const p1 = await b.store.handleLogQuery({ page: { limit: 1 } })
      assert.ok(p1.nextCursor, '第一页应有游标')
      // 第三批写盘时当天文件已非空且会超阈值 → 封存成 .N.log；当日封存件受保护，清空删的是昨天那份。
      b.store.log('warn', 'pg.c.2', { pad: 'x'.repeat(60) })
      await b.store.synced()
      const cleared = await b.store.handleLogClear({ date: pastDate })
      assert.equal(cleared.ok, true)
      assert.ok(cleared.removed >= 1, '昨天那份必须真被删掉（否则这条用例测不到东西）')
      const p2 = await b.store.handleLogQuery({ page: { limit: 1, cursor: p1.nextCursor } })
      assert.equal(p2.expired, true, '文件集合变了，旧游标必须 expired')
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
