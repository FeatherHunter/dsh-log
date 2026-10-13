// tests/snapshot.test.mjs —— 快照确认制门禁（#18 Q6 三修订）。
// 用法：node --test tests/snapshot.test.mjs；更新快照：node tests/update-snapshots.mjs。
// 只用 Node 自带测试能力（node:test），不引入新的测试框架。
// 口径（#18 Q6 用户已拍板）：
//   黄 warn——清单新增字段但快照未更新（只警告，测试仍绿；跑更新脚本转绿）；
//   红 error——未知事件名、envelope 非法、事件总数突变（与基线比 ±超 5 且无 changelog 说明）。
//   红的是“无 changelog”不是字段本身：补 CHANGELOG 说明后跑更新脚本即转绿。
// 本文件不改 src，只读 dist/config.js 的 parse/lint 能力与 tests/event-snapshots/ 基线。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAP_DIR = path.join(PKG_DIR, 'tests', 'event-snapshots')
const BASELINE_FILE = path.join(SNAP_DIR, '_baseline.json')
const CHANGELOG_FILE = path.join(SNAP_DIR, 'CHANGELOG.md')

const configUrl = pathToFileURL(path.join(PKG_DIR, 'dist', 'config.js')).href + '?x=' + Date.now()
const config = await import(configUrl)
const { parseEventListManifest, lintEventFields, EVENT_LEVELS, EVENT_KINDS, LOG_FORMAT_VERSION } = config

// 与 tests/eventList.test.mjs 的 makeSample 同形（快照基线就从它生成；改清单先改这里）。
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

function loadSnapshots() {
  const map = new Map()
  for (const file of readdirSync(SNAP_DIR)) {
    if (!file.endsWith('.json') || file === '_baseline.json') continue
    const eventName = file.slice(0, -'.json'.length)
    map.set(eventName, JSON.parse(readFileSync(path.join(SNAP_DIR, file), 'utf8')))
  }
  return map
}

function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
}

function loadChangelog() {
  try {
    return existsSync(CHANGELOG_FILE) ? readFileSync(CHANGELOG_FILE, 'utf8') : ''
  } catch {
    return ''
  }
}

// 落盘行 envelope（0.3.0 五键 {v,ts,level,event,fields}，v 取 LOG_FORMAT_VERSION=3）：
/// 非法即红 error（与未知事件名同档；其余未知字段只黄）。
function validateRowEnvelope(row) {
  const errors = []
  if (!row || typeof row !== 'object' || Array.isArray(row)) return { ok: false, errors: ['行必须是对象'] }
  if (row.v !== LOG_FORMAT_VERSION) errors.push('v 只认 ' + String(LOG_FORMAT_VERSION) + '（收到 ' + JSON.stringify(row.v) + '）')
  if (typeof row.ts !== 'number' || !isFinite(row.ts)) errors.push('ts 必须是有穷数字')
  if (EVENT_LEVELS.indexOf(row.level) < 0) errors.push('level 只许 error、warn、info、debug')
  if (typeof row.event !== 'string' || row.event.length === 0) errors.push('event 必须是非空字符串')
  if (!row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) errors.push('fields 必须是对象')
  return { ok: errors.length === 0, errors }
}

// 清单条目 envelope：级别/归类/字段集形状不对即红 error（只有黄/红两档）。
function validateEntryEnvelope(name, entry) {
  const errors = []
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, errors: ['事件 ' + name + ' 必须是对象'] }
  if (EVENT_LEVELS.indexOf(entry.level) < 0) errors.push('事件 ' + name + ' 的 level 只许 error、warn、info、debug')
  if (EVENT_KINDS.indexOf(entry.kind) < 0) errors.push('事件 ' + name + ' 的 kind 只许 resident、ondemand、selfmon')
  if (!Array.isArray(entry.fields)) errors.push('事件 ' + name + ' 的 fields 必须是字符串数组')
  return { ok: errors.length === 0, errors }
}

function sameSet(a, b) {
  const sa = new Set(a || [])
  const sb = new Set(b || [])
  if (sa.size !== sb.size) return false
  for (const x of sa) if (!sb.has(x)) return false
  return true
}

