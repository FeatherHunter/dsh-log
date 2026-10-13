// tests/isolation.test.mjs —— #19 全栈隔离契约测试（0.3.0 新契约，P0 验收线）。
//
// 为什么单独一片：隔离是「跨实例、跨层」的性质，散在 host/node/client 各自的单测里只能看到自己那一层，
// 看不到「A 狂打 + B 空闲，B 零变化」这种跨层断言。本片按 #19 验收线逐层断言，任一串删即红：
//
//   L1 电话名    pluginId 与 prefix 双必填；撞名直接抛、不覆盖旧的
//   L2 日志目录  同一日志目录第二个活跃写者建库当场抛；release() 后可接管且是追加；不同 id 自动分目录
//   L3 开关文件  log-switch-<id>.json 派生：A 改开关只动自己的文件
//   L4 客户端键  dsws.debug.<id> 命名空间：读不到别家的键、写也只写自己的
//   L5 全局函数  裸全局 dswsLogHash/dswsLogTrunc 已删；散列改为依赖注入
//
// 跑 dist（与其余测试同口径）：真临时目录 + 真磁盘写入，断言看落盘文件里的行，不看队列对象。
// 计时器默认用「死计时器」（回调永不触发），把「等时间」从断言里排除；只有写盘冲突那一条
// 必须用真计时器——那条测的性质就是「有界等待后用冲突收场」，等不到时间就测不了。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, rmdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 每次都拿一个全新的模块实例：模块级目录所有权登记是进程级状态，测试之间不能互相看见。
const load = (entry) =>
  import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())

const cfg = (id, extra) => Object.assign({ pluginId: id, prefix: id }, extra || {})
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// 死计时器：回调永不执行。用于「不该有定时器参与」的用例。
const deadTimer = () => ({ timeout: () => ({}) })
// 真计时器：需要真超时语义（有界等待）的用例才用。
const realTimer = () => ({ timeout: (fn, ms) => setTimeout(fn, ms) })

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-iso-'))
}
function switchPath(cacheDir, id) {
  return path.join(cacheDir, id === 'wf' ? 'log-switch.json' : 'log-switch-' + id + '.json')
}
async function readTextOrEmpty(file) {
  try {
    return await readFile(file, 'utf8')
  } catch (e) {
    void e
    return ''
  }
}
// 读某实例日志目录里当天全部落盘行（按文件名排序后逐行解析 JSON）。
async function readRows(cacheDir, dirName) {
  const dir = path.join(cacheDir, dirName)
  let names = []
  try {
    names = await readdir(dir)
  } catch (e) {
    void e
    return []
  }
  const rows = []
  for (const name of names.filter((n) => n.endsWith('.log')).sort()) {
    const text = await readFile(path.join(dir, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim()) rows.push(JSON.parse(line))
    }
  }
  return rows
}
const events = (rows) => rows.map((r) => r.event)

