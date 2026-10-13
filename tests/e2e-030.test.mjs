// tests/e2e-030.test.mjs —— 0.3.0 端到端真机链路：客户端转发 → 宿主电话 → 落盘 → 查询回读 → 开关落盘。
// 为什么单独有这一套：客户端与宿主各自都有单测，但**接缝**从前只用桩（capturing host）验过。
// 上一轮独立复核点名的未验证面正是「客户端↔宿主端到端真机链路」。这里两侧都跑真实现：
// client 的 host.call 打到 registerHostLogPhones 注册的真 handler，宿主入口配真文件服务（createNodeFileService）。
// 用法：先 node build.mjs 再 node --test "tests/*.test.mjs"（只跑本文件亦可）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bust = '?x=' + Date.now()
const hostMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + bust)
const clientMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'client.js')).href + bust)
const nodeMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'node.js')).href + bust)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const WIRED = { pluginId: 'wf', prefix: 'wf' }

async function makeCacheDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-log-e2e-'))
}

// 内存文件服务：可挂起/延迟写盘，用来摆出确定性的租约重叠（同形于 tests/isolation.test.mjs 的受控 fs）。
function makeControlledFs(mem) {
  const ctl = { delayMs: 0 }
  const fsImpl = {
    async resolve(p) {
      return { __t: String(p) }
    },
    async readText(t) {
      if (!mem.has(t.__t)) throw new Error('文件不存在')
      return mem.get(t.__t)
    },
    async writeText(t, text) {
      if (ctl.delayMs > 0) await wait(ctl.delayMs)
      mem.set(t.__t, String(text))
    },
    async mkdir() {},
    async unlink(t) {
      mem.delete(t.__t)
    },
    async listDir(d) {
      const prefix = String(d.__t || d) + path.sep
      const names = []
      for (const k of mem.keys()) if (k.startsWith(prefix)) names.push(k.slice(prefix.length))
      return names
    }
  }
  return { ctl, fs: fsImpl }
}

function memText(mem) {
  return [...mem.values()].join('\n')
}

// 把宿主与客户端接起来：registry 里的真 handler 就是 client 的 host.call 的落点。
function wire(cacheDir, cfg, fsImpl) {
  const hostLog = hostMod.createHostLog(
    {
      fs: fsImpl || nodeMod.createNodeFileService(),
      timer: nodeMod.createNodeTimer(),
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    },
    cfg
  )
  const registry = new Map()
  hostMod.registerHostLogPhones(registry, hostLog)
  const calls = []
  const host = {
    call: async (name, args) => {
      calls.push(name)
      const handler = registry.get(name)
      if (typeof handler !== 'function') throw new Error('没有这个电话：' + name)
      return handler(args)
    }
  }
  const storeMap = new Map()
  const clientLog = clientMod.createClientLog(
    {
      host,
      storage: {
        getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
        setItem: (k, v) => storeMap.set(k, String(v)),
        removeItem: (k) => storeMap.delete(k)
      }
    },
    cfg
  )
  return { hostLog, registry, calls, host, clientLog }
}

