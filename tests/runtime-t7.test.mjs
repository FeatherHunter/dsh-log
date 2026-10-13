// packages/dsh-log/tests/runtime-t7.test.mjs —— T7 五项运行时行为 + 客户端 _shadow 分流（0.3.0 垂直片 B 补测）。
// 用法：先重建 dist（node build.mjs），再 node --test tests/runtime-t7.test.mjs（或 npm test 跑全量）。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 六项：store.synced() 刷完当期队列才 resolve、store.beforeExit() 只注册一个监听器、
// 同形 error 折叠（10 折 1 / 9 不折 / 异形不折）、onDrop（普通满丢新恰一次、error 挤旧不调）、
// onDrop 重入哨兵（回调里再 log() 不递归）、客户端 _shadow 保留字冲突分流（error 照落 + 影子告警行）。
//
// 两处测法说明（都是为了不靠等时间，跑起来稳）：
// 1. 落盘走真临时目录 + 真磁盘写入，断言看的是当天文件里的行，不看队列对象（队列不在包面上）。
// 2. 计时器用手动计时器（只记排期、回调永不触发）：1000 毫秒防抖被锁在「已排期未落地」，
//    于是「synced() 是不是自己刷下去的」与「折叠是不是在队内完成的」都由本例说了算，不靠等窗口过期。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const hostMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())
const { createHostLog, formatDailyFileName } = hostMod
const clientMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'client.js')).href + '?x=' + Date.now())
const { createClientLog } = clientMod

// 手动计时器：只把「谁在等多久」记下来，回调永不触发（不落盘、不转发）。
function makeManualTimer() {
  const calls = []
  return {
    calls,
    timeout(fn, ms) {
      calls.push({ fn, ms })
      return calls.length
    }
  }
}

// 给 synced() 之类的等待加一道超时闸：正常几毫秒就落定；万一实现退化成等防抖，这里报红而不是把整轮挂死。
async function withTimeout(promise, ms, label) {
  let timer = null
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' 超过 ' + ms + ' 毫秒还没落定')), ms)
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    clearTimeout(timer)
  }
}

// 真磁盘文件服务：形状与 dist/node.js 的 createNodeFileService 同形，直接读写临时目录。
function makeDiskFs() {
  const targetPath = (t) => (t && typeof t === 'object' && typeof t.path === 'string' ? t.path : String(t))
  return {
    async resolve(p) {
      return { path: String(p) }
    },
    async readText(t) {
      try {
        return await readFile(targetPath(t), 'utf8')
      } catch (e) {
        if (e && e.code === 'ENOENT') return ''
        throw e
      }
    },
    async writeText(t, text) {
      const p = targetPath(t)
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, text, 'utf8')
    },
    async mkdir(dir) {
      await mkdir(String(dir), { recursive: true })
    },
    async unlink(t) {
      await rm(targetPath(t), { force: true })
    },
    async listDir() {
      return []
    }
  }
}

// 可开关失败的文件服务：正常时透传真磁盘读写，failWrites 为真时写盘抛错（模拟磁盘故障）。
// 用来验证「写失败 → 进重试位 → 磁盘恢复 → await synced() 必须把行补落盘」这条不变量②的子句。
function makeFlakyFs() {
  const base = makeDiskFs()
  const state = { failWrites: false, writes: 0 }
  return {
    state,
    resolve: (p) => base.resolve(p),
    readText: (t) => base.readText(t),
    mkdir: (d) => base.mkdir(d),
    unlink: (t) => base.unlink(t),
    listDir: () => base.listDir(),
    async writeText(t, text) {
      state.writes += 1
      if (state.failWrites) throw new Error('模拟写盘失败')
      return base.writeText(t, text)
    }
  }
}

// 一套独立的落盘日志库：独立临时目录 + 独立手动计时器 + 真磁盘写入；rows() 读当天文件里的行。
async function makeStore(options = {}) {
  const pluginId = options.pluginId || 't7'
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dsh-log-t7-'))
  const timer = makeManualTimer()
  const fs = options.fs || makeDiskFs()
  const deps = { fs, timer, getCacheDir: async () => cacheDir, DEFAULT_CWD: cacheDir }
  const config = { pluginId, prefix: pluginId }
  if (options.maxQueue !== undefined) config.maxQueue = options.maxQueue
  const { store } = createHostLog(deps, config)
  const dayFile = () => path.join(cacheDir, store.config.logDirName, formatDailyFileName(new Date()))
  return {
    store,
    timer,
    fs,
    cacheDir,
    dayFile,
    // 当天文件里的落盘行（文件还没有就是空数组）：一行一条 JSON，按写入顺序。
    async rows() {
      let text = ''
      try {
        text = await readFile(dayFile(), 'utf8')
      } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e
      }
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    },
    async cleanup() {
      await rm(cacheDir, { recursive: true, force: true })
    }
  }
}

