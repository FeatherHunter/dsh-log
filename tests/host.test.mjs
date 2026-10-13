// packages/dsh-log/tests/host.test.mjs —— 宿主引擎单测（#559 附单测四项，#19 重建）。
// 用法：先重建 dist（见包内 build.mjs 同参数），再 node --test packages/dsh-log/tests/host.test.mjs。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 四项：关闭零调用、串行不丢行、命名规则、失败计数；另加 0.3.0 读侧覆盖
// （v=3 五键、lint 三档、计数自算、host 转出口、logQuery denied/traceChain/expired/当日保护）。
// #19 重建说明：旧对照用的 D:/src 旧路径已不存在（预存红），本文件只引用 impres dist/
// 对应入口（host 用 dist/host.js，phones 直读用 dist/phones.js，store 经 host 的
// createLogStore 拿——store 无包面入口，不直引 dist/store.js）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const fresh = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())
const { createHostLog, registerHostLogPhones, buildPhoneNames, formatDailyFileName, LOG_DEBOUNCE_MS } = fresh

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 内存文件服务夹具：行为与宿主文件服务同形（resolve 给目标对象，读写按目标读写）。
function makeMemoryFiles() {
  return { texts: new Map(), writes: 0, failWrites: false }
}
function makeFs(mem) {
  return {
    async resolve(p) {
      return { __target: String(p) }
    },
    async readText(t) {
      const key = t && t.__target ? t.__target : String(t)
      if (!mem.texts.has(key)) throw new Error('文件不存在：' + key)
      return mem.texts.get(key)
    },
    async writeText(t, text) {
      mem.writes += 1
      if (mem.failWrites) throw new Error('模拟写盘失败')
      mem.texts.set(t && t.__target ? t.__target : String(t), String(text))
    },
    async unlink(t) {
      mem.texts.delete(t && t.__target ? t.__target : String(t))
    }
  }
}
function makePlatform() {
  return {
    os: 'test-os',
    path: { join(...parts) { return parts.join('/').replace(/\/+/g, '/') } },
    fs: {
      async resolve(p) { return { __target: String(p) } },
      async mkdir() {},
      async listDir() { return [] }
    }
  }
}
function makeTimer() {
  const calls = []
  const timeout = (fn, ms) => {
    if (typeof fn === 'number') return new Promise((resolve) => setTimeout(() => resolve({ exitCode: -1 }), fn))
    calls.push(ms)
    return setTimeout(fn, ms)
  }
  return { timeout, calls }
}
function makeDeps(mem, cacheDir) {
  const timer = makeTimer()
  return {
    timer,
    deps: {
      fs: makeFs(mem),
      timer,
      getCacheDir: async () => cacheDir,
      getPlatform: async () => makePlatform(),
      DEFAULT_CWD: '/work'
    }
  }
}

// 一份手写小清单：两常驻、一按需、一自监控（lint 三档与计数自算共用）。
function makeSampleList() {
  return {
    version: 1,
    pluginId: 'wf',
    counts: { resident: 2, ondemand: 1, selfmon: 1 },
    events: {
      'snapshot.built': { level: 'info', kind: 'resident', fields: ['maps', 'issues'] },
      'gh.exec': { level: 'info', kind: 'resident', fields: ['argv0', 'exitCode'] },
      'chain.cache.miss': { level: 'debug', kind: 'ondemand', fields: ['keyHash'] },
      'log.persist.fail': { level: 'warn', kind: 'selfmon', fields: ['op', 'reason'] }
    }
  }
}

