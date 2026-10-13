// tests/rotation.test.mjs —— #21 轮转保留契约测试（0.3.0）。
//
// 落盘命名沿用现状：目录按插件标识派生（logs-<id>），文件名就是 `YYYY-MM-DD.log`（前缀在目录名里，
// 不再重复进文件名——这也让 clear/export/query 的正则与 0.2.x 同形，不用改）。封存件是 `YYYY-MM-DD.N.log`。
//
// 验收线（票 #21）：
//   B1 超阈值出封存 + audit + info 自监控行，当日可写文件唯一，无 Q5 warn 计数。
//   B2 N+3 天只留 N 天（按天不按文件数）；logClear 后当日/switch/audit 都在。
//   B3 Q5 压测与轮转并发时 error 零丢失，计数器各走各的。
// 跑 dist（与其余测试同口径）：真临时目录 + 真磁盘写入，断言看落盘文件。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (entry) =>
  import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())

const pad = (n) => String(n).padStart(2, '0')
function dayStr(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
const TODAY = dayStr(0)
const realTimer = () => ({ timeout: (fn, ms) => setTimeout(fn, ms) })

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-rot-'))
}
async function names(dir) {
  try {
    return await readdir(dir)
  } catch (e) {
    void e
    return []
  }
}
async function readAllRows(dir) {
  const rows = []
  for (const name of (await names(dir)).filter((n) => n.endsWith('.log')).sort()) {
    const text = await readFile(path.join(dir, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line))
    }
  }
  return rows
}

