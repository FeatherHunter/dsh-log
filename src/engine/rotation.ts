// src/engine/rotation.ts —— 轮转的 IO 叶子：目录清单、封存改名、audit 记账、按天保留清理。
//
// S4 第三块：从 store.ts 原样搬出，行为零变化。用工厂把依赖（config / fs / io / sealSeq）显式传进来，
// 四个函数体里的名字（config、fs、resolveTarget…）一个都不用改——搬迁零改写，风险最低。
// 三条硬约束由 core/retention.ts 的纯判据保证，这里只做 IO：
//   ① 封存必须原子（没有 rename 就不封存，绝不用「复制+截断」冒充）
//   ② 保留按天不按文件数，当日可写文件永不删
//   ③ 轮转自己的动作走 info 自监控行 + audit.json 逐次记账，不进 Q5 配额
import type { LogFileService } from '../platform/ports.js'
import type { ResolvedHostLogConfig } from '../config.js'
import { buildRowText } from '../core/row.js'
import { dayNumber, nextSealIndex, retentionCutoff, sealedNameOf, selectExpiredFiles } from '../core/retention.js'
import type { EngineIo } from './io.js'

// 审计文件名（与日志同目录）。
const AUDIT_FILE_NAME = 'audit.json'

export interface RotationInput {
  config: ResolvedHostLogConfig
  fs?: LogFileService | null
  io: EngineIo
  sealSeq: Map<string, number>
}

export interface Rotation {
  listLogNames: (logDir: string) => Promise<string[] | null>
  sealCurrentFile: (logDir: string, fileName: string, dayKey: string) => Promise<string | null>
  appendAudit: (logDir: string, record: Record<string, unknown>) => Promise<void>
  retainSweep: (logDir: string, fileName: string, dayKey: string) => Promise<string>
}

export function createRotation(input: RotationInput): Rotation {
  const config = input.config
  const fs = input.fs
  const sealSeq = input.sealSeq
  const joinLogPath = input.io.joinLogPath
  const resolveTarget = input.io.resolveTarget
  const readTarget = input.io.readTarget
  const writeTarget = input.io.writeTarget

  // 目录清单：拿不到（fs 没 listDir 或调用失败）返回 null＝能力缺失，调用方必须降级，不许猜。
  async function listLogNames(logDir: string): Promise<string[] | null> {
    if (!fs || typeof fs.listDir !== 'function') return null
    try {
      const raw = await fs.listDir(await resolveTarget(logDir))
      if (!Array.isArray(raw)) return null
      const names: string[] = []
      for (let i = 0; i < raw.length; i += 1) {
        const it = raw[i] as unknown
        if (typeof it === 'string') names.push(it)
        else if (it && typeof it === 'object') {
          const nm = (it as { name?: unknown }).name
          if (typeof nm === 'string') names.push(nm)
        }
      }
      return names
    } catch (e) {
      void e
      return null
    }
  }
  // 封存当日可写文件：rename 到 `<当日名>.<N>.log`，N 取目录里已有最大序号 + 1（跨实例也准）。
  // 返回封存后的名字；返回 null＝没有 rename 能力或改名失败（调用方降级为继续追加，不丢行）。
  async function sealCurrentFile(logDir: string, fileName: string, dayKey: string): Promise<string | null> {
    if (!fs || typeof fs.rename !== 'function') return null
    const names = (await listLogNames(logDir)) || []
    const idx = nextSealIndex(config, names, fileName, sealSeq.get(logDir + '|' + dayKey) || 0)
    const sealedName = sealedNameOf(fileName, idx)
    try {
      await fs.rename(
        await resolveTarget(await joinLogPath(logDir, fileName)),
        await resolveTarget(await joinLogPath(logDir, sealedName))
      )
      sealSeq.set(logDir + '|' + dayKey, idx)
      return sealedName
    } catch (e) {
      void e
      return null
    }
  }
  // audit.json：与日志同目录（同桶审计写入，不算共写），逐次追加一行；失败只当没记，绝不影响写盘结果。
  async function appendAudit(logDir: string, record: Record<string, unknown>): Promise<void> {
    if (!fs || typeof fs.writeText !== 'function') return
    try {
      let line = ''
      try {
        line = JSON.stringify(record) + '\n'
      } catch (eJson) {
        void eJson
        return
      }
      const target = await resolveTarget(await joinLogPath(logDir, AUDIT_FILE_NAME))
      let existing = ''
      try {
        existing = await readTarget(target)
      } catch (eRead) {
        void eRead
        existing = ''
      }
      await writeTarget(target, String(existing || '') + line)
    } catch (e) {
      void e
    }
  }
  // 保留清理：只清 `.log`，且只清早于「今天 − (maxDays − 1)」的日期；当日可写文件、开关文件、audit.json 永不删。
  // 返回 info 自监控行文本（没清到东西就是空串）。
  async function retainSweep(logDir: string, fileName: string, dayKey: string): Promise<string> {
    const names = await listLogNames(logDir)
    if (!names) return ''
    const today = dayNumber(dayKey)
    if (isNaN(today)) return ''
    const fsu = fs
    if (!fsu || typeof fsu.unlink !== 'function') return ''
    // 选行规则走 core/retention.ts 单源：按天保留、当日可写文件永不删、开关文件与 audit.json 不在候选里。
    const expired = selectExpiredFiles(config, names, fileName, retentionCutoff(today, config.maxDays))
    const removed: string[] = []
    for (let i = 0; i < expired.length; i += 1) {
      try {
        await fsu.unlink(await resolveTarget(await joinLogPath(logDir, expired[i])))
        removed.push(expired[i])
      } catch (e) {
        void e
      }
    }
    if (removed.length === 0) return ''
    await appendAudit(logDir, { ts: Date.now(), op: 'retain.evict', removed: removed, keptDays: config.maxDays })
    return buildRowText('info', 'log.retain.evict', { removed: removed.length, keptDays: config.maxDays })
  }

  return { listLogNames, sealCurrentFile, appendAudit, retainSweep }
}
