// src/cli/tail.ts —— 读侧主体：认目录、按写入顺序读、筛选、渲染、跟读。
//
// 第一性原理：日志文件是**外部输入**（可能被别的东西改过、可能正写到一半、可能刚被改名），
// 所以这里的每一步都按「观察不到就跳过，绝不抛错」写；并且**永不写文件**——
// 一个用来「看」的工具一旦会写，就再也不能保证它不会改变被观察的系统（这是观察者的基本操守）。

import { formatRow, parseLogLine, type ParsedLogRow } from '../core/read-row.js'
import { LEVEL_SEVERITY } from '../core/level.js'
import {
  listLogFiles,
  logFileWriteOrder,
  type FileNameConfig,
  type LogFileInfo
} from '../core/file-name.js'
import {
  listDirNames,
  pathKind,
  readTextFile,
  sleep,
  statFile
} from '../platform/read-node.js'
import type { CliOptions } from './args.js'

export const DEFAULT_LIMIT = 200
export const DEFAULT_FOLLOW_LIMIT = 20
export const POLL_MS = 400

export interface LogDir {
  dir: string
  files: LogFileInfo[]
}

const DAILY: FileNameConfig = { fileNamePolicy: 'daily' }
const FOUR: FileNameConfig = { fileNamePolicy: 'four-segment' }

/** 一行一行的切分：末尾没有换行的碎片是**半行**（写者可能正写到一半），单独交回由调用方决定。 */
export function splitLogLines(text: string): { lines: string[]; partial: string } {
  const parts = text.split('\n')
  const partial = parts.pop() ?? ''
  return { lines: parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)), partial }
}

export function colorEnabled(options: CliOptions, isTty: boolean | undefined): boolean {
  if (options.asJson || !options.color) return false
  if (process.env.NO_COLOR) return false
  return isTty === true
}

export function matches(row: ParsedLogRow, options: CliOptions, nowMs: number): boolean {
  if (options.level) {
    // 级别未知的行在阈值过滤下**照常显示**：读侧宁可多显示，也不假装它不存在。
    const severity = LEVEL_SEVERITY[row.level]
    if (typeof severity === 'number' && severity > LEVEL_SEVERITY[options.level]) return false
  }
  if (options.sinceMs !== null && row.ts < nowMs - options.sinceMs) return false
  if (options.traceId && row.fields.traceId !== options.traceId) return false
  return true
}

/** 一行的输出文本：`--json` 给原始行（管道给 jq 用），否则给人话。 */
export function outputOf(line: string, options: CliOptions, useColor: boolean): string | null {
  if (options.asJson) return parseLogLine(line) === null ? null : line
  const row = parseLogLine(line)
  if (row === null) return null
  return formatRow(row, { color: useColor })
}

async function filesInDir(dir: string): Promise<LogFileInfo[]> {
  const names = await listDirNames(dir)
  if (names === null) return []
  // 两种命名策略都试：CLI 拿不到宿主配置，但文件名自己带得出答案（解析不通的自然落空）。
  const merged = listLogFiles(DAILY, names).concat(listLogFiles(FOUR, names))
  merged.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const ra = logFileWriteOrder(a)
    const rb = logFileWriteOrder(b)
    if (ra !== rb) return ra - rb
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return merged
}

// 认目录的**契约**（2026-10-15 与上游对齐时定下，写进文档前先写进这里）：
//   ① 给「日志目录」本身 → 直接用（里面有没有日志文件由 filesInDir 判）；
//   ② 给「日志根目录」→ 往下看**一层**子目录，挑出里面有日志文件的那些；
//   ③ 目录名**不要求**带 `logs-` 前缀——目录名是使用者的自由（`my-namespace/2026-10-15.log`
//      照样认得出来），发现逻辑只认「里面有没有日志文件」，不认名字像不像本包的派生形状；
//   ④ 两条都不成立才算「没找到」（调用方据此报错并退出码 1）。
// 回归线：tests/cli-tail.test.mjs 与 tests/cli-export.test.mjs 各有一条无前缀目录的用例钉着。
/** 认目录：给日志目录就用它；给根目录就往下看一层；再不行列为「没找到」。 */
export async function discoverLogDirs(paths: readonly string[]): Promise<{ dirs: LogDir[]; missing: string[] }> {
  const dirs: LogDir[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if ((await pathKind(path)) !== 'dir') { missing.push(path); continue }
    const direct = await filesInDir(path)
    if (direct.length > 0) {
      if (!seen.has(path)) { seen.add(path); dirs.push({ dir: path, files: direct }) }
      continue
    }
    const names = (await listDirNames(path)) ?? []
    let found = false
    for (const name of names) {
      const sub = `${path}/${name}`
      if ((await pathKind(sub)) !== 'dir') continue
      const files = await filesInDir(sub)
      if (files.length > 0 && !seen.has(sub)) { seen.add(sub); dirs.push({ dir: sub, files }); found = true }
    }
    if (!found) missing.push(path)
  }
  return { dirs, missing }
}

