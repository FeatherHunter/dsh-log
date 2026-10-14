// src/cli/args.ts —— 命令行参数解析（纯函数：不碰 IO，便于单测，也保证「用法错误先于任何读取」）。
//
// 为什么单独一个文件：解析是纯逻辑，读文件是副作用。混在一起就没法在不启动进程的情况下
// 断言「`--level nonsense` 会当场报错、不会先扫一遍磁盘」——而这条正是 CLI 的基本礼貌。

import { LOG_LEVEL_ORDER, isKnownLevel } from '../core/level.js'

export interface CliOptions {
  /** 子命令：tail（看日志，默认）或 export（交日志：目录 → 自包含摘要 + 原始行）。 */
  command: 'tail' | 'export'
  paths: string[]
  follow: boolean
  asJson: boolean
  level: string
  sinceMs: number | null
  traceId: string
  limit: number
  limitGiven: boolean
  color: boolean
  help: boolean
  version: boolean
}

export interface ParseArgsResult {
  options: CliOptions
  error: string
}

export const USAGE = `dsh-log —— 看日志、交日志（只读）

用法：
  dsh-log [tail] <目录...> [选项]
  dsh-log export <目录...> [--json]

  子命令：
    tail（可省略）  看日志：按写入顺序渲染成人话，可筛选、可跟读
    export          交日志：产出一份**自包含**文本（目录摘要 + 原始行），
                    贴进工单、当附件都够；摘要里的 unknown 就是「没记下来」，不会拿你的环境顶替

  tail 的子命令名可以省略（dsh-log <目录...> 与 dsh-log tail <目录...> 等价）。

目录可以是「某个插件的日志目录」（里面是 YYYY-MM-DD.log），
也可以是「日志根目录」（里面是 logs-<pluginId>/），两种都认。

选项（tail）：
  -f, --follow          跟着看：先显示最后 N 行，然后等新行（默认 N=20）
  -n, --limit <N>       显示最后 N 行（默认 200；--follow 默认 20）
      --level <级别>    只显示该级别及以上（error | warn | info | debug）
      --since <时长>    只显示这个时间之后的（30s | 5m | 2h | 3d | ISO 时间）
      --trace <traceId> 只显示这一次请求链路（按 fields.traceId）
      --json            输出原始 JSON 行（给 jq/脚本用，不做渲染）
      --no-color        不颜色（默认只在终端里上色；NO_COLOR=1 同效）
  -h, --help            显示这段帮助
  -v, --version         显示版本号

选项（export）：
      --json            只输出摘要对象（每个目录一行，多个目录就是 NDJSON）；要行就用 tail --json
      （筛选类选项对 export 没有意义，传了会当场报错，不静默忽略）

例子：
  dsh-log tail ./logs-my-plugin -f
  dsh-log tail ./logs --since 1h --level error
  dsh-log tail ./logs --trace 80670256ab1237b7
  dsh-log tail ./logs --json | jq 'select(.level=="error") | .event'
  dsh-log export ./logs-my-plugin > ticket.txt
  dsh-log export ./logs-my-plugin --json | jq .rows

读法：一行一条，格式是
  <时间> <级别> <事件名> <message>  (其余字段 k=v)
其中 message 是写日志时放进 fields.message 的那句人话；没有它就只有事件名与字段。

只读承诺：本命令不写、不改、不删任何文件（包括不写缓存与状态）；要留档请用 shell 重定向。`

export function parseDuration(text: string, nowMs: number): number | null {
  const m = /^(\d+)([smhd])$/.exec(text)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    const factor = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000
    return n * factor
  }
  const at = Date.parse(text)
  if (!Number.isNaN(at)) return nowMs - at
  return null
}

