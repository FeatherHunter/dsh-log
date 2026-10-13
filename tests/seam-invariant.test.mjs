// tests/seam-invariant.test.mjs —— 读写接缝不变式（0.3.0 Track 1）。
//
// 为什么单独一片：0.3.0 曾带着一个 P1 静默缺陷发布候选——写侧把当日文件封存成 `<日期>.<N>.log`，
// 而读侧（查询/导出/清空）各自用 daily 正则只认 `<日期>.log`。结果是文件一封存，那些行就对读侧整体消失：
// 磁盘 14 行、查询只回 5 行，而且不报错（.local/probe-seam.mjs 实测）。
//
// 118 个用例、37 条变异全绿都没抓住它，原因是断言的分工：
//   · 写侧断言「文件里有多少行」   · 读侧断言「查询能查到什么」   · **没有人测两者的接缝**。
// 变异测试只能证明「已写下的断言咬得住」，发现不了没写的断言。这片就是那条缺掉的断言。
//
// 不变式（每个场景都必须成立）：
//   磁盘上本桶的行多重集  ===  查询能看到的行多重集
// 磁盘那一侧用**本文件自己的正则**枚举文件，不调用包里的解析器——否则解析器一错，两边一起错，接缝又看不见了。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (entry) =>
  import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())
const nodeMod = await load('node.js')

const pad2 = (n) => String(n).padStart(2, '0')
const dayStr = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + (offsetDays || 0))
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-seam-'))
}

// 磁盘那一侧：本文件自己的形状（可写文件 + 任意序号封存件），故意不复用包内解析器。
const DISK_LOG_RE = /^\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/
const DISK_FOUR_RE = /^\d{4}-\d{2}-\d{2}\.[a-z0-9-]+\.\d+\..+\.log$/

async function diskRows(cacheDir, dirName, pattern) {
  const re = pattern || DISK_LOG_RE
  const logDir = path.join(cacheDir, dirName)
  let names = []
  try {
    names = await readdir(logDir)
  } catch (e) {
    void e
    return { names: [], rows: [], raw: '' }
  }
  const files = names.filter((n) => re.test(n)).sort()
  const rows = []
  let raw = ''
  for (const name of files) {
    const text = await readFile(path.join(logDir, name), 'utf8')
    raw += text
    for (const line of text.split('\n')) {
      if (!line) continue
      rows.push(JSON.parse(line))
    }
  }
  return { names: files, rows, raw }
}

// 读侧：一路翻页把桶里所有行取回来（默认查询有 100 上限，不翻页会误判成「读侧少」）。
async function queryAllRows(store) {
  const out = []
  let cursor = null
  for (let guard = 0; guard < 500; guard++) {
    const page = await store.handleLogQuery({ page: { limit: 100, cursor } })
    assert.equal(page.ok, true)
    for (const e of page.entries) out.push(e)
    cursor = page.nextCursor
    if (!cursor) break
  }
  return out
}

const eventsOf = (rows) => rows.map((r) => r.event).sort()
const keysOf = (row) => Object.keys(row).sort().join(',')

async function withStore(cacheDir, id, extra, fn) {
  const h = await nodeMod.createNodeHostLog({ cacheDir }, Object.assign({ pluginId: id, prefix: id }, extra || {}))
  await h.ready
  try {
    await fn(h)
  } finally {
    try {
      h.store.release()
    } catch (e) {
      void e
    }
  }
}

