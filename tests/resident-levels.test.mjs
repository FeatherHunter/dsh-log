// tests/resident-levels.test.mjs —— 常驻事件放行口径（0.3.0 补：清单 kind='resident' 真生效）
//
// 背景（2026-10-14 独立对抗审查必改 #1）：写侧的常驻名单从前是硬编码的 43 个 DSH 事件名，
// 写侧从不读调用方清单——外部插件把自己的 info 事件在清单里标成 kind:'resident' 也照样被
// 开关拦掉：默认配置下 log('info','my.app.started') 回 'skipped'、磁盘零行、丢弃计数为零，
// 而 README 说「常驻信息落盘」。
//
// 现在口径：放行集合 = 包内固定 43 条 ∪ 调用方清单里 kind === 'resident' 的事件，单源在
// src/core/resident.ts，宿主引擎与客户端共用一份（两份名单曾经漂移过）。
// 本文件钉住三件事：①清单声明真生效 ②没声明的 info 仍被拦（默认口径不变）
// ③包内固定表与字符串路径清单的既有行为一字不变。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 每次都拿一份新的模块副本，模块级单例（目录登记表等）不在用例之间串。 */
async function fresh(entry) {
  return import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())
}

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-resident-'))
}

/** 读某个日志子目录里的全部行（按文件名字典序，单一文件时即写入顺序）。 */
async function readRows(cacheDir, dirName) {
  const rows = []
  let names = []
  try {
    names = await readdir(path.join(cacheDir, dirName))
  } catch {
    return rows
  }
  for (const name of names.filter((n) => n.endsWith('.log')).sort()) {
    const text = await readFile(path.join(cacheDir, dirName, name), 'utf8')
    for (const line of text.split('\n')) if (line.trim() !== '') rows.push(JSON.parse(line))
  }
  return rows
}

/** 清单：声明两条——一条 resident（该落盘）、一条 ondemand（该被开关拦）。 */
function manifestWith(pluginId) {
  return {
    version: 1,
    pluginId: pluginId,
    events: {
      'res.declared': { level: 'info', kind: 'resident', fields: ['n'] },
      'res.plain': { level: 'info', kind: 'ondemand', fields: ['n'] }
    }
  }
}

function makeStorage(preset) {
  const map = new Map(Object.entries(preset || {}))
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, String(v)) }
  }
}

function makeTimer() {
  return { timeout() { return 0 } }
}