// 清单 vs 快照：未知事件（清单有、快照无）即红；新字段/删字段/元信息漂移只黄。
function diffManifestVsSnapshots(manifest, snapshots) {
  const errors = []
  const warns = []
  for (const name of Object.keys(manifest.events)) {
    const entry = manifest.events[name]
    const entryCheck = validateEntryEnvelope(name, entry)
    if (!entryCheck.ok) {
      errors.push('[红 error] envelope 非法：' + entryCheck.errors.join('；'))
      continue
    }
    const snap = snapshots.get(name)
    if (!snap) {
      errors.push('[红 error] 未知事件名：清单有 `' + name + '` 但快照无对应文件（先登记快照再上线）')
      continue
    }
    const snapCheck = validateEntryEnvelope(name, snap)
    if (!snapCheck.ok) {
      errors.push('[红 error] 快照 envelope 非法：' + snapCheck.errors.join('；'))
      continue
    }
    const extraInManifest = (entry.fields || []).filter((f) => (snap.fields || []).indexOf(f) < 0)
    const extraInSnapshot = (snap.fields || []).filter((f) => (entry.fields || []).indexOf(f) < 0)
    if (extraInManifest.length > 0) {
      warns.push('[黄 warn] 新字段未更新快照：`' + name + '` 新增 ' + extraInManifest.join('、') + '（跑 node tests/update-snapshots.mjs 转绿）')
    }
    if (extraInSnapshot.length > 0) {
      warns.push('[黄 warn] 快照残留旧字段：`' + name + '` 快照多出 ' + extraInSnapshot.join('、') + '（跑 node tests/update-snapshots.mjs 转绿）')
    }
    if (entry.level !== snap.level || entry.kind !== snap.kind) {
      warns.push('[黄 warn] 元信息漂移：`' + name + '` 的 level/kind 与快照不一致（跑 node tests/update-snapshots.mjs 转绿）')
    }
  }
  return { errors, warns }
}

// 增量门：总数与基线比 ±超 5 且 CHANGELOG 无说明即红；红的是“无 changelog”不是字段本身。
function checkTotalGate(manifest, baseline, changelogText) {
  const total = Object.keys(manifest.events).length
  const delta = total - baseline.total
  if (Math.abs(delta) <= baseline.threshold) return { ok: true, severity: 'none', total, delta, message: '' }
  const text = String(changelogText || '')
  const names = Object.keys(manifest.events)
  const mentionsTotal = text.indexOf('total=' + String(total)) >= 0 || text.indexOf('共' + String(total) + '个') >= 0
  const mentionsAllNew = names.every((n) => baseline.events.indexOf(n) >= 0 || text.indexOf(n) >= 0)
  if (mentionsTotal || mentionsAllNew) return { ok: true, severity: 'none', total, delta, message: '' }
  return {
    ok: false,
    severity: 'error',
    total,
    delta,
    message: '[红 error] 事件总数突变（基线 ' + baseline.total + '，现在 ' + total + '，差 ' + (delta > 0 ? '+' : '') + delta + ' 超 ±' + baseline.threshold + '）且无 changelog 说明：红的是“无 changelog”不是字段本身，先在 tests/event-snapshots/CHANGELOG.md 写明增删原因再跑 node tests/update-snapshots.mjs 更新基线'
  }
}