describe('0.3.0 端到端真机链路（客户端 ↔ 宿主）', () => {
  it('接缝一：对账跟宿主走，转发真的落盘成 v=3 五键行', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const { hostLog, calls, clientLog } = wire(cacheDir, WIRED)
      // 宿主把开关打开，客户端对账必须跟宿主走（不是本地默认关）。
      await hostLog.store.setSwitch(true)
      const recon = await clientLog.reconcileLogSwitch()
      assert.equal(recon.ok, true)
      assert.equal(recon.enabled, true)
      assert.equal(clientLog.logSwitch.enabled, true)
      assert.ok(calls.includes('wf.logGetSwitch'), '对账要走宿主读开关电话')

      clientLog.log('warn', 'e2e.client.row', { step: 'send' })
      clientLog.log('error', 'e2e.client.boom', { code: 7 })
      const sent = await clientLog.sendLogBatch()
      assert.deepEqual(sent, { ok: true, sent: 2 })
      await hostLog.store.synced()
      assert.equal(hostLog.store.getPendingCount(), 0, 'synced() 后一行都不许压在内存里')

      const logDir = path.join(cacheDir, 'logs')
      const files = await fs.readdir(logDir)
      assert.equal(files.length, 1)
      const rows = (await fs.readFile(path.join(logDir, files[0]), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
      assert.equal(rows.length, 2)
      assert.deepEqual(
        rows.map((r) => ({ v: r.v, level: r.level, event: r.event })),
        [
          { v: 3, level: 'warn', event: 'e2e.client.row' },
          { v: 3, level: 'error', event: 'e2e.client.boom' }
        ]
      )
      assert.deepEqual(Object.keys(rows[0]).sort(), ['event', 'fields', 'level', 'ts', 'v'], '落盘行只有五键')
      // fields 里除调用方给的键之外，还必须有客户端自动注入的追踪三件套（#24）。
      assert.equal(rows[0].fields.step, 'send')
      assert.match(rows[0].fields.traceId, /^[0-9a-f]{16}$/)
      assert.match(rows[0].fields.spanId, /^[0-9a-f]{8}$/)
      assert.equal(rows[0].fields.seq, 0)
      hostLog.store.release()
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('接缝二：查询透传——自己看得见，别家返 denied 且零行', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const { hostLog, calls, clientLog } = wire(cacheDir, WIRED)
      await hostLog.store.setSwitch(true)
      await clientLog.reconcileLogSwitch()
      clientLog.log('error', 'e2e.query.boom', {})
      await clientLog.sendLogBatch()
      await hostLog.store.synced()

      const mine = await clientLog.queryLogs({ pluginId: 'wf', level: 'error' })
      assert.equal(mine.denied, false)
      assert.deepEqual((mine.entries || []).map((e) => e.event), ['e2e.query.boom'])
      assert.ok(calls.includes('wf.logQuery'), '查询透传要走派生出来的查询电话名')

      const other = await clientLog.queryLogs({ pluginId: 'other-plugin' })
      assert.equal(other.denied, true, '查别家必须返 denied，不许静默返空')
      assert.equal((other.entries || []).length, 0)
      hostLog.store.release()
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('接缝三：客户端改开关经宿主电话落到宿主开关文件', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const { hostLog, calls, clientLog } = wire(cacheDir, WIRED)
      await hostLog.store.setSwitch(true)
      await clientLog.reconcileLogSwitch()
      const set = await clientLog.setLogSwitch(false)
      assert.equal(set.ok, true)
      assert.equal(set.enabled, false)
      assert.equal(clientLog.logSwitch.enabled, false)
      assert.ok(calls.includes('wf.logSetSwitch'), '改开关要走宿主写开关电话')
      await hostLog.store.synced()
      const text = await fs.readFile(path.join(cacheDir, 'log-switch.json'), 'utf8')
      assert.deepEqual(JSON.parse(text), { enabled: false }, '开关文件 0.3.0 起只有 enabled')
      hostLog.store.release()
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('接缝四：宿主冲突态拒收时，被拒的行进重试位、到顶只算被拒的那一行', async () => {
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs: memFs } = makeControlledFs(mem)
    try {
      const { hostLog, clientLog } = wire(cacheDir, WIRED, memFs)
      // 第二个实例占住同一日志目录（宿主入口建库不抛，冲突在写盘那一刻判）。
      const holder = hostMod.createHostLog(
        {
          fs: memFs,
          timer: nodeMod.createNodeTimer(),
          getCacheDir: async () => cacheDir,
          getPlatform: async () => null,
          DEFAULT_CWD: cacheDir
        },
        WIRED
      )
      ctl.delayMs = 600
      holder.store.log('warn', 'e2e.holder', {})
      holder.store.flushNow()
      await wait(40) // holder 握着写盘租约（那一批已经在慢写里）
      ctl.delayMs = 0 // 后续写盘恢复正常，别再让开关文件也慢写 600 毫秒
      // 让被接线的那一个先撞一次冲突：写盘等到预算耗尽即判冲突。
      await hostLog.store.setSwitch(true)
      await clientLog.reconcileLogSwitch()
      hostLog.store.log('warn', 'e2e.warmup', {})
      hostLog.store.flushNow()
      await wait(300)
      assert.ok(hostLog.store.getLastPersistFail(), '先确认它已经进了冲突态')

      clientLog.log('error', 'e2e.rejected', {})
      const before = clientLog.getDroppedCount()
      const res = await clientLog.sendLogBatch()
      assert.equal(res.ok, false, '宿主拒收就必须回 ok:false')
      assert.equal(clientLog.logForwardState.lastReason, 'host-reject')
      assert.equal(clientLog.getDroppedCount(), before, '被拒的行先进重试位，不立刻判死（0.3.0 Track 1）')
      // 重试到顶（首次 + 3 次重试）：如实计数，且只算宿主说它拒的那一行——不是整批。
      await wait(50)
      for (let i = 0; i < 6 && clientLog.getDroppedCount() === before; i++) await clientLog.sendLogBatch()
      assert.equal(clientLog.getDroppedCount(), before + 1, '重试到顶后只算被拒的那一行')
      // 被拒的那一行不许出现在共享文件里（冲突态一行都不写）。
      ctl.delayMs = 0
      holder.store.release()
      await wait(200)
      assert.ok(!memText(mem).includes('e2e.rejected'), '冲突态下这行不许落盘')
      hostLog.store.release()
      holder.store.release()
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true })
    }
  })
})