/** argv → 选项。纯函数：同样的输入永远同样的输出（`nowMs` 只为 `--since` 的绝对时间换算）。 */
export function parseArgs(argv: readonly string[], nowMs: number = Date.now()): ParseArgsResult {
  const options: CliOptions = {
    command: 'tail',
    paths: [],
    follow: false,
    asJson: false,
    level: '',
    sinceMs: null,
    traceId: '',
    limit: 0,
    limitGiven: false,
    color: true,
    help: false,
    version: false
  }
  // 子命令只认一次（见下方 `tail` 分支）。
  let subcommandSeen = false
  const takeValue = (arg: string, key: string, index: number): { value: string; next: number } | { error: string } => {
    const eq = arg.indexOf('=')
    if (eq >= 0) return { value: arg.slice(eq + 1), next: index }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) return { error: `${key} 需要一个值` }
    return { value: next, next: index + 1 }
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') { options.help = true; continue }
    if (arg === '-v' || arg === '--version') { options.version = true; continue }
    if (arg === '-f' || arg === '--follow') { options.follow = true; continue }
    if (arg === '--json') { options.asJson = true; continue }
    if (arg === '--no-color') { options.color = false; continue }
    if (arg === '--level' || arg.startsWith('--level=')) {
      const got = takeValue(arg, '--level', i)
      if ('error' in got) return { options, error: got.error }
      if (!isKnownLevel(got.value)) {
        return { options, error: `--level 只认 ${LOG_LEVEL_ORDER.join(' | ')}，收到 ${got.value}` }
      }
      options.level = got.value
      i = got.next
      continue
    }
    if (arg === '--since' || arg.startsWith('--since=')) {
      const got = takeValue(arg, '--since', i)
      if ('error' in got) return { options, error: got.error }
      const ms = parseDuration(got.value, nowMs)
      if (ms === null || ms < 0) return { options, error: `--since 认 30s | 5m | 2h | 3d 或 ISO 时间，收到 ${got.value}` }
      options.sinceMs = ms
      i = got.next
      continue
    }
    if (arg === '--trace' || arg.startsWith('--trace=')) {
      const got = takeValue(arg, '--trace', i)
      if ('error' in got) return { options, error: got.error }
      options.traceId = got.value
      i = got.next
      continue
    }
    if (arg === '-n' || arg === '--limit' || arg.startsWith('--limit=')) {
      const got = takeValue(arg, '--limit', i)
      if ('error' in got) return { options, error: got.error }
      const n = Number(got.value)
      if (!Number.isInteger(n) || n <= 0) return { options, error: `--limit 需要正整数，收到 ${got.value}` }
      options.limit = n
      options.limitGiven = true
      i = got.next
      continue
    }
    if (arg.startsWith('-')) return { options, error: `不认识的选项 ${arg}` }
    // 子命令：帮助里就是这么写的，所以必须真认它——否则 `tail` 会被当成一个目录名，
    // 于是每次带子命令调用都白吐一行「没找到日志目录：tail」（2026-10-15 用户实测报的缺陷）。
    // 只认**第一个**位置参数上的那一个：`dsh-log tail tail` 里的第二个仍是目录名（可以叫 tail 的目录）。
    if ((arg === 'tail' || arg === 'export') && !subcommandSeen && options.paths.length === 0) {
      subcommandSeen = true
      options.command = arg
      continue
    }
    options.paths.push(arg)
  }
  // export 的语义是「原样交出去」：筛选选项对它没有意义。静默忽略比报错更坏——
  // 使用者会以为「筛过了」，实际交出去的还是全部（这也是本包一贯的「不假装」口径）。
  if (options.command === 'export') {
    const incompatible =
      options.follow ? '--follow' :
      options.level !== '' ? '--level' :
      options.sinceMs !== null ? '--since' :
      options.traceId !== '' ? '--trace' :
      options.limitGiven ? '--limit' : ''
    if (incompatible !== '') {
      return { options, error: `export 不支持 ${incompatible}（它的语义是原样交出整个目录；要筛选就用 tail）` }
    }
  }
  return { options, error: '' }
}