describe('#19 全栈隔离（五层契约）', () => {
  it('L1 电话名：双必填缺一即抛；撞名直接抛且不覆盖旧的', async () => {
    const hostMod = await load('host.js')
    // 宿主入口现在要求 deps.getCacheDir（缺了建库即抛，见 createHostLog 的注释）：本用例不写盘，
    // 但依赖形状要如实——真实宿主一定有取缓存目录的函数。
    const noopDeps = { getCacheDir: async () => 'C:/noop-cache' }

    // 双必填：缺任一项建库即抛（fail-loud 建库期，不静默给默认值）。
    const missingPrefix = [
      ['缺 pluginId', { prefix: 'iso-ph' }],
      ['缺 prefix', { pluginId: 'iso-ph' }]
    ]
    for (const [label, input] of missingPrefix) {
      assert.throws(() => hostMod.createHostLog(noopDeps, input), /必填/, label + ' 应抛中文错')
    }

    const registry = new Map()
    const reg = { has: (n) => registry.has(n), set: (n, h) => registry.set(n, h) }
    const first = hostMod.createHostLog(noopDeps, cfg('iso-ph'))
    const names = hostMod.registerHostLogPhones(reg, first)
    // #20 接线：5 个冻结动作 + 第 6 个只读查询电话（名字由 buildLogQueryPhoneName 单源派生）。
    assert.equal(registry.size, 6, '五个冻结动作 + 只读查询应各注册一个电话名')
    assert.equal(names.logBatch, 'iso-ph.logBatch')
    assert.ok(registry.has('iso-ph.logQuery'), '第 6 个只读查询电话应注册为 <prefix>.logQuery')
    assert.equal(typeof registry.get('iso-ph.logQuery'), 'function', '第 6 个电话应是可调函数')
    const handlerOfBatch = registry.get('iso-ph.logBatch')

    // 撞名：同一个前缀的第二个插件注册即抛，且不得覆盖已注册的处理器。
    const clash = hostMod.createHostLog(noopDeps, { pluginId: 'iso-ph-other', prefix: 'iso-ph' })
    assert.throws(() => hostMod.registerHostLogPhones(reg, clash), /电话名已被注册/, '撞名应抛')
    assert.equal(registry.size, 6, '撞名失败不得留下半张表')
    assert.equal(registry.get('iso-ph.logBatch'), handlerOfBatch, '旧处理器不得被覆盖')

    // 不同前缀各自注册，互不干扰。
    const second = hostMod.createHostLog(noopDeps, cfg('iso-ph-b'))
    const names2 = hostMod.registerHostLogPhones(reg, second)
    assert.equal(registry.size, 12)
    assert.equal(names2.logBatch, 'iso-ph-b.logBatch')
  })

  it('L5 查询电话（#20 接线）：第 6 个电话可调、查自己回已落盘行、查别人返 denied 空集', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-q'))
      await a.ready
      a.store.log('warn', 'iso.q.row', { n: 1 })
      await a.store.synced()

      const registry = new Map()
      hostMod.registerHostLogPhones({ has: (n) => registry.has(n), set: (n, h) => registry.set(n, h) }, a)
      const query = registry.get('iso-q.logQuery')
      assert.equal(typeof query, 'function', '第 6 个电话应已注册')

      const mine = await query({})
      assert.equal(mine.ok, true, '查询应回成功')
      assert.equal(mine.denied, false, '查自己不得被判无权')
      assert.ok(
        mine.entries.some((e) => e.event === 'iso.q.row'),
        '查自己应能读到刚落盘的那行'
      )

      // 默认只查自己：查别的插件返空集 + denied（调用方必须显式处理 denied）。
      const other = await query({ pluginId: 'iso-q-other' })
      assert.equal(other.denied, true, '查别人应判无权')
      assert.equal(other.entries.length, 0, '无权查询不得回任何行')
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L5 查时授权聚合（#20）：无权点名返 denied 空集、授权后可见、traceId 跨源整链拉回', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-agg-a'))
      const b = await mod.createNodeHostLog({ cacheDir }, cfg('iso-agg-b'))
      await a.ready
      await b.ready
      a.store.log('warn', 'agg.a.row', { traceId: 'T-1', seq: 1 })
      b.store.log('warn', 'agg.b.row', { traceId: 'T-1', seq: 2 })
      await a.store.synced()
      await b.store.synced()

      const sources = [
        { pluginId: 'iso-agg-a', query: (args) => a.store.handleLogQuery(args) },
        { pluginId: 'iso-agg-b', query: (args) => b.store.handleLogQuery(args) }
      ]

      // 无权点名别人：空集 + denied 点名（不许把空结果当「没有日志」）。
      const denied = await hostMod.aggregateLogQuery('iso-agg-a', sources, [], { pluginId: 'iso-agg-b' })
      assert.deepEqual(denied.denied, ['iso-agg-b'], '无权来源必须点名')
      assert.equal(denied.entries.length, 0, '无权时一行都不许给')

      // 持授权表后可看别人。
      const granted = await hostMod.aggregateLogQuery('iso-agg-a', sources, ['iso-agg-b'], { pluginId: 'iso-agg-b' })
      assert.equal(granted.denied.length, 0, '已授权不得再报无权')
      assert.ok(
        granted.entries.some((e) => e.event === 'agg.b.row'),
        '授权后应能看到 B 的行'
      )

      // 缺省＝自己 + 已授权来源；未授权来源被点名但不影响有权来源的结果。
      const both = await hostMod.aggregateLogQuery('iso-agg-a', sources, ['iso-agg-b'], {})
      assert.ok(both.entries.some((e) => e.event === 'agg.a.row'))
      assert.ok(both.entries.some((e) => e.event === 'agg.b.row'))
      const mixed = await hostMod.aggregateLogQuery('iso-agg-a', sources, [], {})
      assert.deepEqual(mixed.denied, ['iso-agg-b'])
      assert.ok(mixed.entries.some((e) => e.event === 'agg.a.row'), '有权来源照常出结果')

      // traceId 整链：跨来源合并后按 (seq,ts) 排，不受 100 上限截断。
      const chain = await hostMod.aggregateLogQuery('iso-agg-a', sources, ['iso-agg-b'], { traceId: 'T-1' })
      assert.equal(chain.traceChain, true)
      assert.deepEqual(
        chain.entries.map((e) => e.event),
        ['agg.a.row', 'agg.b.row'],
        '整链应按 seq 排成 A→B'
      )
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 日志目录：同一目录第二个活跃写者建库当场抛，第一个照常写；release() 后可接管且是追加', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const first = await mod.createNodeHostLog({ cacheDir }, cfg('iso-dir'))
      await first.ready
      first.store.log('warn', 'iso.dir.first', { n: 1 })
      await first.store.synced()

      // 同一日志目录（同 cacheDir + 同 pluginId 派生）第二个活跃写者：建库当场抛，不等第一次写盘。
      await assert.rejects(
        () => mod.createNodeHostLog({ cacheDir }, cfg('iso-dir')),
        /已有活跃写者/,
        '同目录第二个活跃实例应建库即抛'
      )
      // 抛错方不得影响已在写的一方。
      first.store.log('warn', 'iso.dir.first.after', { n: 2 })
      await first.store.synced()
      const before = await readRows(cacheDir, 'logs-iso-dir')
      assert.ok(events(before).includes('iso.dir.first.after'), '第一个实例不应受抛错影响')

      // release() 幂等，交还后同一目录可被下一个实例接管。
      first.store.release()
      first.store.release()
      const second = await mod.createNodeHostLog({ cacheDir }, cfg('iso-dir'))
      second.store.log('warn', 'iso.dir.second', { n: 3 })
      await second.ready
      const after = await readRows(cacheDir, 'logs-iso-dir')
      assert.ok(events(after).includes('iso.dir.second'), '接管后应能落盘')
      assert.ok(events(after).includes('iso.dir.first.after'), '旧行必须还在：接管是追加不是覆盖')
      assert.ok(after.length > before.length, '行数应增加')
      second.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2/L3 派生：同一 cacheDir 不同 pluginId 各写自己的目录与开关文件，可并存', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      // 派生规则本身（配置层直接可查，不靠文件猜）。
      assert.equal(hostMod.resolveHostLogConfig(cfg('wf')).logDirName, 'logs')
      assert.equal(hostMod.resolveHostLogConfig(cfg('wf')).switchFileName, 'log-switch.json')
      assert.equal(hostMod.resolveHostLogConfig(cfg('iso-x')).logDirName, 'logs-iso-x')
      assert.equal(hostMod.resolveHostLogConfig(cfg('iso-x')).switchFileName, 'log-switch-iso-x.json')

      // 同一 cacheDir 下两个不同 pluginId：这是多插件共存的正常形态，必须允许并存。
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-da'))
      const b = await mod.createNodeHostLog({ cacheDir }, cfg('iso-db'))
      await Promise.all([a.ready, b.ready])
      a.store.log('warn', 'iso.da.row', {})
      b.store.log('warn', 'iso.db.row', {})
      await a.store.synced()
      await b.store.synced()

      const rowsA = events(await readRows(cacheDir, 'logs-iso-da'))
      const rowsB = events(await readRows(cacheDir, 'logs-iso-db'))
      assert.ok(rowsA.includes('iso.da.row'))
      assert.ok(rowsB.includes('iso.db.row'))
      assert.ok(!rowsA.includes('iso.db.row'), 'A 的目录不得出现 B 的行')
      assert.ok(!rowsB.includes('iso.da.row'), 'B 的目录不得出现 A 的行')

      // 开关文件同样按 id 派生：A 写开关不动 B 的文件，也不改 B 的内存状态。
      await a.store.handleLogSetSwitch({ enabled: true })
      assert.match(await readTextOrEmpty(switchPath(cacheDir, 'iso-da')), /"enabled":true/)
      assert.equal(await readTextOrEmpty(switchPath(cacheDir, 'iso-db')), '', 'B 的开关文件不得被写')
      assert.equal(b.store.getSwitchState().enabled, false, 'B 的内存开关状态不得被改')
      assert.equal(a.store.getSwitchState().enabled, true)
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 配额：A 狂打超配额只限自己，B 的行数、丢弃数、开关文件零变化', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const busy = await mod.createNodeHostLog({ cacheDir }, cfg('iso-busy', { maxQueue: 3 }))
      const idle = await mod.createNodeHostLog({ cacheDir }, cfg('iso-idle'))
      await Promise.all([busy.ready, idle.ready])

      idle.store.log('warn', 'iso.idle.row', { keep: true })
      await idle.store.synced()
      const idleRowsBefore = await readRows(cacheDir, 'logs-iso-idle')
      const idleSwitchBefore = await readTextOrEmpty(switchPath(cacheDir, 'iso-idle'))
      assert.ok(idleRowsBefore.length > 0, 'B 应至少落了一行，零变化的断言才有意义')

      for (let i = 0; i < 40; i++) busy.store.log('warn', 'iso.busy.spam', { i })
      await busy.store.synced()
      await busy.store.handleLogSetSwitch({ enabled: true })

      assert.ok(busy.store.getDroppedCount() > 0, 'A 超配额应丢行（丢的是自己）')
      assert.equal(idle.store.getDroppedCount(), 0, 'B 的丢弃数必须零变化')
      assert.deepEqual(await readRows(cacheDir, 'logs-iso-idle'), idleRowsBefore, 'B 的落盘行必须零变化')
      assert.equal(
        await readTextOrEmpty(switchPath(cacheDir, 'iso-idle')),
        idleSwitchBefore,
        'B 的开关文件必须零变化'
      )
      const busyRows = await readRows(cacheDir, 'logs-iso-busy')
      assert.ok(busyRows.length > 0, 'A 自己被限流但仍应落下一部分')
      assert.ok(
        busyRows.every((r) => String(r.event).startsWith('iso.busy')),
        'A 的目录里只该有 A 自己的行'
      )
      busy.store.release()
      idle.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L4 客户端存储键：dsws.debug.<id> 命名空间，读不到别家的键、写也只写自己的', async () => {
    const clientMod = await load('client.js')
    const shared = new Map()
    const storage = {
      getItem: (k) => (shared.has(k) ? shared.get(k) : null),
      setItem: (k, v) => {
        shared.set(k, String(v))
      }
    }
    // 别的插件留下的键（若实现串读，mine 的开关会被打开）。
    const otherKey = clientMod.debugStorageKey('iso-other')
    shared.set(otherKey, JSON.stringify({ enabled: true }))

    const mine = clientMod.createClientLog(
      { storage, timer: deadTimer(), host: { call: async () => ({ ok: true, enabled: true }) } },
      cfg('iso-mine')
    )
    assert.equal(clientMod.debugStorageKey('iso-mine'), 'dsws.debug.iso-mine')
    assert.notEqual(clientMod.debugStorageKey('iso-mine'), otherKey, '不同插件的键必须不同')
    assert.equal(mine.logSwitch.enabled, false, '不得串读别家的键')
    assert.equal(mine.isEnabled('info'), false)

    await mine.setLogSwitch(true)
    assert.equal(mine.logSwitch.enabled, true)
    assert.ok(shared.has(clientMod.debugStorageKey('iso-mine')), '写开关应写回自己的键')
    assert.equal(
      shared.get(otherKey),
      JSON.stringify({ enabled: true }),
      '别家的键不得被动过'
    )
  })

  it('L5 全局函数：裸全局已删、不再被读；散列走依赖注入', async () => {
    let poisonCalls = 0
    const poison = () => {
      poisonCalls += 1
      throw new Error('不应调用全局散列')
    }
    globalThis.dswsLogHash = poison
    globalThis.dswsLogTrunc = poison
    try {
      const clientMod = await load('client.js')
      const c = clientMod.createClientLog(
        {
          storage: { getItem: () => null, setItem: () => {} },
          timer: deadTimer(),
          hashFn: (s) => 'INJ-' + String(s).length
        },
        cfg('iso-glob')
      )
      assert.equal(poisonCalls, 0, '建库不得读全局散列')
      c.log('warn', 'iso.glob.probe', { a: 1 })
      assert.equal(poisonCalls, 0, '记行不得读全局散列')

      // 注入的散列必须真的被采用：导出失败行只记散列、不记原文。
      c.logExportFail('export', 'boom', new Error('绝密原文'))
      const row = c.logQueue[c.logQueue.length - 1] || {}
      const fields = row.fields || {}
      assert.equal(row.event, 'log.export.fail')
      assert.match(String(fields.errorHash || ''), /^INJ-/, '应使用注入的散列函数')
      assert.ok(!JSON.stringify(row).includes('绝密原文'), '只散列、不记原文')
      assert.equal(poisonCalls, 0, '注入生效时也不得回退去读全局')
    } finally {
      delete globalThis.dswsLogHash
      delete globalThis.dswsLogTrunc
    }
  })

  it('L2 写盘冲突：异步目录路径下有界等待后判冲突——不写共享文件、记行抛中文错', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    let hangWrites = true
    const hangFs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        if (hangWrites) return new Promise(() => {}) // 永久挂起：把这个实例的写盘租约钉住
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = (fs, timer) => ({
      fs,
      timer,
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    })
    try {
      // A：写盘挂住 → 一直持有写盘租约（异步路径没有常驻持有，所以 B 建库不抛，冲突在写盘时判）。
      const a = hostMod.createHostLog(deps(hangFs, realTimer()), cfg('iso-lease'))
      a.store.log('warn', 'iso.lease.a', {})
      a.store.flushNow()
      await wait(30)

      const b = hostMod.createHostLog(deps(hangFs, realTimer()), cfg('iso-lease'))
      b.store.log('warn', 'iso.lease.b', {})
      b.store.flushNow()
      // 等过 DIR_LEASE_WAIT_MS（200 毫秒）：A 的租约不会交还，B 必须用「冲突」收场而不是干等。
      await wait(450)

      assert.throws(() => b.store.log('warn', 'iso.lease.b2', {}), /已有活跃写者/, '冲突后记行应抛中文错')
      assert.ok(b.store.getDroppedCount() >= 1, '冲突的那批行应计入丢弃数，不得静默写共享文件')
      assert.equal(mem.size, 0, '冲突路径一行都不许写共享文件')
      b.store.release()
      a.store.release()
      hangWrites = false
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 release() 只交还常驻持有：写盘在途时被 release，租约仍须挡住下一个实例', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    let hangWrites = true
    let writeCalls = 0
    const hangFs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        writeCalls += 1
        if (hangWrites) return new Promise(() => {}) // 永久挂起：把这个实例的写盘租约钉住
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = (fs, timer) => ({
      fs,
      timer,
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    })
    try {
      const a = hostMod.createHostLog(deps(hangFs, realTimer()), cfg('iso-rel'))
      a.store.log('warn', 'iso.rel.a', {})
      a.store.flushNow()
      await wait(30) // A 已握住写盘租约（写盘永不返回）
      a.store.release() // 实例宣告结束：只许摘常驻持有，不许摘在途租约

      const b = hostMod.createHostLog(deps(hangFs, realTimer()), cfg('iso-rel'))
      b.store.log('warn', 'iso.rel.b', {})
      b.store.flushNow()
      await wait(450) // 等过 DIR_LEASE_WAIT_MS（200 毫秒）

      assert.equal(writeCalls, 1, 'release() 之后，下一个实例不得进入写盘（否则就是并发读改写同一文件）')
      assert.throws(() => b.store.log('warn', 'iso.rel.b2', {}), /已有活跃写者/, '应判冲突而不是接管')
      assert.equal(mem.size, 0, '一行都不许写共享文件')
      b.store.release()
      hangWrites = false
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 release() 延后交还：同步目录下写盘在途时 release，下一个实例建库仍须抛冲突', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    let hangWrites = true
    const hangFs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        if (hangWrites) return new Promise(() => {}) // 永久挂起：写盘一直不返回
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = (fs, timer) => ({
      fs,
      timer,
      getCacheDir: async () => cacheDir,
      // 目录唯一同步可知的入口（与 src/node.ts:163 同形）：常驻持有在「建库当场」就登记。
      syncCacheDir: cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    })
    const syncCfg = () => cfg('iso-rs')
    try {
      const a = hostMod.createHostLog(deps(hangFs, realTimer()), syncCfg())
      a.store.log('warn', 'iso.rs.a', {})
      a.store.flushNow()
      await wait(30) // 写盘已开始且永不返回：此刻常驻持有就是那次读改写的锁
      a.store.release() // 必须延后交还，不能把窗口敞开

      assert.throws(
        () => hostMod.createHostLog(deps(hangFs, realTimer()), syncCfg()),
        /已有活跃写者/,
        '写盘在途时 release，下一个实例建库必须仍判冲突'
      )
      hangWrites = false
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 写盘租约：异步目录下并发两实例按序等待——都写完、不丢行、不判冲突', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const fs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        await wait(5) // 慢写：把两批刷盘的重叠窗口撑开，逼出「等待租约」这条路
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    // 异步目录路径（不传 syncCacheDir）：建库不抛，冲突在写盘时判——正例是「等到空出来」而不是冲突。
    const deps = {
      fs,
      timer: realTimer(),
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    }
    try {
      const a = hostMod.createHostLog(deps, cfg('iso-lease-ok'))
      const b = hostMod.createHostLog(deps, cfg('iso-lease-ok'))
      a.store.log('warn', 'iso.lease.ok.a', {})
      b.store.log('warn', 'iso.lease.ok.b', {})
      await Promise.all([a.store.flushNow(), b.store.flushNow()])

      assert.equal(a.store.getDroppedCount(), 0, 'A 不该丢行')
      assert.equal(b.store.getDroppedCount(), 0, 'B 不该丢行：等租约不是冲突')
      const text = Array.from(mem.values()).join('\n')
      assert.ok(text.includes('iso.lease.ok.a'), 'A 的行应落盘')
      assert.ok(text.includes('iso.lease.ok.b'), 'B 的行应落盘')
      // 单写者语义：两批都进了同一个文件（读-改-写被串行化，没有互相覆盖）。
      const rows = text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
      assert.deepEqual(rows.map((r) => r.event).sort(), ['iso.lease.ok.a', 'iso.lease.ok.b'])
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // ---- 以下六条是独立审查（bfde5bcc / d5d80652）判 No-Go 后补的回归线：每条对应一个真缺陷，
  // ---- 修回去（把守卫改回旧行为）就该红，否则说明断言没咬住。

  it('L2 目录键归一：同一目录的不同写法必须撞同一个键（否则两个实例静默覆写同一文件）', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-norm'))
      await a.ready
      // 三种写法指向同一个真实目录：点号、父级回退（sub 不存在，realpath 失败时靠折叠兜底）、重复分隔符。
      const spellings = [
        ['点号', cacheDir + path.sep + '.'],
        ['父级回退', path.join(cacheDir, 'sub', '..')],
        ['重复分隔符', cacheDir + path.sep + path.sep]
      ]
      for (const [label, dir] of spellings) {
        await assert.rejects(
          () => mod.createNodeHostLog({ cacheDir: dir }, cfg('iso-norm')),
          /已有活跃写者/,
          label + '写法必须与首次建库撞同一个目录键'
        )
      }
      a.store.release()

      // 宿主入口的 syncCacheDir 是调用方直接给的字符串，没有 realpath 兜底（目录可能还不存在），
      // 归一只能靠 normalizeLogDir 自己折叠：这一组专门咬住折叠分支。
      const hostMod = await load('host.js')
      const h1 = hostMod.createHostLog({ getCacheDir: async () => cacheDir, syncCacheDir: cacheDir }, cfg('iso-norm'))
      const hostSpellings = [
        ['点号段', cacheDir + path.sep + '.'],
        ['父级回退', cacheDir + path.sep + 'ghost' + path.sep + '..'],
        ['重复分隔符', cacheDir + path.sep + path.sep]
      ]
      for (const [label, dir] of hostSpellings) {
        assert.throws(
          () => hostMod.createHostLog({ getCacheDir: async () => dir, syncCacheDir: dir }, cfg('iso-norm')),
          /已有活跃写者/,
          label + '（宿主入口）必须折叠到同一个目录键'
        )
      }
      h1.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 三路并发同目录（异步路径）：按序等待——都落盘、零丢弃、不误判冲突', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const slowFs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        await wait(30) // 慢写：把三路争抢的重叠窗口撑开
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = {
      fs: slowFs,
      timer: realTimer(),
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    }
    try {
      const insts = ['a', 'b', 'c'].map(() => hostMod.createHostLog(deps, cfg('iso-herd')))
      insts.forEach((s, i) => s.store.log('warn', 'iso.herd.' + 'abc'[i], {}))
      await Promise.all(insts.map((s) => s.store.flushNow()))
      assert.deepEqual(
        insts.map((s) => s.store.getDroppedCount()),
        [0, 0, 0],
        '三路争抢不得把「同伴刚抢到租约」误判成冲突而丢行'
      )
      const rows = [...mem.values()]
        .join('')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
      assert.deepEqual(events(rows).sort(), ['iso.herd.a', 'iso.herd.b', 'iso.herd.c'], '三行都该落盘')
      insts.forEach((s) => s.store.release())
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 begin/end 配对：no-dir 早退不得吃掉在途写盘计数（否则常驻持有被提前交还）', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    let hangWrites = true
    let dirMode = 'ok'
    const fs2 = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        if (hangWrites) return new Promise(() => {}) // 挂住：让这次写盘一直在途
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = {
      fs: fs2,
      timer: realTimer(),
      getCacheDir: async () => (dirMode === 'ok' ? cacheDir : null),
      syncCacheDir: cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    }
    try {
      const a = hostMod.createHostLog(deps, cfg('iso-pair'))
      a.store.log('warn', 'iso.pair.a', {})
      a.store.flushNow()
      await wait(30) // 同步路径：常驻持有 + 一次在途写盘
      a.store.release() // 只能记「延后交还」
      dirMode = 'null'
      await a.store.handleLogSetSwitch({ enabled: true }) // 走 no-dir 早退分支
      dirMode = 'ok'
      assert.throws(
        () => hostMod.createHostLog(deps, cfg('iso-pair')),
        /已有活跃写者/,
        '在途写盘还没结束，常驻持有不得被提前交还'
      )
      hangWrites = false
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 开关文件独立占位：共用同一 switchFileName 的第二个实例建库即抛，派生名照常并存', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-sw-a', { switchFileName: 'log-switch-shared.json' }))
      await a.ready
      await assert.rejects(
        () => mod.createNodeHostLog({ cacheDir }, cfg('iso-sw-b', { switchFileName: 'log-switch-shared.json' })),
        /已有活跃写者/,
        '开关文件也是共享资源，撞车必须建库当场抛'
      )
      // 默认派生名互不冲突：不同 pluginId 的开关文件不同名，照常并存。
      const c = await mod.createNodeHostLog({ cacheDir }, cfg('iso-sw-b'))
      await c.ready
      assert.equal(hostMod.resolveHostLogConfig(cfg('iso-sw-b')).switchFileName, 'log-switch-iso-sw-b.json')
      a.store.release()
      c.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L5 冲突态降级：清空不删共享文件、导出返失败形状（不读共享目录）', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const victim = path.join(cacheDir, 'logs-iso-guard', '2020-01-01.log')
    mem.set(victim, '{"v":3}\n')
    let hangWrites = true
    const hangFs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        if (hangWrites) return new Promise(() => {})
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    const deps = {
      fs: hangFs,
      timer: realTimer(),
      getCacheDir: async () => cacheDir,
      getPlatform: async () => null,
      DEFAULT_CWD: cacheDir
    }
    try {
      const a = hostMod.createHostLog(deps, cfg('iso-guard'))
      a.store.log('warn', 'iso.guard.a', {})
      a.store.flushNow()
      await wait(30)
      const b = hostMod.createHostLog(deps, cfg('iso-guard'))
      b.store.log('warn', 'iso.guard.b', {})
      b.store.flushNow()
      await wait(450) // 有界等待后用冲突收场：b 进入冲突态

      const cleared = await b.store.handleLogClear({ date: 'all' })
      assert.equal(cleared.ok, false, '冲突态不得执行清空')
      assert.equal(cleared.removed, 0)
      assert.ok(mem.has(victim), '冲突态清空不得删掉共享目录里的文件')

      const exported = await b.store.handleLogExport({})
      assert.equal(exported.ok, false, '冲突态导出不得读共享目录')
      assert.equal(exported.text, '')

      b.store.release()
      a.store.release()
      hangWrites = false
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L5 导出零变化（双插件）：A 狂打不影响 B 的导出内容', async () => {
    const mod = await load('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-exp-a'))
      const b = await mod.createNodeHostLog({ cacheDir }, cfg('iso-exp-b'))
      await a.ready
      await b.ready
      for (let i = 0; i < 120; i += 1) a.store.log('warn', 'exp.a.row', { i })
      b.store.log('warn', 'exp.b.row', {})
      await Promise.all([a.store.synced(), b.store.synced()])
      const out = await b.store.handleLogExport({})
      assert.equal(out.ok, true)
      assert.ok(out.text.includes('exp.b.row'), 'B 的导出应含自己的行')
      assert.ok(!out.text.includes('exp.a.row'), 'B 的导出不得含别家插件的行')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // 可控内存盘（#19 审查必改 R1/R2/R3/R5/R11 的回归线要用）：writeText 可挂起（hang）或延迟
  // delayMs 毫秒，用来精确摆出「租约重叠 → 有界等待 → 判冲突」的时序，而不用真睡在别处。
  const makeControlledFs = (mem) => {
    const ctl = { hang: false, delayMs: 0, failWrites: false }
    const fs = {
      async resolve(p) {
        return { __t: String(p) }
      },
      async readText(t) {
        if (!mem.has(t.__t)) throw new Error('文件不存在')
        return mem.get(t.__t)
      },
      async writeText(t, text) {
        if (ctl.hang) return new Promise(() => {})
        if (ctl.failWrites) throw new Error('模拟写盘失败')
        const d = ctl.delayMs
        if (d > 0) await wait(d)
        mem.set(t.__t, String(text))
      },
      async unlink(t) {
        mem.delete(t.__t)
      }
    }
    return { ctl, fs }
  }
  const memDeps = (fs, cacheDir) => ({
    fs: fs,
    timer: realTimer(),
    getCacheDir: async () => cacheDir,
    getPlatform: async () => null,
    DEFAULT_CWD: cacheDir
  })
  const memText = (mem) => [...mem.values()].map((v) => String(v)).join('\n')

  it('L2 记录电话回包说实话（R1）：冲突态回 ok:false、accepted 只数真进队列的', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const cacheDir2 = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      // 让 A 的写盘永久挂起：B 的第一次写盘等满预算后判冲突。
      ctl.hang = true
      const a = hostMod.createHostLog(deps, cfg('iso-batch'))
      a.store.log('warn', 'iso.batch.a', {})
      a.store.flushNow()
      await wait(30)
      const b = hostMod.createHostLog(deps, cfg('iso-batch'))
      b.store.log('warn', 'iso.batch.b', {})
      b.store.flushNow()
      await wait(450)

      const res = await b.store.handleLogBatch({
        entries: [
          { level: 'error', event: 'iso.batch.e1', fields: {} },
          { level: 'error', event: 'iso.batch.e2', fields: {} }
        ]
      })
      assert.equal(res.ok, false, '本批一行都没进，回包必须如实回失败（不许静默丢）')
      assert.equal(res.accepted, 0, 'accepted 只数真进了队列的')
      assert.ok(res.dropped >= 2, 'dropped 是累计值，至少包含这两条')

      // 无冲突的实例：全进则 ok:true、accepted 等于条数。
      const mem2 = new Map()
      const clean = makeControlledFs(mem2)
      const c = hostMod.createHostLog(memDeps(clean.fs, cacheDir2), cfg('iso-batch-c'))
      const res2 = await c.store.handleLogBatch({
        entries: [{ level: 'warn', event: 'iso.batch.ok', fields: {} }]
      })
      assert.deepEqual(
        res2,
        { ok: true, accepted: 1, skipped: 0, rejected: 0, dropped: 0 },
        '正常态回包应如实报接收条数'
      )

      ctl.hang = false
      a.store.release()
      b.store.release()
      c.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
      await rm(cacheDir2, { recursive: true, force: true })
    }
  })

  it('L2 冲突自愈与丢弃计数（R2/R3）：持有者走了就不再拦，丢弃数只数用户行', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      ctl.delayMs = 300
      const a = hostMod.createHostLog(deps, cfg('iso-heal'))
      a.store.log('warn', 'iso.heal.a', {})
      await wait(30) // A 的写盘在途，租约要握到约 300 毫秒
      const b = hostMod.createHostLog(deps, cfg('iso-heal'))
      b.store.log('warn', 'iso.heal.b', {})
      b.store.flushNow()
      await wait(250) // 200 毫秒预算耗尽 → b 判冲突

      const d0 = b.store.getDroppedCount()
      assert.throws(() => b.store.log('warn', 'iso.heal.b2', {}), /已有活跃写者/, '冲突态记行应抛中文错')
      assert.throws(() => b.store.log('warn', 'iso.heal.b3', {}), /已有活跃写者/)
      // 再刷一次：旧实现会把自己刚记下的自监控行也当一批去写、写失败再计一次（一行报成丢两行）。
      b.store.flushNow()
      await wait(30)
      assert.equal(b.store.getDroppedCount() - d0, 2, '丢弃数应恰好等于被拒的用户行数（自监控行不计）')

      // 自愈：A 的写盘收尾、租约交还之后，b 不该还被拦着（旧实现会一直拦到 release()）。
      await wait(200)
      ctl.delayMs = 0
      b.store.log('warn', 'iso.heal.b4', {})
      b.store.flushNow()
      await wait(60)
      assert.ok(memText(mem).includes('iso.heal.b4'), '持有者走了以后 B 的行应能落盘')

      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 冲突期自监控行不丢（R5）：双方交还后随下一轮 flush 落盘', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      ctl.delayMs = 300
      const a = hostMod.createHostLog(deps, cfg('iso-mon'))
      a.store.log('warn', 'iso.mon.a', {})
      await wait(30)
      const b = hostMod.createHostLog(deps, cfg('iso-mon'))
      b.store.log('warn', 'iso.mon.b', {})
      b.store.flushNow()
      await wait(250) // b 判冲突：本实例此刻不许写那个目录
      assert.ok(!memText(mem).includes('log.persist.fail'), '冲突期这份诊断落不了盘（本实例不写共享目录）')

      ctl.delayMs = 0
      a.store.release()
      b.store.release()
      await wait(200) // A 的在途写收尾、所有持有交还
      b.store.flushNow()
      await wait(60)
      const text = memText(mem)
      assert.ok(text.includes('log.persist.fail'), '冲突期攒下的自监控行必须在闸门解除后落盘，绝不能被吞掉')
      const failRow = text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .find((r) => r.event === 'log.persist.fail')
      assert.equal(failRow.fields.reason, 'dir-conflict', '自监控行要带上判定冲突的原因')
      // #23 C4 定位元：只带最小定位元，禁路径与文件名（否则红不可行动、还可能泄漏用户目录）。
      assert.deepEqual(
        Object.keys(failRow.fields).sort(),
        ['dirHash', 'op', 'pluginId', 'reason'],
        '自监控行只带 pluginId/op/reason/dirHash 四键'
      )
      assert.ok(!JSON.stringify(failRow.fields).includes(cacheDir), '自监控行不得泄漏目录原文')
      assert.equal(typeof failRow.fields.dirHash, 'string', '目录只以散列形式出现')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 等待预算余量（R11）：对方持租约约 120 毫秒时等待方应等到并落盘', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      // 120 毫秒：明显小于 200 毫秒预算（等待方必须等到），又明显大于 30 毫秒（把预算调小就会被咬住）。
      ctl.delayMs = 120
      const a = hostMod.createHostLog(deps, cfg('iso-margin'))
      a.store.log('warn', 'iso.margin.a', {})
      await wait(30) // A 在途，租约还剩约 90 毫秒
      const b = hostMod.createHostLog(deps, cfg('iso-margin'))
      b.store.log('warn', 'iso.margin.b', {})
      b.store.flushNow()
      // 等 B 的写盘真的收尾：synced() 必须等到在途刷盘结束（这行断言本身就咬住「队列空 ≠ 写完了」——
      // 探针实测旧实现在这里 119ms 就返回、写盘 246ms 才落地）。
      await b.store.synced()
      assert.equal(b.store.getDroppedCount(), 0, '预算内的重叠不算冲突，一行都不该丢')
      const text = memText(mem)
      assert.ok(text.includes('iso.margin.a') && text.includes('iso.margin.b'), '两边的行都应落盘')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L3 开关文件写盘期冲突（R8）：共用 switchFileName 时后写者不得静默覆盖', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      // 两个插件各自派生日志目录（logs-iso-sw-a / logs-iso-sw-b，互不冲突），但共用同一个开关文件。
      const shared = { switchFileName: 'log-switch-shared.json' }
      const a = hostMod.createHostLog(deps, cfg('iso-sw-a', shared))
      const b = hostMod.createHostLog(deps, cfg('iso-sw-b', shared))
      await a.store.setSwitch(true)
      const key = [...mem.keys()].find((k) => k.endsWith('log-switch-shared.json'))
      assert.ok(key, 'A 应写出开关文件')
      assert.ok(String(mem.get(key)).includes('"enabled":true'), 'A 的开关应已落盘')

      await b.store.setSwitch(false)
      assert.ok(
        String(mem.get(key)).includes('"enabled":true'),
        'B 不得静默盖掉 A 的开关：异步入口也要在写盘那一刻判这个文件的占用'
      )
      assert.equal(b.store.getSwitchState().enabled, false, 'B 内存里的开关仍是自己那份')

      // 开关文件冲突不设全局闸门：B 照旧能写自己的日志目录。
      b.store.log('warn', 'iso.sw.b.row', {})
      await b.store.synced()
      assert.ok(memText(mem).includes('iso.sw.b.row'), 'B 的日志不应被开关文件冲突牵连')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 符号链接（R9）：node 入口解析链接，junction 指向同一目录必须撞同一个键', async () => {
    const mod = await load('node.js')
    const real = await makeCacheDir()
    const linkHome = await makeCacheDir()
    const link = path.join(linkHome, 'link')
    let linked = false
    try {
      const a = await mod.createNodeHostLog({ cacheDir: real }, cfg('iso-lnk'))
      await a.ready
      try {
        await symlink(real, link, 'junction')
        linked = true
      } catch (e) {
        void e
      }
      if (linked) {
        await assert.rejects(
          () => mod.createNodeHostLog({ cacheDir: link }, cfg('iso-lnk')),
          /已有活跃写者/,
          'junction 指向同一个真实目录，必须折成同一个键并当场抛'
        )
      }
      a.store.release()
    } finally {
      if (linked) {
        try {
          await rmdir(link)
        } catch (e) {
          void e
        }
      }
      await rm(real, { recursive: true, force: true })
      await rm(linkHome, { recursive: true, force: true })
    }
  })

  // ── 复核（reviewer 1b6b1bfd）指出的「实现对、网没盖」六条：行为用探针验过是对的，但变异
  //    N2/N3/N6/U2/U3/U5 全套仍全绿 —— 也就是这些性质没有回归线咬住。以下逐条补网。 ──

  it('L2 解闸（N2）：持有者还活着时 release() 不许把冲突闸门打开', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      ctl.delayMs = 300
      const a = hostMod.createHostLog(deps, cfg('iso-n2'))
      a.store.log('warn', 'n2.a.row', {})
      await wait(30) // A 的写盘在途，租约要握到约 300 毫秒
      const b = hostMod.createHostLog(deps, cfg('iso-n2'))
      b.store.log('warn', 'n2.b.row', {})
      b.store.flushNow()
      await wait(250) // 预算耗尽 → b 判冲突
      assert.throws(() => b.store.log('warn', 'n2.b.row2', {}), /已有活跃写者/, '冲突态记行必须抛')

      // b 主动交还自己的（本来就没有的）持有：闸门只能按「冲突源还在不在」决定开不开。
      b.store.release()
      assert.throws(
        () => b.store.log('warn', 'n2.b.row3', {}),
        /已有活跃写者/,
        'A 还活着（写盘在途），b.release() 不得无条件解闸——否则两实例并发覆写同一文件'
      )
      ctl.delayMs = 0
      await wait(400) // A 写盘收尾、租约交还
      b.store.log('warn', 'n2.b.row4', {})
      await b.store.synced()
      const text = memText(mem)
      assert.ok(text.includes('n2.b.row4'), '持有者真走了之后必须自愈落盘')
      assert.ok(!text.includes('n2.b.row3'), '被闸门挡下的那行不许落盘')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 synced() 等待在途写盘（N3）：慢写时 await synced() 返回即已落盘', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      ctl.delayMs = 120
      const a = hostMod.createHostLog(deps, cfg('iso-n3'))
      a.store.log('warn', 'n3.row', {})
      a.store.flushNow()
      await wait(10) // 写盘在途（要 120 毫秒）
      await a.store.synced()
      const text = memText(mem)
      assert.ok(
        text.includes('n3.row'),
        'synced() 返回时那行必须已经落盘——收尾条件不许漏掉「还有在途写盘」这一项'
      )
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L3 开关文件在途时 release()（N6）：常驻持有延后交还，后写者不得静默覆盖', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    const switchText = () => {
      for (const [k, v] of mem.entries()) if (k.includes('log-switch')) return String(v)
      return ''
    }
    try {
      const a = hostMod.createHostLog(deps, cfg('iso-n6'))
      ctl.delayMs = 250
      a.store.setSwitch(true) // 开关文件写盘在途（要 250 毫秒）；同时本实例常驻占住这个键
      await wait(30)
      a.store.release() // 在途写盘期间交还：常驻持有必须延后，等这次写收尾
      // 宿主入口建库不判占用（设计如此），所以这里验的是「后写者不许静默覆盖」：
      const b = hostMod.createHostLog(deps, cfg('iso-n6'))
      await b.store.setSwitch(false)
      assert.ok(
        !switchText().includes('"enabled":false'),
        'A 的开关写盘还在途，B 不得整份覆盖掉它（否则开关状态静默丢失）'
      )
      const fail = b.store.getLastPersistFail()
      assert.ok(fail && fail.op === 'persistSwitch' && fail.reason === 'dir-conflict', '拒绝必须留痕，不许静默')
      await wait(400) // A 的写收尾、延后交还生效
      assert.equal(JSON.parse(switchText() || '{}').enabled, true, 'A 写的值必须完整落盘')
      a.store.release()
      const c = hostMod.createHostLog(deps, cfg('iso-n6'))
      await c.store.setSwitch(false) // 持有者真走了：这次是合法接管，允许覆盖
      assert.equal(JSON.parse(switchText() || '{}').enabled, false, '接管之后新值才落盘')
      b.store.release()
      c.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L5 聚合截断（U2）：跨源合并后按 ts 倒序截 limit，不整包倒给调用方', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-u2-a'))
      const b = await mod.createNodeHostLog({ cacheDir }, cfg('iso-u2-b'))
      await a.ready
      await b.ready
      for (let i = 0; i < 3; i++) a.store.log('warn', 'u2.a.' + i, {})
      for (let i = 0; i < 3; i++) b.store.log('warn', 'u2.b.' + i, {})
      await a.store.synced()
      await b.store.synced()
      const sources = [
        { pluginId: 'iso-u2-a', query: (args) => a.store.handleLogQuery(args) },
        { pluginId: 'iso-u2-b', query: (args) => b.store.handleLogQuery(args) }
      ]
      const one = await hostMod.aggregateLogQuery('iso-u2-a', sources, ['iso-u2-b'], { page: { limit: 1 } })
      assert.equal(one.entries.length, 1, 'limit=1 必须只回一行（跨源合并后截断）')
      const all = await hostMod.aggregateLogQuery('iso-u2-a', sources, ['iso-u2-b'], { page: { limit: 100 } })
      assert.equal(all.entries.length, 6, 'limit=100 应回满六行')
      for (let i = 1; i < all.entries.length; i++) {
        assert.ok(all.entries[i - 1].ts >= all.entries[i].ts, '合并结果必须 ts 倒序')
      }
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L5 聚合点名无权（U3）：点名无权来源时 denied 点名且一行都不回', async () => {
    const mod = await load('node.js')
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    try {
      const a = await mod.createNodeHostLog({ cacheDir }, cfg('iso-u3-a'))
      const b = await mod.createNodeHostLog({ cacheDir }, cfg('iso-u3-b'))
      await a.ready
      await b.ready
      a.store.log('warn', 'u3.a.row', {})
      b.store.log('warn', 'u3.b.row', {})
      await a.store.synced()
      await b.store.synced()
      const sources = [
        { pluginId: 'iso-u3-a', query: (args) => a.store.handleLogQuery(args) },
        { pluginId: 'iso-u3-b', query: (args) => b.store.handleLogQuery(args) }
      ]
      const res = await hostMod.aggregateLogQuery('iso-u3-a', sources, [], { pluginId: 'iso-u3-b', page: { limit: 100 } })
      assert.deepEqual(res.denied, ['iso-u3-b'], '点名无权来源必须进 denied')
      assert.equal(res.entries.length, 0, '无权来源一行都不许回——早退，别把别家的行拼进来')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 丢弃计数只数用户行（R3）：自监控行与用户行同批被拒也不多算', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      // 第一轮：写盘失败（不是丢弃）→ 两行用户行进重试位，同时排上一行 log.persist.fail 自监控行。
      ctl.failWrites = true
      const b = hostMod.createHostLog(deps, cfg('iso-count'))
      b.store.log('warn', 'cnt.u1', {})
      b.store.log('warn', 'cnt.u2', {})
      b.store.flushNow()
      await wait(60)
      assert.equal(b.store.getDroppedCount(), 0, '写失败不丢行')
      assert.equal(b.store.getPendingCount(), 3, '两行用户行 + 一行自监控行都还压在手里')
      // 第二轮：另一个实例占住目录（长写盘），B 这一轮撞冲突 → 整批被拒。
      ctl.failWrites = false
      ctl.delayMs = 400
      const a = hostMod.createHostLog(deps, cfg('iso-count'))
      a.store.log('warn', 'cnt.a', {})
      a.store.flushNow()
      await wait(30) // A 的租约握到约 400 毫秒
      b.store.flushNow()
      await wait(260) // B 等满 200 毫秒预算 → 判冲突
      assert.equal(
        b.store.getDroppedCount(),
        2,
        '丢弃数只数被拒的**用户行**：两行用户行算 2，那行自监控行不许算（旧实现会报成 3）'
      )
      ctl.delayMs = 0
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 冲突丢批不丢自监控行（R3/R5）：只数用户行，诊断行留着补写', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      // 1) 开关文件写失败 → 攒下一行待写的 log.persist.fail 自监控行（队列里只有它）。
      ctl.failWrites = true
      const a = hostMod.createHostLog(deps, cfg('iso-mix'))
      await a.store.setSwitch(true)
      a.store.flushNow()
      await wait(30)
      assert.equal(a.store.getPendingCount(), 1, '先攒下一行自监控行')
      assert.equal(a.store.getDroppedCount(), 0, '写失败不丢行')
      ctl.failWrites = false
      // 2) 让另一个实例占住目录（长写盘）。
      ctl.delayMs = 400
      const b = hostMod.createHostLog(deps, cfg('iso-mix'))
      b.store.log('warn', 'mix.holder', {})
      b.store.flushNow()
      await wait(30)
      // 3) A 再加一行用户行 → 同一批 [自监控行, 用户行]；这一批撞冲突被整批拒。
      a.store.log('warn', 'mix.user', {})
      a.store.flushNow()
      await wait(260)
      assert.equal(
        a.store.getDroppedCount(),
        1,
        '只数被拒的用户行：那行自监控行不许算进 dropped（旧实现会把一行报成两行）'
      )
      assert.equal(a.store.getPendingCount(), 1, '自监控行必须留在手里等闸门解除，不许跟着这批一起丢')
      // 4) 持有者走了：诊断行补写落盘。
      ctl.delayMs = 0
      b.store.release()
      await wait(250)
      a.store.flushNow()
      await wait(80)
      assert.ok(memText(mem).includes('log.persist.fail'), '闸门解除后诊断行必须补写落盘')
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L2 写失败高水位（R2）：丢弃响亮、error 留到最后、恢复后补落盘', async () => {
    const hostMod = await load('host.js')
    const cacheDir = await makeCacheDir()
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const deps = memDeps(fs, cacheDir)
    try {
      ctl.failWrites = true
      const drops = []
      const a = hostMod.createHostLog(deps, cfg('iso-cap', { maxQueue: 3 }))
      a.store.setOnDrop((count, reason) => drops.push({ count, reason }))
      // 写盘一直失败 + 小队列：普通行会在配额与重试位两个上限上被丢，但每次都要响亮。
      for (let i = 0; i < 40; i += 1) {
        a.store.log('warn', 'cap.row.' + i, {})
        if (i % 5 === 0) await wait(5)
      }
      await wait(30)
      assert.ok(a.store.getDroppedCount() >= 1, '写失败 + 高水位必须计数，不许静默吞')
      assert.ok(drops.length >= 1, '每次丢弃都要响 onDrop')
      assert.ok(
        drops.every((d) => typeof d.reason === 'string' && d.reason.length > 0),
        'onDrop 必须带得出原因'
      )
      // 内存兜底那一条也要被走到：写盘一直失败时，「还压在内存里的行（重试位 + 队列）超上限」
      // 必须丢最旧的普通行并**响**一声 write-fail（只在重试位里数长度的话，这个兜底永远不触发）。
      assert.ok(
        drops.some((d) => d.reason === 'write-fail'),
        '内存上限兜底必须响 write-fail，而不是静默丢'
      )
      // error 在同样的病态条件下仍不许丢：写盘一恢复就要全部落盘。
      for (let i = 0; i < 3; i += 1) a.store.log('error', 'cap.err.' + i, {})
      await wait(30)
      ctl.failWrites = false
      await a.store.synced()
      const text = memText(mem)
      for (let i = 0; i < 3; i += 1) {
        assert.ok(text.includes('cap.err.' + i), '写失败路径上 error 不许丢：cap.err.' + i)
      }
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('L1 查询电话撞名（U5）：第 6 个电话名同样不许被第二个插件抢走', async () => {
    const hostMod = await load('host.js')
    const registry = new Map()
    const reg = { has: (n) => registry.has(n), set: (n, h) => registry.set(n, h) }
    const first = hostMod.createHostLog({ getCacheDir: async () => 'C:/noop-cache' }, cfg('iso-u5'))
    hostMod.registerHostLogPhones(reg, first)
    assert.equal(registry.size, 6, '五个冻结动作 + 第 6 个只读查询')
    // 第 6 个名字不进 phoneNames（那份映射的键类型是冻结的 5 个动作），要用名字请走单源派生。
    const qn = hostMod.buildLogQueryPhoneName('iso-u5')
    assert.equal(qn, 'iso-u5.logQuery', '第 6 个电话名由 buildLogQueryPhoneName 单源派生')
    assert.ok(registry.has(qn), '第 6 个只读查询电话必须真注册')
    const handlerOfQuery = registry.get(qn)
    // 真正需要防的是「这个电话名已经被人占了」：先占一个同名的查询电话，注册必须抛且不覆盖。
    // （只测「同前缀注册两次」是不够的：那时 5 个冻结动作先撞名抛了，第 6 个名字根本没被碰到。）
    const pre = new Map()
    const preReg = { has: (n) => pre.has(n), set: (n, h) => pre.set(n, h) }
    const foreign = () => ({ ok: true })
    preReg.set(qn, foreign)
    const clashQuery = hostMod.createHostLog({ getCacheDir: async () => 'C:/noop-cache' }, cfg('iso-u5'))
    assert.throws(
      () => hostMod.registerHostLogPhones(preReg, clashQuery),
      /电话名已被注册/,
      '第 6 个电话名被占用时同样必须抛'
    )
    assert.equal(pre.get(qn), foreign, '已占用的查询电话 handler 不得被覆盖')
    // 撞名：同前缀第二个插件注册即抛，且第 6 个电话的旧 handler 不得被覆盖。
    const clash = hostMod.createHostLog({ getCacheDir: async () => 'C:/noop-cache' }, { pluginId: 'iso-u5-other', prefix: 'iso-u5' })
    assert.throws(() => hostMod.registerHostLogPhones(reg, clash), /电话名已被注册/, '含查询电话的撞名必须抛')
    assert.equal(registry.size, 6, '撞名失败不得留下半张表')
    assert.equal(registry.get(qn), handlerOfQuery, '查询电话的旧处理器不得被覆盖')
    const other = hostMod.createHostLog({ getCacheDir: async () => 'C:/noop-cache' }, cfg('iso-u5-other'))
    hostMod.registerHostLogPhones(reg, other)
    assert.equal(registry.size, 12, '不同前缀照常各自注册')
    assert.equal(hostMod.buildLogQueryPhoneName('iso-u5-other'), 'iso-u5-other.logQuery')
  })

  // #19 复核必改 3：闸门那一批里的自监控行保护点（src/store.ts 的 deferSelfMonRows 分支）此前零覆盖——
  // 删掉它、或让它取批尾（吞用户行）都不掉一条测试。这条用例把复核者 probe-d3 的时序固化成回归线：
  // 写失败一轮 → 重试位 [w1,w2]（无自监控行）→ 队列 [自监控行 F1, 用户行 r1, r2] → 另一实例慢写占租约 →
  // 闸门先拦重试位那批、再拦队列这批（闸门是这批里唯一的 defer 点）。
  // 咬点：①残留用户行一行都不许落盘（拆闸门 → 红）；②dropped 只许 +2，不许把自监控行也数上（闸门不 defer → 红）；
  // ③闸门解除后那条 log.persist.fail 必须补写落盘（诊断行被吞 → 红）；④被丢的用户行永不复活（defer 取批尾 → 红）。
  it('L2 冲突闸门只丢用户行、留下诊断行（复核必改 3）：残留批一行不落盘，闸门解除后补写', async () => {
    const hostMod = await load('host.js')
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    const cacheDir = '/gate'
    const deps = memDeps(fs, cacheDir)
    const b = hostMod.createHostLog(deps, cfg('iso-gate'))
    const eventsOnDisk = () =>
      [...mem.values()]
        .map((v) => String(v))
        .join('\n')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l)
          } catch (e) {
            void e
            return null
          }
        })
        .filter((r) => r && r.event)
        .map((r) => r.event)

    try {
      // 1) 一轮写失败：两行 warn 进重试位，另排一行 log.persist.fail（诊断行）
      ctl.failWrites = true
      b.store.log('warn', 'gate.w1', {})
      b.store.log('warn', 'gate.w2', {})
      await b.store.flushNow()
      await wait(60)
      assert.equal(b.store.getDroppedCount(), 0, '写失败不许计丢弃（行进了重试位）')
      ctl.failWrites = false
      const droppedBefore = b.store.getDroppedCount()

      // 2) 另一个实例慢写占住同一目录：注意**不能 await**——await 会等到那次写收尾，
      //    租约就没了，B 随后根本撞不上冲突（首版正是这么写错的）。
      ctl.delayMs = 400
      const a = hostMod.createHostLog(deps, cfg('iso-gate'))
      a.store.log('warn', 'gate.holder', {})
      a.store.flushNow()
      await wait(40) // A 的在途写已捕获 400ms 延迟，此刻正握着租约
      b.store.log('warn', 'gate.r1', {})
      b.store.log('warn', 'gate.r2', {})
      await b.store.flushNow() // 第一轮取重试位那批（无自监控行）→ 200ms 预算耗尽判冲突；第二轮取残留批 → 闸门

      // 3) 冲突仍在（A 的写在途）：用户行一行不落盘，dropped 恰 +4（4 行用户行，自监控行不算），
      //    攒下的诊断行此刻也不许假报已写。必须在 A 的写收尾前查——那之后闸门自愈、诊断行会合法落盘。
      const midEvents = eventsOnDisk()
      for (const ev of ['gate.r1', 'gate.r2', 'gate.w1', 'gate.w2']) {
        assert.ok(!midEvents.includes(ev), '冲突期用户行一行都不许写共享文件：' + ev)
      }
      assert.equal(
        b.store.getDroppedCount() - droppedBefore,
        4,
        'dropped 只数用户行：重试位 2 + 残留 2 = 4，不许把自监控行也数上'
      )
      assert.ok(!midEvents.includes('log.persist.fail'), '闸门还活着时诊断行合法滞留（不许假报已写）')

      // 3b) 闸门仍活时 synced() 必须诚实：快速返回（不死等）、pending 如实大于 0、不假报已写。
      const t0 = Date.now()
      await b.store.synced()
      assert.ok(Date.now() - t0 < 150, '闸门仍活时 synced() 不许死等（对方持有目录，本实例写不了）')
      assert.ok(b.store.getPendingCount() > 0, '攒下的诊断行必须如实体现在 pending 上')
      assert.ok(!eventsOnDisk().includes('log.persist.fail'), '闸门仍活时 synced() 不许假报已写')

      // 4) 持有者走后闸门自愈：synced() 必须把攒下的诊断行带出去，且被丢的用户行永不复活
      a.store.release()
      await wait(250)
      await b.store.synced()
      const afterEvents = eventsOnDisk()
      assert.ok(afterEvents.includes('log.persist.fail'), '闸门解除后诊断行必须补写落盘（synced() 不许把它漏下）')
      for (const ev of ['gate.r1', 'gate.r2']) {
        assert.ok(!afterEvents.includes(ev), '已被计丢弃的行永不复活（defer 不许取错行）：' + ev)
      }
      assert.equal(b.store.getPendingCount(), 0, 'synced() 返回时不许还有攒着的行')
      assert.equal(b.store.getDroppedCount() - droppedBefore, 4, '补写诊断行不许再动 dropped')
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  // #19 复核必改 2：开关文件撞占用**只拦那个文件**，不许闸住本实例自己的日志目录。
  // 稳态（已持有开关键）之后 cacheDir 漂移、撞上另一个实例常驻占着的共享 switchFileName 时，
  // 旧实现走 acquireDirForWrite 的默认分支 → markDirConflict → 本实例此后每一行 log() 都抛错、用户行丢掉。
  it('L2 开关文件冲突不闸住自己的日志目录（复核必改 2）：开关写失败只记诊断，自己的行照落', async () => {
    const hostMod = await load('host.js')
    const mem = new Map()
    const { ctl, fs } = makeControlledFs(mem)
    let currentDir = '/drift1'
    const depsA = {
      fs: fs,
      timer: realTimer(),
      getCacheDir: async () => currentDir,
      getPlatform: async () => null,
      DEFAULT_CWD: '/drift1'
    }
    const depsB = memDeps(fs, '/drift2')
    const shared = 'log-switch-shared.json'
    const a = hostMod.createHostLog(depsA, {
      pluginId: 'iso-drift-a',
      prefix: 'iso-drift-a',
      logDirName: 'logs-drift-a',
      switchFileName: shared
    })
    const b = hostMod.createHostLog(depsB, {
      pluginId: 'iso-drift-b',
      prefix: 'iso-drift-b',
      logDirName: 'logs-drift-b',
      switchFileName: shared
    })
    try {
      // A 先在 /drift1 落一次开关：这一步之后 A 常驻持有 /drift1 的开关文件键（稳态）
      await a.store.setSwitch(true)
      // B 常驻持有 /drift2 的同一个共享开关文件名
      await b.store.setSwitch(false)
      ctl.delayMs = 0

      // A 的 cacheDir 漂移到 /drift2：开关文件撞上 B 的常驻持有
      currentDir = '/drift2'
      await a.store.setSwitch(true)
      assert.equal(a.store.getLastPersistFail().op, 'persistSwitch', '开关写失败要能被问出来')
      assert.equal(a.store.getLastPersistFail().reason, 'dir-conflict')

      // 关键：A 自己的日志照旧能记（不许被开关文件那次冲突闸住）
      assert.doesNotThrow(() => a.store.log('warn', 'drift.row', { ok: true }), '开关文件冲突不许拦本实例的日志')
      await a.store.synced()
      const text = memText(mem)
      assert.ok(text.includes('drift.row'), '冲突之后 A 自己的行必须照常落盘')
      assert.equal(a.store.getDroppedCount(), 0, '这条冲突不许把用户行计进丢弃')

      // B 的开关文件不许被 A 覆盖
      const bSwitch = [...mem.entries()].find(([k]) => String(k).endsWith('/drift2/' + shared))
      assert.ok(bSwitch, 'B 的开关文件应当在 /drift2 下')
      assert.equal(JSON.parse(String(bSwitch[1])).enabled, false, 'A 撞冲突后不许覆盖 B 的开关')
    } finally {
      a.store.release()
      b.store.release()
      await rm(currentDir, { recursive: true, force: true })
    }
  })
})
