// scripts/pack-smoke.mjs —— 打包冒烟：把「真发出去的包」装进一个全新工程跑一遍。
//
// 为什么要有它：`npm test` 跑的是仓库里的 dist，而消费者拿到的是 tarball——两者差一层打包规则
// （`files` 白名单、exports 条件、声明文件是否真的进包）。这一层只有真打一次包、真装一次才看得见。
// 它检查四件事：
//   ① tarball 里的文件清单对得上（含 README/INTEGRATION/LICENSE/模板/四个入口的 js 与 .d.ts）；
//   ② 每个 `dist/**/*.js` 都有同名的 `.d.ts`（声明漏一个就是消费者侧 TS7016）；
//   ③ 包里没有 `src/`、`tests/` 这类不该发出去的东西；
//   ④ 装进全新工程后：`import 'dsh-log'` 与 `dsh-log/node` 都能用，写一行日志真落盘且是五键行。
//
// 用法：node build.mjs && node scripts/pack-smoke.mjs（CI 里就是这么跑的）
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
function check(ok, message) {
  if (!ok) problems.push(message)
  console.log((ok ? '  ✔ ' : '  ✖ ') + message)
}

// 优先用 node 直接跑 npm 自带的 cli.js（不开 shell，避免 Windows 上 .cmd 的引号与弃用警告）；
// 找不到就退回 shell 调 npm。
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
function npm(args, cwd) {
  const useCli = existsSync(NPM_CLI)
  const r = useCli
    ? spawnSync(process.execPath, [NPM_CLI, ...args], { cwd, encoding: 'utf8' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: true })
  if (r.status !== 0) throw new Error('npm ' + args.join(' ') + ' 失败：\n' + (r.stderr || r.stdout || ''))
  return r.stdout || ''
}

const work = await mkdtemp(path.join(tmpdir(), 'dsh-pack-smoke-'))
try {
  console.log('① 打包清单')
  const dry = JSON.parse(npm(['pack', '--dry-run', '--json'], PKG_DIR))[0]
  const names = dry.files.map((f) => f.path.replace(/\\/g, '/'))
  const required = [
    'package.json',
    'README.md',
    'INTEGRATION.md',
    'LICENSE',
    'event-list.template.json',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/node.js',
    'dist/node.d.ts',
    'dist/host.js',
    'dist/host.d.ts',
    'dist/client.js',
    'dist/client.d.ts'
  ]
  for (const need of required) check(names.includes(need), '清单含 ' + need)
  check(!names.some((n) => n.startsWith('src/')), '不打包 src/')
  check(!names.some((n) => n.startsWith('tests/') || n.startsWith('scripts/')), '不打包 tests/ 与 scripts/')
  check(!names.some((n) => n.endsWith('.map')), '不打包 sourcemap')

  console.log('② 声明与实现一一对应')
  const jsFiles = names.filter((n) => n.startsWith('dist/') && n.endsWith('.js'))
  const missingDecl = jsFiles.filter((n) => !names.includes(n.replace(/\.js$/, '.d.ts')))
  check(jsFiles.length > 0, '包里至少有 dist 的 js（实际 ' + jsFiles.length + ' 个）')
  check(missingDecl.length === 0, '每个 dist js 都有同名 .d.ts' + (missingDecl.length ? '（缺：' + missingDecl.join(', ') + '）' : ''))

  console.log('③ 真装一次（全新工程）')
  const tarball = path.join(work, 'dsh-log.tgz')
  npm(['pack', '--pack-destination', work], PKG_DIR)
  const packed = (await readdir(work)).find((n) => n.endsWith('.tgz'))
  check(Boolean(packed), '打出了 tarball：' + String(packed))
  await rm(tarball, { force: true })

  const consumer = path.join(work, 'consumer')
  await writeFile(path.join(work, 'placeholder'), '')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(consumer, { recursive: true })
  await writeFile(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'pack-smoke-consumer', private: true, type: 'module' }, null, 2)
  )
  npm(['install', path.join(work, packed), '--no-audit', '--no-fund', '--silent'], consumer)
  const installed = await readdir(path.join(consumer, 'node_modules', 'dsh-log', 'dist'))
  check(installed.includes('index.d.ts'), '装完 dist/index.d.ts 在')

  console.log('④ 消费者冒烟：写一行真落盘')
  const smoke = path.join(consumer, 'smoke.mjs')
  const cacheDir = path.join(consumer, 'logs')
  await writeFile(
    smoke,
    [
      "import { LOG_FORMAT_VERSION, lintEventFields } from 'dsh-log'",
      "import { createQuickLog } from 'dsh-log/node'",
      "import { readFile, readdir } from 'node:fs/promises'",
      'const log = await createQuickLog(' + JSON.stringify(cacheDir) + ')',
      "log.store.log('warn', 'smoke.step', { step: 'pack' })",
      'const report = await log.ready',
      "if (!report.ok) throw new Error('ready 没落定：' + JSON.stringify(report))",
      'const dir = ' + JSON.stringify(path.join(cacheDir, 'logs-quick')),
      'const files = await readdir(dir)',
      "const text = await readFile(dir + '/' + files.filter((n) => n.endsWith('.log'))[0], 'utf8')",
      "const row = JSON.parse(text.split('\\n').filter(Boolean).pop())",
      "const keys = Object.keys(row).sort().join(',')",
      "if (keys !== 'event,fields,level,ts,v') throw new Error('落盘行不是五键：' + keys)",
      'if (row.v !== LOG_FORMAT_VERSION) throw new Error(\'v 不是 \' + LOG_FORMAT_VERSION)',
      "if (row.event !== 'smoke.step') throw new Error('事件名不对：' + row.event)",
      "const manifest = { version: 1, pluginId: 'smoke', events: { 'smoke.step': { level: 'warn', kind: 'ondemand', fields: ['step'] } } }",
      "const lint = lintEventFields(manifest, 'smoke.step', ['step'])",
      "if (lint.ok !== true || lint.severity !== 'none') throw new Error('根入口的检查器不可用：' + JSON.stringify(lint))",
      "const lintWarn = lintEventFields(manifest, 'smoke.step', ['step', 'typo'])",
      "if (lintWarn.severity !== 'warn' || lintWarn.unknownFields.join(',') !== 'typo') throw new Error('未知字段该是 warn：' + JSON.stringify(lintWarn))",
      "console.log(JSON.stringify({ ok: true, file: files[0], row }))"
    ].join('\n')
  )
  const smokeOut = spawnSync(process.execPath, [smoke], { cwd: consumer, encoding: 'utf8' })
  check(smokeOut.status === 0, '消费者脚本 exit 0' + (smokeOut.status === 0 ? '' : '：' + (smokeOut.stderr || '').split('\n').slice(0, 4).join(' | ')))
  if (smokeOut.status === 0) {
    const parsed = JSON.parse(smokeOut.stdout.trim().split('\n').pop())
    check(parsed.ok === true && parsed.row && parsed.row.v === 3, '落盘一行五键 v=3：' + JSON.stringify(parsed.row))
  }
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {})
}

if (problems.length > 0) {
  console.error('\n打包冒烟失败 ' + problems.length + ' 项：')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\n打包冒烟通过。')
