// packages/dsh-log/src/store.ts —— 宿主日志库（由 src/host/logStore.js 移植，行为零变化）。
//
// 以后谁改它：改宿主落盘位置、按天分文件、防抖刷盘或开关持久化的人。导出/清空/开关三个电话体在 ./phones.js。
// 接线：由调用方建库并注册电话名；文件服务、计时器、取缓存目录函数、平台全部显式传入；
// 电话组经本文件静态引入（包内引用，不受 src/host 那条禁止静态引入的老规矩约束）。
// 它只做六件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数、目录占用（同目录只许一个活跃写者）。
// 防抖窗口 1000 毫秒（设计 2.2 字面：窗口内多次调用合并为一次读改写）。
//
// 与旧实现的两处有意差别（都是 #558 冻结清单要求的参数化，默认配置下字节级一致）：
// 1. 日志子目录名与开关文件名走配置默认派生（插件标识为 wf 时与旧字面一字不差）。
// 2. 内存队列默认 1000 条封顶，满时按级别丢弃、只计数不抛错（旧实现无上限）。
// 其余逻辑逐行对应旧实现，含失败语义的唯一例外：记录电话最外层 catch 回成功加接收 0 条。

import {
  LOG_DEBOUNCE_MS,
  LOG_FORMAT_VERSION,
  LEGACY_LOG_DIR_NAME,
  LEGACY_SWITCH_FILE_NAME,
  resolveHostLogConfig,
  resolveLogFileName,
  formatDailyFileName,
  parseLogFileName,
  listLogFiles,
  type HostLogConfigInput,
  type ResolvedHostLogConfig,
  type OnDropCallback
} from './config.js'
// S2 下沉（领域层，纯函数/纯类型）：指纹与短 id、结果判别联合、五键行文本与字节数。
import { hash8 } from './core/ids.js'
import { buildRowText, utf8Bytes } from './core/row.js'
import type { LogOutcome, WriteOutcome } from './core/outcome.js'
import { isErrorLevel, isUrgentLevel } from './core/level.js'
import { findEvictableIndex } from './core/admission.js'
import { dayNumber, nextSealIndex, retentionCutoff, sealedNameOf, selectExpiredFiles } from './core/retention.js'
import { logFileDate } from './core/file-name.js'
import { createLogPhones } from './phones.js'
import { createEngineIo } from './engine/io.js'
import { createRotation } from './engine/rotation.js'
import { createPipeline } from './engine/pipeline.js'
import { createSwitchFile } from './engine/switch-file.js'
import { createLater } from './platform/later.js'
import type { LogFileService, LogPlatform, LogPlatformFs, LogTimer } from './platform/ports.js'
export type { LogFileService, LogPlatform, LogPlatformFs, LogPlatformPath, LogTimer } from './platform/ports.js'
// 目录所有权登记与写盘租约（并发核心）已下沉 engine/dir-lease.ts（S4 第一块）。
import {
  DIR_LEASE_WAIT_MS,
  dirConflictMessage,
  dropDirHolder,
  dropPermanentHolder,
  normalizeLogDir,
  otherHolderKind,
  takeDirHolder,
  waitForDirFree
} from './engine/dir-lease.js'

export { LOG_DEBOUNCE_MS, LOG_FORMAT_VERSION, formatDailyFileName }
export type { OnDropCallback } from './config.js'
// 旧字面兼容导出（插件标识为 wf 时的目录名与开关文件名，现状门禁仍断言这两个字面）。
export const LOG_DIR_NAME = LEGACY_LOG_DIR_NAME
export const LOG_SWITCH_FILE = LEGACY_SWITCH_FILE_NAME
// 旧名兼容：旧模块叫 formatLogFileName，新包内叫 formatDailyFileName，行为相同。
export const formatLogFileName = formatDailyFileName

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

// 计时器回退只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（与 update-core 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

// 平台端口（文件服务 / 计时器 / 平台对象）的单源在 platform/ports.ts（S3）：
// 这里只做类型转出口，公开名与拆分前逐字相同。

