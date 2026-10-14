// tests/startup-header.test.mjs —— 目录自述（启动头 host.start）
//
// 背景（research/18 §2.2 实测）：日志目录从前**不自述**——`writeStartupHeader()` 是个没人调用的
// 公开方法，于是第三方只拿到目录时看不到「谁写的、哪一版、什么系统」；宿主导出摘要里的
// `pluginVersion` 更是写死的 'unknown'，`cwd` 却是**跑导出那个进程**的目录（把读者环境当成写者事实）。
//
// 现在的口径（0.3.3）：
//   ① Node 入口建库时自动写一行 host.start（常驻事件，开关关着也落），保证目录自述；
//   ② 行里只放**真记下来的事实**：pluginVersion 由配置传入、os 由平台对象报出，拿不到就不写这个键；
//   ③ 导出摘要的 pluginVersion 认真记下来的值，没记就是 unknown（不许拿读者环境顶替）。
//
// 本文件钉住：自动写、字段来源、非法入参抛错、摘要不再恒 unknown。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 每次都拿一份新的模块副本：模块级登记表不在用例之间串。 */
async function fresh(entry) {
  return import(pathToFileURL(path.join(PKG_DIR, 'dist', entry)).href + '?x=' + Date.now() + Math.random())
}

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-header-'))
}

/** 读某个日志子目录里的全部行（单一文件时即写入顺序）。 */
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

describe('目录自述：启动头（host.start）', () => {
  it('Node 入口自动写启动头：第一行是 host.start，带 pid/startedAt/dir/pluginVersion，开关关着也落', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog(
        { cacheDir },
        { pluginId: 'hdr-a', prefix: 'hdr-a', pluginVersion: '1.2.3' }
      )
      log.store.log('warn', 'hdr.user.row', {})
      await log.store.synced()

      const rows = await readRows(cacheDir, 'logs-hdr-a')
      assert.equal(rows[0].event, 'host.start', '启动头必须是这个目录的第一行')
      assert.equal(rows.filter((r) => r.event === 'host.start').length, 1, '一个实例只写一行启动头')
      assert.equal(rows[0].v, 3)
      assert.equal(rows[0].level, 'info')
      assert.deepEqual(Object.keys(rows[0]).sort(), ['event', 'fields', 'level', 'ts', 'v'])
      assert.equal(rows[0].fields.dir, cacheDir)
      assert.equal(typeof rows[0].fields.pid, 'number')
      assert.equal(typeof rows[0].fields.startedAt, 'string')
      assert.equal(rows[0].fields.pluginVersion, '1.2.3')

      // getHeaderInfo() 与落盘那一行同源（导出摘要与 CLI 摘要都读它）。
      const header = log.store.getHeaderInfo()
      assert.equal(header.pluginVersion, '1.2.3')
      assert.equal(header.dir, cacheDir)
      assert.equal(header.pid, rows[0].fields.pid)
      assert.equal(header.startedAt, rows[0].fields.startedAt)

      // 导出摘要必须说真话：真记下来的版本就报出来，不许恒 'unknown'（research/18 §2.2 的缺陷本相）。
      const names = await readdir(path.join(cacheDir, 'logs-hdr-a'))
      const todayName = names.find((n) => /^\d{4}-\d{2}-\d{2}\.log$/.test(n))
      const exp = await log.store.handleLogExport({ date: todayName.slice(0, 10) })
      assert.equal(exp.ok, true)
      assert.equal(exp.summary.pluginVersion, '1.2.3', '摘要必须报真记下来的版本')
      assert.equal(exp.summary.header.pluginVersion, '1.2.3')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('不传 pluginVersion：行里没有这个键，摘要如实写 unknown（不拿读者环境顶替）', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'hdr-b', prefix: 'hdr-b' })
      log.store.log('warn', 'hdr.b.row', {})
      await log.store.synced()
      const rows = await readRows(cacheDir, 'logs-hdr-b')
      const header = rows.find((r) => r.event === 'host.start')
      assert.ok(header, '启动头仍要写（只是环境自述缺失）')
      assert.equal(Object.prototype.hasOwnProperty.call(header.fields, 'pluginVersion'), false, '没记的键不许出现')
      assert.equal(log.store.getHeaderInfo().pluginVersion, '')

      const exp = await log.store.handleLogExport({ date: rows[0].ts ? new Date(rows[0].ts).toISOString().slice(0, 10) : '' })
      assert.equal(exp.summary.pluginVersion, 'unknown', '没记就是 unknown')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('os 来自平台对象：宿主入口手动写启动头时记下平台报出的系统名', async () => {
    const hostMod = await fresh('host.js')
    const nodeMod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      const hostLog = hostMod.createHostLog(
        {
          fs: nodeMod.createNodeFileService(),
          timer: nodeMod.createNodeTimer(),
          getCacheDir: async () => cacheDir,
          syncCacheDir: cacheDir,
          getPlatform: () => ({ os: 'test-os' })
        },
        { pluginId: 'hdr-c', prefix: 'hdr-c', pluginVersion: '9.9.9' }
      )
      await hostLog.store.writeStartupHeader()
      hostLog.store.log('warn', 'hdr.c.row', {})
      await hostLog.store.synced()
      const rows = await readRows(cacheDir, 'logs-hdr-c')
      const header = rows.find((r) => r.event === 'host.start')
      assert.ok(header, '宿主入口手动调用也要真落一行')
      assert.equal(header.fields.os, 'test-os')
      assert.equal(header.fields.pluginVersion, '9.9.9')
      assert.equal(hostLog.store.getHeaderInfo().os, 'test-os')
      hostLog.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('pluginVersion 非法即抛中文错：不是字符串、太长', async () => {
    const mod = await fresh('node.js')
    const cacheDir = await makeCacheDir()
    try {
      await assert.rejects(
        mod.createNodeHostLog({ cacheDir }, { pluginId: 'hdr-d', prefix: 'hdr-d', pluginVersion: 123 }),
        /pluginVersion 必须是字符串/
      )
      await assert.rejects(
        mod.createNodeHostLog({ cacheDir }, { pluginId: 'hdr-d', prefix: 'hdr-d', pluginVersion: 'v'.repeat(65) }),
        /pluginVersion 太长/
      )
      // 空串与纯空白按「没记」处理，不抛。
      const log = await mod.createNodeHostLog({ cacheDir }, { pluginId: 'hdr-d', prefix: 'hdr-d', pluginVersion: '   ' })
      // 入口已自动写过启动头，所以这里拿到的是「记了但版本为空」的那份事实。
      assert.equal(log.store.getHeaderInfo().pluginVersion, '')
      await log.store.writeStartupHeader()
      assert.equal(log.store.getHeaderInfo().pluginVersion, '')
      log.store.release()
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
