// tests/append-write.test.mjs —— 追加写（appendText 能力，2026-10-14 补）的回归线。
//
// 背景：0.3.0 原本只有「读旧文 + 拼新行 + 全文覆写」，每次刷盘的写量是 O(全文)。
// 平台 fs 多了一个**可选**能力 appendText（node 适配器用 node:fs/promises 的 appendFile 实现），
// 有它时稳态只写新增（O(新增)），并且两个写者撞上时只会交错、不会整篇覆写。
// 这个文件钉三件事：①追加路真被用上（不是摆设）②追加路下轮转/封存/行序仍然对
// ③首触与「封存之前」仍然读一次，跨进程 foreign-write 判定没被追加路绕掉。
// 用法：先重建 dist（node build.mjs），再 node --test tests/append-write.test.mjs。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, appendFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hostMod = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'host.js')).href + '?x=' + Date.now())
const { createHostLog, formatDailyFileName } = hostMod

// 真磁盘文件服务 + 调用计数：writeText（整篇覆写）与 appendText（追加）分别记账。
// withAppend=false 时删掉 appendText，用来对照「没有这个能力的宿主」走老路。
function makeCountingFs(options = {}) {
  const state = { writeCalls: 0, writeBytes: 0, appendCalls: 0, appendBytes: 0, readCalls: 0, writePaths: [], appendPaths: [], maxAppendBytes: 0, appendedTexts: [] }
  const targetPath = (t) => (t && typeof t === 'object' && typeof t.path === 'string' ? t.path : String(t))
  const fs = {
    state,
    async resolve(p) {
      return { path: String(p) }
    },
    async readText(t) {
      state.readCalls += 1
      try {
        return await readFile(targetPath(t), 'utf8')
      } catch (e) {
        if (e && e.code === 'ENOENT') return ''
        throw e
      }
    },
    async writeText(t, text) {
      state.writeCalls += 1
      state.writeBytes += Buffer.byteLength(text, 'utf8')
      const p = targetPath(t)
      state.writePaths.push(p)
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(p, text, 'utf8')
    },
    async appendText(t, text) {
      state.appendCalls += 1
      const bytes = Buffer.byteLength(text, 'utf8')
      state.appendBytes += bytes
      state.maxAppendBytes = Math.max(state.maxAppendBytes, bytes)
      state.appendedTexts.push(text)
      const p = targetPath(t)
      state.appendPaths.push(p)
      await mkdir(path.dirname(p), { recursive: true })
      await appendFile(p, text, 'utf8')
    },
    async mkdir(dir) {
      await mkdir(String(dir), { recursive: true })
    },
    async unlink(t) {
      await rm(targetPath(t), { force: true })
    },
    async listDir(t) {
      try {
        return await readdir(targetPath(t))
      } catch (e) {
        if (e && e.code === 'ENOENT') return []
        throw e
      }
    },
    async rename(from, to) {
      await rename(targetPath(from), targetPath(to))
    }
  }
  if (options.withAppend === false) delete fs.appendText
  return fs
}

// 会撒谎的适配器（⑥⑦用）：声明了 appendText 却不干实事——
//   silent = 回一声「成功」但一个字节都不写；throw = 直接抛错。
// 两者都是「能力清单上有、实际不可用」，引擎必须能自己发现并退回读改写，而不是以为写成了。
function makeLyingFs(mode) {
  const fs = makeCountingFs()
  fs.appendText = async () => {
    fs.state.appendCalls += 1
    if (mode === 'throw') throw new Error('这台适配器的 appendText 是坏的')
    return undefined
  }
  return fs
}