export interface LogStoreDeps {
  fs?: LogFileService | null
  timer?: LogTimer | null
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  getPlatform?: () => Promise<LogPlatform | null> | LogPlatform | null
  DEFAULT_CWD?: string
  // 同步可知的落盘目录（#19 隔离，可选）：调用方在建库这一刻就知道目录时显式传入
  // （Node 入口的 cacheDir 就是这种），建库当场登记常驻占用，同目录已有活跃写者则立刻抛中文错。
  // 不传则退回「等 getCacheDir 解析出来、写任何一行之前再判定」的异步路径，行为不变。
  syncCacheDir?: string
}

// 记录电话入参里的一条：形状定义下沉 core/row.ts（S4），公开名在这里原样转出。
export type { LogEntry } from './core/row.js'

// 一行的去向与写盘结果三态已下沉 core/outcome.ts（S2）：它们表达的是「回包不许说谎」这条契约，
// 写侧与记录电话回包读同一处定义，免得两边各自漂移。下面这些注释保留原决策依据。

// #21 轮转：审计文件名（与日志同目录）与封存序号（按「目录|日期」记，跨实例也接着往下排）。
const sealSeq = new Map<string, number>()

// 0.3.0 落盘行只写 v=3（五键 {v,ts,level,event,fields}，v 取 LOG_FORMAT_VERSION）。
// 本文件不解析旧行、不抛错：v!=3 的跳过逻辑在读侧 T3，本文件只需保证自己只写 v=3。
// 旧行（0.2.x 无 v 键）读到时由读侧跳过，本文件写盘与队列路径永不因旧行抛错。

// Q5 队列满丢弃回调（#18 Q5）：普通行满丢新时计数之外再调一次，供 dev 首丢发声，prod 只计数。
// 接入方式冻结：不改 config 入参，只以 store 上的 setter 接入（store.setOnDrop），默认隔离。
// #19 隔离：emitOnDrop 只读实例级 storeOnDrop。模块级 setOnDrop 全局回调已在 0.3.0 #27 删除——
// 它 0.3.0 全程是空转（留着只会让调用方以为自己接上了回调，实际什么都不会发生）。

