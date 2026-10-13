// src/engine/switch-file.ts —— 开关文件的读写（引擎层：状态在内存，真身在 `log-switch-<id>.json`）。
//
// S4 第五块：从 store.ts 原样搬出，只有两处改成注入（见下）。为什么单列一个模块：
// 开关文件是**整份状态覆盖写**，它的三条规矩与日志行完全不同，混在组合根里最容易出事：
//   ① 形状只有 `{ enabled }`——0.3.0 删掉了从来没被读过的 sampleRate（死旋钮，留着就是骗人）；
//   ② 旧文件多带的键一律忽略，读得回来；
//   ③ 它自己就是被写的那个文件，占用的键必须取**它本身**：取日志目录键会漏保护——两个实例可以
//      各自覆盖 logDirName（键不同、都不抛）却共用同一个 switchFileName，后写者静默盖掉前者
//      （#19 审查必改 4 / R8：探针实测 a.enabled=true 之后被 b 写成 {"enabled":false}）。
//
// 归属判定不在这里：占用登记与 release() 住在组合根（engine/dir-lease.ts 是登记表，store.ts 是持有者），
// 所以「能不能占这个键」由注入的 claimSwitchKey 回答，本模块只管读写。
import type { LogFileService } from '../platform/ports.js'
import type { ResolvedHostLogConfig } from '../config.js'
import { normalizeLogDir } from './dir-lease.js'
import type { EngineIo } from './io.js'

export interface SwitchFileInput {
  config: ResolvedHostLogConfig
  fs?: LogFileService | null
  io: EngineIo
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  notePersistFail: (op: string, reason: string, dir: string) => void
  /**
   * 取开关文件的常驻持有。返回 true＝可以写（本次拿到，或本来就持有，或不需要持有）；
   * false＝别人持有同一个键，调用方按 dir-conflict 记一笔并放弃。
   * 注意：撞开关文件**不设全局闸门**——冲突的是开关文件，不是本实例的日志目录，本实例照旧能记自己的日志。
   */
  claimSwitchKey: (switchKey: string, failDir: string) => boolean
  /** 写开关文件用的租约（组合根传 acquireDirForWrite(path, 'persistSwitch', { quiet: true })）。 */
  acquireSwitchWrite: (switchPath: string) => Promise<{ key: string; held: boolean } | null>
  beginWrite: () => void
  endWrite: (use: { key: string; held: boolean } | null) => void
}

export interface SwitchFile {
  getState: () => { enabled: boolean }
  load: () => Promise<{ enabled: boolean }>
  persist: () => Promise<void>
  set: (enabled: boolean) => Promise<{ enabled: boolean }>
}

export function createSwitchFile(input: SwitchFileInput): SwitchFile {
  const config = input.config
  const getCacheDir = input.getCacheDir
  const notePersistFail = input.notePersistFail
  const claimSwitchKey = input.claimSwitchKey
  const acquireSwitchWrite = input.acquireSwitchWrite
  const beginWrite = input.beginWrite
  const endWrite = input.endWrite
  const joinLogPath = input.io.joinLogPath
  const resolveTarget = input.io.resolveTarget
  const readTarget = input.io.readTarget
  const writeTarget = input.io.writeTarget

  // 开关：全局整机一个开关，默认关闭；错误与告警始终落盘，其余只在开关打开时落盘。
  let switchEnabled = false
  let switchLoaded = false

  function getSwitchState(): { enabled: boolean } {
    return { enabled: switchEnabled }
  }
  // 开关从盘上读回：缓存目录下开关文件，全文覆写，失败不抛错。重启后保持，对账以宿主为准。
  // 文件形状是 { "enabled": boolean }：0.3.0 删掉了从来没被读过的 sampleRate（死参数，
  // 留着就是一条会骗人的旋钮；要采样就明确加通道，而不是塞一个不生效的字段）。
  // 旧文件多带的键一律忽略，读得回来。
  async function loadSwitch(): Promise<{ enabled: boolean }> {
    if (switchLoaded) return getSwitchState()
    switchLoaded = true
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) return getSwitchState()
      const target = await resolveTarget(await joinLogPath(dir, config.switchFileName))
      const txt = await readTarget(target)
      if (!txt) return getSwitchState()
      const parsed = JSON.parse(txt) as { enabled?: unknown }
      if (parsed && typeof parsed.enabled === 'boolean') switchEnabled = parsed.enabled
    } catch (e) {
      void e
      notePersistFail('readBack', 'read-fail', '')
    }
    return getSwitchState()
  }
  async function persistSwitch(): Promise<void> {
    let failDir = ''
    let dirUse: { key: string; held: boolean } | null = null
    beginWrite() // 与 finally 里的 endWrite 严格配对：早退路径也走 finally，不许失衡
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      if (!dir) {
        notePersistFail('persistSwitch', 'no-dir', '')
        return
      }
      failDir = String(dir || '')
      // 开关文件（log-switch-<id>.json）自己就是被写的那个文件，占用的键必须取它本身：
      // 取日志目录键会漏保护——两个实例可以各自覆盖 logDirName（键不同、都不抛）却共用同一个
      // switchFileName（真身是同一个文件），后写的把前一个的开关持久化静默盖掉（#19 审查必改 4）。
      const switchPath = await joinLogPath(dir, config.switchFileName)
      // 开关文件是「整份状态覆盖写」，不是追加型数据：本实例一开始持久化开关就常驻占住这个键。
      // 异步入口（宿主）建库时还不知道目录、拿不到常驻持有，若不在这里占位，两个实例会各自拿到租约、
      // 先后整份覆盖，后写者静默盖掉前者的开关（#19 审查必改 R8）。
      // 同步入口在建库时就占了同一个键，这里再判一次是幂等（claimSwitchKey 自己判）。
      const switchKey = normalizeLogDir(switchPath)
      if (!claimSwitchKey(switchKey, failDir)) return
      dirUse = await acquireSwitchWrite(switchPath)
      if (!dirUse) return
      const target = await resolveTarget(switchPath)
      await writeTarget(target, JSON.stringify({ enabled: switchEnabled }))
    } catch (e) {
      void e
      notePersistFail('persistSwitch', 'write-fail', failDir)
    } finally {
      endWrite(dirUse)
    }
  }
  async function setSwitch(enabled: boolean): Promise<{ enabled: boolean }> {
    switchEnabled = enabled === true
    await persistSwitch()
    return getSwitchState()
  }

  return { getState: getSwitchState, load: loadSwitch, persist: persistSwitch, set: setSwitch }
}