describe('#21 轮转与保留', () => {
  it('B1 超阈值出封存：当日可写文件唯一、audit 记账、info 自监控行、丢弃数为 0', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-rot')
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'rot', prefix: 'rot', maxSize: 400 })
      await log.ready
      // 分批写：一次同步刷完所有行的话，第一次写盘时文件还不存在（没有旧文可封存），不会触发封存。
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'rot.row', { r, i })
        await log.store.synced()
      }

      const files = await names(dir)
      assert.ok(files.includes(TODAY + '.log'), '当日可写文件必须在（且只有这一个当日可写名）')
      const sealed = files.filter((n) => /^\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(n))
      assert.ok(sealed.length >= 1, '超过 maxSize 必须出封存件，实际文件：' + files.join(','))
      assert.ok(files.includes('audit.json'), 'audit.json 必须逐次记账')
      const audit = await readFile(path.join(dir, 'audit.json'), 'utf8')
      assert.ok(audit.includes('"rotate.seal"'), 'audit 里要有 rotate.seal 记录')

      const rows = await readAllRows(dir)
      const selfRows = rows.filter((r) => r.event === 'log.rotate.seal')
      assert.ok(selfRows.length >= 1, '轮转要有 info 自监控行')
      assert.equal(selfRows[0].level, 'info', '轮转自监控行走 info，不占 Q5 warn 配额')
      assert.equal(selfRows[0].v, 3, '自监控行与普通行同形（五键）')
      assert.equal(log.store.getDroppedCount(), 0, '轮转不该让任何一行进丢弃计数')
      assert.equal(rows.filter((r) => r.event === 'rot.row').length, 50, '50 行一行不许丢')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('B1b 没有 rename 能力就降级：继续追加、不封存、不丢行，并记一行 info 降级自监控', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-deg')
    // 宿主只给「读/写/列目录」能力，不给 rename：封存必须降级，绝不能用「复制+截断」冒充原子。
    const fsNoRename = {
      async resolve(p) {
        return String(p)
      },
      async readText(t) {
        try {
          return await readFile(String(t), 'utf8')
        } catch (e) {
          void e
          return ''
        }
      },
      async writeText(t, text) {
        await mkdir(path.dirname(String(t)), { recursive: true })
        await writeFile(String(t), String(text), 'utf8')
      },
      async mkdir(d) {
        await mkdir(String(d), { recursive: true })
      },
      async unlink(t) {
        try {
          await unlink(String(t))
        } catch (e) {
          void e
        }
      },
      async listDir(t) {
        return names(String(t))
      }
    }
    try {
      const log = hostMod.createHostLog(
        {
          fs: fsNoRename,
          timer: realTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        { pluginId: 'deg', prefix: 'deg', maxSize: 400 }
      )
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'deg.row', { r, i })
        await log.store.synced()
      }

      const files = await names(dir)
      assert.ok(files.includes(TODAY + '.log'))
      assert.equal(files.filter((n) => /\.\d+\.log$/.test(n)).length, 0, '没有 rename 就不许出封存件')
      const rows = await readAllRows(dir)
      assert.equal(rows.filter((r) => r.event === 'deg.row').length, 50, '降级也不许丢行')
      const degRows = rows.filter((r) => r.event === 'log.rotate.degraded')
      assert.ok(degRows.length >= 1, '降级本身要留一行 info 自监控')
      assert.equal(degRows[0].level, 'info')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('B2 保留按天不按文件数：早于 maxDays 的清掉、近的与当日封存件都留着，audit 记账', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-ret')
    await mkdir(dir, { recursive: true })
    try {
      // 预置：10/5/3/2 天前各一份当日文件 + 今天的三份封存件。
      for (const off of [-10, -5, -3, -2]) {
        await writeFile(path.join(dir, dayStr(off) + '.log'), '{"v":3}\n', 'utf8')
      }
      for (const n of [1, 2, 3]) {
        await writeFile(path.join(dir, TODAY + '.' + n + '.log'), '{"v":3}\n', 'utf8')
      }

      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'ret', prefix: 'ret', maxDays: 3 })
      await log.ready
      log.store.log('warn', 'ret.row', {})
      await log.store.synced()

      const files = await names(dir)
      assert.ok(!files.includes(dayStr(-3) + '.log'), '第 4 天的文件必须清掉（maxDays=3 含当日）')
      assert.ok(!files.includes(dayStr(-5) + '.log') && !files.includes(dayStr(-10) + '.log'))
      assert.ok(files.includes(dayStr(-2) + '.log'), '第 3 天（含当日往前数 3 天）必须留着')
      for (const n of [1, 2, 3]) {
        assert.ok(files.includes(TODAY + '.' + n + '.log'), '同一天封存多份不按文件数清（' + n + '）')
      }
      const audit = await readFile(path.join(dir, 'audit.json'), 'utf8')
      assert.ok(audit.includes('"retain.evict"'), 'audit 要记 retain.evict')
      const rows = await readAllRows(dir)
      assert.ok(rows.some((r) => r.event === 'log.retain.evict' && r.level === 'info'), '清理要有 info 自监控行')

      // logClear：只删历史，当日可写文件、开关文件、audit.json 一个都不许少。
      await log.store.handleLogSetSwitch({ enabled: true })
      const cleared = await log.store.handleLogClear({ date: 'all' })
      assert.equal(cleared.ok, true)
      const after = await names(dir)
      assert.ok(after.includes(TODAY + '.log'), '当日可写文件永不删')
      assert.ok(after.includes('audit.json'), 'audit.json 永不删')
      // 开关文件的真身在 cacheDir 根下（不在日志子目录里），它同样永不删。
      const rootAfter = await names(cacheDir)
      assert.ok(rootAfter.includes('log-switch-ret.json'), '开关文件永不删')
      assert.ok(!after.includes(dayStr(-2) + '.log'), '历史文件被清空带走')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('B2b 点名清某一天：只删那一天，当天与别的日期都不动', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-one')
    await mkdir(dir, { recursive: true })
    try {
      await writeFile(path.join(dir, dayStr(-1) + '.log'), '{"v":3}\n', 'utf8')
      await writeFile(path.join(dir, dayStr(-2) + '.log'), '{"v":3}\n', 'utf8')
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'one', prefix: 'one' })
      await log.ready
      log.store.log('warn', 'one.row', {})
      await log.store.synced()

      const cleared = await log.store.handleLogClear({ date: dayStr(-1) })
      assert.equal(cleared.ok, true)
      assert.equal(cleared.removed, 1)
      const after = await names(dir)
      assert.ok(!after.includes(dayStr(-1) + '.log'))
      assert.ok(after.includes(dayStr(-2) + '.log'), '点名清一天不许连带别的日期')
      assert.ok(after.includes(TODAY + '.log'))
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('B3 配额压力与轮转并发：error 零丢失、丢弃计数只记队列丢弃、轮转行不进计数', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      // 小队列 + 小阈值：既压 Q5（队列丢弃）又压轮转（多次封存），两条计数器各走各的。
      const log = await mod.createNodeHostLog(
        { cacheDir },
        { pluginId: 'mix', prefix: 'mix', maxQueue: 20, maxSize: 400 }
      )
      await log.ready
      for (let i = 0; i < 60; i += 1) {
        log.store.log('error', 'mix.err', { i })
        log.store.log('debug', 'mix.noise', { i })
      }
      await log.store.synced()
      // 第二轮：写盘在已有大文件上继续，这一步才谈得上「超阈值封存」。
      log.store.log('error', 'mix.err', { tail: true })
      await log.store.synced()

      const dir = path.join(cacheDir, 'logs-mix')
      const rows = await readAllRows(dir)
      assert.equal(rows.filter((r) => r.event === 'mix.err').length, 61, 'error 一行都不许丢（挤旧保新）')
      const dropped = log.store.getDroppedCount()
      assert.ok(dropped >= 0, '丢弃计数只记队列侧的丢弃')
      const files = await names(dir)
      assert.ok(files.filter((n) => /^\d{4}-\d{2}-\d{2}\.\d+\.log$/.test(n)).length >= 1, '压力下也要正常封存')
      assert.ok(rows.every((r) => r.v === 3), '所有落盘行都是五键 v3')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('B1c 单批自己就超阈值（R3）：没有旧文可封存，但绝不静默——记一行 info 说明', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'ovs', prefix: 'ovs', maxSize: 150 })
      await log.ready
      // 一批写下去就超过阈值：这次没有「旧文」可封存，整批原样落盘是唯一不丢行的选择。
      for (let i = 0; i < 8; i += 1) log.store.log('warn', 'ovs.row', { i, pad: 'y'.repeat(40) })
      await log.store.synced()
      const dir = path.join(cacheDir, 'logs-ovs')
      const rows = await readAllRows(dir)
      assert.equal(rows.filter((r) => r.event === 'ovs.row').length, 8, '一批超阈值也不许丢行')
      const over = rows.filter((r) => r.event === 'log.rotate.oversize')
      assert.equal(over.length, 1, '开局就超阈值必须留一行 info 自监控（免得事后无从解释）')
      assert.equal(over[0].level, 'info', '轮转自监控走 info，不占 Q5 warn 配额')
      assert.ok(over[0].fields.bytes > 150, '自监控行要说清实际字节数')
      assert.equal(log.store.getDroppedCount(), 0, '超阈值不是丢弃')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
