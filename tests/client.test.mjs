// packages/dsh-log/tests/client.test.mjs —— 客户端引擎单测（#560 附单测，#19 重建）。
// 用法：先重建 dist（见包内 build.mjs 同参数），再 node --test packages/dsh-log/tests/client.test.mjs。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 覆盖：电话名拼法、批量口径、开关默认与秒显、关闭零调用、批量与截断、失败只计数、
// 对账与设置、看门狗不改返回值、自定义前缀隔离、对象清单复用、
// 两种消费形态对照（直接 import 与闭包四名字直传）。
// #19 重建说明：旧对照用的 D:/src 旧路径已不存在（预存红），本文件只引用 impres dist/
// 对应入口（client 用 dist/client.js）；旧实现行为对照改为 dist 双跑一致性对照。
// 存储键口径：0.3.0 起为命名空间键 `dsws.debug.<pluginId>`（见 src/client.ts debugStorageKey），
// 不再断言 0.2.x 单键 'dsws.debug'（该字面只保留作前缀常量）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const clientUrl = pathToFileURL(path.join(PKG_DIR, 'dist', 'client.js')).href + '?x=' + Date.now()
const client = await import(clientUrl)
const { createClientLog, resolveClientLogConfig, buildClientPhoneNames, CLIENT_BATCH } = client

function makeStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) },
    _map: map
  }
}
function makeTimer() {
  const calls = []
  return { calls, timeout(fn, ms) { calls.push(ms); return calls.length } }
}
function makeManualTimer() {
  const fns = []
  return { fns, timeout(fn, ms) { fns.push({ fn, ms }); return fns.length } }
}
function okHost(seen) {
  return {
    call(name, args) {
      if (seen) seen.push({ name, args })
      if (name.endsWith('.logGetSwitch')) return Promise.resolve({ ok: true, enabled: false })
      if (name.endsWith('.logSetSwitch')) return Promise.resolve({ ok: true, enabled: true })
      return Promise.resolve({ ok: true, accepted: args && args.entries ? args.entries.length : 0, dropped: 0 })
    }
  }
}
// 旧实现按构建语义载入已随旧路径删除（#19：D:/src 不存在，不硬造对照）。
// 旧实现行为对照改为下面的 dist 双跑一致性对照（同操作同电话名同队列同丢弃同开关）。
function makeNamespacedKey(pluginId) {
  return client.debugStorageKey(pluginId)
}

