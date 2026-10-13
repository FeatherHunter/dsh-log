// #23 A3 的硬杀验收：synced() 之后杀进程必须一行不丢；没 synced 就杀允许丢，但不许落半行。
// 真子进程 + 真磁盘 + SIGKILL（Windows 上 process.kill(pid,'SIGKILL') 即无条件终止）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHILD = join(HERE, 'fixtures', 'kill-child.mjs')

function todayName() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'
}

// 拉起子进程并等它真的死掉（不依赖 stdio，避免管道缓冲影响）。
function runChild(cacheDir, mode, count) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD, cacheDir, mode, String(count)], { stdio: 'ignore' })
    child.on('exit', (code, signal) => resolve({ code, signal }))
    child.on('error', () => resolve({ code: -1, signal: null }))
  })
}

async function freshDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-log-kill-'))
  return dir
}

function parseRows(text) {
  const lines = text.split('\n')
  // 末尾必须是换行（不许半行），否则说明被杀在写盘中途
  assert.equal(lines[lines.length - 1], '', '日志文件必须以换行收尾（没有半行）')
  const rows = []
  for (const line of lines.slice(0, -1)) {
    if (line === '') continue
    rows.push(JSON.parse(line))
  }
  return rows
}

test('A3 synced 后硬杀进程：20 行 error 一行不丢，且行行完整', async () => {
  const cacheDir = await freshDir()
  try {
    const { code } = await runChild(cacheDir, 'synced', 20)
    // marker 存在 ⇒ 子进程真的走完了 synced() 才被杀（否则这条断言会先红）
    assert.ok(existsSync(join(cacheDir, 'synced.marker')), 'synced() 必须已返回（marker 存在）')
    assert.notEqual(code, 0, '子进程应是被硬杀，不是正常退出')

    const file = join(cacheDir, 'logs-kill', todayName())
    const text = await readFile(file, 'utf8')
    const rows = parseRows(text)
    assert.equal(rows.length, 20, 'synced 之后落盘必须恰好 20 行')
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), ['event', 'fields', 'level', 'ts', 'v'])
      assert.equal(r.v, 3)
      assert.equal(r.level, 'error')
      assert.equal(r.event, 'kill.row')
      assert.equal(typeof r.fields.i, 'number')
      assert.equal(r.fields.payload.length, 64)
    }
    const idx = rows.map((r) => r.fields.i).sort((a, b) => a - b)
    assert.deepEqual(idx, Array.from({ length: 20 }, (_, i) => i), '序号 0..19 齐全且不重')
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('A3 没 synced 就硬杀：允许丢行，但绝不许落半行（丢得干净）', async () => {
  const cacheDir = await freshDir()
  try {
    const { code } = await runChild(cacheDir, 'instant', 20)
    assert.notEqual(code, 0, '子进程应是被硬杀')
    const file = join(cacheDir, 'logs-kill', todayName())
    if (!existsSync(file)) {
      assert.ok(!existsSync(join(cacheDir, 'synced.marker')), '没 synced 就死：文件可以不存在')
      return
    }
    const rows = parseRows(await readFile(file, 'utf8'))
    assert.ok(rows.length <= 20, '行数不可能超过写过的 20 行')
    for (const r of rows) {
      assert.equal(r.v, 3)
      assert.equal(r.event, 'kill.row')
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('A3 跨进程无登记（文档写明的风险）：子进程死后父进程可直接接管同目录，不需要 release()', async () => {
  const cacheDir = await freshDir()
  try {
    await runChild(cacheDir, 'synced', 3)
    const file = join(cacheDir, 'logs-kill', todayName())
    const before = (await readFile(file, 'utf8')).split('\n').filter(Boolean).length

    // 登记表是模块副本级的：另一个进程持有的目录，本进程看不见，所以建库不抛（这是已知缺口，文档按风险提示写）
    const { createNodeHostLog } = await import('../dist/node.js')
    const hostLog = await createNodeHostLog({ cacheDir }, { pluginId: 'kill', prefix: 'kill' })
    const store = hostLog.store
    store.log('warn', 'kill.takeover', {})
    await store.synced()
    store.release()

    const after = await readFile(file, 'utf8')
    const rows = parseRows(after)
    assert.ok(rows.length > before, '接管后新行应追加到同一文件（追加而不是覆盖）')
    assert.equal(rows[0].event, 'kill.row', '老行仍在（追加语义）')
    assert.equal(rows[rows.length - 1].event, 'kill.takeover')
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})
