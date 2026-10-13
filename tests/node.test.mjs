// packages/dsh-log/tests/node.test.mjs —— Node 程序入口（dsh-log/node）单测。
//
// 只测外部行为：拿一个真实临时目录当缓存目录，看日志真的落到哪、写了什么、
// 级别规则与开关在独立进程里成不成立。不测内部私有函数。
//
// 用法：先 node packages/dsh-log/build.mjs，再 node --test packages/dsh-log/tests/node.test.mjs。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 每次都拿一份新的模块副本，模块级单例不会在用例之间串。 */
async function freshNodeEntry() {
  return import(pathToFileURL(path.join(PKG_DIR, 'dist', 'node.js')).href + '?x=' + Date.now() + Math.random())
}

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-node-'))
}

/** 读当天日志的正文；没有文件就当空串。 */
async function readLogText(cacheDir, dirName) {
  try {
    const files = await readdir(path.join(cacheDir, dirName))
    const logFile = files.find((n) => n.endsWith('.log'))
    if (!logFile) return ''
    return readFile(path.join(cacheDir, dirName, logFile), 'utf8')
  } catch {
    return ''
  }
}

describe('Node 程序入口：日志包能在独立 Node 程序里直接用', () => {
  it('快捷入口 1 行可用：createQuickLog 只给目录即落盘（#19 默认入口）', async () => {
    const mod = await freshNodeEntry()
    assert.equal(typeof mod.createQuickLog, 'function')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createQuickLog(cacheDir)
      assert.equal(log.store.config.pluginId, 'quick')
      log.store.log('warn', 'skill.step.fail', { step: 'quick' })
      await log.ready
      assert.match(await readLogText(cacheDir, 'logs-quick'), /"step":"quick"/)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('三件事齐备：建库、写、等落盘', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'probe-one', prefix: 'probe-one' })
      assert.equal(typeof log.store.log, 'function')
      assert.equal(typeof log.store.isEnabled, 'function')
      assert.equal(typeof log.store.flush, 'function')
      assert.equal(typeof log.store.getDroppedCount, 'function')
      assert.equal(typeof log.ready.then, 'function')
      log.store.log('warn', 'skill.step.fail', { step: 'fetch', reason: 'timeout' })
      await log.ready
      const text = await readLogText(cacheDir, 'logs-probe-one')
      assert.match(text, /"event":"skill\.step\.fail"/)
      assert.equal(log.store.getDroppedCount(), 0)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('落点只由调用方给的目录决定，不读环境变量', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    const otherDir = await makeCacheDir()
    const before = { SKILLS_DB_PATH: process.env.SKILLS_DB_PATH, DSH_LOG_DIR: process.env.DSH_LOG_DIR }
    try {
      // 故意摆上几个像「日志目录」的环境变量，看入口会不会偷偷跟着走。
      process.env.SKILLS_DB_PATH = otherDir
      process.env.DSH_LOG_DIR = otherDir
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'probe-two', prefix: 'probe-two' })
      log.store.log('warn', 'skill.step.fail', { step: 'env' })
      await log.ready
      assert.match(await readLogText(cacheDir, 'logs-probe-two'), /"step":"env"/)
      assert.equal(await readLogText(otherDir, 'logs-probe-two'), '')
    } finally {
      if (before.SKILLS_DB_PATH === undefined) delete process.env.SKILLS_DB_PATH
      else process.env.SKILLS_DB_PATH = before.SKILLS_DB_PATH
      if (before.DSH_LOG_DIR === undefined) delete process.env.DSH_LOG_DIR
      else process.env.DSH_LOG_DIR = before.DSH_LOG_DIR
      await rm(cacheDir, { recursive: true, force: true })
      await rm(otherDir, { recursive: true, force: true })
    }
  })

  it('目录由标识派生：日志子目录与开关文件名跟着标识走', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'calorie', prefix: 'calorie' })
      assert.equal(log.store.config.logDirName, 'logs-calorie')
      assert.equal(log.store.config.switchFileName, 'log-switch-calorie.json')
      log.store.log('warn', 'skill.step.fail', { step: 'naming' })
      await log.ready
      const entries = await readdir(cacheDir)
      assert.ok(entries.includes('logs-calorie'), '应派生日志子目录 logs-calorie')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('调用方给的目录还不存在时自己建：开关与日志都落得下去', async () => {
    const mod = await freshNodeEntry()
    const base = await makeCacheDir()
    const nested = path.join(base, 'not-yet', 'deeper')
    try {
      const log = await mod.createNodeHostLog({ cacheDir: nested }, { pluginId: 'probe-nested', prefix: 'probe-nested' })
      log.store.log('warn', 'skill.step.fail', { step: 'nested' })
      const setOut = await log.store.handleLogSetSwitch({ enabled: true })
      await log.ready
      assert.equal(setOut.ok, true)
      const entries = await readdir(nested)
      assert.ok(entries.includes('log-switch-probe-nested.json'), '开关文件应写在给的目录下')
      assert.ok(entries.includes('logs-probe-nested'), '日志子目录应被建出来')
      const switchText = await readFile(path.join(nested, 'log-switch-probe-nested.json'), 'utf8')
      assert.match(switchText, /"enabled":true/)
      assert.equal(log.store.getDroppedCount(), 0)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  it('级别规则照旧：告警恒落，信息只在开关打开后落', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const first = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'probe-level', prefix: 'probe-level' })
      first.store.log('warn', 'skill.step.fail', { step: 'always' })
      first.store.log('info', 'skill.run.start', { step: 'before-switch' })
      await first.ready
      const textBefore = await readLogText(cacheDir, 'logs-probe-level')
      assert.match(textBefore, /"step":"always"/)
      assert.ok(!textBefore.includes('before-switch'), '开关没开时非常驻信息不应落盘')

      await first.store.handleLogSetSwitch({ enabled: true })

      // 换一个进程（新实例）再写：开关应还在，信息这次要落盘。
      // 0.3.0 隔离口径（#19）：同一日志目录同时只许一个活跃写者，所以先让第一个实例收尾并交还目录
      // （synced 等它真刷完、release 交还常驻持有），第二个实例才能接管同一目录——这正是「旧进程已退出」的等价写法。
      await first.store.synced()
      first.store.release()
      const second = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'probe-level', prefix: 'probe-level' })
      second.store.log('info', 'skill.run.start', { step: 'after-switch' })
      await second.ready
      second.store.release()
      const textAfter = await readLogText(cacheDir, 'logs-probe-level')
      assert.match(textAfter, /"step":"after-switch"/)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('一行一条 JSON：落盘内容带时间戳、级别、事件名与字段对象', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'probe-shape', prefix: 'probe-shape' })
      log.store.log('warn', 'skill.step.fail', { step: 'parse' })
      await log.ready
      const text = (await readLogText(cacheDir, 'logs-probe-shape')).trim().split('\n')
      const last = JSON.parse(text[text.length - 1])
      assert.equal(typeof last.ts, 'number')
      assert.equal(last.level, 'warn')
      assert.equal(last.event, 'skill.step.fail')
      assert.deepEqual(last.fields, { step: 'parse' })
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('不给目录直接报错，不猜位置', async () => {
    const mod = await freshNodeEntry()
    await assert.rejects(() => mod.createNodeHostLog({}, { pluginId: 'probe', prefix: 'probe' }), /cacheDir/)
    await assert.rejects(() => mod.createNodeHostLog({ cacheDir: '' }, { pluginId: 'probe', prefix: 'probe' }), /cacheDir/)
  })

  it('文件服务的边角：读不存在的文件当空、删不存在的文件不报错、列不到目录当空', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const fs = mod.createNodeFileService()
      const target = await fs.resolve(path.join(cacheDir, 'nothing.log'))
      assert.equal(await fs.readText(target), '')
      await fs.unlink(target)
      assert.deepEqual(await fs.listDir(await fs.resolve(path.join(cacheDir, 'no-such-dir'))), [])
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('写盘失败只计数不抛错：换个不可写的落点再写，程序照样往下跑', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const broken = {
        resolve: async (p) => ({ path: p }),
        readText: async () => {
          throw new Error('模拟读不了')
        },
        writeText: async () => {
          throw new Error('模拟写不了')
        }
      }
      const log = await mod.createNodeHostLog(
        { cacheDir, fs: broken },
        { pluginId: 'probe-broken', prefix: 'probe-broken' }
      )
      assert.doesNotThrow(() => log.store.log('warn', 'skill.step.fail', { step: 'broken' }))
      await assert.doesNotReject(() => log.ready)
      assert.ok(log.store.getDroppedCount() >= 0)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // 下面两条是 2026-10-14 独立对抗审查必改 #2/#3 的回归线：ready 从前写一行 debug 级
  // log.flush.marker 当路标——默认开关关着时它自己是 skipped（基准行根本不落盘，靠 6 轮
  // flushNow + 10ms 蒙混），而且写盘失败时 ready 照样 resolve，调用方以为落定了、磁盘零行。
  it('ready 回执说真话：落定了 ok 为真；写盘失败时 ok 为假并给出 pending 与最近一次失败', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    let failWrites = false
    const mem = new Map()
    const flaky = {
      resolve: async (p) => ({ path: p }),
      readText: async (t) => (mem.has(t.path) ? mem.get(t.path) : ''),
      writeText: async (t, text) => {
        if (failWrites) throw new Error('模拟磁盘写不了')
        mem.set(t.path, text)
      },
      mkdir: async () => {}
    }
    const diskText = () => {
      let text = ''
      for (const [k, v] of mem) if (k.endsWith('.log')) text += v
      return text
    }
    try {
      const log = await mod.createNodeHostLog(
        { cacheDir, fs: flaky },
        { pluginId: 'ready-report', prefix: 'ready-report' }
      )
      // ① 落定路径：ok 为真，且没有内部基准行混进用户文件
      log.store.log('warn', 'ready.ok.row', { n: 1 })
      const good = await log.ready
      assert.equal(good.ok, true)
      assert.equal(good.pending, 0)
      assert.equal(good.lastPersistFail, null)
      assert.match(diskText(), /"event":"ready\.ok\.row"/)
      assert.ok(!diskText().includes('log.flush.marker'), '内部基准行不许进用户文件')

      // ② 写盘失败路径：ok 为假、pending > 0、定位元有形，磁盘上不许有这一行
      failWrites = true
      log.store.log('error', 'ready.fail.row', { n: 2 })
      const bad = await log.ready
      assert.equal(bad.ok, false)
      assert.ok(bad.pending > 0, '没落定就要如实报 pending')
      assert.ok(bad.lastPersistFail, '要给出最近一次失败的定位元')
      assert.equal(bad.lastPersistFail.op, 'writeBatch')
      assert.equal(bad.lastPersistFail.reason, 'write-fail')
      assert.ok(!bad.lastPersistFail.dirHash.includes(cacheDir), '定位元不带真实路径')
      assert.ok(!diskText().includes('ready.fail.row'), '写失败的行不能假装落盘')

      // ③ 磁盘恢复后再读一次 ready：行补落盘、回执转真
      failWrites = false
      const recovered = await log.ready
      assert.equal(recovered.ok, true)
      assert.equal(recovered.pending, 0)
      assert.match(diskText(), /"event":"ready\.fail\.row"/)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('开关打开时也不写内部基准行：用户文件里只有用户的行', async () => {
    const mod = await freshNodeEntry()
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createQuickLog(cacheDir)
      await log.store.setSwitch(true)
      log.store.log('info', 'ready.info.row', { n: 3 })
      const report = await log.ready
      assert.equal(report.ok, true)
      const text = await readLogText(cacheDir, 'logs-quick')
      assert.match(text, /"event":"ready\.info\.row"/)
      assert.ok(!text.includes('log.flush.marker'), '开关打开也不许写内部路标行')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
