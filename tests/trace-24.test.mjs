// tests/trace-24.test.mjs —— #24 追踪标识与链路串联（0.3.0）验收补测。
//
// 为什么单独一片：#24 的三条验收线跨客户端与宿主两侧——`child/why` 只在客户端引擎里，
// 「跨桶伪造 traceId 被拒但源行仍在」与「整链超 100 不断」只在宿主侧聚合层里，
// 各自单测都只看得到一半。本片按 A2/A3 逐条断言：
//
//   A2 child 链    traceId 不变、spanId 刷新、子实例 seq 从 0 起单调；why() 三来源可区分
//   A2 跨边界      客户端 → 宿主电话 → 落盘行，三件套原样透传（接收端不重写 traceId）
//   A2 伪造跨桶    无权来源不进链且点名 denied；被拒来源自己的行一行不少
//   A3 整链拉取    同一 traceId 多来源（含 quick 入口）一次拉回按 (seq,ts) 排，超 100 不断
//
// 跑 dist（与其余测试同口径）；宿主侧用真临时目录 + 真磁盘写入。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (entry) =>
  import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())

const clientMod = await load('client.js')
const nodeMod = await load('node.js')
const hostMod = await load('host.js')

const cfg = (id) => ({ pluginId: id, prefix: id })
async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-trace-'))
}
// 客户端依赖替身：存储用内存 Map；计时器手动（不真等时间）；host 可以是捕获器或真电话表。
function makeStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), _map: map }
}
const manualTimer = () => ({ timeout: () => 1 })
function capturingHost(seen) {
  return {
    call(name, args) {
      seen.push({ name: name, args: args })
      if (name.endsWith('.logGetSwitch')) return Promise.resolve({ ok: true, enabled: true })
      if (name.endsWith('.logSetSwitch')) return Promise.resolve({ ok: true, enabled: true })
      return Promise.resolve({ ok: true, accepted: args && args.entries ? args.entries.length : 0, dropped: 0 })
    }
  }
}
// 把真宿主电话表包成客户端认的 host 形状（name → handler）。
function phoneHost(registry, seen) {
  return {
    call(name, args) {
      if (seen) seen.push({ name: name, args: args })
      const handler = registry.get(name)
      if (typeof handler !== 'function') return Promise.resolve({ ok: false, error: 'no-such-phone' })
      return Promise.resolve(handler(args))
    }
  }
}
async function readRowsOf(cacheDir, dirName) {
  const dir = path.join(cacheDir, dirName)
  const names = (await readdir(dir)).filter((n) => n.endsWith('.log')).sort()
  const rows = []
  for (const name of names) {
    const text = await readFile(path.join(dir, name), 'utf8')
    for (const line of text.split('\n')) {
      if (line.trim() !== '') rows.push(JSON.parse(line))
    }
  }
  return rows
}