// 客户端夹具：空本地存储（开关默认关）+ 手动计时器（转发排期不落地）+ 不真发电话的宿主。
function makeStorage() {
  const map = new Map()
  return {
    getItem(k) {
      return map.has(String(k)) ? map.get(String(k)) : null
    },
    setItem(k, v) {
      map.set(String(k), String(v))
    }
  }
}
function makeQuietHost() {
  return {
    call() {
      return Promise.resolve({ ok: true, accepted: 0, dropped: 0 })
    }
  }
}

describe('T7 运行时行为（#18 队列口径 + 0.3.0 追踪分流）', () => {
  it('synced()：写 N 行后 await，当天文件含全部 N 行（刷完当期队列才 resolve）', async () => {
    const h = await makeStore({ pluginId: 't7-sync' })
    try {
      const N = 20
      await h.store.handleLogSetSwitch({ enabled: true })
      for (let i = 0; i < N; i++) h.store.log('info', 'sync.probe.' + i, { i })
      // 前提：信息级走 1000 毫秒防抖，手动计时器的回调永不触发——队列此刻还没落盘。
      assert.equal(h.timer.calls.filter((c) => c.ms === 1000).length, 1, '普通行应只排一次 1000 毫秒防抖')
      assert.deepEqual(await h.rows(), [], 'await 之前一行都不该落盘')
      await withTimeout(h.store.synced(), 5000, 'store.synced()')
      const rows = await h.rows()
      assert.equal(rows.length, N, 'synced() 落定后当天文件应含全部 ' + N + ' 行')
      assert.deepEqual(
        rows.map((r) => r.event),
        Array.from({ length: N }, (_, i) => 'sync.probe.' + i),
        '顺序与写入顺序一致'
      )
      for (const row of rows) {
        assert.equal(row.v, 3)
        assert.equal(row.level, 'info')
      }
      assert.equal(h.store.getDroppedCount(), 0)
    } finally {
      await h.cleanup()
    }
  })

  it('synced()：写盘失败过、磁盘恢复后，队列空也要把重试位里的行补落盘（不等任何定时器）', async () => {
    // 2026-10-14 终局审查 ② 点出「synced() 的收尾条件里重试位那一句没有独立覆盖」。复核结论：
    // 该句是防御性冗余（dist 里删掉它，同场景仍然 pending=0、行如实落盘，见 pipeline.ts synced() 上的注释），
    // 没有任何测试能区分它；但**「写失败 → 重试位 → 磁盘恢复 → await synced() 补落盘」这条可观察不变量**
    // 此前确实一条用例都没有，本用例就是补这一条网（违反它时这里必红）。
    const fs = makeFlakyFs()
    const h = await makeStore({ pluginId: 't7-retry', fs })
    try {
      fs.state.failWrites = true
      // warn 是紧急级别，走直通刷盘（不经 1000 毫秒防抖），失败后该行进重试位。
      h.store.log('warn', 'retry.land', { n: 1 })
      await withTimeout(h.store.flushNow(), 5000, 'store.flushNow()')
      assert.ok(h.store.getPendingCount() >= 1, '写失败后该行应压在重试位（pending 大于 0），而不是被丢掉')
      assert.deepEqual(await h.rows(), [], '写失败期间盘上不该有这行')
      assert.equal(h.store.getDroppedCount(), 0, '写失败不等于丢行')

      fs.state.failWrites = false
      // 手动计时器的回调永不触发：这一行只能靠 synced() 自己把重试位刷出去。
      await withTimeout(h.store.synced(), 5000, 'store.synced()')
      assert.equal(h.store.getPendingCount(), 0, 'synced() 返回时重试位应已清空')
      const landed = (await h.rows()).filter((r) => r.event === 'retry.land')
      assert.equal(landed.length, 1, 'synced() 返回即已补落盘：一行不多一行不少')
      assert.equal(landed[0].level, 'warn')
      assert.equal(landed[0].v, 3)
    } finally {
      await h.cleanup()
    }
  })

  it('beforeExit()：调 3 次只注册一个监听器，用例自己加的监听器能摘干净', async () => {
    const h = await makeStore({ pluginId: 't7-exit' })
    const before = process.listenerCount('beforeExit')
    const existed = new Set(process.listeners('beforeExit'))
    const added = []
    try {
      h.store.beforeExit()
      h.store.beforeExit()
      h.store.beforeExit()
      assert.equal(process.listenerCount('beforeExit'), before + 1, '调 3 次只增一个监听器')
      for (const l of process.listeners('beforeExit')) {
        if (!existed.has(l)) added.push(l)
      }
      assert.equal(added.length, 1)
      h.store.beforeExit()
      assert.equal(process.listenerCount('beforeExit'), before + 1, '再调一次也不重复注册')
    } finally {
      // 摘干净自己加的：差集优先，兜底再把 added 过一遍，绝不把监听器留在进程上。
      for (const l of added) process.removeListener('beforeExit', l)
      for (const l of process.listeners('beforeExit')) {
        if (!existed.has(l)) process.removeListener('beforeExit', l)
      }
      await h.cleanup()
    }
    assert.equal(process.listenerCount('beforeExit'), before, '用例结束后监听器数回到原样')
  })

  it('同形 error 折叠：窗口内 10 次折成 1 行带 repeated，9 次不折，异形不折', async () => {
    // 10 次同 event 同 fields：折成 1 行，repeated=10，原字段保留。
    const ten = await makeStore({ pluginId: 't7-fold-ten' })
    try {
      for (let i = 0; i < 10; i++) ten.store.log('error', 'fold.probe', { code: 'E1' })
      await ten.store.synced()
      const rows = await ten.rows()
      assert.equal(rows.length, 1, '1000 毫秒窗口内 10 次同形 error 应折叠成 1 行')
      assert.equal(rows[0].level, 'error')
      assert.equal(rows[0].event, 'fold.probe')
      assert.equal(rows[0].fields.repeated, 10, '折叠行带重复次数')
      assert.equal(rows[0].fields.code, 'E1', '原有字段保留')
      assert.equal(rows[0].v, 3)
    } finally {
      await ten.cleanup()
    }

    // 超阈值继续同形：只更新那一行的计数，不再新增行。
    const more = await makeStore({ pluginId: 't7-fold-more' })
    try {
      for (let i = 0; i < 12; i++) more.store.log('error', 'fold.probe', { code: 'E1' })
      await more.store.synced()
      const rows = await more.rows()
      assert.equal(rows.length, 1, '12 次同形仍只有 1 行')
      assert.equal(rows[0].fields.repeated, 12, '计数跟到最后一次，而不是停在阈值 10')
    } finally {
      await more.cleanup()
    }

    // 9 次同形：不到阈值，原样 9 行，一行都不带 repeated。
    const nine = await makeStore({ pluginId: 't7-fold-nine' })
    try {
      for (let i = 0; i < 9; i++) nine.store.log('error', 'fold.nine', { code: 'E1' })
      await nine.store.synced()
      const rows = await nine.rows()
      assert.equal(rows.length, 9, '9 次同形不折，原样 9 行')
      for (const row of rows) {
        assert.equal(row.event, 'fold.nine')
        assert.equal('repeated' in row.fields, false, '未折叠的行不带 repeated')
      }
    } finally {
      await nine.cleanup()
    }

    // 异形不折：同 event 不同 fields 10 次 + 不同 event 同 fields 10 次（两事件交替），共 20 行都不折。
    const odd = await makeStore({ pluginId: 't7-fold-odd' })
    try {
      for (let i = 0; i < 10; i++) odd.store.log('error', 'fold.d1', { i })
      for (let i = 0; i < 10; i++) odd.store.log('error', i % 2 ? 'fold.d2.b' : 'fold.d2.a', { code: 'K' })
      await odd.store.synced()
      const rows = await odd.rows()
      assert.equal(rows.length, 20, '异形不折：20 次全落')
      assert.equal(rows.filter((r) => r.event === 'fold.d1').length, 10, '同 event 不同 fields 不折')
      assert.equal(rows.filter((r) => r.event.startsWith('fold.d2')).length, 10, '不同 event 同 fields 不折')
      for (const row of rows) {
        assert.equal('repeated' in row.fields, false, '异形行不带 repeated')
      }
    } finally {
      await odd.cleanup()
    }
  })

  it('onDrop：普通行满丢新恰调一次（queue-full），error 满时挤旧不调', async () => {
    const h = await makeStore({ pluginId: 't7-drop', maxQueue: 3 })
    try {
      const drops = []
      h.store.setOnDrop((count, reason) => drops.push({ count, reason }))
      await h.store.handleLogSetSwitch({ enabled: true })
      for (let i = 0; i < 3; i++) h.store.log('info', 'fill-' + i, { i })
      assert.equal(h.store.getDroppedCount(), 0, '满队前不丢')

      // 普通行满：丢掉新来的那一行，onDrop 恰调一次。
      h.store.log('info', 'overflow', {})
      assert.equal(drops.length, 1, '普通行满丢新应恰调一次 onDrop（不多不少）')
      assert.deepEqual(drops[0], { count: 1, reason: 'queue-full' })
      assert.equal(h.store.getDroppedCount(), 1, '丢弃只计数不抛错')

      // error 满：挤掉最旧普通行腾位，照落，不调 onDrop。
      h.store.log('error', 'boom', { code: 'E' })
      assert.equal(drops.length, 1, 'error 挤旧不调 onDrop')
      assert.equal(h.store.getDroppedCount(), 2)

      await h.store.synced()
      const rows = await h.rows()
      assert.deepEqual(
        rows.map((r) => r.event),
        ['fill-1', 'fill-2', 'boom'],
        'error 照落，被挤掉的是最旧的 fill-0'
      )
      assert.equal(rows[2].level, 'error')
    } finally {
      await h.cleanup()
    }
  })

  it('重入哨兵：onDrop 回调里再 log() 不递归、不炸栈，回调仍只算一次', async () => {
    const h = await makeStore({ pluginId: 't7-reentry', maxQueue: 3 })
    try {
      let calls = 0
      h.store.setOnDrop(() => {
        calls += 1
        // 回调里再打一行：队列还是满的，会再触发一次丢弃——哨兵必须挡住递归。
        h.store.log('info', 'from-drop', {})
      })
      await h.store.handleLogSetSwitch({ enabled: true })
      for (let i = 0; i < 3; i++) h.store.log('info', 'fill-' + i, { i })

      assert.doesNotThrow(() => h.store.log('info', 'overflow', {}), '回调内再 log() 不得炸栈')
      assert.equal(calls, 1, '回调只算一次（内层那次丢弃不再回调）')
      assert.equal(h.store.getDroppedCount(), 2, '外层丢 1 行 + 回调内层丢 1 行')

      h.store.log('info', 'overflow-2', {})
      assert.equal(calls, 2, '哨兵用完即复位：下一次丢弃照常回调')
      assert.equal(h.store.getDroppedCount(), 4, '第二轮同样是外层 1 行 + 回调内层 1 行')

      await h.store.synced()
      const rows = await h.rows()
      assert.deepEqual(
        rows.map((r) => r.event),
        ['fill-0', 'fill-1', 'fill-2'],
        '满队时回调内打的行也走丢弃，不进队列'
      )
      assert.ok(!rows.some((r) => r.event === 'from-drop'))
    } finally {
      await h.cleanup()
    }
  })

  it('_shadow：保留字与业务字段冲突时 error 照落，冲突字段进 _shadow，warn 计数与影子行都出现', async () => {
    const logger = createClientLog(
      { storage: makeStorage(), timer: makeManualTimer(), host: makeQuietHost() },
      { pluginId: 'wf', prefix: 'wf' }
    )
    logger.log('error', 'boom', { traceId: 'user-trace', spanId: 'user-span', seq: 42, keep: 'yes' })

    const main = logger.logQueue.find((r) => r.event === 'boom')
    assert.ok(main, 'error 本体照落，不被拒收')
    assert.equal(main.level, 'error')
    assert.equal(main.v, 3)
    assert.equal(main.fields.keep, 'yes', '业务字段原样保留')
    assert.deepEqual(
      main.fields._shadow,
      { traceId: 'user-trace', spanId: 'user-span', seq: 42 },
      '冲突的保留字整体搬进 _shadow'
    )
    assert.match(main.fields.traceId, /^[0-9a-f]{16}$/, '行内 traceId 是自动建链的，没被用户值顶掉')
    assert.match(main.fields.spanId, /^[0-9a-f]{8}$/)
    assert.equal(main.fields.seq, 0, '行内 seq 是本实例序号，不是用户塞的 42')

    const shadowRow = logger.logQueue.find((r) => r.event === 'log.trace.shadow')
    assert.ok(shadowRow, 'warn 计数之外还要有一行可检索的影子告警行')
    assert.equal(shadowRow.level, 'warn')
    assert.deepEqual(shadowRow.fields, { event: 'boom', shadowed: ['traceId', 'spanId', 'seq'] })
    assert.equal(logger.why().shadowWarns, 1, '影子 warn 计数加一')
    assert.equal(logger.why().traceId, main.fields.traceId)
    assert.equal(logger.logQueue.length, 2, '只多一行影子 warn，没有别的行')

    // 无冲突的行不搬影子、不计数。
    logger.log('error', 'clean-row', { keep: 'ok' })
    const clean = logger.logQueue.find((r) => r.event === 'clean-row')
    assert.equal('_shadow' in clean.fields, false)
    assert.equal(clean.fields.keep, 'ok')
    assert.equal(logger.why().shadowWarns, 1, '无冲突不加影子计数')
  })
})