describe('读写接缝不变式（0.3.0 Track 1）', () => {
  it('无轮转：磁盘行多重集 === 查询行多重集（20 行）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await withStore(cacheDir, 'seam-plain', {}, async (h) => {
        for (let i = 0; i < 20; i += 1) h.store.log('warn', 'seam.plain.' + i, { i })
        await h.store.synced()
        const disk = await diskRows(cacheDir, 'logs-seam-plain')
        const q = await queryAllRows(h.store)
        assert.equal(disk.rows.length, 20)
        assert.deepEqual(eventsOf(q), eventsOf(disk.rows), '查询必须看到磁盘上的每一行')
        for (const r of disk.rows) assert.equal(keysOf(r), 'event,fields,level,ts,v')
        for (const r of disk.rows) assert.equal(r.v, 3)
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('轮转封存后：封存件里的行查询照样看得到（D1 回归线，40 行分 8 批）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      // maxSize 很小 → 每批都可能触发封存；分批判写保证封存真的发生（一批写完则 existing 为空、不封存）。
      await withStore(cacheDir, 'seam-rot', { maxSize: 300 }, async (h) => {
        for (let batch = 0; batch < 8; batch += 1) {
          for (let i = 0; i < 5; i += 1) h.store.log('warn', 'seam.rot.' + batch + '.' + i, { pad: 'y'.repeat(40) })
          await h.store.synced()
        }
        const disk = await diskRows(cacheDir, 'logs-seam-rot')
        const sealed = disk.names.filter((n) => /\.\d+\.log$/.test(n))
        assert.ok(sealed.length >= 1, '这个场景必须真的发生封存，否则测不到接缝（实测封存件 ' + sealed.length + ' 个）')
        const userRows = disk.rows.filter((r) => String(r.event).indexOf('seam.rot.') === 0)
        assert.equal(userRows.length, 40, '40 行用户行一行不许丢')
        const q = await queryAllRows(h.store)
        assert.deepEqual(eventsOf(q), eventsOf(disk.rows), '封存件里的行不许对查询消失')
        assert.equal(q.length, disk.rows.length, '读侧行数必须与磁盘行数相等（含自监控行）')
        assert.equal(q.filter((r) => String(r.event).indexOf('seam.rot.') === 0).length, 40)
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('导出接缝：某天的导出文本包含该天全部文件（含封存件），不是只读第一个名字', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await withStore(cacheDir, 'seam-exp', { maxSize: 300 }, async (h) => {
        for (let batch = 0; batch < 5; batch += 1) {
          for (let i = 0; i < 4; i += 1) h.store.log('warn', 'seam.exp.' + batch + '.' + i, { pad: 'z'.repeat(40) })
          await h.store.synced()
        }
        const disk = await diskRows(cacheDir, 'logs-seam-exp')
        const today = dayStr(0)
        const todayFiles = disk.names.filter((n) => n.indexOf(today) === 0)
        assert.ok(todayFiles.length >= 2, '今天应至少有一个可写文件加一个封存件')
        const exp = await h.store.handleLogExport({ date: today })
        assert.equal(exp.ok, true)
        const textRows = String(exp.text || '')
          .split('\n')
          .filter(Boolean)
        const diskTodayRows = disk.rows.filter(() => true).length
        assert.equal(textRows.length, diskTodayRows, '导出必须包含今天所有文件的行（含封存件）')
        assert.equal(exp.bytes, String(exp.text || '').length)
        // 导出文本按写入先后拼接：第一行应是最早那批的行。
        assert.ok(textRows[0].indexOf('seam.exp.0.0') >= 0, '导出顺序应为写入先后（可写文件在最前）')
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('保留清理后：被清掉的那天在磁盘与查询两侧同时消失（不留单侧残影）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const old = dayStr(-3)
      await mkdir(path.join(cacheDir, 'logs-seam-ret'), { recursive: true })
      // ts 取「一小时前」：落在默认查询窗口（近 24h）内，所以只要文件还在，查询就该看得见它——
      // 这样「两侧同时消失」才是真的断言，而不是被时间窗顺手过滤掉的假绿。
      await writeFile(
        path.join(cacheDir, 'logs-seam-ret', old + '.log'),
        JSON.stringify({ v: 3, ts: Date.now() - 3600 * 1000, level: 'warn', event: 'seam.old.row', fields: {} }) + '\n'
      )
      await withStore(cacheDir, 'seam-ret', { maxDays: 2 }, async (h) => {
        h.store.log('warn', 'seam.today.row', {})
        await h.store.synced()
        const disk = await diskRows(cacheDir, 'logs-seam-ret')
        assert.ok(disk.names.indexOf(old + '.log') < 0, 'maxDays=2 时 3 天前的文件必须被保留清理吃掉')
        const q = await queryAllRows(h.store)
        assert.deepEqual(eventsOf(q), eventsOf(disk.rows))
        assert.ok(eventsOf(q).indexOf('seam.old.row') < 0, '被保留清理的行不许还留在查询里')
        assert.ok(eventsOf(q).indexOf('seam.today.row') >= 0)
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('点名清空某一天：磁盘与查询两侧同时少掉那天，今天的行一行不少', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const y = dayStr(-1)
      const recentTs = Date.now() - 3600 * 1000
      await mkdir(path.join(cacheDir, 'logs-seam-clr'), { recursive: true })
      await writeFile(
        path.join(cacheDir, 'logs-seam-clr', y + '.log'),
        JSON.stringify({ v: 3, ts: recentTs, level: 'warn', event: 'seam.y.row', fields: {} }) + '\n'
      )
      // 昨天的封存件：清空必须连它一起删（旧实现 daily 只删 `<日期>.log` 一个名字，封存件会漏）。
      await writeFile(
        path.join(cacheDir, 'logs-seam-clr', y + '.1.log'),
        JSON.stringify({ v: 3, ts: recentTs + 1, level: 'warn', event: 'seam.y.sealed', fields: {} }) + '\n'
      )
      await withStore(cacheDir, 'seam-clr', {}, async (h) => {
        h.store.log('warn', 'seam.today.keep', {})
        await h.store.synced()
        const before = await queryAllRows(h.store)
        assert.ok(eventsOf(before).indexOf('seam.y.sealed') >= 0, '清空前昨天的封存件必须在查询里可见')
        const cleared = await h.store.handleLogClear({ date: y })
        assert.equal(cleared.ok, true)
        assert.equal(cleared.removed, 2, '昨天的可写文件与封存件都要删掉（removed=' + cleared.removed + '）')
        const disk = await diskRows(cacheDir, 'logs-seam-clr')
        const q = await queryAllRows(h.store)
        assert.deepEqual(eventsOf(q), eventsOf(disk.rows), '清空后两侧必须一致')
        assert.deepEqual(eventsOf(q), ['seam.today.keep'])
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('四段式策略下同一条不变式成立（封存件同样可见）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await withStore(cacheDir, 'seam-four', { fileNamePolicy: 'four-segment', maxSize: 300 }, async (h) => {
        for (let batch = 0; batch < 4; batch += 1) {
          for (let i = 0; i < 4; i += 1) h.store.log('warn', 'seam.four.' + batch + '.' + i, { pad: 'q'.repeat(40) })
          await h.store.synced()
        }
        const disk = await diskRows(cacheDir, 'logs-seam-four', DISK_FOUR_RE)
        const userRows = disk.rows.filter((r) => String(r.event).indexOf('seam.four.') === 0)
        assert.equal(userRows.length, 16, '四段式下 16 行用户行一行不许丢')
        assert.ok(
          disk.names.filter((n) => /\.\d+\.log$/.test(n)).length >= 1,
          '四段式也要真的发生封存，否则测不到接缝'
        )
        const q = await queryAllRows(h.store)
        assert.deepEqual(eventsOf(q), eventsOf(disk.rows))
        assert.equal(q.length, disk.rows.length)
      })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
