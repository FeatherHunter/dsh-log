// tests/consumer-types.test.mjs —— 消费方视角（#27 A1/A3）：把包当别人家的依赖装一次，真编译。
//
// 为什么必须这样测：仓库内 tsc 走的是 types:[] + 源码路径，永远看不见「发布出去之后消费者拿到什么」。
// 所以这里造一个临时工程，node_modules/dsh-log 用 junction 指到本仓，然后用真 tsc 编译：
//   1. strict + moduleResolution Bundler：0 错误（有类型，不是隐式 any）
//   2. strict + moduleResolution NodeNext：0 错误（老一点/严一点的解析也要能过）
//   3. 装了一份「像 @types/node 那样」的声明 + types:["node"]：0 错误（本包不重复声明 Node 内建）
//   4. 故意写错一行：必须报错（否则说明拿到的是 any，第 1 条就是假绿）
//
// skipLibCheck 关掉：这样 tsc 会真的检查我们发出去的 .d.ts 自身是否自洽，而不是跳过它们。
import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSC = path.join(PKG_DIR, 'node_modules', 'typescript', 'bin', 'tsc')

const GOOD_APP = `import { LOG_FORMAT_VERSION, computeEventCounts, parseEventListManifest, lintEventFields } from 'dsh-log'
import type { LogRowV3, OnDropCallback } from 'dsh-log'
import { createQuickLog, createNodeHostLog } from 'dsh-log/node'
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'
import { createClientLog } from 'dsh-log/client'

const version: 3 = LOG_FORMAT_VERSION
const manifest = parseEventListManifest({ version: 1, pluginId: 'consumer', events: {} })
const counts = computeEventCounts(manifest)
const resident: number = counts.resident
const lint = lintEventFields(manifest, 'any.event', ['a'])
const lintOk: boolean = lint.ok

const row: LogRowV3 = { v: 3, ts: Date.now(), level: 'warn', event: 'consumer.row', fields: {} }
const onDrop: OnDropCallback = (dropped, reason) => {
  void dropped
  void reason
}

const log = await createQuickLog('/tmp/dsh-log-consumer', 'consumer')
log.store.setOnDrop(onDrop)
log.store.log('warn', 'consumer.row', { step: 'fetch' })
log.store.log('error', 'consumer.fail', {})
const dropped: number = log.store.getDroppedCount()
await log.store.synced()
log.store.release()

const hostLog = await createNodeHostLog({ cacheDir: '/tmp/dsh-log-consumer' }, { pluginId: 'consumer', prefix: 'consumer' })
const table = new Map<string, (args: never) => Promise<unknown>>()
const names = registerHostLogPhones(
  {
    has: (name: string) => table.has(name),
    set: (name: string, handler: (args: never) => Promise<unknown>) => {
      table.set(name, handler)
    }
  },
  hostLog
)
const first: string = names.logBatch

void version
void resident
void lintOk
void row
void dropped
void first
void createHostLog
void createClientLog
`

const BAD_APP = `import { createQuickLog } from 'dsh-log/node'
const log = await createQuickLog('/tmp/dsh-log-consumer', 'consumer')
// level 是字符串联合，给数字必须报错——如果这里不报错，说明消费者拿到的是 any
log.store.log(123, 'consumer.row')
`

// 形状照着 @types/node 的声明方式写：本包若把 src/node-ambient.d.ts 一起发出去，
// 这里的 realpathSync 就会撞 TS2451（Cannot redeclare block-scoped variable）。
const FAKE_NODE_TYPES = `declare module 'node:fs' {
  export const realpathSync: { (path: string): string; native(path: string): string }
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export function dirname(path: string): string
}
declare module 'node:fs/promises' {
  export function rename(from: string, to: string): Promise<void>
}
`

function makeConsumer({ moduleResolution, withNodeTypes = false, files }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-log-consumer-'))
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  symlinkSync(PKG_DIR, path.join(dir, 'node_modules', 'dsh-log'), 'junction')
  if (withNodeTypes) {
    const typesDir = path.join(dir, 'node_modules', '@types', 'node')
    mkdirSync(typesDir, { recursive: true })
    writeFileSync(path.join(typesDir, 'package.json'), JSON.stringify({ name: '@types/node', version: '0.0.0', types: 'index.d.ts' }))
    writeFileSync(path.join(typesDir, 'index.d.ts'), FAKE_NODE_TYPES)
  }
  const moduleKind = moduleResolution === 'Bundler' ? 'ESNext' : 'NodeNext'
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: moduleKind,
      moduleResolution,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: withNodeTypes ? ['node'] : []
    },
    include: ['*.ts']
  }
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
  // 消费方是 ESM 工程（NodeNext 下这一条决定 app.ts 被当 ESM 还是 CJS）
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-log-consumer', private: true, type: 'module' }))
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text)
  const r = spawnSync(process.execPath, [TSC, '-p', path.join(dir, 'tsconfig.json')], { encoding: 'utf8' })
  return { dir, status: r.status, output: (r.stdout || '') + (r.stderr || '') }
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch (e) {
    void e
  }
}

describe('消费方视角（#27 A1/A3）：装进临时工程真编译', () => {
  for (const moduleResolution of ['Bundler', 'NodeNext']) {
    it('strict + ' + moduleResolution + '：四个入口都有类型，编译 0 错误', () => {
      const r = makeConsumer({ moduleResolution, files: { 'app.ts': GOOD_APP } })
      try {
        assert.equal(r.status, 0, 'tsc 应当 0 错误，实际输出：\n' + r.output)
        assert.ok(!/TS7016/.test(r.output), '不该出现 TS7016（隐式 any 说明声明没被找到）')
      } finally {
        cleanup(r.dir)
      }
    })
  }

  it('装着 @types/node 形状的声明也不冲突（本包不重复声明 Node 内建）', () => {
    const r = makeConsumer({ moduleResolution: 'Bundler', withNodeTypes: true, files: { 'app.ts': GOOD_APP } })
    try {
      assert.equal(r.status, 0, '与 @types/node 共存应当 0 错误，实际输出：\n' + r.output)
      assert.ok(!/TS2451|TS2309/.test(r.output), '不该出现重复声明类错误')
    } finally {
      cleanup(r.dir)
    }
  })

  it('故意写错一行必须报错：证明拿到的是真类型而不是 any', () => {
    const r = makeConsumer({ moduleResolution: 'Bundler', files: { 'bad.ts': BAD_APP } })
    try {
      assert.notEqual(r.status, 0, '把 level 写成数字居然编译通过，说明类型没生效')
      assert.ok(/error TS\d+/.test(r.output), '应当是类型错误，实际输出：\n' + r.output)
    } finally {
      cleanup(r.dir)
    }
  })
})
