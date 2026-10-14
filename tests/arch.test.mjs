// tests/arch.test.mjs —— 依赖方向的静态门禁（结构由测试强制，不靠自觉）。
//
// 目标树的分层（research/14 §2）：
//   entries（host.ts / node.ts / index.ts）→ engine|client|host 面（store.ts / phones.ts / client.ts）
//   → 配置面（config.ts）→ platform（端口与适配）→ core（零 IO 的领域层）
// 规则只允许向右。这条线一旦破，最典型的后果是 core 里长出 IO、platform 反向依赖 engine，
// 于是「换平台」「纯函数单测」这些卖点同时消失，而且没有任何测试会红——所以在这里钉死。
//
// 扫描的是**源码**（src/**/*.ts），不是 dist：改坏源码就要当场红。

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { join, posix } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

// 收集 src 下所有 .ts（跳过 .d.ts：环境声明不是模块依赖）。
function walk(dirRel = '') {
  const out = []
  const abs = join(SRC, dirRel)
  for (const name of readdirSync(abs, { withFileTypes: true })) {
    const rel = dirRel ? posix.join(dirRel, name.name) : name.name
    if (name.isDirectory()) out.push(...walk(rel))
    else if (name.name.endsWith('.ts') && !name.name.endsWith('.d.ts')) out.push(rel)
  }
  return out
}

