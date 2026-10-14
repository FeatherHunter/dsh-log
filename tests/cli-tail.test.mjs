// tests/cli-tail.test.mjs —— 读侧命令行（C）的契约：黑盒跑真进程，只看它印出来的东西。
//
// 为什么黑盒：这个工具的价值全在「终端里敲一条命令能不能看明白日志」，所以断言必须打在
// 真进程的 stdout/stderr/退出码上，而不是内部函数上。另外两条纪律单独钉：
//   ① 只读——跑完前后目录里的文件名、大小、mtime 必须一模一样；
//   ② 半行不显示——写者可能正写到一半，读侧不许把半个 JSON 当一行印出来。
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 同 format-row：按测试文件自身定位包根，不用 process.cwd()——变异表在临时副本里跑，
// 用 cwd 会读到活仓库那份没被变异的 dist（实测 M79–M85 假 GREEN 的根因）。
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(PKG_DIR, 'dist', 'cli.js')
const NOW = Date.now()
const SEALED = '2026-01-02.1.log'
const HALF = '2026-01-02.2.log'
const WRITABLE = '2026-01-02.log'
const PARTIAL = '{"v":3,"ts":1791971707832,"level":"error","event":"half.written"'

const ROWS = {
  old: { v: 3, ts: NOW - 3600000, level: 'info', event: 'old.event', fields: { message: '一小时前的事' } },
  mid: { v: 3, ts: NOW - 60000, level: 'warn', event: 'mid.event', fields: { message: '一分钟前的慢', traceId: 'T-1' } },
  fresh: { v: 3, ts: NOW - 1000, level: 'error', event: 'new.event', fields: { message: '刚刚失败', traceId: 'T-2', code: 500 } }
}

let root = ''
let logDir = ''
let cacheRoot = ''

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
}

function snapshot(dir) {
  return readdirSync(dir).sort().map((name) => {
    const st = statSync(join(dir, name))
    return `${name}:${st.size}:${st.mtimeMs}`
  }).join('|')
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-cli-'))
  cacheRoot = root
  logDir = join(root, 'logs-cli-demo')
  mkdirSync(logDir, { recursive: true })
  // 封存件装最早的行（写入顺序：.1 → 可写文件），可写文件装最新的行 —— 这一条由 core/file-name 定义。
  writeFileSync(join(logDir, SEALED), JSON.stringify(ROWS.old) + '\n', 'utf8')
  writeFileSync(
    join(logDir, WRITABLE),
    [JSON.stringify(ROWS.mid), 'not json at all', JSON.stringify({ ts: 1, op: 'rotate.seal', file: 'x.log' }), JSON.stringify(ROWS.fresh)].join('\n') + '\n',
    'utf8'
  )
  // 半行单独放一个封存件：真实现场是「进程写到一半被杀」，此时文件末尾就是半个 JSON。
  // （不能把它放在可写文件末尾——那会让后面追加的新行与它粘成一行，测的就不是半行处理的语义了。）
  writeFileSync(join(logDir, HALF), PARTIAL, 'utf8')
  writeFileSync(join(logDir, 'audit.json'), JSON.stringify({ ts: 1, op: 'rotate.seal' }) + '\n', 'utf8')
})