// logQuery 测试夹具：经 dist/phones.js 的 createLogPhones 直调（phones 无包面入口，
// 测试直引 dist 文件；store 已透出 handleLogQuery、宿主入口也注册第 6 个查询电话，见隔离片）。
async function makeQueryPhones() {
  const phonesMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'phones.js')).href + '?x=' + Date.now() + Math.random())
  const files = new Map()
  const seen = []
  const ctx = {
    config: { pluginId: 'wf', prefix: 'wf', logDirName: 'logs', switchFileName: 'log-switch.json', fileNamePolicy: 'daily', maxQueue: 1000, eventList: null },
    joinPath: (a, b) => String(a) + '/' + String(b),
    joinLogPath: async (d, n) => String(d) + '/' + String(n),
    resolveTarget: async (p) => ({ __target: String(p) }),
    readTarget: async (t) => {
      const key = t && t.__target ? t.__target : String(t)
      if (!files.has(key)) throw new Error('文件不存在：' + key)
      return files.get(key)
    },
    writeTarget: async () => ({}),
    log: (level, event, fields) => { seen.push({ level, event, fields }) },
    getSwitchState: () => ({ enabled: true }),
    getHeaderInfo: () => null,
    loadSwitch: async () => ({ enabled: true }),
    setSwitch: async (enabled) => ({ enabled }),
    getCacheDir: async () => '/cache',
    getPlatform: async () => null,
    DEFAULT_CWD: '/work',
    fs: {
      async listDir() { return Array.from(files.keys()).map((k) => String(k).slice(String(k).lastIndexOf('/') + 1)) },
      async unlink(t) { files.delete(t && t.__target ? t.__target : String(t)) }
    }
  }
  return { phones: phonesMod.createLogPhones(ctx), files, seen }
}

// 写一行 v=3 落盘行（与 store 写盘同形：{v,ts,level,event,fields}）。
function v3row(ts, level, event, fields) {
  return JSON.stringify({ v: 3, ts, level, event, fields })
}