describe('快照确认制门禁（#18 Q6）', () => {
  it('基线齐全：4 事件快照 + 总数基线可读，envelope 全合法', () => {
    const snapshots = loadSnapshots()
    const baseline = loadBaseline()
    assert.equal(baseline.total, 4)
    assert.equal(baseline.threshold, 5)
    assert.deepEqual([...snapshots.keys()].sort(), ['chain.cache.miss', 'gh.exec', 'log.persist.fail', 'snapshot.built'])
    for (const [name, snap] of snapshots) {
      assert.deepEqual(validateEntryEnvelope(name, snap), { ok: true, errors: [] })
    }
    const manifest = parseEventListManifest(makeSample())
    assert.deepEqual(validateRowEnvelope({ v: 3, ts: Date.now(), level: 'info', event: 'gh.exec', fields: {} }), { ok: true, errors: [] })
    assert.equal(manifest.pluginId, 'wf')
  })

  it('有更新即绿：清单与快照一致时零红零黄', () => {
    const manifest = parseEventListManifest(makeSample())
    const diff = diffManifestVsSnapshots(manifest, loadSnapshots())
    assert.deepEqual(diff.errors, [])
    assert.deepEqual(diff.warns, [])
    const gate = checkTotalGate(manifest, loadBaseline(), loadChangelog())
    assert.equal(gate.ok, true)
  })

  it('新字段无快照更新即黄：warn 而非红（lint 同档）', () => {
    const baseManifest = parseEventListManifest(makeSample())
    // lint 口径同档：相对旧清单多出的字段只黄（probeNewField 不在旧清单里）。
    const linted = lintEventFields(baseManifest, 'gh.exec', ['argv0', 'probeNewField'])
    assert.equal(linted.ok, false)
    assert.equal(linted.severity, 'warn')
    assert.equal(linted.unknownEvent, false)
    assert.deepEqual(linted.unknownFields, ['probeNewField'])
    // 快照口径同档：新清单相对旧快照多出同名字段，只黄不红。
    const sample = makeSample()
    sample.events['gh.exec'].fields = [...sample.events['gh.exec'].fields, 'probeNewField']
    const manifest = parseEventListManifest(sample)
    // 快照口径同档：只黄不红。
    const diff = diffManifestVsSnapshots(manifest, loadSnapshots())
    assert.equal(diff.errors.length, 0)
    assert.equal(diff.warns.length >= 1, true)
    assert.match(diff.warns[0], /黄 warn/)
    console.warn(diff.warns[0] + ' —— 黄而非红，不拦排障')
  })

  it('未知事件名即红：error（lint 与快照同档）', () => {
    const manifest = parseEventListManifest(makeSample())
    const linted = lintEventFields(manifest, 'gh.exec2', ['argv0'])
    assert.deepEqual(linted, { ok: false, severity: 'error', unknownEvent: true, unknownFields: [] })
    const sample = makeSample()
    sample.events['brand.new.event'] = { level: 'info', kind: 'resident', fields: ['step'] }
    sample.counts.resident += 1
    const manifest2 = parseEventListManifest(sample)
    const diff = diffManifestVsSnapshots(manifest2, loadSnapshots())
    assert.equal(diff.errors.length, 1)
    assert.match(diff.errors[0], /未知事件名/)
  })

  it('envelope 非法即红：error（v/level/fields 形状不对）', () => {
    assert.equal(validateRowEnvelope({ v: 2, ts: Date.now(), level: 'info', event: 'gh.exec', fields: {} }).ok, false)
    assert.equal(validateRowEnvelope({ v: 3, ts: 'now', level: 'info', event: 'gh.exec', fields: {} }).ok, false)
    assert.equal(validateRowEnvelope({ v: 3, ts: Date.now(), level: 'fatal', event: 'gh.exec', fields: {} }).ok, false)
    assert.equal(validateRowEnvelope({ v: 3, ts: Date.now(), level: 'info', event: 'gh.exec', fields: null }).ok, false)
    const bad = validateEntryEnvelope('gh.exec', { level: 'fatal', kind: 'resident', fields: ['argv0'] })
    assert.equal(bad.ok, false)
    assert.match(bad.errors.join('；'), /level/)
  })

  it('增量门：总数突变 ±超 5 无说明即红，红的是“无 changelog”不是字段本身', () => {
    // 真实基线：当前 4 vs 基线 4，差 0，不过门。
    const manifest = parseEventListManifest(makeSample())
    assert.equal(checkTotalGate(manifest, loadBaseline(), loadChangelog()).ok, true)
    // 合成突变：4 + 7 = 11，差 +7 超 ±5，且 CHANGELOG 没写这 7 个名，即红。
    const sample = makeSample()
    for (let i = 0; i < 7; i++) sample.events['probe.bulk.' + i] = { level: 'info', kind: 'resident', fields: ['step'] }
    sample.counts.resident += 7
    const bulk = parseEventListManifest(sample)
    const gate = checkTotalGate(bulk, loadBaseline(), loadChangelog())
    assert.equal(gate.ok, false)
    assert.equal(gate.severity, 'error')
    assert.match(gate.message, /无 changelog/)
    assert.match(gate.message, /不是字段本身/)
  })

  it('实盘巡检：当前清单过快照门（红即 fail，黄只 warn 不 fail）', () => {
    const manifest = parseEventListManifest(makeSample())
    const diff = diffManifestVsSnapshots(manifest, loadSnapshots())
    const gate = checkTotalGate(manifest, loadBaseline(), loadChangelog())
    for (const w of diff.warns) console.warn(w)
    assert.deepEqual(diff.errors, [])
    assert.equal(gate.ok, true)
  })
})