describe('客户端引擎单测（#560）', () => {
  it('电话名与口径：默认 wf 拼出旧字面，批量数字复用常量不另写', () => {
    assert.deepEqual(buildClientPhoneNames('wf'), {
      logBatch: 'wf.logBatch',
      logExport: 'wf.logExport',
      logClear: 'wf.logClear',
      logGetSwitch: 'wf.logGetSwitch',
      logSetSwitch: 'wf.logSetSwitch'
    })
    assert.deepEqual(CLIENT_BATCH, { maxPerBatch: 50, intervalMs: 1000, packetBytes: 131072, queueMax: 100 })
    assert.equal(client.LOG_BATCH_MAX, 50)
    assert.equal(client.LOG_FLUSH_MS, 1000)
    assert.equal(client.LOG_PACKET_BYTES, 131072)
    assert.equal(client.LOG_QUEUE_MAX, 100)
    // 存储键口径（0.3.0）：命名空间键 `dsws.debug.<pluginId>`；单键字面只保留作前缀常量。
    assert.equal(client.LOG_DEBUG_KEY, 'dsws.debug')
    assert.equal(makeNamespacedKey('wf'), 'dsws.debug.wf')
    assert.equal(makeNamespacedKey('demo'), 'dsws.debug.demo')
    // 只读查询电话名单源经客户端入口同样可达（与 host 同一单源）。
    assert.equal(client.LOG_QUERY_ACTION_SUFFIX, 'logQuery')
    assert.equal(client.buildLogQueryPhoneName('wf'), 'wf.logQuery')
  })

  it('源码静态断言：电话名全走前缀拼装，无写死旧字面，无闭包自由变量', () => {
    // S6 起客户端实现拆进了 src/client/ 子目录：断言扫「客户端这一层的全部源码」——
    // 否则搬走一段就等于把这条检查悄悄删掉（静态断言要跟着模块边界走）。
    const clientDir = path.join(PKG_DIR, 'src', 'client')
    const files = [path.join(PKG_DIR, 'src', 'client.ts')]
    if (existsSync(clientDir)) {
      for (const name of readdirSync(clientDir).sort()) {
        if (name.endsWith('.ts') && !name.endsWith('.d.ts')) files.push(path.join(clientDir, name))
      }
    }
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    assert.ok(code.includes('phoneNames.logBatch'), '转发调拼出来的记录电话名')
    assert.ok(code.includes('phoneNames.logGetSwitch'), '对账调拼出来的开关读电话名')
    assert.ok(code.includes('phoneNames.logSetSwitch'), '设置调拼出来的开关写电话名')
    assert.ok(!code.includes("'wf.logBatch'"), '无写死的旧记录电话名字面')
    assert.ok(!code.includes("'wf.logGetSwitch'"), '无写死的旧开关读字面')
    assert.ok(!code.includes("'wf.logSetSwitch'"), '无写死的旧开关写字面')
    assert.ok(!code.includes('typeof host ==='), '宿主只认传入的依赖，不碰闭包自由变量')
    assert.ok(!code.includes('typeof timer !=='), '计时器只认传入的依赖')
    assert.ok(!code.includes('typeof broadcastLogSwitch ==='), '广播只认传入的依赖')
    const quoted = new Set(Array.from(code.matchAll(/'(log\.[a-z.]+|host\.call\.fail)'/g)).map((m) => m[1]))
    // 0.3.0 事件名 5 个（#24 追踪新增 log.trace.shadow；禁区 client.ts 不动，此处只跟断言）。
    assert.deepEqual(Array.from(quoted).sort(), ['host.call.fail', 'log.export.fail', 'log.forward.summary', 'log.switch.watchdog', 'log.trace.shadow'])
  })

  it('配置：双必填 wf，自定前缀隔离，非法报错，对象清单复用', () => {
    // 双必填（#18）：缺任一即抛中文错，不再回退。
    assert.throws(() => resolveClientLogConfig(), /pluginId|prefix|双必填|缺少配置/)
    assert.throws(() => resolveClientLogConfig({}), /pluginId|缺少配置/)
    assert.throws(() => resolveClientLogConfig({ pluginId: 'demo' }), /prefix/)
    assert.throws(() => resolveClientLogConfig({ prefix: 'demo' }), /pluginId/)
    const demo = resolveClientLogConfig({ pluginId: 'demo', prefix: 'demo' })
    assert.equal(demo.prefix, 'demo')
    assert.equal(createClientLog({ storage: makeStorage() }, { pluginId: 'demo', prefix: 'demo' }).phoneNames.logBatch, 'demo.logBatch')
    assert.throws(() => resolveClientLogConfig({ pluginId: 'WF', prefix: 'wf' }), /非法/)
    assert.throws(() => resolveClientLogConfig({ pluginId: 'wf.demo', prefix: 'wf' }), /非法/)
    assert.throws(() => createClientLog({ storage: makeStorage() }, { pluginId: 'WF', prefix: 'wf' }), /非法/)
    // 对象清单格式复用（与宿主入口同一验形函数）：对象合法透过，数组被拦，字符串只存不解析。
    const list = { version: 1, pluginId: 'wf', counts: { resident: 0, ondemand: 0, selfmon: 0 }, events: {} }
    assert.deepEqual(resolveClientLogConfig({ pluginId: 'wf', prefix: 'wf', eventList: list }).eventList, list)
    assert.throws(() => resolveClientLogConfig({ pluginId: 'wf', prefix: 'wf', eventList: [] }), /事件清单/)
    assert.equal(resolveClientLogConfig({ pluginId: 'wf', prefix: 'wf', eventList: 'some/path.json' }).eventList, 'some/path.json')
  })

  it('开关默认关闭与本地秒显：空存储默认关，预设开秒显，坏值回默认，旧版多带的键被忽略', () => {
    const fresh = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })
    assert.equal(fresh.isEnabled('error'), true)
    assert.equal(fresh.isEnabled('warn'), true)
    assert.equal(fresh.isEnabled('info'), false)
    assert.equal(fresh.isEnabled('debug'), false)
    assert.deepEqual(fresh.logSwitch, { enabled: false, rev: 1 })
    // 旧版本地值带 sampleRate（0.3.0 已删该参数）：照旧读得回来，多余的键一律忽略。
    const preset = makeStorage({ 'dsws.debug.wf': JSON.stringify({ enabled: true, sampleRate: 0.5, rev: 1 }) })
    const opened = createClientLog({ storage: preset, timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })
    assert.equal(opened.isEnabled('info'), true)
    assert.deepEqual(opened.logSwitch, { enabled: true, rev: 1 })
    const broken = makeStorage({ 'dsws.debug.wf': '不是 JSON' })
    assert.equal(createClientLog({ storage: broken }, { pluginId: 'wf', prefix: 'wf' }).isEnabled('info'), false)
    assert.equal(createClientLog({}, { pluginId: 'wf', prefix: 'wf' }).isEnabled('info'), false)
  })

  it('关闭零调用：信息与调试不进队列、不排定时器、不计数，错误仍允许', () => {
    const timer = makeTimer()
    const logger = createClientLog({ storage: makeStorage(), timer }, { pluginId: 'wf', prefix: 'wf' })
    for (let i = 0; i < 5; i++) logger.log('info', 'evt.closed', { n: i })
    for (let i = 0; i < 5; i++) logger.log('debug', 'evt.closed.debug', { n: i })
    assert.equal(timer.calls.length, 0)
    assert.equal(logger.logQueue.length, 0)
    assert.equal(logger.getDroppedCount(), 0)
    logger.log('error', 'boom', {})
    assert.equal(logger.logQueue.length, 1)
    assert.equal(timer.calls[timer.calls.length - 1], 0)
  })

  it('批量语义：120 条进 100 条记 20 丢弃，一次发 50 条，落定记一行转发汇总', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'wf', prefix: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 120; i++) logger.log('info', 'evt-' + i, { n: i })
    assert.equal(logger.logQueue.length, 100)
    assert.equal(logger.getDroppedCount(), 20)
    await logger.sendLogBatch()
    assert.equal(seen.length, 1)
    assert.equal(seen[0].name, 'wf.logBatch')
    assert.equal(seen[0].args.entries.length, 50)
    assert.equal(typeof seen[0].args.droppedCount, 'number')
    const summary = logger.logQueue[logger.logQueue.length - 1]
    assert.equal(summary.level, 'warn')
    assert.equal(summary.event, 'log.forward.summary')
    assert.equal(summary.fields.droppedDelta, 20)
    assert.equal(summary.fields.totalDropped, 20)
    assert.equal(summary.fields.reason, 'queue-full')
    assert.equal(typeof summary.fields.windowMs, 'number')
    assert.equal(logger.logQueue.length, 51)
  })

  it('超包截断：单包超 128KB 先到先截，裁掉记丢弃，尾条记截断标记', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'wf', prefix: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 60; i++) logger.log('info', 'big-' + i, { blob: 'x'.repeat(5000) })
    assert.equal(logger.getDroppedCount(), 0)
    await logger.sendLogBatch()
    const sent = seen[0].args.entries
    assert.ok(sent.length < 50, '超包后实发少于 50 条（实发 ' + sent.length + ' 条）')
    assert.ok(logger.getDroppedCount() > 0, '裁掉的记入丢弃数')
    assert.equal(sent[sent.length - 1].truncated, true)
    assert.ok(logger.estimateBatchBytes(sent) <= 131072, '实发包体积回到 128KB 以内')
  })

  it('转发失败先进重试位：重试到顶才如实计数，宿主恢复后一行不丢', async () => {
    // 0.3.0 Track 1：失败不再当场判死。宿主断线是暂时的，整批进重试位（最多重试 3 次）；
    // 到顶才如实计数，宿主恢复后一行都不许算丢。
    const timer = makeTimer()
    const logger = createClientLog({ storage: makeStorage(), timer, host: okHost() }, { pluginId: 'wf', prefix: 'wf' })
    logger.log('error', 'boom', { reason: 'test' })
    assert.equal(timer.calls[timer.calls.length - 1], 0, 'error 走直通：立刻排一次转发')
    logger.logSwitch.enabled = true
    logger.log('info', 'normal', {})
    assert.equal(timer.calls[timer.calls.length - 1], 1000, '普通行走 1000 毫秒防抖')
    let mode = 'fail'
    const flaky = createClientLog(
      {
        storage: makeStorage(),
        timer: makeTimer(),
        host: {
          call() {
            if (mode === 'fail') return Promise.reject(new Error('断线'))
            return Promise.resolve({ ok: true, accepted: 1, dropped: 0 })
          }
        }
      },
      { pluginId: 'wf', prefix: 'wf' }
    )
    flaky.logSwitch.enabled = true
    flaky.log('info', 'kept', {})
    const before = flaky.getDroppedCount()
    for (let i = 0; i < 3; i++) {
      const res = await flaky.sendLogBatch()
      assert.equal(res.ok, false)
      assert.equal(flaky.getDroppedCount(), before, '第 ' + (i + 1) + ' 次失败不该判死')
    }
    mode = 'ok'
    const res2 = await flaky.sendLogBatch()
    assert.equal(res2.ok, true)
    assert.equal(flaky.getDroppedCount(), before, '宿主恢复后一行都不许算丢')
    // 另起一个一直坏的：首次 + 3 次重试，第四次才计数
    const bad = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: { call() { return Promise.reject(new Error('长坏')) } } },
      { pluginId: 'wf', prefix: 'wf' }
    )
    bad.logSwitch.enabled = true
    bad.log('info', 'gone', {})
    const badBefore = bad.getDroppedCount()
    let threw = false
    try {
      for (let i = 0; i < 4; i++) await bad.sendLogBatch()
    } catch {
      threw = true
    }
    assert.equal(threw, false, '失败一律不抛')
    assert.equal(bad.getDroppedCount() - badBefore, 1, '重试到顶才计数，一行算一行')
    // 宿主明确拒收时按它说的数计（一行被拒不许报成整批丢）
    const rejecting = createClientLog(
      {
        storage: makeStorage(),
        timer: makeTimer(),
        host: { call() { return Promise.resolve({ ok: false, accepted: 0, skipped: 0, rejected: 1, dropped: 0 }) } }
      },
      { pluginId: 'wf', prefix: 'wf' }
    )
    rejecting.logSwitch.enabled = true
    rejecting.log('error', 'r1', {})
    rejecting.log('error', 'r2', {})
    const rejBefore = rejecting.getDroppedCount()
    for (let i = 0; i < 4; i++) await rejecting.sendLogBatch()
    assert.equal(rejecting.getDroppedCount() - rejBefore, 1, '只算宿主说它拒的那一行')
    // #26 验收线 A1：宿主如实报的三档计数要能在汇总行里看到（不许塌成一个布尔）
    const summary = rejecting.logQueue.find((e) => e.event === 'log.forward.summary')
    assert.ok(summary, '部分拒收后要有一行转发汇总')
    assert.equal(summary.fields.rejected, 1, '汇总行如实带 rejected')
    assert.equal(summary.fields.accepted, 0, '汇总行如实带 accepted')
    assert.equal(summary.fields.skipped, 0, '汇总行如实带 skipped')
    assert.deepEqual(logger.flush(), { ok: true })
  })

  it('对账 winner 为宿主：成功跟宿主走并广播，失败保持本地不回退开启', async () => {
    const ls = makeStorage({ 'dsws.debug.wf': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    let broadcast = 0
    const logger = createClientLog(
      { storage: ls, timer: makeTimer(), host: okHost(), broadcastLogSwitch() { broadcast += 1 } },
      { pluginId: 'wf', prefix: 'wf' }
    )
    assert.equal(logger.isEnabled('info'), true)
    const res = await logger.reconcileLogSwitch()
    assert.equal(res.ok, true)
    assert.equal(logger.logSwitch.enabled, false)
    assert.equal(JSON.parse(ls._map.get('dsws.debug.wf')).enabled, false)
    assert.equal(broadcast, 1)
    const keepLs = makeStorage({ 'dsws.debug.wf': JSON.stringify({ enabled: true, sampleRate: 1, rev: 1 }) })
    const keep = createClientLog(
      { storage: keepLs, timer: makeTimer(), host: { call() { return Promise.reject(new Error('断线')) } } },
      { pluginId: 'wf', prefix: 'wf' }
    )
    const res2 = await keep.reconcileLogSwitch()
    assert.equal(res2.ok, false)
    assert.equal(keep.logSwitch.enabled, true)
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })
    const res3 = await noHost.reconcileLogSwitch()
    assert.equal(res3.ok, false)
    assert.equal(noHost.logSwitch.enabled, false)
  })

  it('设置保存：宿主生效才更新本地并广播，失败保持旧值并给机器码', async () => {
    const ls = makeStorage()
    let broadcast = 0
    let seen = null
    const host = {
      call(name, args) {
        seen = { name, args }
        return Promise.resolve({ ok: true, enabled: true })
      }
    }
    const logger = createClientLog({ storage: ls, timer: makeTimer(), host, broadcastLogSwitch() { broadcast += 1 } }, { pluginId: 'wf', prefix: 'wf' })
    const res = await logger.setLogSwitch(true)
    assert.equal(seen.name, 'wf.logSetSwitch')
    assert.deepEqual(seen.args, { enabled: true }, '开关写电话只发 enabled（0.3.0 已删 sampleRate）')
    assert.equal(res.ok, true)
    assert.deepEqual(logger.logSwitch, { enabled: true, rev: 1 })
    assert.deepEqual(JSON.parse(ls._map.get('dsws.debug.wf')), { enabled: true, rev: 1 })
    assert.equal(broadcast, 1)
    const rejected = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: { call() { return Promise.resolve({ ok: false }) } } },
      { pluginId: 'wf', prefix: 'wf' }
    )
    const res2 = await rejected.setLogSwitch(true)
    assert.equal(res2.ok, false)
    assert.equal(res2.error, 'host-rejected')
    assert.equal(rejected.logSwitch.enabled, false)
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })
    const res3 = await noHost.setLogSwitch(true)
    assert.equal(res3.error, 'host-unavailable')
    const failRow = noHost.logQueue.find((e) => e.event === 'host.call.fail')
    assert.ok(failRow, '无宿主时记一行开关写失败分类行')
    assert.equal(failRow.fields.method, 'wf.logSetSwitch')
  })

  it('看门狗：计时先到记一行告警，原调用照常落定不改返回值', async () => {
    const timer = makeManualTimer()
    let resolveHost = null
    const hanging = { call() { return new Promise((resolve) => { resolveHost = resolve }) } }
    const logger = createClientLog({ storage: makeStorage(), timer, host: hanging }, { pluginId: 'wf', prefix: 'wf' })
    const pending = logger.setLogSwitch(true)
    const watchdog = timer.fns.find((f) => f.ms === 5000)
    assert.ok(watchdog, '开关写注册 5 秒看门狗')
    watchdog.fn()
    const row = logger.logQueue.find((e) => e.event === 'log.switch.watchdog')
    assert.ok(row, '计时先到记一行看门狗')
    assert.equal(row.level, 'warn')
    // 0.3.0 行内自带追踪字段（traceId/spanId/seq 由 log() 注入），只断言看门狗自有三键。
    assert.equal(row.fields.op, 'set')
    assert.equal(row.fields.timeoutMs, 5000)
    assert.equal(row.fields.stage, 'waiting-host')
    resolveHost({ ok: true, enabled: true })
    const res = await pending
    assert.equal(res.ok, true)
    assert.equal(res.enabled, true)
    assert.equal(logger.logQueue.filter((e) => e.event === 'log.switch.watchdog').length, 1)
  })

  it('导出链路行：只走包内散列（0.3.0 删全局裸函数），不抛错', () => {
    // #19：不再认 globalThis.dswsLogHash/dswsLogTrunc；散列恒为包内 8 位十六进制。
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'wf', prefix: 'wf' })
    logger.logExportFail('export', 'export-not-ok', new Error('断线'))
    let line = logger.logQueue[logger.logQueue.length - 1]
    assert.equal(line.event, 'log.export.fail')
    assert.ok(/^[0-9a-f]{8}$/.test(line.fields.errorHash || ''))
    assert.equal(line.isDiagnostic, true, '导出失败行是库自己写的诊断行，必须带标记（丢弃计数不算它）')
    logger.logQueue.length = 0
    logger.logExportFail('openDir', 'open-fail', '打不开')
    line = logger.logQueue[logger.logQueue.length - 1]
    assert.ok(/^[0-9a-f]{8}$/.test(line.fields.errorHash || ''))
    assert.equal(line.isDiagnostic, true, '第二条诊断行同样带标记')
  })

  it('自定义前缀隔离：转发与失败行方法名跟随前缀，不回落旧字面', async () => {
    const seen = []
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(seen) }, { pluginId: 'demo', prefix: 'demo' })
    assert.equal(logger.phoneNames.logBatch, 'demo.logBatch')
    logger.logSwitch.enabled = true
    logger.log('info', 'hello-demo', {})
    await logger.sendLogBatch()
    assert.equal(seen[0].name, 'demo.logBatch')
    const noHost = createClientLog({ storage: makeStorage(), timer: makeTimer() }, { pluginId: 'demo', prefix: 'demo' })
    await noHost.setLogSwitch(true)
    const failRow = noHost.logQueue.find((e) => e.event === 'host.call.fail')
    assert.equal(failRow.fields.method, 'demo.logSetSwitch')
  })

  it('双跑一致性对照（旧 D:/src 路径已删）：默认 wf 下同操作同电话名同队列同丢弃同开关', async () => {
    // #19：旧实现源（D:/src/client/kernel/log.js）已不存在，对照改为同一 dist 入口跑两遍，
    // 同操作下落点、队列、丢弃、开关完全一致（旧“零变化”口径的 dist 内延续）。
    async function snapshot(mod, seen) {
      const summary = mod.logQueue[mod.logQueue.length - 1]
      // 归一化：traceId/spanId 逐实例随机、windowMs 逐次计时，双跑对照时剔除，只比形状与计数。
      const normFields = (f) => {
        const c = { ...(f || {}) }
        delete c.traceId
        delete c.spanId
        delete c.windowMs
        return c
      }
      return {
        calls: seen.map((s) => s.name),
        sent: seen.length ? seen[0].args.entries.length : -1,
        queue: mod.logQueue.length,
        dropped: mod.getDroppedCount(),
        summary: summary ? { event: summary.event, level: summary.level, fields: normFields(summary.fields) } : null,
        strip: mod.logQueue.slice(0, 3).map((e) => e.level + '|' + e.event + '|' + JSON.stringify(normFields(e.fields)))
      }
    }
    async function operate(mod) {
      mod.log('error', 'boom', { reason: 'test' })
      mod.log('warn', 'careful', { kind: 'export' })
      mod.logSwitch.enabled = true
      for (let i = 0; i < 120; i++) mod.log('info', 'evt-' + i, { n: i })
      await mod.sendLogBatch()
    }
    const firstSeen = []
    const firstMod = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(firstSeen) }, { pluginId: 'wf', prefix: 'wf' })
    await operate(firstMod)
    const fromFirst = await snapshot(firstMod, firstSeen)
    const secondSeen = []
    const secondMod = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: okHost(secondSeen) }, { pluginId: 'wf', prefix: 'wf' })
    await operate(secondMod)
    const fromSecond = await snapshot(secondMod, secondSeen)
    assert.deepEqual(fromSecond, fromFirst)
  })

  it('两种消费形态对照：直接 import 与闭包四名字直传行为一致', async () => {
    const direct = createClientLog(
      { storage: makeStorage(), timer: makeTimer(), host: okHost() },
      { pluginId: 'wf', prefix: 'wf' }
    )
    // 文本拼接形态：消费方闭包里只有 host、timer、localStorage、broadcastLogSwitch 四个名字，原样传入。
    const viaClosure = new Function(
      'createClientLog', 'host', 'timer', 'localStorage', 'broadcastLogSwitch',
      'return createClientLog({ host: host, timer: timer, localStorage: localStorage, broadcastLogSwitch: broadcastLogSwitch }, { pluginId: "wf", prefix: "wf" })'
    )(
      createClientLog,
      okHost(),
      makeTimer(),
      makeStorage(),
      () => {}
    )
    for (const mod of [direct, viaClosure]) {
      mod.logSwitch.enabled = true
      mod.log('info', 'hello', { n: 1 })
    }
    assert.equal(direct.logQueue.length, viaClosure.logQueue.length)
    assert.equal(direct.getDroppedCount(), viaClosure.getDroppedCount())
    assert.deepEqual(direct.phoneNames, viaClosure.phoneNames)
    const [r1, r2] = await Promise.all([direct.sendLogBatch(), viaClosure.sendLogBatch()])
    assert.deepEqual(r1, r2)
  })

  it('宿主长坏链条终止：重试有界，丢弃计数只数用户行（库自己的诊断行不算丢）', async () => {
    const bad = { call() { return Promise.reject(new Error('宿主长坏')) } }
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: bad }, { pluginId: 'wf', prefix: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 10; i++) logger.log('info', 'lost-' + i, {})
    // 首次 + 3 次重试＝重试到顶，10 行如实计数
    for (let i = 0; i < 4; i++) await logger.sendLogBatch()
    assert.equal(logger.getDroppedCount(), 10)
    // 收敛不滋生：后面几轮只剩库自己写的转发汇总行，计数必须一动不动
    // （修前会把这条诊断行也算进去 → 报 11；口径与宿主侧 userRowCount 对齐后才对得上）
    for (let i = 0; i < 10; i++) await logger.sendLogBatch()
    assert.equal(logger.getDroppedCount(), 10, '诊断行不计入 dropped，实测 ' + logger.getDroppedCount())
    assert.ok(logger.logQueue.length <= 1, '队列不被汇总行撑大，实测 ' + logger.logQueue.length)
  })

  // 2026-10-15：客户端丢弃计数与宿主侧对齐（只数用户行）。诊断行也是队列里的一行，
  // 被拒收时若不排除，1 行用户日志会被报成「丢 2 行」——这条用例把「不算」和「真的标了」两件事都钉住。
  it('诊断行不计入丢弃：只剩转发汇总行时 dropped 停住，且它自己带 isDiagnostic 标记', async () => {
    const bad = { call() { return Promise.reject(new Error('宿主长坏')) } }
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: bad }, { pluginId: 'wf', prefix: 'wf' })
    logger.logSwitch.enabled = true
    logger.log('warn', 'diag.only-one', {})
    for (let i = 0; i < 4; i++) await logger.sendLogBatch()
    assert.equal(logger.getDroppedCount(), 1, '1 行用户行就是 1，实测 ' + logger.getDroppedCount())
    const summary = logger.logQueue.find((r) => r.event === 'log.forward.summary')
    assert.ok(summary, '到顶后队列里应留下一条转发汇总行，实测 ' + JSON.stringify(logger.logQueue.map((r) => r.event)))
    assert.equal(summary.isDiagnostic, true, '汇总行必须带 isDiagnostic 标记（否则它被拒时会被算成用户的行）')
    // 再发若干轮：能发的只有这条诊断行，它被拒多少次都不许让计数上涨
    for (let i = 0; i < 6; i++) await logger.sendLogBatch()
    assert.equal(logger.getDroppedCount(), 1, '只剩诊断行时计数必须停住，实测 ' + logger.getDroppedCount())
    // 用户行不带标记（对照，防「所有行都标上」的假实现）
    logger.log('warn', 'diag.user-row', {})
    const userRow = logger.logQueue.find((r) => r.event === 'diag.user-row')
    assert.ok(userRow, '用户行应进队列')
    assert.notEqual(userRow.isDiagnostic, true, '调用方自己写的行不许被标成诊断行')
  })

  it('宿主回 {ok:false} 却不报 rejected：按 entries.length - accepted 兜底，绝不静默丢账', async () => {
    // 2026-10-14 终局审查 277d5b3e 必改 3：非规范宿主只回 {ok:false}（不带 rejected）时，
    // 旧实现把 rejected 当 0 → 整批行被丢掉而丢弃计数不动（静默丢账）。
    const sloppy = { call() { return Promise.resolve({ ok: false }) } }
    const logger = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: sloppy }, { pluginId: 'wf', prefix: 'wf' })
    logger.logSwitch.enabled = true
    for (let i = 0; i < 3; i++) logger.log('info', 'sloppy-' + i, {})
    for (let i = 0; i < 4; i++) await logger.sendLogBatch()
    assert.equal(logger.getDroppedCount(), 3, '重试到顶后整批如实计丢，实测 ' + logger.getDroppedCount())

    // 回了 accepted 但没回 rejected：按「entries.length - accepted」只算真被拒的那部分。
    const half = { call() { return Promise.resolve({ ok: false, accepted: 1 }) } }
    const l2 = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: half }, { pluginId: 'wf', prefix: 'wf' })
    l2.logSwitch.enabled = true
    for (let i = 0; i < 3; i++) l2.log('info', 'half-' + i, {})
    for (let i = 0; i < 4; i++) await l2.sendLogBatch()
    assert.equal(l2.getDroppedCount(), 2, '只算 entries.length - accepted = 2，实测 ' + l2.getDroppedCount())

    // 宿主如实报了 rejected 时以它为准（不被兜底公式覆盖）。
    const explicit = { call() { return Promise.resolve({ ok: false, accepted: 2, rejected: 1 }) } }
    const l3 = createClientLog({ storage: makeStorage(), timer: makeTimer(), host: explicit }, { pluginId: 'wf', prefix: 'wf' })
    l3.logSwitch.enabled = true
    for (let i = 0; i < 3; i++) l3.log('info', 'explicit-' + i, {})
    for (let i = 0; i < 4; i++) await l3.sendLogBatch()
    assert.equal(l3.getDroppedCount(), 1, '宿主自报 rejected=1 就按 1 算，实测 ' + l3.getDroppedCount())
  })

  // 2026-10-14 独立审查 #4：客户端 log() 从前返回 undefined，而宿主 store.log() 回
  // 'queued'|'skipped'|'dropped'，README 却称两者「同名同参同语义」——调用方看不出自己的
  // info 到底记上了没有。现在两端同口径，本用例逐档钉住。
  it('log 回执与宿主同口径：skipped（开关挡下）/ queued（真进队列）/ dropped（满队列丢新）', async () => {
    const log = createClientLog(
      { storage: makeStorage(), timer: makeTimer() },
      { pluginId: 'rc-a', prefix: 'rc-a' }
    )
    // 开关关着：info 被挡下（不是丢），丢弃计数不动
    assert.equal(log.log('info', 'rc.plain', {}), 'skipped')
    assert.equal(log.logDroppedState.count, 0)
    // error/warn 恒放行
    assert.equal(log.log('warn', 'rc.warn', {}), 'queued')
    assert.equal(log.log('error', 'rc.error', {}), 'queued')
    // 开关打开后 info 记上
    log.logSwitch.enabled = true
    assert.equal(log.log('info', 'rc.on', {}), 'queued')
    // 灌满队列：普通行满时丢新 → 回执说 dropped 且真计数
    let outcome = 'queued'
    for (let i = 0; i < 5000 && outcome === 'queued'; i++) outcome = log.log('info', 'rc.fill.' + i, {})
    assert.equal(outcome, 'dropped')
    assert.ok(log.logDroppedState.count > 0, '丢新必须计入丢弃数')
  })
})