// tests/release-surface.test.mjs —— 发行面（#27）：类型要随包发出去，且公共面不留空转兼容物。
//
// 这片的断言都对着「消费者拿到的是什么」，不是「仓库里有什么」：
//   1. package.json 的 exports 每个子路径都要有 types 条件（否则 strict 消费者编译即 TS7016）
//   2. dist/ 的 .d.ts 必须与 src/ 一一对应（少一个就是「某个入口没类型」）
//   3. 根入口（dsh-log）可用，且它的类型面里不出现 Node 专有类型（宿主/客户端两半不依赖 Node）
//   4. 0.3.0 删掉的空转兼容物必须真的不在公共面上（留着比删掉更坏：调用方以为接上了）
//
// 为什么单独立一片：这些断言与运行期行为无关，跑得快、失败信息直指发行配置，不掺进隔离/轮转那些大套里。
import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))

// src 下的实现文件（.d.ts 只是类型输入，不产出声明）
function srcUnits(dir = path.join(PKG_DIR, 'src'), prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...srcUnits(path.join(dir, entry.name), rel))
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(rel)
  }
  return out.sort()
}

function dtsUnits(dir = path.join(PKG_DIR, 'dist'), prefix = '') {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...dtsUnits(path.join(dir, entry.name), rel))
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) out.push(rel)
  }
  return out.sort()
}

describe('发行面（#27）：类型与入口', () => {
  it('exports 四个子路径都带 types 条件，且指向真实存在的声明文件', () => {
    const entries = ['.', './host', './client', './node']
    for (const key of entries) {
      const entry = pkg.exports[key]
      assert.ok(entry, 'exports 缺子路径 ' + key)
      assert.equal(typeof entry.types, 'string', key + ' 缺 types 条件')
      assert.equal(typeof entry.default, 'string', key + ' 缺 default 条件')
      assert.ok(entry.types.endsWith('.d.ts'), key + ' 的 types 不是 .d.ts：' + entry.types)
      assert.ok(existsSync(path.join(PKG_DIR, entry.types)), key + ' 的 types 指向不存在的文件：' + entry.types)
      assert.ok(existsSync(path.join(PKG_DIR, entry.default)), key + ' 的 default 指向不存在的文件：' + entry.default)
    }
    // 老解析器（不看 exports 的）靠顶层 types 字段找到根入口声明
    assert.equal(pkg.types, pkg.exports['.'].types)
  })

  it('src 的每个实现文件都有对应的 dist/*.d.ts，且声明非空', () => {
    const missing = []
    for (const unit of srcUnits()) {
      const dts = unit.slice(0, -3) + '.d.ts'
      const full = path.join(PKG_DIR, 'dist', dts)
      if (!existsSync(full) || readFileSync(full, 'utf8').trim().length === 0) missing.push(dts)
    }
    assert.deepEqual(missing, [], '这些实现文件没产出声明（消费者拿到的就是隐式 any）')
    // 反向也要对得上：dist 里的声明不该有 src 里没有的（陈旧产物同样是谎言）
    const expected = srcUnits().map((u) => u.slice(0, -3) + '.d.ts').sort()
    assert.deepEqual(dtsUnits(), expected)
  })

  it('files 字段包含 dist，声明才真的会被打包发布', () => {
    assert.ok(Array.isArray(pkg.files) && pkg.files.includes('dist'), 'files 必须包含 dist')
  })

  it('bin 指向真实文件、第一行是 shebang，且在打包范围内（否则 npx dsh-log 装出来不能执行）', () => {
    assert.ok(pkg.bin && typeof pkg.bin['dsh-log'] === 'string', 'package.json 该有 bin.dsh-log')
    const rel = pkg.bin['dsh-log']
    const binPath = path.join(PKG_DIR, rel)
    assert.ok(existsSync(binPath), 'bin 指向的文件不存在：' + rel)
    assert.equal(
      readFileSync(binPath, 'utf8').split('\n')[0],
      '#!/usr/bin/env node',
      'bin 的第一行必须是 shebang（由 build.mjs 在包头之前补回）'
    )
    assert.ok(rel.replace(/^\.\//, '').startsWith('dist/'), 'bin 必须落在 files 覆盖的 dist/ 里')
  })

  it('根入口可用：dsh-log 与 dsh-log/node 都能按包名导入（自引用解析）', async () => {
    const root = await import('dsh-log')
    assert.equal(typeof root.parseLogFileName, 'function')
    assert.equal(typeof root.lintEventFields, 'function')
    assert.equal(root.LOG_FORMAT_VERSION, 3)
    // 读侧三件（0.3.1）：纯函数，浏览器与 Node 都能用
    assert.equal(typeof root.parseLogLine, 'function')
    assert.equal(typeof root.formatRow, 'function')
    assert.equal(typeof root.formatRows, 'function')
    const nodeEntry = await import('dsh-log/node')
    assert.equal(typeof nodeEntry.createQuickLog, 'function')
    const hostEntry = await import('dsh-log/host')
    assert.equal(typeof hostEntry.createHostLog, 'function')
    const clientEntry = await import('dsh-log/client')
    assert.equal(typeof clientEntry.createClientLog, 'function')
  })

  it('根入口不把 Node 拖进消费者：index.js 与所有声明里没有 node: 导入', () => {
    const indexJs = readFileSync(path.join(PKG_DIR, 'dist', 'index.js'), 'utf8')
    assert.ok(!/from\s+'node:/.test(indexJs), 'dist/index.js 不该 import node: 内建')
    const offenders = []
    for (const dts of dtsUnits()) {
      const text = readFileSync(path.join(PKG_DIR, 'dist', dts), 'utf8')
      for (const line of text.split('\n')) {
        // 只看真导入语句：注释里提到 node:path 不算
        if (/^\s*(import|export)\b/.test(line) && /'node:/.test(line)) offenders.push(dts + ' :: ' + line.trim())
      }
    }
    assert.deepEqual(offenders, [], '声明里出现 Node 专有类型会让消费者必须装 @types/node')
  })

  it('0.3.0 删掉的空转兼容物真的不在公共面上', async () => {
    const root = await import('dsh-log')
    const nodeEntry = await import('dsh-log/node')
    const hostEntry = await import('dsh-log/host')
    const clientEntry = await import('dsh-log/client')
    // store.js 不是公开子路径，但它是「模块级全局回调」的老家，直接按文件查它的导出面。
    const storeModule = await import(pathToFileURL(path.join(PKG_DIR, 'dist', 'store.js')).href + '?x=' + Date.now())
    for (const [name, mod] of [
      ['checkEventCounts', root],
      ['checkEventCounts', hostEntry],
      ['logFileNamePattern', root],
      ['setOnDrop', storeModule],
      ['buildLogDebugKey', clientEntry],
      ['LOG_DEBUG_KEY_PREFIX', clientEntry]
    ]) {
      assert.equal(mod[name], undefined, name + ' 应当已从公共面删除')
    }
    // 保留的锚点仍在（删的是别名与空转物，不是事实本身）
    assert.equal(clientEntry.LOG_DEBUG_KEY, 'dsws.debug')
    assert.equal(typeof nodeEntry.createNodeHostLog, 'function')
  })

  it('src 里不再有 @deprecated 标记（A5：兼容包袱清零）', () => {
    const hits = []
    for (const unit of srcUnits()) {
      const text = readFileSync(path.join(PKG_DIR, 'src', unit), 'utf8')
      if (text.includes('@deprecated')) hits.push(unit)
    }
    assert.deepEqual(hits, [], '这些源文件还留着 @deprecated：要么删掉，要么写进 README 迁移节并从这里豁免')
  })
})