// 抓 import / export ... from / import() 的模块说明符。
//
// 用 TypeScript 自己的解析器（devDependency，测试里早就在用真 tsc），**不用正则**：
// 2026-10-14 的终局审查证明过，按行匹配的正则对多行 import/export 全盲——本仓 168 条 from 子句里
// 有 18 条（11%）是多行写法（§9 门面转出口、index.ts 全部、store.ts/client.ts/host.ts 若干），
// 也就是说这些边上的越界依赖当时根本没人拦。改用 AST 后，多行、注释里的假 from、动态 import 都不会漏。
function specifiersOf(text, fileName = 'module.ts') {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS)
  const out = []
  const add = (node) => {
    if (node !== undefined && node !== null && ts.isStringLiteral(node)) out.push(node.text)
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

// 把相对说明符解析成 src 内的 posix 相对路径；解析不到（跑出 src 外）返 null。
// TS 的 ESM 写法是 import './x.js' 指向 src/x.ts，所以把 .js 还原成 .ts 再判层。
function resolveInSrc(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  let joined = posix.normalize(posix.join(posix.dirname(fromRel), spec))
  if (joined.startsWith('..')) return null
  if (joined.endsWith('.js')) joined = joined.slice(0, -3) + '.ts'
  return joined
}

function layerOf(rel) {
  if (rel.startsWith('core/')) return 0
  if (rel.startsWith('platform/')) return 1
  // 配置面（门面 config.ts 与 config/ 下的小件：校验 / 常量 / 电话名 / 文件名 / 配置补齐 / 事件清单）
  if (rel === 'config.ts' || rel.startsWith('config/')) return 2
  // 引擎 / 客户端 / 宿主电话面（S4 起逐个从根目录搬进 engine|client|host 子目录，两个位置都算这一层）
  if (rel.startsWith('engine/') || rel.startsWith('client/') || rel.startsWith('host/')) return 3
  if (rel === 'store.ts' || rel === 'phones.ts' || rel === 'client.ts') return 3
  return 4 // host.ts / node.ts / index.ts（入口层）
}

const FILES = walk()

describe('架构门禁：依赖方向只允许向右（core ← platform ← config ← 引擎/客户端面 ← 入口）', () => {
  test('依赖解析看得见多行 import/export（2026-10-14 审查证伪过的盲区）', () => {
    // 这几条都是本仓真实存在的**多行**写法；按行匹配的正则一条都看不见。
    const canaries = [
      ['index.ts', './config.js'],
      ['config.ts', './config/constants.js'],
      ['config.ts', './core/file-name.js'],
      ['host.ts', './store.js'],
      ['phones.ts', './host/aggregate.js'],
      ['client.ts', './config.js']
    ]
    const missing = []
    for (const [rel, spec] of canaries) {
      const found = specifiersOf(readFileSync(join(SRC, rel), 'utf8'), rel)
      if (!found.includes(spec)) missing.push(`${rel} 的 ${spec}`)
    }
    assert.deepEqual(missing, [], `这些多行写法没被解析到（说明解析器又退回按行了）：\n${missing.join('\n')}`)
  })

  test('扫描到源码文件（不是空跑）', () => {
    assert.ok(FILES.length >= 14, `只扫到 ${FILES.length} 个文件，路径或过滤有问题`)
    assert.ok(FILES.includes('core/level.ts'), 'core/level.ts 应当在扫描结果里')
    assert.ok(FILES.includes('core/read-row.ts'), 'core/read-row.ts（读侧渲染）应当在扫描结果里')
    assert.ok(FILES.includes('platform/fs-node.ts'), 'platform/fs-node.ts 应当在扫描结果里')
    assert.ok(FILES.includes('platform/read-node.ts'), 'platform/read-node.ts（读侧文件能力）应当在扫描结果里')
    assert.ok(FILES.includes('cli/tail.ts'), 'cli/tail.ts（读侧命令行主体）应当在扫描结果里')
    assert.ok(FILES.includes('engine/io.ts'), 'engine/io.ts 应当在扫描结果里')
    assert.ok(FILES.includes('config/constants.ts'), 'config/constants.ts 应当在扫描结果里')
    assert.ok(FILES.includes('config/event-list.ts'), 'config/event-list.ts 应当在扫描结果里')
  })

  test('core/ 零 IO、零上层：只许相对引用 core 内部', () => {
    const bad = []
    for (const rel of FILES.filter((f) => layerOf(f) === 0)) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        const target = resolveInSrc(rel, spec)
        if (target === null || !target.startsWith('core/')) {
          bad.push(`${rel} → ${spec}`)
        }
      }
    }
    assert.deepEqual(bad, [], `core 里出现了非 core 依赖：\n${bad.join('\n')}`)
  })

  test('platform/ 只许 node: 内置、core/ 与 platform 内部', () => {
    const bad = []
    for (const rel of FILES.filter((f) => layerOf(f) === 1)) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        if (spec.startsWith('node:')) continue
        const target = resolveInSrc(rel, spec)
        if (target === null || !(target.startsWith('core/') || target.startsWith('platform/'))) {
          bad.push(`${rel} → ${spec}`)
        }
      }
    }
    assert.deepEqual(bad, [], `platform 依赖了上层或包外模块：\n${bad.join('\n')}`)
  })

  test('config.ts 与 config/ 只许引用 core/ 与 config 内部', () => {
    const bad = []
    for (const rel of FILES.filter((f) => f === 'config.ts' || f.startsWith('config/'))) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        const target = resolveInSrc(rel, spec)
        if (target === null || !(target.startsWith('core/') || target.startsWith('config/'))) {
          bad.push(`${rel} → ${spec}`)
        }
      }
    }
    assert.deepEqual(bad, [], `配置面越界引用：${bad.join('、')}`)
  })

  test('配置面内部不许挂环（config/* 互相 import 必须无环）', () => {
    const names = FILES.filter((f) => f === 'config.ts' || f.startsWith('config/'))
    const edges = new Map()
    for (const rel of names) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      const outs = []
      for (const spec of specifiersOf(text)) {
        const target = resolveInSrc(rel, spec)
        if (target !== null && (target.startsWith('config/') || target === 'config.ts')) outs.push(target)
      }
      edges.set(rel, outs)
    }
    const cycles = []
    const state = new Map()
    const visit = (node, trail) => {
      if (state.get(node) === 'done') return
      if (state.get(node) === 'open') { cycles.push(trail.concat(node).join(' → ')); return }
      state.set(node, 'open')
      for (const next of edges.get(node) || []) visit(next, trail.concat(node))
      state.set(node, 'done')
    }
    for (const rel of names) visit(rel, [])
    assert.deepEqual(cycles, [], `配置面出现循环依赖：\n${cycles.join('\n')}`)
  })

  test('三个面互不认识：engine/ 与 client/ 与 host/ 之间不许互相 import（只有组合根接线）', () => {
    // 理由：面与面互相 import 会让「同一份语义」在两个面里各长一份（历史上 store 与 client 的级别判定
    // 与常驻表就是这么分家的）。跨面组合只许发生在组合根（store.ts / phones.ts / client.ts）与入口层。
    const faces = ['engine/', 'client/', 'host/']
    const faceOf = (rel) => faces.find((f) => rel.startsWith(f)) || null
    const bad = []
    for (const rel of FILES) {
      const mine = faceOf(rel)
      if (mine === null) continue
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        const target = resolveInSrc(rel, spec)
        if (target === null) continue
        const other = faceOf(target)
        if (other !== null && other !== mine) bad.push(`${rel} → ${target}`)
        if (target === 'store.ts' || target === 'phones.ts' || target === 'client.ts') bad.push(`${rel} → ${target}（组合根由入口接线，面不许反向引用）`)
      }
    }
    assert.deepEqual(bad, [], `面与面之间出现直接依赖：\n${bad.join('\n')}`)
  })

  test('引擎/客户端面（store/phones/client）不许引用入口层，也不许碰 node: 内置', () => {
    const bad = []
    for (const rel of FILES.filter((f) => layerOf(f) === 3)) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        if (spec.startsWith('node:')) {
          bad.push(`${rel} → ${spec}（IO 只能在 platform 与入口层）`)
          continue
        }
        const target = resolveInSrc(rel, spec)
        if (target === null) {
          bad.push(`${rel} → ${spec}（包外依赖：本包运行时零依赖）`)
          continue
        }
        if (layerOf(target) === 4) bad.push(`${rel} → ${spec}（入口层只能被入口层引用）`)
      }
    }
    assert.deepEqual(bad, [], `分层被打破：\n${bad.join('\n')}`)
  })

  test('全包零运行时依赖：只允许 node: 内置与相对引用', () => {
    const bad = []
    for (const rel of FILES) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      for (const spec of specifiersOf(text)) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue
        bad.push(`${rel} → ${spec}`)
      }
    }
    assert.deepEqual(bad, [], `出现包外模块引用：\n${bad.join('\n')}`)
  })

  test('node: 内置只出现在 platform/ 与入口 node.ts', () => {
    // 读侧 CLI（cli.ts + cli/）刻意不在白名单里：它要读文件，所以文件能力留在 platform/read-node.ts，
    // CLI 自己一行 node: 都不许碰——这条同时把「工具不许写文件」变成了结构约束（写 API 只能来自 platform）。
    const allowed = new Set(['platform/fs-node.ts', 'platform/timer-node.ts', 'platform/read-node.ts', 'node.ts'])
    const bad = []
    for (const rel of FILES) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      if (specifiersOf(text).some((s) => s.startsWith('node:')) && !allowed.has(rel)) {
        bad.push(rel)
      }
    }
    assert.deepEqual(bad, [], `这些文件碰了 node: 内置：${bad.join('、')}`)
  })

  test('不允许 require（本包是纯 ESM）', () => {
    const bad = []
    for (const rel of FILES) {
      const text = readFileSync(join(SRC, rel), 'utf8')
      if (/\brequire\s*\(/.test(text)) bad.push(rel)
    }
    assert.deepEqual(bad, [], `出现 require()：${bad.join('、')}`)
  })
})
