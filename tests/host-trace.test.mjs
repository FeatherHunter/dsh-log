// tests/host-trace.test.mjs —— 宿主侧链上下文（store.trace()，0.4.0 / research/18 §1）的契约。
//
// 为什么黑盒式看磁盘：这一条的验收标准就是「落盘行里有没有那三个键、串不串得起来」，
// 所以断言必须打在真临时目录里的真行上，而不是打在上下文对象的内部字段上。
//
// 六条纪律（每条都对应一个可能的退化）：
//   ① 同一上下文的三行：同一 traceId、同一 spanId、seq 0/1/2，行仍是五键；
//   ② child()：traceId 不变、spanId 变、seq 从 0 起（父上下文继续往下走，不受影响）；
//   ③ 保留字所有权：用了上下文，调用方再传 traceId/spanId/seq 就进 fields._shadow（不拒收、不覆盖）；
//   ④ 低层不变：不经上下文 store.log(...) 的 fields 原样透传（今天的行为，回归线）；
//   ⑤ 被开关挡下的行不消耗 seq（与客户端同口径）；
//   ⑥ 与查询面接缝：handleLogQuery({traceId}) 与 CLI --trace 都按 seq 序拉回这三行。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(PKG_DIR, 'dist', 'cli.js')
const nodeMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'node.js')).href + '?x=' + Date.now())
const { createNodeHostLog } = nodeMod

async function makeHost(pluginId) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dsh-htrace-'))
  const host = await createNodeHostLog({ cacheDir }, { pluginId, prefix: pluginId })
  return { cacheDir, host, store: host.store }
}

// 该 cacheDir 下唯一那个装着 .log 的目录（不猜目录名：派生规则变了这条测试也不该假红）。
async function logDirOf(cacheDir) {
  for (const name of await readdir(cacheDir)) {
    try {
      const files = await readdir(path.join(cacheDir, name))
      if (files.some((f) => f.endsWith('.log'))) return path.join(cacheDir, name)
    } catch (e) {
      void e
    }
  }
  throw new Error('没找到日志目录：' + cacheDir)
}

async function rowsOf(cacheDir) {
  const dir = await logDirOf(cacheDir)
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/.test(f)).sort()
  const rows = []
  for (const file of files) {
    const text = await readFile(path.join(dir, file), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      rows.push(JSON.parse(line))
    }
  }
  return { dir, rows }
}

