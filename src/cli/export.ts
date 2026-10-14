// src/cli/export.ts —— `dsh-log export`：把一个日志目录变成一份能交出去的自包含文本。
//
// 第一性原理：交接场景里，收日志的人既不该被要求「装这个包」，也不该被要求「按我们的目录结构
// 摆好文件」。所以输出必须**自包含**：一段人读的摘要（谁写的、哪一版、多少行、级别与事件分布、
// 开关状态）+ 原始行（一个字节都不改——别人要重新解析也有得解析）。
//
// 摘要里读不出来的格子写 unknown：**绝不用跑这条命令的进程的环境顶替**（research/18 §2.2 的缺陷本相）。
// 本命令仍然只读：要留档请用 shell 重定向（`dsh-log export ./logs > ticket.txt`），工具自己不写任何文件。

import { createLogDigest, formatLogDigest, type LogDigest } from '../core/log-digest.js'
import { readTextFile } from '../platform/read-node.js'
import { splitLogLines, type LogDir } from './tail.js'
import type { CliOptions } from './args.js'

/** 开关文件是日志目录的**兄弟**：`logs-<id>/` 旁边是 `log-switch-<id>.json`，`logs/` 旁边是 `log-switch.json`。 */
export function switchCandidates(dir: string): string[] {
  // 先去掉结尾的分隔符：`./logs-my-plugin/` 与 `./logs-my-plugin` 是同一个目录，
  // 不处理的话前者会被当成「名字是空的」，开关文件就永远认不出来（unknown 挂在那儿没人知道为什么）。
  const cleaned = dir.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  const base = parts[parts.length - 1] ?? ''
  const parent = parts.slice(0, -1).join('/')
  const prefix = parent === '' ? '' : parent + '/'
  if (base === 'logs') return [prefix + 'log-switch.json']
  if (base.startsWith('logs-')) return [prefix + 'log-switch-' + base.slice('logs-'.length) + '.json']
  // 目录名不是本包的派生形状：不去猜，摘要里如实写 unknown。
  return []
}

export interface LogExport {
  digest: LogDigest
  /** 原始行（原样，按写入顺序：先旧文件后新文件）。 */
  rows: string[]
}

/** 把一个日志目录收成「摘要 + 原始行」；读不到的文件按 0 行记，绝不抛错。 */
export async function collectExport(entry: LogDir): Promise<LogExport> {
  const accumulator = createLogDigest(entry.dir)
  const rows: string[] = []
  for (const file of entry.files) {
    const text = await readTextFile(entry.dir + '/' + file.name)
    if (text === null) {
      accumulator.addFile(file.name, '')
      continue
    }
    accumulator.addFile(file.name, text)
    const { lines } = splitLogLines(text)
    for (const line of lines) if (line.trim() !== '') rows.push(line)
  }
  let switchText: string | null = null
  for (const candidate of switchCandidates(entry.dir)) {
    const text = await readTextFile(candidate)
    if (text !== null) {
      switchText = text
      break
    }
  }
  accumulator.setSwitch(switchText)
  return { digest: accumulator.finish(), rows: rows }
}

/**
 * 交日志：默认输出「摘要 + 原始行」（贴工单、当附件都够）；
 * `--json` 只输出摘要对象——**每个目录一行**（一个目录就是一行，多个目录就是 NDJSON），
 * 给脚本用；要行就用 `tail --json`。
 */
export async function runExport(dirs: readonly LogDir[], options: CliOptions): Promise<number> {
  const parts: string[] = []
  for (const entry of dirs) {
    const collected = await collectExport(entry)
    if (options.asJson) {
      parts.push(JSON.stringify(collected.digest))
      continue
    }
    parts.push(formatLogDigest(collected.digest))
    parts.push('--- 以下是原始行（原样，未渲染） ---')
    for (const row of collected.rows) parts.push(row)
  }
  if (parts.length > 0) process.stdout.write(parts.join('\n') + '\n')
  return 0
}