async function makeStore(options = {}) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'dsh-log-append-'))
  const fs = options.fs || makeCountingFs()
  const config = { pluginId: options.pluginId || 'ap', prefix: options.pluginId || 'ap' }
  if (options.maxSize !== undefined) config.maxSize = options.maxSize
  const { store } = createHostLog({ fs, timer: { timeout: (fn) => setTimeout(fn, 0) }, getCacheDir: async () => cacheDir }, config)
  const logDir = path.join(cacheDir, 'logs-' + (options.pluginId || 'ap'))
  return {
    store,
    fs,
    cacheDir,
    logDir,
    dayFile: () => path.join(logDir, formatDailyFileName(new Date())),
    async rows() {
      try {
        return (await readFile(this.dayFile(), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
      } catch (e) {
        if (e && e.code === 'ENOENT') return []
        throw e
      }
    },
    // 目录里所有 .log（含封存件）里的行：轮转之后诊断行可能落在新文件或旧封存件里。
    async allRows() {
      const out = []
      for (const n of (await readdir(logDir)).filter((x) => x.endsWith('.log')).sort()) {
        const text = await readFile(path.join(logDir, n), 'utf8')
        for (const line of text.split('\n').filter(Boolean)) out.push(JSON.parse(line))
      }
      return out
    },
    async cleanup() {
      await rm(cacheDir, { recursive: true, force: true })
    }
  }
}

describe('追加写（appendText 能力）', () => {
  it('① 追加路真被用上：首触读一次定尺寸 + 首追加读一次验证，之后只追加，从不整篇覆写', async () => {
    const t = await makeStore()
    try {
      for (const event of ['ap.one', 'ap.two', 'ap.three']) {
        t.store.log('warn', event, { pad: 'x'.repeat(40) })
        await t.store.synced()
      }
      assert.deepEqual((await t.rows()).map((r) => r.event), ['ap.one', 'ap.two', 'ap.three'], '行序与条数都要对')
      assert.equal(t.fs.state.writeCalls, 0, '有 appendText 时一次整篇覆写都不该发生')
      assert.equal(t.fs.state.appendCalls, 3, '每批一次追加')
      // 两次读：首触拿尺寸 + 首追加读回来验证「适配器真的写进去了」（对抗审查补的信任检查），
      // 之后稳态一次都不读（只有封存之前会再读一次确认）。
      assert.equal(t.fs.state.readCalls, 2, '首触 1 次 + 首追加验证 1 次，稳态不读旧文')
      const fileBytes = Buffer.byteLength(await readFile(t.dayFile(), 'utf8'), 'utf8')
      assert.equal(t.fs.state.appendBytes, fileBytes, '写出去的字节数 === 文件字节数（写量 O(新增)）')
    } finally {
      await t.cleanup()
    }
  })

  it('② 没有 appendText 的适配器照旧走读改写（能力协商不是硬依赖）', async () => {
    const t = await makeStore({ fs: makeCountingFs({ withAppend: false }) })
    try {
      t.store.log('warn', 'legacy.one', {})
      await t.store.synced()
      t.store.log('warn', 'legacy.two', {})
      await t.store.synced()
      assert.deepEqual((await t.rows()).map((r) => r.event), ['legacy.one', 'legacy.two'])
      assert.equal(t.fs.state.appendCalls, 0)
      assert.equal(t.fs.state.writeCalls, 2, '两批两次整篇覆写')
      assert.equal(t.fs.state.readCalls, 2, '读改写每批都要读旧文')
    } finally {
      await t.cleanup()
    }
  })

  it('③ 追加路下轮转仍然对：超阈值封存、一行不丢、audit 与自监控行齐全', async () => {
    const t = await makeStore({ maxSize: 500 })
    try {
      for (let b = 0; b < 6; b += 1) {
        for (let i = 0; i < 3; i += 1) t.store.log('warn', 'ap.batch', { b, i, pad: 'z'.repeat(60) })
        await t.store.synced()
      }
      const names = (await readdir(t.logDir)).filter((n) => n.endsWith('.log'))
      const sealed = names.filter((n) => /\.\d+\.log$/.test(n))
      assert.ok(sealed.length >= 1, '超阈值必须真的封存出编号文件，实际：' + JSON.stringify(names))
      assert.equal(t.fs.state.writePaths.filter((x) => x.endsWith('.log')).length, 0, '封存走 rename，日志文件一次整篇覆写都没有')

      const all = []
      for (const n of names.sort()) {
        const text = await readFile(path.join(t.logDir, n), 'utf8')
        for (const line of text.split('\n').filter(Boolean)) all.push(JSON.parse(line))
      }
      assert.equal(all.filter((r) => r.event === 'ap.batch').length, 18, '18 行用户行一行不丢')
      assert.ok(all.some((r) => r.event === 'log.rotate.seal'), '封存要有 info 自监控行')
      const audit = JSON.parse((await readFile(path.join(t.logDir, 'audit.json'), 'utf8')).trim().split('\n')[0])
      assert.equal(audit.op, 'rotate.seal')
      assert.ok(audit.bytes > 0, 'audit 记的是封存那一刻的真实字节数')
    } finally {
      await t.cleanup()
    }
  })

  it('④ 追加路不把跨进程判定绕掉：真封存之前会读一次确认，外来写者照样留 foreign-write', async () => {
    const t = await makeStore({ maxSize: 500 })
    try {
      t.store.log('warn', 'fw.first', { pad: 'a'.repeat(60) })
      await t.store.synced()
      const readsAfterFirst = t.fs.state.readCalls

      // 模拟另一个写者：直接往同一份文件里追加一行（我们没写过它）。
      const foreign = JSON.stringify({ v: 3, ts: Date.now(), level: 'warn', event: 'foreign.row', fields: {} })
      await appendFile(t.dayFile(), foreign + '\n', 'utf8')

      // 把这份文件推过阈值：追加模式下的尺寸是自己记的，所以封存前必须读一次确认真实长度。
      for (let b = 0; b < 5; b += 1) {
        t.store.log('warn', 'fw.more', { b, pad: 'b'.repeat(60) })
        await t.store.synced()
      }
      assert.ok(t.fs.state.readCalls > readsAfterFirst, '封存前必须发生一次确认读')
      const rows = await t.allRows()
      const diag = rows.filter((r) => r.event === 'log.persist.fail')
      assert.ok(diag.length >= 1, '外来写者必须留下 foreign-write 诊断')
      assert.equal(diag[0].fields.reason, 'foreign-write')
      assert.equal(rows.filter((r) => r.event === 'foreign.row').length, 1, '对方的行在（追加不覆写）')
      assert.equal(rows.filter((r) => r.event === 'fw.first').length, 1)
      assert.equal(rows.filter((r) => r.event === 'fw.more').length, 5)
    } finally {
      await t.cleanup()
    }
  })

  it('⑤ 尺寸是累加的：多批小追加最后也要走到封存阈值（M63 咬点）', async () => {
    // 这一条专治「追加后只记本批字节数」的假修复：那样每批都以为文件很小、永远到不了阈值。
    const t = await makeStore({ maxSize: 2000 })
    try {
      for (let b = 0; b < 10; b += 1) {
        for (let i = 0; i < 3; i += 1) t.store.log('warn', 'ap.acc', { b, i, pad: 'q'.repeat(60) })
        await t.store.synced()
      }
      const names = await readdir(t.logDir)
      const sealed = names.filter((n) => /\.\d+\.log$/.test(n))
      assert.ok(sealed.length >= 1, '十批小追加累计起来必须触发封存，实际目录：' + JSON.stringify(names))
      assert.equal(t.fs.state.writeCalls, t.fs.state.writePaths.filter((x) => !x.endsWith('.log')).length, '日志文件零覆写')
      const rows = await t.allRows()
      assert.equal(rows.filter((r) => r.event === 'ap.acc').length, 30, '30 行一行不丢')
    } finally {
      await t.cleanup()
    }
  })

  it('⑥ 撒谎的 appendText（返回成功却什么都不写）：那批行必须仍落盘、留 append-not-effective、此后不再依赖追加', async () => {
    // 为什么要这一条：适配器只说「我写好了」不等于真写了。历史上假 rename 就这么吞掉过 12500 行，
    // 所以追加路每份文件的第一次都会独立读回来确认；确认不了就判死追加能力、退回读改写补写这一批。
    const t = await makeStore({ fs: makeLyingFs('silent') })
    try {
      t.store.log('error', 'lie.row', { i: 1 })
      await t.store.synced()
      const rows = await t.allRows()
      assert.equal(rows.filter((r) => r.event === 'lie.row').length, 1, '撒谎的适配器不许吃掉这一行')
      assert.equal(t.store.getDroppedCount(), 0, '不许把「没写成」算成丢弃（它还在）')
      assert.ok(t.fs.state.writeCalls >= 1, '判定追加无效后必须退回读改写（writeText）')
      assert.ok(
        rows.some((r) => r.event === 'log.persist.fail' && r.fields.reason === 'append-not-effective'),
        '要留一条 append-not-effective 诊断，别让降级静默'
      )

      // 后续批次也不再依赖追加：第二行同样要落盘，且第一行不许被重写一遍。
      t.store.log('warn', 'lie.row2', { i: 2 })
      await t.store.synced()
      const rows2 = await t.allRows()
      assert.equal(rows2.filter((r) => r.event === 'lie.row2').length, 1, '判死之后后续批次仍要落盘')
      assert.equal(rows2.filter((r) => r.event === 'lie.row').length, 1, '已经落盘的行不许被重写一遍')
    } finally {
      await t.cleanup()
    }
  })

  it('⑦ 抛错的 appendText：判死追加能力、退回读改写，行不丢、留 append-failed', async () => {
    const t = await makeStore({ fs: makeLyingFs('throw') })
    try {
      t.store.log('error', 'boom.row', { i: 7 })
      await t.store.synced()
      const rows = await t.allRows()
      assert.equal(rows.filter((r) => r.event === 'boom.row').length, 1, '追加抛错不许吃掉这一行')
      assert.equal(t.store.getDroppedCount(), 0)
      assert.ok(t.fs.state.writeCalls >= 1, '必须退回读改写')
      assert.ok(
        rows.some((r) => r.event === 'log.persist.fail' && r.fields.reason === 'append-failed'),
        '要留一条 append-failed 诊断'
      )
    } finally {
      await t.cleanup()
    }
  })

  it('⑧ 大批次按行边界切块追加：单次 append 不超过原子上限（大行不会被别的写者撕成半行）', async () => {
    // 依据：.local/probe-append-big.mjs 实测——两个真子进程各写 20 行、每行 64KB 时，
    // 一次性大块追加会互相插进去，40 行里 2 行读不出来；按 ≤4KB 的行边界切块后 0 条坏行。
    const t = await makeStore()
    try {
      for (let i = 0; i < 200; i += 1) t.store.log('warn', 'chunk.row', { i, pad: 'p'.repeat(50) })
      await t.store.synced()
      assert.ok(t.fs.state.appendCalls > 1, '一个十几 KB 的批次必须切成多次追加，实际 ' + t.fs.state.appendCalls + ' 次')
      assert.ok(
        t.fs.state.maxAppendBytes <= 4096,
        '单次追加不得超过原子上限 4096 字节，实际 ' + t.fs.state.maxAppendBytes
      )
      // 每一块都必须在行边界收尾（块内容除最后一块外都以换行结束），不然就会在半行处断开。
      for (const piece of t.fs.state.appendedTexts.slice(0, -1)) {
        assert.ok(piece.endsWith('\n'), '切块必须落在行边界上，实际块尾：' + JSON.stringify(piece.slice(-12)))
      }
      const rows = await t.rows()
      assert.equal(rows.filter((r) => r.event === 'chunk.row').length, 200, '两百行一行不丢')
      assert.equal(t.fs.state.appendBytes, Buffer.byteLength(await readFile(t.dayFile(), 'utf8'), 'utf8'), '写量仍是 O(新增)')

      // 边界：单行自己就超上限时，它自成一个块、整行写完 —— 切了必然产生半行，宁可不切。
      const before = t.fs.state.appendCalls
      t.store.log('warn', 'chunk.big', { pad: 'z'.repeat(5000) })
      await t.store.synced()
      const bigPieces = t.fs.state.appendedTexts.slice(before)
      assert.equal(bigPieces.length, 1, '单行超上限时它自成一个块（不许从行中间断开）')
      assert.ok(bigPieces[0].endsWith('\n'), '整行写完，只在行尾收尾')
    } finally {
      await t.cleanup()
    }
  })
})
