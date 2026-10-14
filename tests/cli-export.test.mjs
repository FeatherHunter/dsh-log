// tests/cli-export.test.mjs —— 读侧第二件工具：`dsh-log export`（把目录交出去）
//
// 背景（research/18 §2.2 实测）：宿主导出摘要里的 pluginVersion 写死 'unknown'、cwd 是**跑导出
// 那个进程**的目录；第三方只拿到一个目录时，更没有「谁写的、哪一版、什么系统」这些事实。
//
// 现在的口径（0.3.3）：目录自述行 host.start 由入口自动写；`export` 把「摘要 + 原始行」原样交出去，
// **读不出来的格子写 unknown，绝不用跑命令那个进程的环境顶替**。
//
// 本文件钉住：①摘要内容与原始行都在 ②环境缺失一律 unknown（不许出现读者环境）③--json 形状
// ④只读（跑完目录一个字节不变）⑤筛选选项当场报错 ⑥无前缀目录也能导出。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(PKG_DIR, 'dist', 'cli.js')

async function makeCacheDir() {
  return mkdtemp(path.join(tmpdir(), 'dsh-log-export-'))
}

/** 跑 CLI：返回 { code, stdout, stderr }（不抛，好断言退出码）。 */
async function runCli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

function rowOf(ts, level, event, fields) {
  return JSON.stringify({ v: 3, ts, level, event, fields })
}

/** 目录快照：名字 → 大小+修改时间（用来证明「跑 export 一个字节都没改」）。 */
async function snapshot(dir) {
  const out = {}
  for (const name of (await readdir(dir)).sort()) {
    const info = await stat(path.join(dir, name))
    out[name] = info.size + ':' + info.mtimeMs
  }
  return out
}