after(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('读侧命令行（C）：dsh-log tail', () => {
  test('默认渲染：按写入顺序（封存件在前）、人话在行里、坏行与半行都不印', () => {
    const res = run(['tail', logDir])
    assert.equal(res.status, 0, res.stderr)
    const lines = res.stdout.trimEnd().split('\n')
    assert.equal(lines.length, 3, `应只印三行合法日志，实际：\n${res.stdout}`)
    assert.ok(lines[0].includes('old.event') && lines[0].includes('一小时前的事'), '最早的行来自封存件')
    assert.ok(lines[1].includes('mid.event'))
    assert.ok(lines[2].includes('new.event') && lines[2].includes('(traceId=T-2, code=500)'))
    assert.ok(!res.stdout.includes('not json'), '坏行不印')
    assert.ok(!res.stdout.includes('half.written'), '半行不印（写者可能正写到一半）')
    assert.ok(!res.stdout.includes('rotate.seal'), 'audit.json 不是日志行，不印')
    assert.match(lines[2], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} ERROR new\.event /)
  })

  test('子命令 tail 真被认（可写也可省）：两种写法输出一样、stderr 干净', () => {
    const withSub = run(['tail', logDir])
    const withoutSub = run([logDir])
    assert.equal(withSub.status, 0, withSub.stderr)
    assert.equal(withSub.stderr, '', `带子命令不该有任何 stderr（缺陷：tail 被当成目录名），实际：${withSub.stderr}`)
    assert.equal(withSub.stdout, withoutSub.stdout, '`dsh-log tail <目录>` 与 `dsh-log <目录>` 必须完全等价')
    assert.ok(!withSub.stderr.includes('没找到日志目录：tail'))

    // 子命令后面的选项也要认：`tail -n 1 <目录>`
    const subThenFlag = run(['tail', '-n', '1', logDir])
    assert.equal(subThenFlag.status, 0, subThenFlag.stderr)
    assert.equal(subThenFlag.stderr, '')
    assert.equal(subThenFlag.stdout.trimEnd().split('\n').length, 1)

    // 只有一个 `tail` 时它是子命令、不是目录名：退回当前目录（这里没有日志，报的是「一个都没有」）
    const bareSub = run(['tail'])
    assert.ok(!bareSub.stderr.includes('没找到日志目录：tail'), `tail 不该被当成目录名，实际：${bareSub.stderr}`)
  })

  test('--json：原样输出（管道给 jq 用），仍是「跳过坏行、跳过半行」', () => {
    const res = run(['tail', logDir, '--json'])
    assert.equal(res.status, 0, res.stderr)
    const lines = res.stdout.trimEnd().split('\n')
    assert.equal(lines.length, 3)
    for (const line of lines) {
      const row = JSON.parse(line)
      assert.equal(row.v, 3)
    }
    assert.equal(JSON.parse(lines[0]).event, 'old.event')
    assert.ok(!res.stdout.includes('网络'), '--json 不做渲染')
  })

  test('过滤：--level / --since / --trace / --limit 各管一段', () => {
    const byLevel = run(['tail', logDir, '--level', 'error'])
    assert.equal(byLevel.status, 0, byLevel.stderr)
    assert.ok(byLevel.stdout.includes('new.event') && !byLevel.stdout.includes('mid.event'))

    const bySince = run(['tail', logDir, '--since', '5m'])
    assert.equal(bySince.status, 0, bySince.stderr)
    assert.ok(!bySince.stdout.includes('old.event'), '一小时前的行该被 --since 5m 滤掉')
    assert.ok(bySince.stdout.includes('mid.event') && bySince.stdout.includes('new.event'))

    const byTrace = run(['tail', logDir, '--trace', 'T-1'])
    assert.equal(byTrace.status, 0, byTrace.stderr)
    assert.ok(byTrace.stdout.includes('mid.event'))
    assert.equal(byTrace.stdout.trimEnd().split('\n').length, 1)

    const byLimit = run(['tail', logDir, '-n', '1'])
    assert.equal(byLimit.status, 0, byLimit.stderr)
    assert.equal(byLimit.stdout.trimEnd().split('\n').length, 1)
    assert.ok(byLimit.stdout.includes('new.event'), '-n 1 给的是最后一行')
  })

  test('目录发现：给日志根目录（里面是 logs-*/）也能找到', () => {
    const res = run(['tail', cacheRoot])
    assert.equal(res.status, 0, res.stderr)
    assert.ok(res.stdout.includes('new.event'))
    assert.ok(res.stdout.includes('old.event'))
  })

  test('用法与找不到目录：都要说清楚并给非零退出码', () => {
    const help = run(['tail', '--help'])
    assert.equal(help.status, 0)
    assert.ok(help.stdout.includes('只读承诺'), '帮助里要写明不写文件')

    const badLevel = run(['tail', logDir, '--level', 'nonsense'])
    assert.equal(badLevel.status, 1)
    assert.ok(badLevel.stderr.includes('--level 只认'))

    const badSince = run(['tail', logDir, '--since', '一会儿'])
    assert.equal(badSince.status, 1)
    assert.ok(badSince.stderr.includes('--since 认'))

    const missing = run(['tail', join(root, 'not-there')])
    assert.equal(missing.status, 1)
    assert.ok(missing.stderr.includes('没找到日志目录'))

    const version = run(['tail', '--version'])
    assert.equal(version.status, 0)
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)
  })

  test('只读：跑完前后，目录里的名字、大小、mtime 一个都没变', () => {
    const before = snapshot(logDir)
    const res = run(['tail', logDir, '--json'])
    assert.equal(res.status, 0)
    assert.equal(snapshot(logDir), before, '这个工具不许写、不许改、不许删日志文件')
  })

  test('-f 跟读：先给最后 N 行，然后新行一出现就跟着印出来', async () => {
    const child = spawn(process.execPath, [CLI, 'tail', logDir, '-f', '-n', '1'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk.toString() })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.ok(out.includes('new.event'), `初始该只给最后一行（-n 1），实际：\n${out}`)
    assert.ok(!out.includes('mid.event'), '-n 1 不该给更早的行')

    appendFileSync(join(logDir, WRITABLE), JSON.stringify({
      v: 3, ts: Date.now(), level: 'warn', event: 'followed.event', fields: { message: '跟着看看到的' }
    }) + '\n', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.ok(out.includes('followed.event'), `新行该被跟着印出来，实际：\n${out}`)
    assert.ok(out.includes('跟着看看到的'))
    assert.ok(!out.includes('half.written'), '半行始终不印')
  })
})
