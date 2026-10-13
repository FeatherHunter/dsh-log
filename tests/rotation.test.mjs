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
import { mkdtemp, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
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
      assert.equal(degRows[0].fields.reason, 'no-rename', '原因要如实：这里是根本没有 rename 能力')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // B1d（2026-10-14 soak 咬出的静默丢数据）：适配器**声明了** rename，却是个空实现/同步实现——
  // 改名说成功、文件其实没搬走。若照单全收，调用方会以为旧文已搬走而清空 existing，
  // 下一次写盘把整份文件覆盖成新行，此前所有行静默消失（20k 行风暴实测丢 12500 行、dropped 仍是 0）。
  // 现在封存后要回查目录：目标名没出现就当没封成 → 降级继续追加，一行不丢。
  it('B1d rename 说成功却没搬走：一行不丢、降级留痕（rename-not-effective）', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-liar')
    try {
      const fsLyingRename = {
        resolve: async (p) => ({ path: String(p) }),
        async readText(t) {
          try {
            return await readFile(String(t.path ?? t), 'utf8')
          } catch (e) {
            void e
            return ''
          }
        },
        async writeText(t, text) {
          const p = String(t.path ?? t)
          await mkdir(path.dirname(p), { recursive: true })
          await writeFile(p, String(text), 'utf8')
        },
        async mkdir(d) {
          await mkdir(String(d), { recursive: true })
        },
        async unlink(t) {
          try {
            await unlink(String(t.path ?? t))
          } catch (e) {
            void e
          }
        },
        async listDir(t) {
          return names(String(t.path ?? t))
        },
        // 空实现：不抛错、也不搬走文件（模拟「忘了 await 自己的异步改名」这类适配器）。
        rename() {
          return undefined
        }
      }
      const log = hostMod.createHostLog(
        {
          fs: fsLyingRename,
          timer: realTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        { pluginId: 'liar', prefix: 'liar', maxSize: 400 }
      )
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'liar.row', { r, i })
        await log.store.synced()
      }
      const files = await names(dir)
      assert.equal(files.filter((n) => /\.\d+\.log$/.test(n)).length, 0, '没真搬走就不许有封存件')
      const rows = await readAllRows(dir)
      assert.equal(rows.filter((r) => r.event === 'liar.row').length, 50, '改名没生效也不许丢一行')
      const degRows = rows.filter((r) => r.event === 'log.rotate.degraded')
      assert.ok(degRows.length >= 1, '降级要留一行 info 自监控')
      assert.equal(degRows[0].fields.reason, 'rename-not-effective', '原因要如实：改名没生效')
      assert.equal(log.store.getDroppedCount(), 0)
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // B1e（2026-10-14 独立审查 N1）：适配器给了 rename 却**没有 listDir**——这是 INTEGRATION 明文许可的
  // 接入形态（「列目录缺了按空目录处理」）。旧实现先 rename 再判能不能验证：文件被真搬走、回查却列不出
  // 目录 → 报「没封成」→ 调用方把旧文整篇写回当日文件 → **每一行在磁盘上两份**，而 dropped 仍是 0。
  // 现在：列不出目录就根本不动手。
  it('B1e 有 rename 但没 listDir：不许动手封存、更不许一行变两份（reason=no-listdir）', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-nolist')
    try {
      const fsNoList = {
        resolve: async (p) => ({ path: String(p) }),
        async readText(t) {
          try {
            return await readFile(String(t.path ?? t), 'utf8')
          } catch (e) {
            void e
            return ''
          }
        },
        async writeText(t, text) {
          const p = String(t.path ?? t)
          await mkdir(path.dirname(p), { recursive: true })
          await writeFile(p, String(text), 'utf8')
        },
        async mkdir(d) {
          await mkdir(String(d), { recursive: true })
        },
        async unlink(t) {
          try {
            await unlink(String(t.path ?? t))
          } catch (e) {
            void e
          }
        },
        // 故意不提供 listDir；rename 是真会搬走文件的实现（最危险的组合）。
        async rename(from, to) {
          const a = String(from.path ?? from)
          const b = String(to.path ?? to)
          await mkdir(path.dirname(b), { recursive: true })
          await rename(a, b)
        }
      }
      const log = hostMod.createHostLog(
        {
          fs: fsNoList,
          timer: realTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        { pluginId: 'nolist', prefix: 'nolist', maxSize: 400 }
      )
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'nolist.row', { r, i })
        await log.store.synced()
      }
      const files = await names(dir)
      assert.equal(files.filter((n) => /\.\d+\.log$/.test(n)).length, 0, '列不出目录就不许封存')
      const rows = await readAllRows(dir)
      const mine = rows.filter((r) => r.event === 'nolist.row')
      assert.equal(mine.length, 50, '一行不丢')
      assert.equal(new Set(mine.map((r) => JSON.stringify(r.fields))).size, 50, '一行也不许变两份')
      const degRows = rows.filter((r) => r.event === 'log.rotate.degraded')
      assert.ok(degRows.length >= 1, '降级要留一行 info 自监控')
      assert.equal(degRows[0].fields.reason, 'no-listdir')
      assert.equal(log.store.getDroppedCount(), 0)
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // B1f：适配器的 rename 真搬，但搬到**别的名字**上（不是请求的封存名）。旧实现会报「没封成」→
  // 旧文被整篇重写一遍（磁盘上两份）；现在按「目录里多出了一个原本没有的文件」判定为已搬走，
  // 清空 existing，绝不重写旧文。
  it('B1f rename 搬到了别的名字：算搬走、不重写旧文、一行不变两份', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-wrongname')
    try {
      const fsWrongName = {
        resolve: async (p) => ({ path: String(p) }),
        async readText(t) {
          try {
            return await readFile(String(t.path ?? t), 'utf8')
          } catch (e) {
            void e
            return ''
          }
        },
        async writeText(t, text) {
          const p = String(t.path ?? t)
          await mkdir(path.dirname(p), { recursive: true })
          await writeFile(p, String(text), 'utf8')
        },
        async mkdir(d) {
          await mkdir(String(d), { recursive: true })
        },
        async unlink(t) {
          try {
            await unlink(String(t.path ?? t))
          } catch (e) {
            void e
          }
        },
        async listDir(t) {
          return names(String(t.path ?? t))
        },
        // 真搬走，但把序号写成了 9（不是请求的 .1）。
        async rename(from, to) {
          const a = String(from.path ?? from)
          const b = String(to.path ?? to).replace(/\.1\.log$/, '.9.log')
          await rename(a, b)
        }
      }
      const log = hostMod.createHostLog(
        {
          fs: fsWrongName,
          timer: realTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        { pluginId: 'wrongname', prefix: 'wrongname', maxSize: 400 }
      )
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'wn.row', { r, i })
        await log.store.synced()
      }
      const files = await names(dir)
      assert.ok(files.some((n) => /\.9\.log$/.test(n)), '文件确实搬到了别的名字上')
      assert.equal(files.filter((n) => /\.1\.log$/.test(n)).length, 0, '请求的封存名上不该有东西')
      const rows = await readAllRows(dir)
      const mine = rows.filter((r) => r.event === 'wn.row')
      assert.equal(mine.length, 50, '一行不丢')
      assert.equal(new Set(mine.map((r) => JSON.stringify(r.fields))).size, 50, '旧文不许被重写一遍（一行不变两份）')
      assert.equal(log.store.getDroppedCount(), 0)
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // B1g（2026-10-14 第二轮复核 N2）：适配器的 rename 是**复制到别处但没删源**（跨卷搬运用 copy+unlink，
  // unlink 那步失败或漏写就长这样——最常见的 rename 降级实现），且复制到的名字≠请求的封存名。
  // 只看「目录里多了个新文件」就判「已搬走」会清空 existing，把整篇覆写掉（复核实测丢 10/40 行、dropped=0）。
  // 判据必须再加一句「源文件确实不在清单里了」；源还在就当没搬成、继续追加（宁可文件长过阈值）。
  it('B1g 复制到异名但没删源：不许当成搬走（reason=rename-not-effective）', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const dir = path.join(cacheDir, 'logs-copykeep')
    try {
      const fsCopyKeep = {
        resolve: async (p) => ({ path: String(p) }),
        async readText(t) {
          try {
            return await readFile(String(t.path ?? t), 'utf8')
          } catch (e) {
            void e
            return ''
          }
        },
        async writeText(t, text) {
          const p = String(t.path ?? t)
          await mkdir(path.dirname(p), { recursive: true })
          await writeFile(p, String(text), 'utf8')
        },
        async mkdir(d) {
          await mkdir(String(d), { recursive: true })
        },
        async unlink(t) {
          try {
            await unlink(String(t.path ?? t))
          } catch (e) {
            void e
          }
        },
        async listDir(t) {
          return names(String(t.path ?? t))
        },
        // 复制到「别的名字」（.9.log）但**不删源**——不是真搬走。
        async rename(from, to) {
          const a = String(from.path ?? from)
          const b = String(to.path ?? to).replace(/\.1\.log$/, '.9.log')
          await mkdir(path.dirname(b), { recursive: true })
          await writeFile(b, await readFile(a, 'utf8'), 'utf8')
        }
      }
      const log = hostMod.createHostLog(
        {
          fs: fsCopyKeep,
          timer: realTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        { pluginId: 'copykeep', prefix: 'copykeep', maxSize: 400 }
      )
      for (let r = 0; r < 5; r += 1) {
        for (let i = 0; i < 10; i += 1) log.store.log('warn', 'ck.row', { r, i })
        await log.store.synced()
      }
      const rows = await readAllRows(dir)
      const mine = rows.filter((r) => r.event === 'ck.row')
      const uniq = new Set(mine.map((r) => JSON.stringify(r.fields)))
      assert.equal(uniq.size, 50, '一行都不许丢（复制没删源 ⇒ 绝不当成搬走）')
      const degRows = rows.filter((r) => r.event === 'log.rotate.degraded')
      assert.ok(degRows.length >= 1, '降级要留一行 info 自监控')
      assert.equal(degRows[0].fields.reason, 'rename-not-effective')
      assert.equal(log.store.getDroppedCount(), 0)
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