describe('#24 追踪标识与链路串联（0.3.0）', () => {
  it('A2 child 链：traceId 不变、spanId 刷新、子实例 seq 从 0 起单调，why() 三来源可区分', async () => {
    const seen = []
    const c = clientMod.createClientLog(
      { storage: makeStorage(), timer: manualTimer(), host: capturingHost(seen) },
      cfg('trace-a')
    )
    assert.equal(c.why().sources.traceId, 'none', '尚未建链')
    c.logSwitch.enabled = true
    c.log('info', 'trace.root', {})
    assert.equal(c.why().sources.traceId, 'auto', 'info 以上缺链自动建链')
    const rootId = c.why().traceId
    const rootSpan = c.why().spanId
    assert.match(String(rootId), /^[0-9a-f]{16}$/, '自动链 traceId 是 16 位十六进制')
    assert.match(String(rootSpan), /^[0-9a-f]{8}$/, 'spanId 是 8 位十六进制')

    const child = c.log.child({})
    child.logSwitch.enabled = true // 子实例是独立实例：队列与开关各自独立（见 src/client.ts child 注释）
    assert.equal(child.why().sources.traceId, 'inherited', 'child 继承父链')
    assert.equal(child.why().traceId, rootId, 'child 的 traceId 与父一致')
    assert.notEqual(child.why().spanId, rootSpan, 'child 每次刷新 spanId')
    assert.equal(child.why().seq, 0, '子实例 seq 从 0 起')
    child.log('info', 'trace.child.1', {})
    child.log('info', 'trace.child.2', {})
    assert.equal(child.why().seq, 2, '子实例内 seq 单调')

    const explicit = c.log.child({ traceId: 'T-EXPLICIT' })
    assert.equal(explicit.why().sources.traceId, 'explicit', 'child(ctx) 显式传入')
    assert.equal(explicit.why().traceId, 'T-EXPLICIT')

    await c.flush()
    await child.flush()
    const rows = seen
      .filter((s) => s.name === 'trace-a.logBatch')
      .flatMap((s) => (s.args && s.args.entries ? s.args.entries : []))
    const root = rows.find((r) => r.event === 'trace.root')
    const k1 = rows.find((r) => r.event === 'trace.child.1')
    const k2 = rows.find((r) => r.event === 'trace.child.2')
    assert.ok(root && k1 && k2, '三行都要送出去')
    assert.equal(root.fields.traceId, rootId, '三件套住在 fields 里')
    assert.equal(k1.fields.traceId, rootId, '子行 traceId 与父一致')
    assert.equal(k1.fields.spanId, k2.fields.spanId, '同一子实例内 spanId 不变')
    assert.notEqual(k1.fields.spanId, root.fields.spanId, '子 spanId 与父不同')
    assert.equal(k1.fields.seq, 0)
    assert.equal(k2.fields.seq, 1)
    assert.equal(root.fields.seq, 0, '父实例自己的 seq 也从 0 起')
  })

  it('A2 跨边界：客户端经真电话落盘后三件套原样，按 traceId 能拉回整条链', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('trace-e2e'))
      await a.ready
      await a.store.handleLogSetSwitch({ enabled: true })
      const registry = new Map()
      hostMod.registerHostLogPhones(registry, a)
      const seen = []
      const c = clientMod.createClientLog(
        { storage: makeStorage(), timer: manualTimer(), host: phoneHost(registry, seen) },
        cfg('trace-e2e')
      )
      c.logSwitch.enabled = true
      const kid = c.log.child({ traceId: 'T-E2E' })
      kid.logSwitch.enabled = true
      kid.log('info', 'e2e.step.1', { step: 1 })
      kid.log('warn', 'e2e.step.2', { step: 2 })
      kid.log('error', 'e2e.step.3', { step: 3 })
      await kid.flush()
      await c.flush()
      await a.store.synced()

      const rows = await readRowsOf(cacheDir, 'logs-trace-e2e')
      const mine = rows.filter((r) => String(r.event).startsWith('e2e.step.'))
      assert.equal(mine.length, 3, '三行都要落盘')
      for (const row of mine) {
        assert.equal(row.v, 3)
        assert.deepEqual(Object.keys(row).sort(), ['event', 'fields', 'level', 'ts', 'v'])
        assert.equal(row.fields.traceId, 'T-E2E', '接收端不得重写 traceId')
        assert.match(String(row.fields.spanId), /^[0-9a-f]{8}$/, 'spanId 原样透传')
      }
      assert.deepEqual(mine.map((r) => r.fields.seq), [0, 1, 2], 'seq 按实例单调透传')

      const chain = await a.store.handleLogQuery({ traceId: 'T-E2E' })
      assert.equal(chain.traceChain, true, '带 traceId 查询走整链通道')
      assert.deepEqual(
        chain.entries.map((e) => e.event),
        ['e2e.step.1', 'e2e.step.2', 'e2e.step.3'],
        '整链按 (seq,ts) 排'
      )
      a.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('A2 伪造跨桶 traceId：无权来源不进链且点名 denied，被拒来源自己的行一行不少', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('trace-forge-a'))
      const b = await nodeMod.createNodeHostLog({ cacheDir }, cfg('trace-forge-b'))
      await a.ready
      await b.ready
      a.store.log('warn', 'forge.a.row', { traceId: 'T-FORGE', seq: 0 })
      b.store.log('warn', 'forge.b.row', { traceId: 'T-FORGE', seq: 1 })
      await a.store.synced()
      await b.store.synced()

      const sources = [
        { pluginId: 'trace-forge-a', query: (args) => a.store.handleLogQuery(args) },
        { pluginId: 'trace-forge-b', query: (args) => b.store.handleLogQuery(args) }
      ]
      // A 拿着 B 的 traceId 来查：无权来源整源被拒，链里只剩自己的行。
      const forged = await hostMod.aggregateLogQuery('trace-forge-a', sources, [], { traceId: 'T-FORGE' })
      assert.deepEqual(forged.denied, ['trace-forge-b'], '无权来源必须点名')
      assert.deepEqual(
        forged.entries.map((e) => e.event),
        ['forge.a.row'],
        '无权来源的行一行都不许进链'
      )
      assert.equal(forged.traceChain, true)

      // 被拒不等于被删：B 自己查得到自己的那行，源行一行不少。
      const own = await b.store.handleLogQuery({ traceId: 'T-FORGE' })
      assert.deepEqual(
        own.entries.map((e) => e.event),
        ['forge.b.row'],
        '被拒来源自己的行仍在'
      )
      a.store.release()
      b.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('A3 整链拉取：多来源（含 quick 入口）按 (seq,ts) 排、超 100 不断链', async () => {
    const cacheDir = await makeCacheDir()
    try {
      const a = await nodeMod.createNodeHostLog({ cacheDir }, cfg('trace-big'))
      await a.ready
      for (let i = 0; i < 150; i++) {
        a.store.log('warn', 'big.a.' + String(i), { traceId: 'T-BIG', seq: i })
      }
      const q = await nodeMod.createQuickLog(cacheDir)
      await q.ready
      for (let i = 0; i < 3; i++) {
        q.store.log('warn', 'big.quick.' + String(i), { traceId: 'T-BIG', seq: i })
      }
      await a.store.synced()
      await q.store.synced()

      const sources = [
        { pluginId: 'trace-big', query: (args) => a.store.handleLogQuery(args) },
        { pluginId: 'quick', query: (args) => q.store.handleLogQuery(args) }
      ]
      const chain = await hostMod.aggregateLogQuery('trace-big', sources, ['quick'], { traceId: 'T-BIG' })
      assert.equal(chain.traceChain, true)
      assert.deepEqual(chain.denied, [], '已授权来源不得报无权')
      assert.equal(chain.entries.length, 153, '150 + 3 行一行不丢，不受 100 上限截断')
      assert.ok(
        chain.entries.some((e) => String(e.event).startsWith('big.quick.')),
        'quick 入口写的行也在链内'
      )
      // 排序键 (seq, ts) 单调不减。
      let prev = null
      for (const e of chain.entries) {
        const key = [Number(e.fields.seq), Number(e.ts)]
        if (prev !== null) {
          assert.ok(
            key[0] > prev[0] || (key[0] === prev[0] && key[1] >= prev[1]),
            '整链必须按 (seq,ts) 升序：' + JSON.stringify(key) + ' 不得排在 ' + JSON.stringify(prev) + ' 之后'
          )
        }
        prev = key
      }
      a.store.release()
      q.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