describe('常驻事件放行口径：清单声明 resident 真生效，未声明的 info 仍被拦', () => {
  it('宿主：清单里 kind=resident 的 info 开关关着也落盘；同清单里的 ondemand 被拦', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog(
        { cacheDir },
        { pluginId: 'res-a', prefix: 'res-a', eventList: manifestWith('res-a') }
      )
      // 开关默认关着（开关文件不存在）
      assert.equal(log.store.getSwitchState().enabled, false)
      // ① 清单声明的 resident：放行，回执说 queued
      assert.equal(log.store.log('info', 'res.declared', { n: 1 }), 'queued')
      // ② 同清单里没标 resident 的：仍按级别规则拦掉，回执说 skipped、不占丢弃计数
      assert.equal(log.store.log('info', 'res.plain', { n: 2 }), 'skipped')
      // ③ 包内固定 43 条里的名字：行为与 0.3.0 之前一字不变
      assert.equal(log.store.log('info', 'gh.exec', { n: 3 }), 'queued')

      const report = await log.ready
      assert.equal(report.ok, true)
      const rows = await readRows(cacheDir, 'logs-res-a')
      const events = rows.map((r) => r.event)
      assert.ok(events.includes('res.declared'), '清单声明的常驻 info 必须落盘')
      assert.ok(events.includes('gh.exec'), '包内固定常驻名照旧放行')
      assert.ok(!events.includes('res.plain'), '没标 resident 的 info 不许偷偷落盘')
      assert.equal(log.store.getDroppedCount(), 0, '被开关拦掉不算丢弃')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('宿主：不传清单时只有包内固定 43 条放行（默认口径没变）', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'res-b', prefix: 'res-b' })
      assert.equal(log.store.log('info', 'res.declared', { n: 1 }), 'skipped')
      assert.equal(log.store.log('info', 'gh.exec', { n: 2 }), 'queued')
      await log.ready
      // host.start 是入口自动写的目录自述行（常驻），不参与「哪些事件被放行」的口径判定。
      const events = (await readRows(cacheDir, 'logs-res-b')).map((r) => r.event).filter((e) => e !== 'host.start')
      assert.deepEqual(events, ['gh.exec'])
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('宿主：清单给的是字符串路径（本包不读盘）时只有固定表放行，且不抛错', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog(
        { cacheDir },
        { pluginId: 'res-c', prefix: 'res-c', eventList: 'somewhere/event-list.json' }
      )
      assert.equal(log.store.log('info', 'res.declared', {}), 'skipped')
      assert.equal(log.store.log('info', 'gh.exec', {}), 'queued')
      await log.ready
      assert.deepEqual(
        (await readRows(cacheDir, 'logs-res-c')).map((r) => r.event).filter((e) => e !== 'host.start'),
        ['gh.exec']
      )
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('客户端：清单声明的 resident 放行并真的进队列；未声明的 info 被拦', async () => {
    const mod = await fresh('client.js')
    const log = mod.createClientLog(
      { storage: makeStorage(), timer: makeTimer() },
      { pluginId: 'res-d', prefix: 'res-d', eventList: manifestWith('res-d') }
    )
    assert.equal(log.logSwitch.enabled, false)
    // 清单声明的 resident：isEnabled 为真，log 之后真进了队列
    assert.equal(log.isEnabled('info', 'res.declared'), true)
    log.log('info', 'res.declared', { n: 1 })
    assert.equal(log.logQueue.length, 1)
    // 未标 resident 的 info：仍被拦，队列不变
    assert.equal(log.isEnabled('info', 'res.plain'), false)
    log.log('info', 'res.plain', { n: 2 })
    assert.equal(log.logQueue.length, 1, '被拦的行不许进队列')
    // 固定表与 error 照旧
    assert.equal(log.isEnabled('info', 'gh.exec'), true)
    assert.equal(log.isEnabled('error', 'res.anything'), true)
  })

  it('客户端：不传清单时，同样的名字被拦（两端默认口径一致）', async () => {
    const mod = await fresh('client.js')
    const log = mod.createClientLog(
      { storage: makeStorage(), timer: makeTimer() },
      { pluginId: 'res-e', prefix: 'res-e' }
    )
    assert.equal(log.isEnabled('info', 'res.declared'), false)
    log.log('info', 'res.declared', { n: 1 })
    assert.equal(log.logQueue.length, 0)
    assert.equal(log.isEnabled('info', 'gh.exec'), true)
  })

  it('两端同一份集合：清单声明的 resident 在宿主与客户端都放行', async () => {
    const hostMod = await fresh('node.js')
    const clientMod = await fresh('client.js')
    const cacheDir = await makeCacheDir()
    const manifest = manifestWith('res-f')
    try {
      const host = await hostMod.createNodeHostLog(
        { cacheDir },
        { pluginId: 'res-f', prefix: 'res-f', eventList: manifest }
      )
      const client = clientMod.createClientLog(
        { storage: makeStorage(), timer: makeTimer() },
        { pluginId: 'res-f', prefix: 'res-f', eventList: manifest }
      )
      assert.equal(host.store.log('info', 'res.declared', { side: 'host' }), 'queued')
      assert.equal(client.isEnabled('info', 'res.declared'), true)
      assert.equal(host.store.isEnabled('info', 'res.plain'), false)
      assert.equal(client.isEnabled('info', 'res.plain'), false)
      await host.ready
      host.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