export function createLogStore(deps: LogStoreDeps, configInput?: HostLogConfigInput) {
  const input: LogStoreDeps = deps || {}
  const fs = input.fs
  const timer = input.timer
  const getCacheDir = input.getCacheDir
  const getPlatform = input.getPlatform
  const defaultCwd = input.DEFAULT_CWD || ''
  // 配置（#18 双必填：pluginId 与 prefix 均须显式传入，缺任一即抛中文错；旧回退已删，旧字面仅注释保留）。
  // 其余全走 #558 默认派生；清单注入参数（eventList）经 resolveHostLogConfig 验形（对象当场验、字符串存、默认 null 透过）。
  const config: ResolvedHostLogConfig = resolveHostLogConfig(
    configInput as HostLogConfigInput
  )
  // 等租约时用的「稍后执行一次」与引擎共用一份实现（platform/later.ts）。
  const later = createLater(timer)
  // IO 端口（路径拼接、目标解析、读/写）已下沉 engine/io.ts（S4 第二块）：组合根在这里接线。
  const io = createEngineIo({ fs: fs, getPlatform: getPlatform })
  const { joinPath, joinLogPath, resolveTarget, readTarget, writeTarget } = io
  // 轮转的 IO 叶子（目录清单/封存/审计/保留清理）已下沉 engine/rotation.ts（S4 第三块）：
  // 同样是组合根接线，保持同名局部引用，调用点一字不改。
  const rotation = createRotation({ config: config, fs: fs, io: io, sealSeq: sealSeq })
  const { listLogNames, sealCurrentFile, appendAudit, retainSweep } = rotation
  // 开关文件的读写下沉 engine/switch-file.ts（S4 第五块）：先建它——流水线的准入判定要读开关状态。
  // 它自己出错时要记的自监控行（读失败/写失败/撞占用）走流水线，所以用一次性转发绑定：
  // 两边都只在运行期被调用，先建谁都不会踩到未初始化。
  let noteFail: (op: string, reason: string, dir: string) => void = () => {}
  const switchFile = createSwitchFile({
    config: config,
    fs: fs,
    io: io,
    getCacheDir: getCacheDir,
    notePersistFail: (op: string, reason: string, dir: string) => noteFail(op, reason, dir),
    claimSwitchKey: claimSwitchKey,
    acquireSwitchWrite: (switchPath: string) =>
      acquireDirForWrite(switchPath, 'persistSwitch', { quiet: true }),
    beginWrite: beginWrite,
    endWrite: endWrite,
  })
  // 行流水线（准入/队列/刷盘/重试/自监控）已下沉 engine/pipeline.ts（S4 第四块）：
  // 这里接线；下面解构出同名局部引用，原调用点一字不改。
  const pipeline = createPipeline({
    config: config,
    fs: fs,
    io: io,
    rotation: rotation,
    timer: timer,
    getSwitchEnabled: () => switchFile.getState().enabled,
    isConflictLive: () => conflictStillLive(),
    getCacheDir: getCacheDir,
    ensureLogDir: ensureLogDir,
    currentPid: currentPid,
    currentStartedAt: currentStartedAt,
    acquireDirForWrite: acquireDirForWrite,
    beginWrite: beginWrite,
    endWrite: endWrite,
    conflictMessage: () => dirConflictMessage(dirConflict),
  })
  noteFail = pipeline.notePersistFail
  const { log, isEnabled, flush, handleLogBatch, notePersistFail, flushNow, synced, beforeExit } = pipeline
  const { getDroppedCount, getPendingCount, getLastPersistFail, setOnDrop } = pipeline
  // 同形 error 折叠（阈值 1000ms 内同形 ≥10 次折 1 行）已随行流水线下沉 engine/pipeline.ts（S4 第四块）：
  // 它是「准入」的一部分，与配额/丢弃计数同属一处，读同一份 core/level.ts 的级别语义。
  // 开关状态住在 engine/switch-file.ts（S4 第五块）：这里只留「认领开关文件键」的判定——
  // 占用登记与 release() 是本实例的归属，属于组合根。
  function claimSwitchKey(switchKey: string, failDir: string): boolean {
    if (!switchKey) return true
    if (ownedSwitchKey !== '') return true // 已持有（建库时占的同一个键，或目录漂移前占的旧键）
    if (otherHolderKind(switchKey, dirToken)) {
      // 冲突的是开关文件，不是本实例的日志目录：不设全局闸门，本实例照旧能记自己的日志。
      notePersistFail('persistSwitch', 'dir-conflict', failDir)
      return false
    }
    takeDirHolder(switchKey, dirToken, true)
    ownedSwitchKey = switchKey
    return true
  }
  // 目录占用（#19 隔离）：本实例的占位身份、常驻占位目录、已判定的冲突目录。
  // 判定冲突后 dirConflict 非空：本实例不写共享文件（记行当场抛中文错），直到 release()。
  const dirToken: object = {}
  let ownedDirKey = ''
  // 开关文件的常驻持有键（与日志目录分开）：两处真身可能不同，各自的锁各自管。
  let ownedSwitchKey = ''
  let dirConflict = ''
  // 冲突目录的归一化键：闸门自愈要拿它回查「那个持有者还在不在」（#19 审查必改 R2）。
  let dirConflictKey = ''
  // 在途写盘计数与「延后交还」：写盘进行中时 release() 不能把目录让出去（同步路径下常驻持有就是
  // 那把锁，摘早了下一个实例立刻建库并跟这次写并发读改写）。等这次写收尾再交还。
  let activeWrites = 0
  let releasePendingKeys: string[] = []
  // 判定冲突并记自监控行：这批行不入队（调用方负责把 dropped 加上），log.persist.fail 带 reason='dir-conflict'。
  function markDirConflict(dir: string, op: string): void {
    const d = String(dir || '')
    if (!dirConflict) {
      dirConflict = d
      dirConflictKey = normalizeLogDir(d)
    }
    try {
      notePersistFail(op, 'dir-conflict', d)
    } catch (e) {
      void e
    }
  }
  // 冲突闸门自愈（#19 审查必改 R2/R4）：闸门绑的是「判定冲突那一刻的那个持有者」，不是这个目录的永久属性。
  // 持有者已经交还（慢写租约到期、对方 release()）就当场解除——否则一次 300 毫秒的慢写会把本实例永久
  // 降级到 release()：目录明明空着，此后每一行还是抛「已有活跃写者」。持有者仍在（常驻持有＝对方还活着）
  // 则维持闸门。返回 true＝闸门仍然有效（本实例此刻不许写那个目录）。
  function conflictStillLive(): boolean {
    if (!dirConflict) return false
    if (!dirConflictKey) return true
    if (otherHolderKind(dirConflictKey, dirToken) !== '') return true
    dirConflict = ''
    dirConflictKey = ''
    return false
  }
  // 写盘前判定所有权：在写任何一行之前调用。返回 null＝判定冲突（调用方一行都不许写，冲突态与自监控行已记好）。
  // opts.quiet：撞占用时**不设实例级闸门**，只记自监控行。给「开关文件」这类整份覆盖写的目标用——
  // 冲突的是那个文件，不是本实例的日志目录，本实例照旧得能记自己的日志（#19 复核必改 2：宿主入口
  // 稳态持有开关键后再撞共享 switchFileName，旧实现会连自己的日志一起闸住、用户行计进 dropped 丢掉）。
  async function acquireDirForWrite(
    dir: string,
    op: string,
    opts?: { quiet?: boolean }
  ): Promise<{ key: string; held: boolean } | null> {
    const key = normalizeLogDir(dir)
    if (!key) return { key: '', held: false }
    if (key === ownedDirKey) return { key: key, held: false }
    // 租约重叠（另一个实例正好在写同一目录）不算冲突：等它交还，绝不并发读改写。
    // 事件驱动（交还时被唤醒）＋**整段预算内的重排队**：被唤醒后可能被同批等待者抢先，
    // 那就接着等剩下的预算，只有预算真的耗尽才判冲突——否则 ≥3 路争抢时输家会整批丢行
    // 并被毒化到 release()（#19 审查必改 2）。
    const deadline = Date.now() + DIR_LEASE_WAIT_MS
    let kind = otherHolderKind(key, dirToken)
    while (kind === 'lease') {
      const remain = deadline - Date.now()
      if (remain <= 0) break
      const free = await waitForDirFree(key, dirToken, remain, later)
      if (!free) break
      kind = otherHolderKind(key, dirToken)
    }
    if (kind) {
      if (opts && opts.quiet === true) {
        try {
          notePersistFail(op, 'dir-conflict', dir)
        } catch (e) {
          void e
        }
      } else {
        markDirConflict(dir, op)
      }
      return null
    }
    takeDirHolder(key, dirToken, false)
    return { key: key, held: true }
  }
  function releaseDirUse(use: { key: string; held: boolean } | null): void {
    if (!use || !use.held) return
    try {
      dropDirHolder(use.key, dirToken)
    } catch (e) {
      void e
    }
  }
  // 写盘开始/收尾：写盘期间目录必须一直被本实例占着，release() 遇到在途写盘要延后交还。
  function beginWrite(): void {
    activeWrites += 1
  }
  function endWrite(use: { key: string; held: boolean } | null): void {
    releaseDirUse(use)
    if (activeWrites > 0) activeWrites -= 1
    if (activeWrites === 0 && releasePendingKeys.length > 0) {
      const keys = releasePendingKeys
      releasePendingKeys = []
      for (let i = 0; i < keys.length; i++) {
        try {
          dropPermanentHolder(keys[i], dirToken)
        } catch (e) {
          void e
        }
      }
    }
  }
  // 释放本实例对该目录的占用（#19 隔离）：同步、幂等。释放后同一目录可由下一个实例接管并正常追加写。
  // 只交还占用，不停日志能力本身：释放后再记行会重新走占用判定（目录已被别人接管则照样判冲突）。
  // 只摘常驻那一份持有，且在途写盘未收尾时延后摘：否则下一个实例会在这次读改写中途接管并并发覆写。
  function release(): void {
    const key = ownedDirKey
    const switchKey = ownedSwitchKey
    ownedDirKey = ''
    ownedSwitchKey = ''
    // 这里**不**清 dirConflict（#19 审查必改 R4）：release() 交还的是本实例的持有；在冲突态下本实例
    // 根本没持有那个目录（dirUse 恒 null），清了闸门等于「什么都没交还却宣布自己有权写」——下一批照样
    // 撞冲突、写到一半丢行、再进冲突态。闸门由 conflictStillLive() 在持有者真的走了之后自行解除。
    // 开关文件的持有与日志目录可能不同路径，但它同样是**共享文件的读改写目标**（R8：共用
    // switchFileName 时后写者会静默盖掉前者），所以在途写盘期间同样延后交还。
    if (activeWrites > 0) {
      if (key) releasePendingKeys.push(key)
      if (switchKey) releasePendingKeys.push(switchKey)
    } else {
      try {
        dropPermanentHolder(key, dirToken)
      } catch (e) {
        void e
      }
      try {
        dropPermanentHolder(switchKey, dirToken)
      } catch (e2) {
        void e2
      }
    }
  }
  // 启动头信息：每次启动写入进程标识、启动时间与实际目录，事后能区分哪几行来自哪个进程。
  let headerInfo: { pid: number; startedAt: string; dir: string } | null = null
  // 进程身份在建库那一刻定下来，全生命周期复用。
  // 为什么必须固定：四段式文件名里带启动时间，而它原来取不到启动头就每次现算 `new Date()`——
  // 于是每次刷盘都算出一个新名字，四段式退化成「一次刷盘一个文件」：永远不封存、保留清理算不清，
  // 一个进程的日志被摊成几十个文件（.local/probe-four.mjs 实测：4 批刷盘出 4 个不同启动时间的文件）。
  const storePid = currentPid()
  const storeStartedAt = new Date().toISOString()
  function currentPid(): number {
    try {
      const g = globalThis as { process?: { pid?: unknown } }
      return (g.process && typeof g.process.pid === 'number' ? g.process.pid : 0) || 0
    } catch (e) {
      void e
      return 0
    }
  }
  function currentStartedAt(): string {
    return storeStartedAt
  }
  // IO 端口与轮转接线在文件上方（createPipeline 之前）：流水线要用它们，先接线再建流水线。
  async function ensureLogDir(logDir: string): Promise<void> {
    // 真正的建目录由写文件内部自动完成，这里建不上也不报错。
    try {
      const platform = typeof getPlatform === 'function' ? await getPlatform() : null
      if (platform && platform.fs && typeof platform.fs.mkdir === 'function') {
        try {
          await platform.fs.mkdir(logDir)
        } catch (e) {
          void e
        }
        return
      }
    } catch (e) {
      void e
    }
    try {
      if (fs !== undefined && fs !== null && typeof fs.mkdir === 'function') await fs.mkdir(logDir)
    } catch (e2) {
      void e2
    }
  }
  // ---- #21 轮转与保留（抄 daily-rotate-file 语义，不引包）----
  //
  // 三条硬约束：①封存必须原子（只有 rename 算原子，没有 rename 就不封存，绝不用「复制+截断」冒充）；
  // ②保留按**天**不按文件数（高频一天封存 N 份也不会误清最近的 error 文件）；③轮转自己的动作走 info
  // 自监控行 + audit.json 逐次记账，永不进 Q5 warn 配额，也不占内存队列的额度。

  // UTF-8 字节数（utf8Bytes）与五键行文本（buildRowText）已下沉 core/row.ts（S2）：
  // 轮转阈值判定与自监控行构造读同一处，写侧读侧不会再各自算一套。
  // 从文件名里取日期：走单源解析器（daily 与 four-segment 都带 YYYY-MM-DD，封存件也带）。
  // 不再各自写正则：读侧认不出封存件，就是「轮转后历史行整体消失」那个缺陷的根（config.ts parseLogFileName 注释）。
  // 取日期与天数换算已下沉 core/retention.ts（dayNumber）与 core/file-name.ts（logFileDate）。
  // 轮转的 IO 叶子（目录清单/封存/审计/保留清理）已下沉 engine/rotation.ts（S4 第三块）：
  // 接线在文件上方（createPipeline 之前），这里保持同名局部引用，调用点一字不改。

  // 开关文件的读写（loadSwitch/persistSwitch/setSwitch/getSwitchState）已下沉
  // engine/switch-file.ts（S4 第五块）：形状 {enabled}、旧文件多带的键忽略、占用键取开关文件本身。
  // 归属判定留在组合根：下面 claimSwitchKey 回答「能不能占这个键」，模块只管读写。
  // 启动头：每次启动在日志头写入进程标识、启动时间与实际目录；目录漂移时写实际目录头、不迁移旧日志。
  async function writeStartupHeader(): Promise<{ pid: number; startedAt: string; dir: string } | null> {
    try {
      const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
      const pid = currentPid()
      headerInfo = { pid: pid, startedAt: storeStartedAt, dir: (dir as string) || defaultCwd || '' }
      log('info', 'host.start', { pid: headerInfo.pid, startedAt: headerInfo.startedAt, dir: headerInfo.dir })
    } catch (e) {
      void e
    }
    return headerInfo
  }
  function getHeaderInfo(): { pid: number; startedAt: string; dir: string } | null {
    return headerInfo
  }
  // 电话组：导出/清空/开关三组电话体在 ./phones.js，此处只留调用（包内静态引入）。
  // 依赖全显式传入；新文件不引用本文件，单向引用。
  const phones = createLogPhones({
    fs: fs,
    getCacheDir: getCacheDir,
    getPlatform: getPlatform,
    DEFAULT_CWD: defaultCwd,
    config: config,
    joinPath: joinPath,
    joinLogPath: joinLogPath,
    resolveTarget: resolveTarget,
    readTarget: readTarget,
    writeTarget: writeTarget,
    log: log,
    getDirConflict: () => dirConflict,
    getSwitchState: switchFile.getState,
    getHeaderInfo: getHeaderInfo,
    loadSwitch: switchFile.load,
    setSwitch: switchFile.set
  })
  // 导出电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogExport(args: { date?: unknown; [key: string]: unknown }) {
    return phones.handleLogExport(args)
  }
  // 清空电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogClear(args: { date?: unknown }) {
    return phones.handleLogClear(args)
  }
  // 开关读电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogGetSwitch() {
    return phones.handleLogGetSwitch()
  }
  // 开关写电话（实现见 phones.js；电话字面与回参与拆前同形）。
  async function handleLogSetSwitch(args: { enabled?: unknown }) {
    return phones.handleLogSetSwitch(args)
  }
  // 只读查询电话（实现见 phones.js）：#20 接线——六参（timeRange/pluginId/level/keyword/traceId/page）、
  // 默认查自己近 24h 倒序第一页、无权返空集＋denied、游标绑 rotate-epoch（过期返 expired＋第一页）、
  // traceId 走独立 traceChain 通道不受 limit100 截断，全在 phones 里；此处只把实现挂上 store，
  // 好让宿主入口（host.registerHostLogPhones）能注册第 6 个电话名（本电话只读，不落盘、不触发轮转/清理）。
  async function handleLogQuery(args?: unknown) {
    return phones.handleLogQuery(args as Parameters<typeof phones.handleLogQuery>[0])
  }
  // 命名空间化挂 store 上：synced/beforeExit 仅经 store 返回对象可达，不污染全局；synced.beforeExit 与 store.beforeExit 同体。
  try {
    (synced as unknown as Record<string, unknown>)['beforeExit'] = beforeExit
  } catch (e) {
    void e
  }
  // 常驻持有登记（#19 隔离）放在最后：此前任何一步抛错都不会留下持有。
  // 键是日志目录（cacheDir 加目录名派生），不是 cacheDir 本身——本入口的 cacheDir 是实参、同步可知，
  // 于是「同一日志目录的第二个活跃写者」在建库这一刻就能 fail-fast；不同 pluginId 派生到不同目录，照常并存。
  const syncLogDir = input.syncCacheDir ? joinPath(String(input.syncCacheDir), config.logDirName) : ''
  const syncDirKey = normalizeLogDir(syncLogDir)
  // 开关文件单独占一份常驻持有：它的真身在 cacheDir 根下，可能与日志目录不是同一个键
  // （logDirName 与 switchFileName 可各自覆盖）。不单独占的话，两个实例可以各自覆盖 logDirName
  // 而共用同一个 switchFileName——两边都不抛，后写的把前一个的开关持久化静默盖掉（#19 审查必改 4）。
  const syncSwitchPath = input.syncCacheDir ? joinPath(String(input.syncCacheDir), config.switchFileName) : ''
  const syncSwitchKey = normalizeLogDir(syncSwitchPath)
  // 两份持有必须一起成功或一起失败：第二份撞车时若不把第一份还回去，建库抛错的这个目录会被
  // 永久毒化——调用方拿不到 store，也就没有 release() 句柄可交还，之后任何实例都建不起来。
  try {
    if (syncDirKey) {
      if (otherHolderKind(syncDirKey, dirToken)) {
        throw new Error(dirConflictMessage(syncLogDir))
      }
      takeDirHolder(syncDirKey, dirToken, true)
      ownedDirKey = syncDirKey
    }
    if (syncSwitchKey) {
      if (otherHolderKind(syncSwitchKey, dirToken)) {
        throw new Error(dirConflictMessage(syncSwitchPath, '开关文件'))
      }
      takeDirHolder(syncSwitchKey, dirToken, true)
      ownedSwitchKey = syncSwitchKey
    }
  } catch (e) {
    if (ownedDirKey) {
      dropPermanentHolder(ownedDirKey, dirToken)
      ownedDirKey = ''
    }
    if (ownedSwitchKey) {
      dropPermanentHolder(ownedSwitchKey, dirToken)
      ownedSwitchKey = ''
    }
    throw e
  }
  return {
    config: config,
    isEnabled: isEnabled,
    log: log,
    flush: flush,
    flushNow: flushNow,
    synced: synced,
    beforeExit: beforeExit,
    release: release,
    getDroppedCount: getDroppedCount,
    // 最近一次落盘失败（#23 审查必改 R2）：写失败不再是内部计数，调用方能直接问出来。
    // 形状 {op, reason, dirHash, at}；成功写盘不清它（它是「最近一次」而不是「当前是否失败」）。
    getLastPersistFail: getLastPersistFail,
    // 还压在手里的行数（队列 + 写失败重试位 + 待补写的自监控行）：写盘长期失败/冲突时它就是
    // 「还有几行没落盘」的答案。
    getPendingCount: getPendingCount,
    setOnDrop: setOnDrop,
    loadSwitch: switchFile.load,
    setSwitch: switchFile.set,
    getSwitchState: switchFile.getState,
    writeStartupHeader: writeStartupHeader,
    getHeaderInfo: getHeaderInfo,
    handleLogBatch: handleLogBatch,
    handleLogExport: handleLogExport,
    handleLogClear: handleLogClear,
    handleLogGetSwitch: handleLogGetSwitch,
    handleLogSetSwitch: handleLogSetSwitch,
    handleLogQuery: handleLogQuery
  }
}

export type LogStore = ReturnType<typeof createLogStore>