describe('宿主侧链上下文 store.trace()（0.4.0）', () => {
  it('同上下文三行：同一 traceId、同一 spanId、seq 0/1/2，行仍是五键', async () => {
    const { cacheDir, host, store } = await makeHost('ht-one')
    try {
      assert.equal(typeof store.trace, 'function', 'store.trace 必须在公共面上')
      const t = store.trace()
      assert.match(t.traceId, /^[0-9a-f]{16}$/, 'traceId 是 16 位十六进制')
      assert.match(t.spanId, /^[0-9a-f]{8}$/, 'spanId 是 8 位十六进制')
      t.log('warn', 'step.one', { k: 1 })
      t.log('warn', 'step.two', { k: 2 })
      t.log('error', 'step.three', { k: 3 })
      await store.synced()

      const { rows } = await rowsOf(cacheDir)
      const mine = rows.filter((r) => String(r.event).startsWith('step.'))
      assert.equal(mine.length, 3, '三行都要落盘')
      for (const row of mine) {
        assert.deepEqual(Object.keys(row).sort(), ['event', 'fields', 'level', 'ts', 'v'], '落盘仍是五键行')
        assert.equal(row.fields.traceId, t.traceId)
        assert.equal(row.fields.spanId, t.spanId, '同一上下文里 spanId 不变')
      }
      assert.deepEqual(mine.map((r) => r.fields.seq), [0, 1, 2], 'seq 从 0 起、单调')
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('child()：traceId 不变、spanId 变、seq 从 0 起，父上下文不受影响', async () => {
    const { cacheDir, host, store } = await makeHost('ht-child')
    try {
      const parent = store.trace()
      parent.log('warn', 'p.first', {})
      const kid = parent.child()
      assert.equal(kid.traceId, parent.traceId, 'child 继承 traceId')
      assert.notEqual(kid.spanId, parent.spanId, 'child 必须换 spanId')
      kid.log('warn', 'k.first', {})
      kid.log('warn', 'k.second', {})
      parent.log('warn', 'p.second', {})
      await store.synced()

      const { rows } = await rowsOf(cacheDir)
      const byEvent = new Map(rows.map((r) => [r.event, r]))
      assert.equal(byEvent.get('p.first').fields.seq, 0)
      assert.equal(byEvent.get('p.second').fields.seq, 1, '父上下文的 seq 不被 child 打乱')
      assert.equal(byEvent.get('k.first').fields.seq, 0, 'child 的 seq 从 0 起')
      assert.equal(byEvent.get('k.second').fields.seq, 1)
      assert.equal(byEvent.get('k.first').fields.spanId, kid.spanId)
      assert.equal(byEvent.get('p.first').fields.spanId, parent.spanId)

      const explicit = parent.child({ spanId: 'FIXEDSPN' })
      assert.equal(explicit.spanId, 'FIXEDSPN', '显式 spanId 优先')
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('保留字所有权：用了上下文，调用方自带的 traceId/spanId/seq 进 fields._shadow（不拒收、不覆盖）', async () => {
    const { cacheDir, host, store } = await makeHost('ht-shadow')
    try {
      const t = store.trace({ traceId: 'T-OWNER' })
      const outcome = t.log('warn', 'conflict.row', { traceId: 'CALLER', spanId: 'CALLER-S', seq: 9, k: 1 })
      assert.equal(outcome, 'queued')
      await store.synced()
      const { rows } = await rowsOf(cacheDir)
      const row = rows.find((r) => r.event === 'conflict.row')
      assert.equal(row.fields.traceId, 'T-OWNER', 'SDK 声明的链路拥有保留字')
      assert.equal(row.fields.k, 1, '普通字段照旧')
      assert.deepEqual(row.fields._shadow, { traceId: 'CALLER', spanId: 'CALLER-S', seq: 9 }, '调用方的值搬进 _shadow，不丢')
      assert.equal(t.shadowWarns, 1, '冲突计数可查')
      assert.equal(row.fields.seq, 0, '主行的 seq 是上下文给的 0，不是调用方塞的 9')
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('低层不变（回归线）：不经上下文 store.log(...) 的 fields 原样透传，没有 _shadow', async () => {
    const { cacheDir, host, store } = await makeHost('ht-raw')
    try {
      store.log('warn', 'raw.row', { traceId: 'RAW', seq: 42, k: 2 })
      await store.synced()
      const { rows } = await rowsOf(cacheDir)
      const row = rows.find((r) => r.event === 'raw.row')
      assert.equal(row.fields.traceId, 'RAW', '低层路径不许悄悄改写既有行为')
      assert.equal(row.fields.seq, 42)
      assert.equal(row.fields._shadow, undefined)
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('被开关挡下的行不消耗 seq（与客户端同口径）', async () => {
    const { cacheDir, host, store } = await makeHost('ht-skip')
    try {
      const t = store.trace({ traceId: 'T-SKIP' })
      assert.equal(t.log('info', 'gated.info', {}), 'skipped', '默认开关关着，info 被挡')
      assert.equal(t.log('warn', 'after.skip', {}), 'queued')
      await store.synced()
      const { rows } = await rowsOf(cacheDir)
      const row = rows.find((r) => r.event === 'after.skip')
      assert.equal(row.fields.seq, 0, '被挡下的行不占号，seq 仍从 0 起')
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('接缝：handleLogQuery({traceId}) 与 CLI --trace 都按 seq 序拉回整条链', async () => {
    const { cacheDir, host, store } = await makeHost('ht-seam')
    try {
      const t = store.trace({ traceId: 'T-SEAM' })
      t.log('warn', 'seam.a', { message: '第一步' })
      const kid = t.child()
      kid.log('warn', 'seam.b', { message: '第二步' })
      kid.log('error', 'seam.c', { message: '第三步' })
      await store.synced()

      const res = await store.handleLogQuery({ traceId: 'T-SEAM' })
      assert.equal(res.ok, true)
      const got = res.entries.filter((e) => String(e.event).startsWith('seam.'))
      assert.deepEqual(got.map((e) => e.event), ['seam.a', 'seam.b', 'seam.c'], '整链按 (seq, ts) 排')
      assert.equal(res.traceChain, true, 'traceId 查询走整链通道')

      const { dir } = await rowsOf(cacheDir)
      const cli = spawnSync(process.execPath, [CLI, '--trace', 'T-SEAM', dir], { encoding: 'utf8' })
      assert.equal(cli.status, 0, cli.stderr)
      assert.ok(cli.stdout.includes('seam.a') && cli.stdout.includes('seam.b') && cli.stdout.includes('seam.c'), 'CLI --trace 命中宿主侧行：' + cli.stdout)
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('影子计数只数「调用方真的传了保留字」：只带 _shadow 不算冲突、也不写影子行', async () => {
    const { cacheDir, host, store } = await makeHost('ht-shadow')
    try {
      const t = store.trace({ traceId: 'T-SHADOW' })
      // 只带 _shadow（调用方自己归档自己的字段）：不是我们搬的 → 不计数、不写 log.trace.shadow
      t.log('warn', 'shadow.self', { _shadow: { mine: 1 } })
      assert.equal(t.shadowWarns, 0, '只带 _shadow 不算保留字冲突')
      // 真的传了保留字：计数 +1，值进 _shadow，主行用上下文的
      t.log('warn', 'shadow.conflict', { traceId: 'caller-id', note: 'x' })
      assert.equal(t.shadowWarns, 1, '传了保留字才算冲突')
      await store.synced()
      const { rows } = await rowsOf(cacheDir)
      const self = rows.find((r) => r.event === 'shadow.self')
      const conflict = rows.find((r) => r.event === 'shadow.conflict')
      assert.deepEqual(self.fields._shadow, { mine: 1 }, '调用方自己的 _shadow 原样保留')
      assert.equal(conflict.fields.traceId, 'T-SHADOW', '主行用上下文的 traceId')
      assert.equal(conflict.fields._shadow.traceId, 'caller-id', '调用方传的进 _shadow')
      assert.equal(rows.filter((r) => r.event === 'log.trace.shadow').length, 0, '宿主侧不写影子行（行本身就是证据）')
    } finally {
      host.store.release()
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