async function collectMatches(
  dirs: readonly LogDir[],
  options: CliOptions,
  nowMs: number,
  useColor: boolean
): Promise<string[]> {
  const out: string[] = []
  for (const entry of dirs) {
    for (const file of entry.files) {
      const text = await readTextFile(`${entry.dir}/${file.name}`)
      if (text === null) continue
      const { lines } = splitLogLines(text)
      for (const line of lines) {
        const row = parseLogLine(line)
        if (row === null || !matches(row, options, nowMs)) continue
        const rendered = outputOf(line, options, useColor)
        if (rendered !== null) out.push(rendered)
      }
    }
  }
  return out
}

/** 一次性显示：把命中的行按写入顺序拼起来，只显示**最后 N 行**（看日志的人要的是最近的事）。 */
export async function runOnce(dirs: readonly LogDir[], options: CliOptions, useColor: boolean): Promise<number> {
  const lines = await collectMatches(dirs, options, Date.now(), useColor)
  const limit = options.limitGiven ? options.limit : DEFAULT_LIMIT
  for (const line of lines.slice(Math.max(0, lines.length - limit))) process.stdout.write(line + '\n')
  return 0
}

/** 跟读：先显示最后 N 行，然后每 400ms 看一次有没有新内容。 */
export async function runFollow(
  paths: readonly string[],
  dirs: readonly LogDir[],
  options: CliOptions,
  useColor: boolean
): Promise<number> {
  const initial = await collectMatches(dirs, options, Date.now(), useColor)
  const limit = options.limitGiven ? options.limit : DEFAULT_FOLLOW_LIMIT
  for (const line of initial.slice(Math.max(0, initial.length - limit))) process.stdout.write(line + '\n')

  // 身份用 ino：封存是「改名」，ino 不变——于是同一份内容不会被当成新文件再显示一遍。
  const seen = new Map<string, { path: string; size: number; lines: number }>()
  for (const entry of dirs) {
    for (const file of entry.files) {
      const abs = `${entry.dir}/${file.name}`
      const st = await statFile(abs)
      if (st === null) continue
      const text = await readTextFile(abs)
      const count = text === null ? 0 : splitLogLines(text).lines.length
      seen.set(st.ino, { path: abs, size: st.size, lines: count })
    }
  }

  for (;;) {
    await sleep(POLL_MS)
    const fresh = await discoverLogDirs(paths)
    const now = Date.now()
    for (const entry of fresh.dirs) {
      for (const file of entry.files) {
        const abs = `${entry.dir}/${file.name}`
        const st = await statFile(abs)
        if (st === null) continue
        const prev = seen.get(st.ino)
        if (prev !== undefined && st.size === prev.size && prev.path === abs) continue
        const text = await readTextFile(abs)
        if (text === null) continue
        const { lines: all } = splitLogLines(text)
        // 首次见到的文件：显示它已有的内容（新开的一天/新轮转出的可写文件，里面的行确实是新的）。
        // 已见过的文件：从上次的行数往后显示；行数变少说明文件被换掉（同名重建），从 0 重来。
        const from = prev === undefined || all.length < prev.lines ? 0 : prev.lines
        for (let i = from; i < all.length; i += 1) {
          const line = all[i]
          const row = parseLogLine(line)
          if (row === null || !matches(row, options, now)) continue
          const rendered = outputOf(line, options, useColor)
          if (rendered !== null) process.stdout.write(rendered + '\n')
        }
        seen.set(st.ino, { path: abs, size: st.size, lines: all.length })
      }
    }
  }
}
