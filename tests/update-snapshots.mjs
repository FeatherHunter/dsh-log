// tests/update-snapshots.mjs —— 事件快照一键更新（#18 Q6 快照确认制）。
// 用法：node tests/update-snapshots.mjs（一键更新，不阻排障：只写盘、不抛业务错）。
// 来源：与 tests/eventList.test.mjs 的 makeSample 同形（初始基线就从它生成）。
// 写出：tests/event-snapshots/<事件名>.json（每事件批准字段集）+ _baseline.json（总数基线）。
// 说明：新增字段先黄后绿——改清单后先跑单测确认黄，再跑本脚本把黄转绿；
// 未知事件名与 envelope 非法不经本脚本自动洗白，仍由 tests/snapshot.test.mjs 判红。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAP_DIR = path.join(PKG_DIR, 'tests', 'event-snapshots')
const BASELINE_FILE = path.join(SNAP_DIR, '_baseline.json')

// 与 tests/eventList.test.mjs 的 makeSample 同形（改这边时两边同步改，再跑本脚本）。
function makeSample() {
  return {
    version: 1,
    pluginId: 'wf',
    counts: { resident: 2, ondemand: 1, selfmon: 1 },
    events: {
      'snapshot.built': {
        level: 'info',
        kind: 'resident',
        fields: ['maps', 'issues', 'labels', 'fallback', 'latencyMs']
      },
      'gh.exec': {
        level: 'info',
        kind: 'resident',
        fields: ['argv0', 'cwdHash', 'latencyMs', 'kind', 'exitCode'],
        codes: ['H_CWD', 'B_TOKEN'],
        rules: ['R_TOKEN_BEARER', 'R_GH_TOKEN']
      },
      'chain.cache.miss': {
        level: 'debug',
        kind: 'ondemand',
        fields: ['keyHash', 'lang', 'reason'],
        guard: '按事件，有穿透才记'
      },
      'log.persist.fail': {
        level: 'warn',
        kind: 'selfmon',
        fields: ['op', 'reason', 'dirHash'],
        codes: ['H_CWD']
      }
    }
  }
}

function toSnapshotFile(eventName, entry) {
  const out = {
    event: eventName,
    level: entry.level,
    kind: entry.kind,
    fields: [...entry.fields]
  }
  if (entry.codes !== undefined) out.codes = [...entry.codes]
  if (entry.rules !== undefined) out.rules = [...entry.rules]
  if (entry.guard !== undefined) out.guard = entry.guard
  out.approvedAt = new Date().toISOString().slice(0, 10)
  out.source = 'tests/eventList.test.mjs makeSample (#18 Q6)'
  return out
}

function main() {
  // 一键更新不阻排障：只做写盘，任何业务分歧都只打印不抛错（抛错只留给 IO 失败）。
  const sample = makeSample()
  const names = Object.keys(sample.events).sort()
  mkdirSync(SNAP_DIR, { recursive: true })
  let oldTotal = null
  try {
    if (existsSync(BASELINE_FILE)) {
      oldTotal = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).total
    }
  } catch {
    oldTotal = null
  }
  for (const name of Object.keys(sample.events)) {
    const file = path.join(SNAP_DIR, name + '.json')
    writeFileSync(file, JSON.stringify(toSnapshotFile(name, sample.events[name]), null, 2) + '\n', 'utf8')
    console.log('[snapshots] 写 ' + name + ' -> tests/event-snapshots/' + name + '.json')
  }
  const baseline = {
    total: Object.keys(sample.events).length,
    threshold: 5,
    events: names,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'tests/eventList.test.mjs makeSample (#18 Q6)',
    note: '事件总数基线：与当前清单事件数之差绝对值超 5 且 CHANGELOG 无说明即红，红的是“无 changelog”不是字段本身'
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n', 'utf8')
  console.log('[snapshots] 基线 total=' + baseline.total + '（之前 ' + String(oldTotal) + '）')
  if (oldTotal !== null && Math.abs(baseline.total - oldTotal) > 5) {
    console.log('[snapshots] 提醒：总数突变超 5，请先在 tests/event-snapshots/CHANGELOG.md 写明增删原因再提交（增量门认 changelog）。')
  }
  console.log('[snapshots] 完成：跑 node --test tests/snapshot.test.mjs 确认转绿。')
}

main()