describe('CLI export：把目录交出去', () => {
  it('默认输出 = 摘要 + 原始行；摘要含目录/行数/级别/事件/启动头/开关，原始行逐字未改', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'logs-exp-a'), { recursive: true })
      const rows = [
        rowOf(1791980000000, 'info', 'host.start', { pid: 1234, startedAt: '2026-10-15T03:00:00.000Z', dir: cacheDir, pluginVersion: '1.2.3', os: 'win32' }),
        rowOf(1791980001000, 'warn', 'net.unreachable', { message: '网络异常：连接超时', host: 'api.example.com' }),
        rowOf(1791980002000, 'error', 'wf.step.fail', { message: '步骤失败' })
      ]
      await writeFile(path.join(cacheDir, 'logs-exp-a', '2026-10-15.log'), rows.join('\n') + '\n', 'utf8')
      await writeFile(path.join(cacheDir, 'log-switch-exp-a.json'), '{"enabled":false}', 'utf8')

      const res = await runCli(['export', path.join(cacheDir, 'logs-exp-a')])
      assert.equal(res.code, 0, res.stderr)
      assert.ok(res.stdout.indexOf('# dsh-log 目录摘要') >= 0)
      assert.ok(res.stdout.indexOf('文件: 1 个（3 行可解析，0 行读不出）') >= 0)
      assert.ok(res.stdout.indexOf('级别: error=1 info=1 warn=1') >= 0)
      assert.ok(res.stdout.indexOf('事件: host.start=1 net.unreachable=1 wf.step.fail=1') >= 0)
      assert.ok(res.stdout.indexOf('pluginVersion=1.2.3') >= 0, '启动头里的版本必须报出来')
      assert.ok(res.stdout.indexOf('os=win32') >= 0)
      assert.ok(res.stdout.indexOf('开关: {"enabled":false}') >= 0)
      assert.ok(res.stdout.indexOf('读不出来: （无）') >= 0)
      // 原始行原样在（三行都在，且逐字等于写进去的那三行）。
      for (const row of rows) assert.ok(res.stdout.indexOf(row) >= 0, '原始行必须原样出现在导出里：' + row)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('环境缺失一律 unknown：旧目录（没有 host.start、没有开关文件）不得出现「跑命令那个进程」的环境', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'logs-exp-old'), { recursive: true })
      await writeFile(
        path.join(cacheDir, 'logs-exp-old', '2026-10-15.log'),
        rowOf(1791980000000, 'warn', 'legacy.row', { message: '老目录没自述' }) + '\n',
        'utf8'
      )
      const res = await runCli(['export', path.join(cacheDir, 'logs-exp-old')])
      assert.equal(res.code, 0, res.stderr)
      assert.ok(res.stdout.indexOf('启动头: unknown') >= 0)
      assert.ok(res.stdout.indexOf('开关: unknown') >= 0)
      assert.ok(res.stdout.indexOf('读不出来: header, logSwitch') >= 0)
      // 读者环境绝不出现：当前工作目录、平台名都不许被当成写者事实。
      assert.equal(res.stdout.indexOf(process.cwd()) >= 0, false, '不许把读者的 cwd 当写者事实')
      assert.equal(res.stdout.indexOf(process.platform) >= 0, false, '不许把读者的平台当写者事实')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('--json 只输出一个摘要对象，形状齐全（给脚本用）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'logs-exp-b'), { recursive: true })
      await writeFile(
        path.join(cacheDir, 'logs-exp-b', '2026-10-15.log'),
        [rowOf(1791980000000, 'info', 'host.start', { pid: 7, startedAt: 'x', dir: 'd', pluginVersion: '2.0.0', os: 'linux' }), rowOf(1791980001000, 'error', 'boom', {})].join('\n') + '\n',
        'utf8'
      )
      const res = await runCli(['export', path.join(cacheDir, 'logs-exp-b'), '--json'])
      assert.equal(res.code, 0, res.stderr)
      const parsed = JSON.parse(res.stdout.trim())
      assert.deepEqual(Object.keys(parsed).sort(), [
        'bad', 'byEvent', 'byLevel', 'dir', 'files', 'firstTs', 'header', 'lastTs', 'logSwitch', 'rows', 'unknown'
      ])
      assert.equal(parsed.rows, 2)
      assert.equal(parsed.header.pluginVersion, '2.0.0')
      assert.equal(parsed.byLevel.error, 1)
      assert.deepEqual(parsed.unknown, ['logSwitch'], '没有开关文件 → 只缺这一格')
      assert.equal(parsed.files[0].name, '2026-10-15.log')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('只读：跑完 export 目录里一个字节都没变（含半行文件也不动它）', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'logs-exp-ro'), { recursive: true })
      await writeFile(path.join(cacheDir, 'logs-exp-ro', '2026-10-15.log'), rowOf(1791980000000, 'warn', 'ro.row', {}) + '\n{半行', 'utf8')
      const before = await snapshot(path.join(cacheDir, 'logs-exp-ro'))
      const res = await runCli(['export', path.join(cacheDir, 'logs-exp-ro')])
      assert.equal(res.code, 0, res.stderr)
      assert.ok(res.stdout.indexOf('1 行读不出') >= 0, '半行要如实计入「读不出」')
      assert.deepEqual(await snapshot(path.join(cacheDir, 'logs-exp-ro')), before, 'export 不许改任何文件')
      // 半行不进原始行段（交出去的东西里不留半截 JSON）。
      assert.equal(res.stdout.indexOf('{半行') >= 0, false)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('筛选选项对 export 当场报错（不静默忽略），用法里写明 export', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'logs-exp-c'), { recursive: true })
      await writeFile(path.join(cacheDir, 'logs-exp-c', '2026-10-15.log'), rowOf(1791980000000, 'warn', 'c.row', {}) + '\n', 'utf8')
      const res = await runCli(['export', path.join(cacheDir, 'logs-exp-c'), '--level', 'error'])
      assert.equal(res.code, 1)
      assert.ok(res.stderr.indexOf('export 不支持 --level') >= 0, res.stderr)
      const help = await runCli(['--help'])
      assert.ok(help.stdout.indexOf('dsh-log export') >= 0, '用法里必须有 export')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  it('无前缀的目录名也能导出（discoverLogDirs 的行为是契约）：开关照实写 unknown', async () => {
    const cacheDir = await makeCacheDir()
    try {
      await mkdir(path.join(cacheDir, 'my-namespace'), { recursive: true })
      await writeFile(path.join(cacheDir, 'my-namespace', '2026-10-15.log'), rowOf(1791980000000, 'warn', 'ns.row', {}) + '\n', 'utf8')
      const res = await runCli(['export', path.join(cacheDir, 'my-namespace')])
      assert.equal(res.code, 0, res.stderr)
      assert.ok(res.stdout.indexOf('ns.row') >= 0, '无前缀目录也必须能导出')
      assert.ok(res.stdout.indexOf('开关: unknown') >= 0, '名字猜不出开关文件 → 如实 unknown，不猜')
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