describe('宿主引擎单测（#559）', () => {
  it('关闭零调用：开关关闭时信息与调试不进队列、不排定时器、不写盘、不计数', async () => {
    const mem = makeMemoryFiles()
    const { timer, deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    assert.equal(store.isEnabled('error'), true)
    assert.equal(store.isEnabled('warn'), true)
    assert.equal(store.isEnabled('info'), false)
    assert.equal(store.isEnabled('debug'), false)
    assert.equal(store.getSwitchState().enabled, false)
    const timerBefore = timer.calls.length
    const writesBefore = mem.writes
    for (let i = 0; i < 5; i++) store.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) store.log('debug', 'evt.closed.debug', { n: i })
    assert.equal(timer.calls.length, timerBefore)
    store.flush()
    await wait(60)
    assert.equal(mem.writes, writesBefore)
    assert.equal(store.getDroppedCount(), 0)
  })

  it('串行不丢行：20 行按序全部落到当天文件', async () => {
    const mem = makeMemoryFiles()
    const { deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.setSwitch(true)
    for (let i = 0; i < 20; i++) store.log('info', 'evt-' + i, { n: i })
    store.flush()
    await wait(80)
    const today = formatDailyFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    assert.equal(keys.length, 1)
    const rows = String(mem.texts.get(keys[0]) || '').split('\n').filter(Boolean)
    assert.equal(rows.length, 20)
    for (let i = 0; i < rows.length; i++) {
      const parsed = JSON.parse(rows[i])
      assert.equal(parsed.event, 'evt-' + i)
      assert.equal(parsed.level, 'info')
    }
  })

  it('命名规则：默认前缀拼出旧字面并派生旧目录名，自定前缀隔离，非法报错，重复注册不覆盖', async () => {
    // 默认前缀 wf 下 5 个字面与现状一字不差。
    assert.deepEqual(buildPhoneNames('wf'), {
      logBatch: 'wf.logBatch',
      logExport: 'wf.logExport',
      logClear: 'wf.logClear',
      logGetSwitch: 'wf.logGetSwitch',
      logSetSwitch: 'wf.logSetSwitch'
    })
    // 自定前缀拼出隔离后的名字。
    assert.equal(buildPhoneNames('demo-plugin').logBatch, 'demo-plugin.logBatch')
    // 目录与开关文件名默认派生：wf 走旧字面，其他标识加后缀。
    const mem = makeMemoryFiles()
    const { deps } = makeDeps(mem, '/cache')
    assert.equal(createHostLog(deps, { pluginId: 'wf', prefix: 'wf' }).store.config.logDirName, 'logs')
    assert.equal(createHostLog(deps, { pluginId: 'wf', prefix: 'wf' }).store.config.switchFileName, 'log-switch.json')
    assert.equal(createHostLog(deps, { pluginId: 'demo', prefix: 'demo' }).store.config.logDirName, 'logs-demo')
    assert.equal(createHostLog(deps, { pluginId: 'demo', prefix: 'demo' }).store.config.switchFileName, 'log-switch-demo.json')
    // 双必填（#18）：不传前缀直接抛中文错，不再回退到插件标识。
    assert.throws(() => createHostLog(deps, { pluginId: 'demo' }), /prefix/)
    const demoDefault = createHostLog(deps, { pluginId: 'demo', prefix: 'demo' })
    assert.equal(demoDefault.store.config.prefix, 'demo')
    assert.equal(demoDefault.phoneNames.logBatch, 'demo.logBatch')
    assert.equal(demoDefault.phoneNames.logExport, 'demo.logExport')
    // 主路径：双显式 wf/wf 仍为 wf 电话名。
    assert.equal(createHostLog(deps, { pluginId: 'wf', prefix: 'wf' }).phoneNames.logBatch, 'wf.logBatch')
    assert.equal(createHostLog(deps, { pluginId: 'wf', prefix: 'wf' }).phoneNames.logBatch, 'wf.logBatch')
    // 缺插件标识、缺前缀、大写、含点都直接报错，不做静默转小写。
    assert.throws(() => createHostLog(deps, {}), /pluginId/)
    assert.throws(() => createHostLog(deps, { prefix: 'wf' }), /pluginId/)
    assert.throws(() => createHostLog(deps, { pluginId: 'wf' }), /prefix/)
    assert.throws(() => createHostLog(deps, { pluginId: 'WF', prefix: 'wf' }), /非法/)
    assert.throws(() => createHostLog(deps, { pluginId: 'wf.demo', prefix: 'wf' }), /非法/)
    assert.throws(() => buildPhoneNames('WF'), /非法/)
    // 依赖形状也 fail-loud（2026-10-14 四维审查）：getCacheDir 是日志根目录的唯一来源，
    // 少了它每一行都无处落盘、只会静默计入丢弃数——建库当场抛，不留到运行期。
    assert.throws(() => createHostLog(undefined, { pluginId: 'wf', prefix: 'wf' }), /getCacheDir/)
    assert.throws(() => createHostLog({}, { pluginId: 'wf', prefix: 'wf' }), /getCacheDir/)
    assert.throws(() => createHostLog({ getCacheDir: 'C:/not-a-function' }, { pluginId: 'wf', prefix: 'wf' }), /getCacheDir/)
    // 只给 getCacheDir 就能建库（其余依赖走退化路，写盘时才报文件服务不可用）。
    assert.equal(typeof createHostLog({ getCacheDir: async () => '/cache' }, { pluginId: 'wf', prefix: 'wf' }).store.log, 'function')
    // 四段式只作可选项：形状为日期点插件标识点进程号点启动时间。
    const four = createHostLog(deps, { pluginId: 'demo', prefix: 'demo', fileNamePolicy: 'four-segment' })
    await four.store.setSwitch(true)
    await four.store.writeStartupHeader()
    four.store.log('error', 'boom-four', {})
    await wait(60)
    const names = Array.from(mem.texts.keys()).filter((k) => k.includes('/logs-demo/'))
    assert.equal(names.length >= 1, true)
    const base = names[0].slice(names[0].lastIndexOf('/') + 1)
    assert.match(base, /^\d{4}-\d{2}-\d{2}\.demo\.\d+\..+\.log$/)
    // 已注册的电话名再次注册时报错、不覆盖旧的。
    const first = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    const registry = new Map()
    registerHostLogPhones(registry, first)
    const keep = registry.get('wf.logBatch')
    const second = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    assert.throws(() => registerHostLogPhones(registry, second), /已被注册/)
    assert.equal(registry.get('wf.logBatch'), keep)
    // 队列口径：默认 1000 条封顶，满时只计数不抛错。
    const small = makeMemoryFiles()
    const slim = makeDeps(small, '/cache')
    const capped = createHostLog(slim.deps, { pluginId: 'wf', prefix: 'wf', maxQueue: 3 })
    await capped.store.setSwitch(true)
    capped.store.log('info', 'a', {})
    capped.store.log('info', 'b', {})
    capped.store.log('info', 'c', {})
    capped.store.log('info', 'dropped-one', {})
    assert.equal(capped.store.getDroppedCount(), 1)
  })

  it('写失败不丢行：进重试位、恢复后补落盘、不计 dropped；记录电话最外层例外如实回失败加接收 0 条', async () => {
    const mem = makeMemoryFiles()
    mem.failWrites = true
    const { deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.setSwitch(true)
    const before = store.getDroppedCount()
    // U8 覆盖：写失败**不是丢弃**，所以 onDrop 一次都不许响（响一声就等于告诉用户「丢了行」）。
    const drops = []
    store.setOnDrop((count, reason) => drops.push({ count, reason }))
    store.log('info', 'evt-fail-1', {})
    store.log('info', 'evt-fail-2', {})
    store.log('info', 'evt-fail-3', {})
    let threw = false
    try {
      store.flush()
      await wait(80)
    } catch {
      threw = true
    }
    assert.equal(threw, false)
    const settledAt = store.getDroppedCount()
    // 0.3.0 写失败语义（#23 审查必改 R2）：写失败**不等于丢行**——那批行进重试位等下次写，
    // dropped 不动；失败本身靠 lastPersistFail 与自监控行对外可见。
    assert.equal(settledAt - before, 0, '写失败不得计进 dropped（行还在重试位里）')
    assert.ok(store.getPendingCount() >= 3, '三条用户行必须还压在手里（重试位）')
    const failed = store.getLastPersistFail()
    assert.ok(failed && failed.op === 'writeBatch' && failed.reason === 'write-fail', '写失败要留下可查状态')
    assert.ok(!String(failed.dirHash || '').includes('/cache'), '可查状态只带目录散列，不带真实路径')
    // 再刷一次：这一轮写的是上一轮攒下的自监控行 log.persist.fail（同样写失败）。它是内部诊断，
    // 自己的写失败也不许计进 dropped（#19 审查必改 R3），否则「用户丢了几行」会被诊断行撑大。
    store.flushNow()
    await wait(30)
    assert.equal(store.getDroppedCount(), settledAt, '自监控行自己的写失败不得计进 dropped')
    await wait(80)
    assert.equal(store.getDroppedCount(), settledAt)
    // 磁盘恢复后必须真落盘：关掉失败开关，再 synced 一次，三条用户行 + 自监控行都要出去。
    mem.failWrites = false
    await store.synced()
    assert.equal(store.getDroppedCount(), settledAt, '恢复后落盘同样不该计 dropped')
    assert.equal(store.getPendingCount(), 0, '恢复后手里不该还剩行')
    assert.deepEqual(drops, [], '写失败不得触发 onDrop（丢弃回调只留给真丢弃：配额满 / 目录冲突）')
    const recovered = [...mem.texts.entries()]
      .filter(([k]) => k.includes('/logs/') && k.endsWith('.log'))
      .map(([, v]) => String(v))
      .join('\n')
    assert.ok(recovered.length > 0, '恢复后必须真有日志文件落盘')
    for (const ev of ['evt-fail-1', 'evt-fail-2', 'evt-fail-3']) {
      assert.ok(recovered.includes(ev), '写失败过的行在磁盘恢复后必须落盘：' + ev)
    }
    // 最外层例外：入参一碰就抛错，一行都没进，如实回失败加接收 0 条（0.3.0 起 ok 不再恒真）。
    const evil = {}
    Object.defineProperty(evil, 'entries', {
      get() {
        throw new Error('模拟入参爆炸')
      }
    })
    const res = await store.handleLogBatch(evil)
    assert.deepEqual(res, { ok: false, accepted: 0, skipped: 0, rejected: 0, dropped: store.getDroppedCount() })
    // 其余电话失败回成功为假，不抛异常。
    const bad = makeMemoryFiles()
    const broken = makeDeps(bad, '/cache')
    broken.deps.getCacheDir = async () => {
      throw new Error('模拟取目录爆炸')
    }
    const { store: brokenStore } = createHostLog(broken.deps, { pluginId: 'wf', prefix: 'wf' })
    const cleared = await brokenStore.handleLogClear({ date: '2026-09-06' })
    assert.equal(cleared.ok, false)
  })

  it('落盘形状：0.3.0 起只写 v=3 五键（经 host 的 createLogStore 拿，store 无包面入口）', async () => {
    const mem = makeMemoryFiles()
    const { deps } = makeDeps(mem, '/cache')
    const { store } = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
    await store.setSwitch(true)
    store.log('warn', 'shape.check', { step: 'v3' })
    store.flush()
    await wait(80)
    const today = formatDailyFileName(new Date())
    const keys = Array.from(mem.texts.keys()).filter((k) => k.endsWith('/' + today))
    assert.equal(keys.length, 1)
    const rows = String(mem.texts.get(keys[0]) || '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    assert.ok(rows.length >= 1)
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), ['event', 'fields', 'level', 'ts', 'v'])
      assert.equal(row.v, 3)
      assert.equal(typeof row.ts, 'number')
      assert.equal(typeof row.level, 'string')
      assert.equal(typeof row.event, 'string')
      assert.equal(typeof row.fields, 'object')
    }
  })

  it('host 转出口：lintEventFields 三档、computeEventCounts 自算、查询名单源可达', async () => {
    const configMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'config.js')).href + '?x=' + Date.now())
    const manifest = configMod.parseEventListManifest(makeSampleList())
    // 三档：干净 none、全过；未知字段 warn；未知事件 error。
    assert.deepEqual(fresh.lintEventFields(manifest, 'gh.exec', ['argv0', 'exitCode']), { ok: true, severity: 'none', unknownEvent: false, unknownFields: [] })
    assert.deepEqual(fresh.lintEventFields(manifest, 'gh.exec', ['argv0', 'token']), { ok: false, severity: 'warn', unknownEvent: false, unknownFields: ['token'] })
    assert.deepEqual(fresh.lintEventFields(manifest, 'gh.exec2', ['argv0']), { ok: false, severity: 'error', unknownEvent: true, unknownFields: [] })
    // 自算计数：实现自算，不再手填 counts。
    assert.deepEqual(fresh.computeEventCounts(manifest), { resident: 2, ondemand: 1, selfmon: 1 })
    // 转出口全在：版本、查询名单源与动作后缀经 dsh-log/host 可达。
    assert.equal(fresh.LOG_FORMAT_VERSION, 3)
    assert.equal(fresh.LOG_QUERY_ACTION_SUFFIX, 'logQuery')
    assert.equal(fresh.buildLogQueryPhoneName('wf'), 'wf.logQuery')
    assert.equal(fresh.buildLogQueryPhoneName('demo'), 'demo.logQuery')
  })

  it('logQuery 可调：denied/traceChain/expired/当日保护（经 dist/phones.js；宿主入口接线见隔离片）', async () => {
    const now = Date.now()
    const today = formatDailyFileName(new Date()).replace(/\.log$/, '')
    const { phones, files } = await makeQueryPhones()
    const put = (name, lines) => files.set('/cache/logs/' + name, lines.join('\n') + '\n')
    put(today + '.log', [
      v3row(now - 3000, 'info', 'chain.step.a', { traceId: 't-1', seq: 2 }),
      v3row(now - 2000, 'info', 'chain.step.b', { traceId: 't-1', seq: 1 }),
      v3row(now - 1000, 'info', 'other.step', { traceId: 't-9', seq: 1 }),
      JSON.stringify({ ts: now, level: 'info', event: 'old.row', fields: {} })
    ])
    // 无权：查别人的标识直接 denied，entries 为空。
    const deniedRes = await phones.handleLogQuery({ pluginId: 'other' })
    assert.equal(deniedRes.ok, true)
    assert.equal(deniedRes.denied, true)
    assert.deepEqual(deniedRes.entries, [])
    // 调用方样板：if (res.denied) 即无权分支。
    if (deniedRes.denied) assert.ok(true, '调用方以 if(res.denied) 处理无权')
    // 整链：traceId 一等参，超 limit 不断链，按 (seq,ts) 排。
    const chain = await phones.handleLogQuery({ traceId: 't-1', page: { limit: 1 } })
    assert.equal(chain.traceChain, true)
    assert.equal(chain.entries.length, 2)
    assert.deepEqual(chain.entries.map((e) => e.fields.seq), [1, 2])
    // 旧行跳过：无 v 键的 0.2.x 行计入 skipped，不抛错。
    const all = await phones.handleLogQuery({})
    assert.equal(all.entries.length, 3)
    assert.equal(all.skipped, 1)
    // 游标过期：文件数变化导致 epoch 变化，老游标返 expired + 第一页。
    const first = await phones.handleLogQuery({ page: { limit: 1 } })
    assert.ok(first.nextCursor, '第一页应有游标')
    put('2099-01-01.log', [v3row(now - 500, 'info', 'future.row', {})])
    const expiredRes = await phones.handleLogQuery({ page: { cursor: first.nextCursor, limit: 1 } })
    assert.equal(expiredRes.expired, true)
    assert.ok(expiredRes.entries.length >= 1, '过期后从第一页重给')
    // 当日保护：all 只删封存区，当日文件永不删；点名删今天回空成功。
    files.set('/cache/logs/2020-01-01.log', v3row(now - 9000, 'info', 'sealed.row', {}) + '\n')
    const cleared = await phones.handleLogClear({ date: 'all' })
    assert.equal(cleared.ok, true)
    assert.ok(!files.has('/cache/logs/2020-01-01.log'), '封存区旧文件应被删')
    assert.ok(files.has('/cache/logs/' + today + '.log'), '当日文件永不删')
    const clearToday = await phones.handleLogClear({ date: today })
    assert.deepEqual(clearToday, { ok: true, removed: 0 })
    // 第 6 个电话（只读查询）的接线已在 tests/isolation.test.mjs 覆盖：注册表里存在 `<prefix>.logQuery`、
    // 是可调函数、查自己回已落盘行、查别人返 denied 空集，另有 aggregateLogQuery 的查时授权聚合用例。
    // 客户端经电话调查询的整链路——client.ts 不在本域，留待客户端域补。
  })

  it('自定义前缀失败方法名：失败行的方法名跟随配置前缀而非写死旧前缀', async () => {
    // 日志系统的失败行要带触发它的那组电话名的前缀，自定前缀下不得回落到旧字面。
    const phonesMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'phones.js')).href + '?x=' + Date.now())
    const seen = []
    const baseCtx = {
      config: { pluginId: 'demo', prefix: 'demo', logDirName: 'logs-demo', switchFileName: 'log-switch-demo.json', fileNamePolicy: 'daily', maxQueue: 1000, eventList: null },
      joinPath: (a, b) => String(a) + '/' + String(b),
      joinLogPath: async (d, n) => String(d) + '/' + String(n),
      resolveTarget: async (p) => ({ __target: String(p) }),
      readTarget: async () => { throw new Error('文件不存在') },
      writeTarget: async () => ({}),
      log: (level, event, fields) => { seen.push({ level, event, fields }) },
      getSwitchState: () => ({ enabled: true }),
      getHeaderInfo: () => null,
      loadSwitch: async () => ({ enabled: true }),
      setSwitch: async (enabled) => ({ enabled }),
      getCacheDir: async () => '/cache',
      getPlatform: async () => null,
      DEFAULT_CWD: '/work'
    }
    const phones = phonesMod.createLogPhones(baseCtx)
    await phones.handleLogClear({ date: 'bad-date' })
    const clearRow = seen.find((r) => r.event === 'host.call.fail' && r.fields && r.fields.kind === 'clear')
    assert.ok(clearRow, '清空失败应记一行失败行')
    assert.equal(clearRow.fields.method, 'demo.logClear')
    seen.length = 0
    const noDirPhones = phonesMod.createLogPhones({ ...baseCtx, getCacheDir: async () => null })
    await noDirPhones.handleLogExport({})
    const exportRow = seen.find((r) => r.event === 'host.call.fail' && r.fields && r.fields.kind === 'export')
    assert.ok(exportRow, '导出无目录应记一行失败行')
    assert.equal(exportRow.fields.method, 'demo.logExport')
  })
})
