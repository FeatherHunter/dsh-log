// tests/format-row.test.mjs —— 读侧渲染（B）的契约：解析要宽容、渲染要稳定、别抛错。
//
// 为什么这些断言重要：CLI 与使用者都靠它把「机器读的那份」变成人能看的行。
// 一旦渲染依赖 Intl/locale，同一份日志在两台机器上就会渲染成不同字符串（测试飘、对账飘），
// 所以这里逐字钉死本地时间的形状（本地时区），ISO 形状则完全可复现。
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'

// 按「测试文件所在目录的上一级」定位包根，而不是 process.cwd()：变异表会把整个包拷到临时目录里跑，
// 那时 cwd 还是活仓库——用 cwd 会让测试读到没被变异的 dist，把注入的缺陷全部漏掉（实测 M79–M85 假 GREEN）。
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = pathToFileURL(join(PKG_DIR, 'dist', 'core', 'read-row.js')).href
const { parseLogLine, formatRow, formatRows } = await import(dist)

const ROW = {
  v: 3,
  ts: 1791971707832,
  level: 'error',
  event: 'net.unreachable',
  fields: { message: '网络异常：连接 api.example.com 超时 3s', host: 'api.example.com', attempt: 2 }
}

describe('读侧渲染（B）：parseLogLine 宽容、formatRow 稳定', () => {
  test('解析：合法行 → 只看 ts/level/event/fields；缺 fields 也算合法', () => {
    const row = parseLogLine(JSON.stringify(ROW))
    assert.deepEqual(row, {
      ts: ROW.ts,
      level: 'error',
      event: 'net.unreachable',
      fields: ROW.fields
    })
    const bare = parseLogLine('{"v":3,"ts":1,"level":"info","event":"x.y"}')
    assert.deepEqual(bare, { ts: 1, level: 'info', event: 'x.y', fields: {} })
  })

  test('解析：非日志行一律 null（空行、半行、audit.json、数组、坏 JSON）', () => {
    const lines = [
      '',
      '   ',
      '{"v":3,"ts":1791971707832,"level":"error","eve', // 半行
      '{"ts":1791971707832,"op":"rotate.seal","file":"2026-10-14.log"}', // audit.json 一类
      '[1,2,3]',
      '"just a string"',
      'null',
      'not json at all'
    ]
    for (const line of lines) assert.equal(parseLogLine(line), null, `这行不该被当成日志行：${line}`)
    assert.equal(parseLogLine(null), null)
    assert.equal(parseLogLine(123), null)
  })

  test('解析：fields 是数组/字符串时按空对象处理，不抛错', () => {
    assert.deepEqual(parseLogLine('{"level":"warn","event":"a.b","fields":[1,2]}'), {
      ts: 0, level: 'warn', event: 'a.b', fields: {}
    })
    assert.deepEqual(parseLogLine('{"level":"warn","event":"a.b","fields":"nope"}'), {
      ts: 0, level: 'warn', event: 'a.b', fields: {}
    })
  })

  test('渲染：本地时间形状固定（YYYY-MM-DD HH:mm:ss.SSS，不经过 Intl）', () => {
    const line = formatRow(parseLogLine(JSON.stringify(ROW)))
    assert.match(line, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} ERROR net\.unreachable /)
    assert.ok(line.includes('网络异常：连接 api.example.com 超时 3s'), '人话必须原样出现')
    assert.ok(line.includes('(host=api.example.com, attempt=2)'), '其余字段以 k=v 附在行尾')
  })

  test('渲染：iso 时间可复现；withFields:false 只留人话；自定义 messageField', () => {
    const iso = formatRow(parseLogLine(JSON.stringify(ROW)), { timeStyle: 'iso' })
    assert.match(iso, /^2026-10-14T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR net\.unreachable /)
    const bare = formatRow(parseLogLine(JSON.stringify(ROW)), { withFields: false })
    assert.ok(!bare.includes('host='), 'withFields:false 不该出现字段')
    assert.ok(bare.includes('网络异常'))
    const custom = formatRow(
      { ts: ROW.ts, level: 'info', event: 'a.b', fields: { note: '换了个字段', k: 1 } },
      { messageField: 'note' }
    )
    assert.ok(custom.includes('换了个字段'))
    assert.ok(custom.includes('(k=1)'))
    assert.ok(!custom.includes('note='), 'messageField 本身不该再以 k=v 出现')
  })

  test('渲染：对象值走 JSON、超长截断；级别未知也照常渲染', () => {
    const line = formatRow({
      ts: ROW.ts,
      level: 'fatal',
      event: 'x.y',
      fields: { ctx: { a: 1 }, huge: 'x'.repeat(500) }
    }, { maxValueChars: 10 })
    assert.ok(line.includes('FATAL'), '未知级别也要显示（读侧不假装它不存在）')
    assert.ok(line.includes('ctx={"a":1}'))
    assert.ok(line.includes('huge=xxxxxxxxxx…'), '超长值截断加省略号')
  })

  test('渲染：默认不上色；color:true 时级别带 ANSI，且对齐宽度不受转义影响', () => {
    const plain = formatRow(parseLogLine(JSON.stringify(ROW)))
    assert.ok(!plain.includes('\u001b['), '默认不该有 ANSI')
    const colored = formatRow(parseLogLine(JSON.stringify(ROW)), { color: true })
    assert.ok(colored.includes('\u001b[31mERROR\u001b[0m'), 'error 该是红色')
    // 对齐按未着色宽度算：着色与不着色的可见列数必须一致。
    const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '')
    assert.equal(strip(colored).indexOf('网络异常'), plain.indexOf('网络异常'))
  })

  test('formatRows：null 行跳过，批量渲染等价于逐行', () => {
    const rows = [parseLogLine(JSON.stringify(ROW)), null, parseLogLine('{"level":"info","event":"a.b"}')]
    const out = formatRows(rows)
    assert.equal(out.length, 2)
    assert.equal(out[0], formatRow(rows[0]))
    assert.ok(out[1].includes('INFO'))
  })
})
