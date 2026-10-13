// src/engine/pipeline.ts —— 行流水线：准入（开关/折叠/配额）→ 队列 → 刷盘（批次/重试位/自监控/退避）。
//
// S4 第四块：从 store.ts 原样搬出，函数体逐字未改（脚本切片搬运，只有 isEnabled 里读开关那一行
// 改成读注入的回调）。这里是 0.3.0 三条硬不变量的所在地：
//   · error 永不丢 —— 三级准入歧视链（未满进 / 满且紧急先挤最旧普通行 / 普通行满才丢新）
//   · 杀进程前 await synced() 即不丢 —— 单飞刷盘 + 在途 promise + 收尾条件含 retryBuffer
//   · 写失败不丢行 —— 重试位 + 有界退避（RETRY_MAX_ATTEMPTS）+ 定位元 lastPersistFail
//
// 依赖全部显式注入；引擎不认识 store.ts，store.ts 只做接线与公开面组装：
//   getSwitchEnabled —— 开关状态住在组合根（引擎不拥有它）
//   isConflictLive   —— 目录冲突闸门住在组合根（租约登记在 engine/dir-lease.ts）
import type { LogFileService, LogTimer } from '../platform/ports.js'
import type { OnDropCallback, ResolvedHostLogConfig } from '../config.js'
import { LOG_DEBOUNCE_MS, formatDailyFileName, resolveLogFileName } from '../config.js'
import type { LogOutcome, WriteOutcome } from '../core/outcome.js'
import { LOG_FORMAT_VERSION, type LogEntry, type QueuedRow, buildRowText, utf8Bytes } from '../core/row.js'
import { findEvictableIndex, findTrimmableIndex } from '../core/admission.js'
import { isErrorLevel, isUrgentLevel } from '../core/level.js'
import { hash8 } from '../core/ids.js'
import { residentEventSet } from '../core/resident.js'
import { logFileDate } from '../core/file-name.js'
import { createLater } from '../platform/later.js'
import type { EngineIo } from './io.js'
import { splitForAppend } from './io.js'
import type { Rotation } from './rotation.js'

// 计时器回退只用运行环境自带的全局函数，不引入任何 Node 或浏览器专属类型（与 platform 同口径）。
declare function setTimeout(fn: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void

export interface PipelineInput {
  config: ResolvedHostLogConfig
  fs?: LogFileService | null
  io: EngineIo
  rotation: Rotation
  timer?: LogTimer | null
  getSwitchEnabled: () => boolean
  isConflictLive: () => boolean
  // 落盘路径与实例占用：由组合根拥有（占用登记与冲突闸门住在 store.ts / engine/dir-lease.ts）。
  // 引擎只问「现在能不能写、写到哪个文件、目录冲突时该说什么」，不自己判定归属。
  getCacheDir?: () => Promise<string | null | ''> | string | null | ''
  ensureLogDir: (logDir: string) => Promise<void>
  currentPid: () => number
  currentStartedAt: () => string
  acquireDirForWrite: (dir: string, op: string) => Promise<{ key: string; held: boolean } | null>
  beginWrite: () => void
  endWrite: (use: { key: string; held: boolean } | null) => void
  conflictMessage: () => string
}

export interface LogBatchReply {
  ok: boolean
  accepted: number
  skipped: number
  rejected: number
  dropped: number
}

export interface Pipeline {
  log: (level: string, event: string, fields: Record<string, unknown>) => LogOutcome
  isEnabled: (level: string, event?: string) => boolean
  flush: () => { ok: boolean }
  handleLogBatch: (args: { entries?: unknown; droppedCount?: unknown }) => Promise<LogBatchReply>
  notePersistFail: (op: string, reason: string, dir: string) => void
  flushNow: () => Promise<void>
  synced: () => Promise<void>
  beforeExit: () => void
  getDroppedCount: () => number
  getPendingCount: () => number
  getLastPersistFail: () => { op: string; reason: string; dirHash: string; at: number } | null
  setOnDrop: (cb: OnDropCallback | null) => void
}

export function createPipeline(input: PipelineInput): Pipeline {
  const config = input.config
  const fs = input.fs
  const timer = input.timer
  const joinLogPath = input.io.joinLogPath
  const resolveTarget = input.io.resolveTarget
  const readTarget = input.io.readTarget
  const writeTarget = input.io.writeTarget
  const canAppend = input.io.canAppend
  const appendTarget = input.io.appendTarget
  const sealCurrentFile = input.rotation.sealCurrentFile
  const appendAudit = input.rotation.appendAudit
  const retainSweep = input.rotation.retainSweep
  const getSwitchEnabled = input.getSwitchEnabled
  const conflictStillLive = input.isConflictLive
  const getCacheDir = input.getCacheDir
  const ensureLogDir = input.ensureLogDir
  const currentPid = input.currentPid
  const currentStartedAt = input.currentStartedAt
  const acquireDirForWrite = input.acquireDirForWrite
  const beginWrite = input.beginWrite
  const endWrite = input.endWrite
  const conflictMessage = input.conflictMessage

  // 同形 error 折叠（优化项，阈值：同一 event+fields散列在 1000ms 窗口内连击 ≥10 次时折叠为 1 行 error + fields.repeated=N）。
  // 只折 error 级（warn/info/debug 不折）；窗口内前 9 行正常入队，第 10 行到达时移除尾部连续同形行并代之以 1 行折叠行，
  // 后续同形只更新该折叠行的 repeated 计数不再新增行；窗口过期或异形即开启新一轮计数。直通仍经防抖异步，未落盘前可在队内完成折叠。
  const FOLD_WINDOW_MS = 1000
  const FOLD_THRESHOLD = 10
  function foldFieldsHash(fields: unknown): string {
    try {
      return hash8(JSON.stringify(fields && typeof fields === 'object' ? fields : {}))
    } catch (e) {
      void e
      return hash8(String(fields))
    }
  }

  // error/warn 越过配额入队的病态上限（× maxQueue）：常态下 error 永不丢，只有无界刷唯一字段的 error
  // 才会顶到这个天花板，到顶后挤最旧一行并调 onDrop 响一声——那是有 bug 的信号，不该静默涨内存。
  const ERR_QUEUE_CEILING = 10
    // 内存队列：调用处只进队列就返回，另起链路写盘。队列里是待写行对象。
    let queue: QueuedRow[] = []
    // 累计丢弃数：写盘失败与通道丢弃都只计数不抛错。
    let dropped = 0
    // #21 保留清理的「上次扫过的日期」：只在跨天后的第一次写盘扫一次，别每次写盘都列目录。
    let lastRetainDay = ''
    // Q5 onDrop 回调（store 级，默认隔离）：普通行满丢新时计数之外再调一次；error/warn 挤旧不调（探针断言只调一次）。
    // 只读实例级 storeOnDrop（#19 隔离：不读任何模块级全局）；回调抛错吞掉不影响记行。
    let storeOnDrop: OnDropCallback | null = null
    // onDrop 重入哨兵（一行布尔：回调内打日志不再递归调 onDrop，见 emitOnDrop）。
    let onDropReentering = false
    function setStoreOnDrop(cb: OnDropCallback | null): void {
      storeOnDrop = (typeof cb === 'function' ? cb : null) as OnDropCallback | null
    }
    function emitOnDrop(reason: string): void {
      if (onDropReentering) return
      let cb: OnDropCallback | null = null
      try {
        cb = storeOnDrop
      } catch (e) {
        void e
        cb = null
      }
      if (typeof cb !== 'function') return
      onDropReentering = true
      try {
        (cb as OnDropCallback)(dropped, reason)
      } catch (e2) {
        void e2
      } finally {
        onDropReentering = false
      }
    }
    let foldEvent: string | null = null
    let foldHash: string | null = null
    let foldStart = 0
    let foldCount = 0
    let foldRow: QueuedRow | null = null
    let foldFields: Record<string, unknown> | null = null
    // 丢弃计数只数用户行：自监控行是内部诊断，算进 dropped 会把「用户丢了几行」这个数报大
    // （#19 审查必改 R3：一行冲突被报成丢两行）。
    function userRowCount(rows: QueuedRow[]): number {
      let n = 0
      for (let i = 0; i < rows.length; i += 1) if (rows[i].selfMon !== true) n += 1
      return n
    }
    // 单写者状态：宿主一次只写一份，队列正忙时新写入合并等待。
    let flushTimer: unknown = null
    let flushing = false
    let flushQueued = false
    // 落盘失败行：失败先记待发，同轮合并；在途已有一行未落定不再追加，避免失败自我繁殖。
    let pendingPersistFail: { op: string; reason: string; dir: string } | null = null
    let persistFailOutstanding = false
    // 最近一次落盘失败的可查状态（#23 审查必改 R2）：写失败不再只是内部计数，调用方能直接问出来。
    let lastPersistFail: { op: string; reason: string; dirHash: string; at: number } | null = null
    // 写失败重试位（#23 审查必改 R2）：写盘失败（重试 1 次后仍失败）的那批行**不丢**，原样放回这里，
    // 退避后再试；磁盘恢复（空间腾出、权限修复）时 error 行因此仍能落盘。只有撑到内存上限
    // （maxQueue × ERR_QUEUE_CEILING）才丢最旧的普通行，而且那一次要响（计数 + onDrop）。
    // 目录冲突与取不到目录**不进这里**：那是本实例的常驻状态，重试也不会成功，按 #23 允许的例外计数丢弃。
    let retryBuffer: QueuedRow[] = []
    let retryScheduled = false
    // 连续写失败次数（写成功即清零）：只用来给自动重试封顶（RETRY_MAX_ATTEMPTS），不影响行本身。
    let retryAttempts = 0
    // 冲突期攒下的自监控行（只有一行，不进队列、不占配额、不计 dropped）：等闸门解除后的下一轮 flush 落盘，
    // 绝不因为「自己刚判了冲突」把这条诊断本身也丢掉（#19 审查必改 R3/R5）。
    let deferredSelfMon: QueuedRow | null = null
    // 跨进程可观测（2026-10-14 四维审查必改 4）：记住自己上次写完这份文件的字节数，下次读回来对不上，
    // 就说明这份文件被**别的写者**动过（另一个进程，或同进程里的另一份模块副本）。零额外 IO——这次读本来就要做。
    // 它只是「事后发现」：挡不住读改写窗口内的并发覆写，也猜不出被吃了几行，所以只留诊断、不谎报 dropped。
    let expectedFileName = ''
    let expectedFileBytes = -1
    // 追加能力的「首次信任」记录（2026-10-14 对抗审查补）：
    // 适配器可能**声明了 appendText 却什么都不做**——信任一个只会点头的适配器，就是当初假 rename
    // 吞掉 12500 行的同一类错。所以每份文件第一次走追加路时，独立读回来确认「这次追加的字节真的在文件里」；
    // 确认不了（长度没涨到期望）或追加直接抛错，就把这个实例的追加能力判死（appendUnusable），
    // 退回读改写并把这一批补写一遍——宁可丢优化，不许自欺。
    let appendVerifiedFileName = ''
    let appendUnusable = false
    function notePersistFail(op: string, reason: string, dir: string): void {
      if (!pendingPersistFail) pendingPersistFail = { op: op, reason: reason, dir: String(dir || '') }
      try {
        lastPersistFail = { op: op, reason: reason, dirHash: hash8(String(dir || '')), at: Date.now() }
      } catch (eL) {
        void eL
      }
      try {
        // 写失败**不许**在这里排「马上再冲一次」（#23 审查必改 R2 的后续）：冲刷循环内部每次失败都会
        // 走到这里，一排程就变成自续的写风暴（探针实测 10 次/秒、进程永远退不出去）。重试只由
        // scheduleRetry() 负责（有次数上限 + 退避 + unref）。这里只兜住不经过 flush 循环的失败
        // （开关文件写失败、判冲突），且要求当前既没有在途冲刷、也没有待重试。
        if (!flushing && !retryScheduled && retryAttempts === 0) scheduleFlush(false)
      } catch (e) {
        void e
      }
    }
    // 「稍后执行一次」的计时器适配在 platform/later.ts（平台层，引擎与组合根共用一份实现）。
    const later = createLater(timer)
    // 常驻事件（#731 一次性修好：信息级里标为常驻的那批，开关关着也落盘）。
    // 名单本体在 core/resident.ts（单源：包内固定 43 条 ∪ 调用方清单里 kind === 'resident' 的事件），
    // 与 client/write.ts 共用同一份——两份名单漂移过一次（#782 只补了附录与计数门禁，漏了写侧）。
    // 历史沿革与 43 条的出处见 core/resident.ts 的注释，别在这儿再抄一份。
    // 认清单的意义（2026-10-14 独立审查）：外部插件把自己的 info 标成 resident 就能落盘，
    // 不必为了几行轨迹去打开全局开关；DSH 侧行为不变（固定表仍是全集的子集）。
    const RESIDENT_EVENTS: ReadonlySet<string> = residentEventSet(config.eventList)
    // 读当前级别与事件名是否允许产生日志；关闭时调用处直接返回。错误与告警始终允许；
    // 信息级里落在常驻名单的也始终允许（#731 根因：从前只看级别，常驻信息全被开关拦掉）。
    // 第二个参数可选，老调用方只传级别时行为与从前一致，不会误放行。
    function isEnabled(level: string, event?: string): boolean {
      if (isUrgentLevel(level)) return true
      if (typeof event === 'string' && RESIDENT_EVENTS.has(event)) return true
      return getSwitchEnabled() === true
    }
    // 队列满时按级别丢弃（#558 队列口径 + #18 Q5）：error/warn 永不丢，新到的 error/warn 满时挤掉最旧普通行；
    // 普通行满时直接丢掉新来的并计数 + 调一次 onDrop；都只计数不抛错。
    // onDrop 只对应普通行丢新：error 挤旧（及全 error 队列挤最旧腾位）只计数不调 onDrop，探针断言普通丢新时恰调一次。
    // 入队放行（#18 Q5 三级歧视链，0.3.0 头号不变量是「error 永不丢」）：
    //   ① 未满：直接进。
    //   ② 满 + 新行是 error/warn：先挤一行最旧的普通行（计数，不调 onDrop）；**没有普通行可挤就继续进**
    //      ——越过配额硬塞，绝不因为「满」丢掉 error/warn。只有撑到病态上限 ERR_QUEUE_CEILING × maxQueue
    //      才挤最旧一行，而且这次要**响**（计数 + onDrop）：到那一步说明有 bug 在无界刷唯一字段的 error。
    //   ③ 满 + 新行是普通：丢新（计数 + onDrop），不入队。
    // 返回 true＝这一行可以入队（调用方负责 push），false＝已经按规则丢掉了。
    function admitRow(level: string): boolean {
      if (queue.length < config.maxQueue) return true
      const urgent = isUrgentLevel(level)
      if (!urgent) {
        dropped += 1
        emitOnDrop('queue-full')
        return false
      }
      const victim = findEvictableIndex(queue)
      if (victim >= 0) {
        queue.splice(victim, 1)
        dropped += 1
        return true
      }
      if (queue.length >= config.maxQueue * ERR_QUEUE_CEILING) {
        queue.splice(0, 1)
        dropped += 1
        emitOnDrop('queue-full')
      }
      return true
    }
    // 记一行日志：只进内存队列就返回，不等写盘完成。级别只有 error、warn、info、debug。
    // 常驻事件名要透给放行判断（#731：只传级别会把常驻信息误拦掉）。
    // 返回值＝这一行的去向（#23 审查必改 R1：记录电话要按它如实回包，不许把丢行报成接收）：
    //   'queued'  已进队列（含被同形 error 折叠吸收——那行由折叠行代表，不是丢）
    //   'skipped' 按开关/采样没进队列（预期行为，不算丢）
    //   'dropped' 队列满丢新（已计数 + onDrop）
    // 目录冲突不在这三种里：当场抛中文错点明出路（调用方 catch 计为拒收）。
    function log(level: string, event: string, fields: Record<string, unknown>): LogOutcome {
      if (!isEnabled(level, event)) return 'skipped'
      // 目录冲突（#19 隔离）：本实例的行绝不入队——绝不混进别人的共享文件；只计数，并当场抛中文错点明出路（绝不静默丢）。
      // 先自愈再判：持有者走了就不再拦（#19 审查必改 R2）；自愈时顺手催一次刷盘，好让冲突期攒下的
      // 自监控行（deferredSelfMon）落盘（#19 审查必改 R5）。
      if (conflictStillLive()) {
        dropped += 1
        throw new Error(conflictMessage())
      }
      if (deferredSelfMon) {
        try {
          scheduleFlush(false)
        } catch (e) {
          void e
        }
      }
      return enqueueRow(level, event, fields)
    }
    // 入队本体（不含冲突闸门）：自监控行 log.persist.fail 必须走这里——它记的就是「本实例刚被判冲突」，
    // 若也走 log() 会被自己刚设上的 dirConflict 抛掉（自监控行永远写不出来），而且那次抛错还会被
    // catch 吞掉、顺手把 dropped 多记一笔（#19 审查必改 3）。
    function enqueueRow(level: string, event: string, fields: Record<string, unknown>, selfMon?: boolean): LogOutcome {
      // 同形 error 折叠（阈值见上：1000ms 窗口内 ≥10 次同 event+fields散列连击折叠为 1 行 error repeated N）。
      if (isErrorLevel(level)) {
        const now = Date.now()
        const ev = String(event || '')
        const h = foldFieldsHash(fields)
        if (foldEvent === ev && foldHash === h && (now - foldStart) < FOLD_WINDOW_MS) {
          foldCount += 1
          if (foldCount >= FOLD_THRESHOLD) {
            if (foldCount === FOLD_THRESHOLD) {
              let removed = 0
              for (let i = queue.length - 1; i >= 0 && removed < (FOLD_THRESHOLD - 1); i--) {
                const r = queue[i]
                if (isErrorLevel(r.level) && r.event === ev && foldFieldsHash(r.fields) === h) {
                  queue.splice(i, 1)
                  removed += 1
                } else break
              }
              const base: Record<string, unknown> = foldFields && typeof foldFields === 'object' ? { ...(foldFields as Record<string, unknown>) } : {}
              base['repeated'] = foldCount
              foldRow = { ts: now, level: 'error', event: ev, fields: base }
              if (!admitRow('error')) return 'dropped'
              queue.push(foldRow)
              scheduleFlush(false)
              return 'queued'
            }
            if (foldRow) {
              try {
                (foldRow.fields as Record<string, unknown>)['repeated'] = foldCount
                foldRow.ts = now
              } catch (e) {
                void e
              }
            }
            return 'queued'
          }
        } else {
          foldEvent = ev
          foldHash = h
          foldStart = now
          foldCount = 1
          try {
            foldFields = fields && typeof fields === 'object' ? { ...(fields as Record<string, unknown>) } : {}
          } catch (e) {
            void e
            foldFields = {}
          }
          foldRow = null
        }
      } else {
        foldEvent = null
        foldHash = null
        foldStart = 0
        foldCount = 0
        foldRow = null
        foldFields = null
      }
      // 自监控行不占用户配额（它是内部诊断，丢了就没人知道出过事），也不计 dropped。
      if (!selfMon && !admitRow(level)) return 'dropped'
      queue.push({
        ts: Date.now(),
        level: level,
        event: String(event || ''),
        fields: fields && typeof fields === 'object' ? fields : {},
        selfMon: selfMon === true
      })
      if (isUrgentLevel(level)) scheduleFlush(true)
      else scheduleFlush(false)
      return 'queued'
    }
    // 安排一次刷盘：普通走 1000 毫秒防抖合并；错误与告警走直通（取消本次防抖等待，本轮事件循环末就写）。
    function scheduleFlush(immediate: boolean): void {
      if (immediate) {
        if (flushTimer !== null) {
          try {
            clearTimeout(flushTimer)
          } catch (e) {
            void e
          }
          flushTimer = null
        }
        later(flushNow, 0)
        return
      }
      if (flushTimer !== null) return
      flushTimer = later(flushNow, LOG_DEBOUNCE_MS)
    }
    // 仅宿主有效：取消本次防抖等待，本轮事件循环末写当天文件。
    function flush(): { ok: boolean } {
      if (flushTimer !== null) {
        try {
          clearTimeout(flushTimer)
        } catch (e) {
          void e
        }
        flushTimer = null
      }
      later(flushNow, 0)
      return { ok: true }
    }
    // 单写者刷盘：一次只写一份，写失败只计数不抛错；写盘中新到的行合并到下一轮。
    // 阻塞时等待不计丢（尽力而为）：flushing 为真时仅置 flushQueued 合并到下一轮，不计 dropped；
    // error 行封存同样：刷盘在途中新到的 error 行只进队列等待，不因“封存阻塞”计丢（尽力而为：同步 log() 无法真等待，
    // 只能保证不丢新到的 error/warn，见 dropForRoom；此处 flushQueued 即该等待的落实）。
    // ready 语义冻结（只改注释，不改行为）：ready=sink 已开 + 队列就绪，不保落盘。
    // ready 本体在 node.ts（基准行落定才算就绪），本文件的 flush/flushNow 只管“安排/执行一次刷盘”，调了不等于写完了。
    // 轮转说明：本文件无 rotate/archive/evict 逻辑也不新造（轮转主体在后续票）；自监控行中 rotate/archive/evict 类走 info，
    // 本文件现有的 log.persist.fail 为 persist 类自监控，级别保持 warn 不动。
    // 在途刷盘的 promise：flushNow 单飞，重复调用返回同一个，synced() 因此能等到**写盘真的收尾**。
    // 为什么必须有它：旧实现里 synced() 的 `await flushNow()` 撞上「已经在途的刷盘」会立刻返回（只置 flushQueued），
    // 而这时那批行早已被 splice 出队列、正卡在等租约/慢写里——于是「杀进程前 await synced() 即不丢」在慢写场景下不成立
    // （探针实测：synced() 119ms 就返回，写盘 246ms 才落地）。
    let flushInFlight: Promise<void> | null = null
    // 写失败退避（#23 审查必改 R2）：一次写失败后隔 RETRY_BACKOFF_MS 再试，避免死循环打满 CPU；
    // 期间新的 log()/flushNow()/synced() 都会自然带上重试位里的行，不必等定时器。
    const RETRY_BACKOFF_MS = 1000
    // 自动重试的次数上限（#23 审查必改 R2）：磁盘长期坏掉时不能靠定时器把自己永远吊着——那会让
    // 进程无法退出（定时器一直在事件循环里），也让「关掉应用」变成不可能。到顶后停止自动排程，
    // 行仍留在重试位，等下一次 log()/flushNow()/synced() 再试（那三条路径都会自然带上重试位）。
    const RETRY_MAX_ATTEMPTS = 5
    function scheduleRetry(): void {
      if (retryScheduled) return
      if (retryAttempts > RETRY_MAX_ATTEMPTS) return
      retryScheduled = true
      try {
        if (!timer || typeof timer.timeout !== 'function') {
          // 没有计时器（测试里的死计时器/未注入）：不排程，下一次 log()/flushNow()/synced() 自然重试。
          retryScheduled = false
          return
        }
        const handle = timer.timeout(() => {
          retryScheduled = false
          void flushNow()
        }, RETRY_BACKOFF_MS) as { unref?: () => void } | undefined
        // 退避重试的定时器**不许把进程钉在事件循环里**（#23 审查必改 R2）：应用该退就能退，
        // 没落盘的行仍在内存里，由 beforeExit()/下一次 flush 接手。宿主 timer 没有 unref 就照常。
        if (handle && typeof handle.unref === 'function') handle.unref()
      } catch (e) {
        void e
        retryScheduled = false
      }
    }
    // 重试位内存上限：与队列同一把尺子（maxQueue × ERR_QUEUE_CEILING）。上限管的是**还压在内存里的行总量**
    // （重试位 + 队列）——只盯重试位的话，队列自己还能再顶到同一个上限，最坏 2×。超限先丢最旧的**普通行**
    // （计数 + onDrop，响亮），error/warn 留到最后才丢——写失败不该变成 error 的静默坟场。
    function trimRetryBuffer(): void {
      const cap = config.maxQueue * ERR_QUEUE_CEILING
      while (retryBuffer.length > 0 && retryBuffer.length + queue.length > cap) {
        const first = findEvictableIndex(retryBuffer)
        const idx = first >= 0 ? first : 0
        const row = retryBuffer.splice(idx, 1)[0]
        if (row && row.selfMon !== true) {
          dropped += 1
          emitOnDrop('write-fail')
        }
      }
    }
    function flushNow(): Promise<void> {
      if (flushInFlight) {
        flushQueued = true
        return flushInFlight
      }
      const p = (async (): Promise<void> => {
        flushTimer = null
        flushing = true
        try {
        // 待办自监控行优先补写：闸门还关着就继续留着——绝不因为「冲突」把这条诊断本身也丢掉（R3/R5）。
        while (queue.length > 0 || retryBuffer.length > 0 || (deferredSelfMon !== null && !conflictStillLive())) {
          if (deferredSelfMon !== null && !conflictStillLive()) {
            queue.push(deferredSelfMon)
            deferredSelfMon = null
          }
          // 重试位里的行更旧：先写它们，写失败的那批不许插到新行后面（顺序即时间序）。
          const batch = retryBuffer.length > 0 ? retryBuffer.splice(0, retryBuffer.length) : queue.splice(0, queue.length)
          let outcome: WriteOutcome = 'ok'
          try {
            outcome = await writeBatch(batch)
          } catch (e) {
            void e
            outcome = 'retry'
          }
          if (outcome === 'ok') {
            persistFailOutstanding = false
            retryAttempts = 0
            continue
          }
          if (outcome === 'retry') {
            // 写盘失败（重试 1 次后仍失败）：这批行**不丢**——放回重试位，退避后再来（#23 审查必改 R2）。
            // 只有撑到内存上限才丢最旧的普通行，且那一次要响（计数 + onDrop）。
            retryBuffer = batch.concat(retryBuffer)
            trimRetryBuffer()
            retryAttempts += 1
            scheduleRetry()
            break
          }
          // 'dropped'（目录冲突 / 取不到目录）：writeBatch 内部已按用户行计数，继续下一轮（可能还有 deferredSelfMon）。
        }
      } finally {
        flushing = false
        if (pendingPersistFail) {
          const f = pendingPersistFail
          pendingPersistFail = null
          if (!persistFailOutstanding) {
            persistFailOutstanding = true
            try {
              // 自监控 log.persist.fail 只带 {pluginId?, op, reason, dirHash} 四键（store 无 pluginId 时不带，不补别的键）；
              // 级别保持 warn（rotate/archive/evict 类才走 info，persist 类不动）。
              let failFields: Record<string, unknown>
              try {
                const pid = (config as ResolvedHostLogConfig).pluginId
                if (typeof pid === 'string' && pid) {
                  failFields = { pluginId: pid, op: f.op, reason: f.reason, dirHash: hash8(f.dir) }
                } else {
                  failFields = { op: f.op, reason: f.reason, dirHash: hash8(f.dir) }
                }
              } catch (ePid) {
                void ePid
                failFields = { op: f.op, reason: f.reason, dirHash: hash8(f.dir) }
              }
              // 自监控行绕开冲突闸门入队（见 enqueueRow 注释）：冲突期它落不了盘（本实例不许写那个目录），
              // 但绝不能被自己的抛错吞掉——先进待办位，闸门解除后的下一轮 flush 再落盘（#19 审查必改 R3/R5）。
              if (isEnabled('warn', 'log.persist.fail')) {
                if (conflictStillLive()) {
                  deferredSelfMon = {
                    ts: Date.now(),
                    level: 'warn',
                    event: 'log.persist.fail',
                    fields: failFields,
                    selfMon: true
                  }
                } else {
                  enqueueRow('warn', 'log.persist.fail', failFields, true)
                }
              }
            } catch (e) {
              void e
            }
          }
          // 在途已有一行未落定不再追加：等待不计丢（尽力而为，避免失败自我繁殖；本轮丢弃的失败行不计 dropped）。
        }
        if (flushQueued) {
          flushQueued = false
          if (queue.length > 0) scheduleFlush(false)
        }
        }
      })()
      flushInFlight = p
      const settle = (): void => {
        if (flushInFlight === p) flushInFlight = null
      }
      p.then(settle, settle)
      return p
    }
    // 落盘确认 synced()（#18 运行时：刷完当期队列才 resolve，杀进程前调此即不丢；只等当期快照，新到行并入下轮亦等）。
    async function synced(): Promise<void> {
      try {
        if (flushTimer !== null) {
          try {
            clearTimeout(flushTimer)
          } catch (e) {
            void e
          }
          flushTimer = null
        }
      } catch (e) {
        void e
      }
      for (let i = 0; i < 50; i++) {
        // 收尾条件加上「没有在途刷盘」与「重试位为空」：队列空 ≠ 写完了，写失败的行也还在重试位里等着。
        // 再算上「冲突期攒下的诊断行」：闸门已经解除就必须把它带出去（否则 README 的「杀进程前调 synced() 即不丢」不成立）；
        // 闸门仍活时它合法滞留（别的活持有者还在，本实例写不了），此时由 lastPersistFail 与 getPendingCount() 对外可见。
        //
        // 关于「重试位为空」这一句（2026-10-14 终局审查 ②）：它是**防御性冗余**，不是可被测试区分的判据。
        // flushNow() 自己的循环条件就含 retryBuffer，且取批时优先取重试位；而只要写过一次失败，队列里必有一行
        // log.persist.fail 诊断行（flushNow 的 finally 入队）使 queue.length !== 0，于是外层循环无论如何都会再调一次
        // flushNow 把重试位带走。探针实证：把这一句从两处删掉，同一场景仍然 pending=0 且行如实落盘（行为逐项相同）。
        // 保留它的理由＝将来若有人改 flushNow 的取批顺序或循环条件，这里仍能独立守住「synced() 返回即已落盘」。
        const selfMonDue = deferredSelfMon !== null && !conflictStillLive()
        if (queue.length === 0 && retryBuffer.length === 0 && !selfMonDue && !flushing && !flushQueued && !pendingPersistFail && flushInFlight === null) break
        try {
          await flushNow()
        } catch (e) {
          void e
        }
        if (queue.length === 0 && retryBuffer.length === 0 && !selfMonDue && !flushing && !flushQueued && !pendingPersistFail && flushInFlight === null) break
        if (flushing || flushQueued || flushInFlight !== null) {
          try {
            await new Promise<void>((resolve) => {
              try {
                later(() => resolve(), 0)
              } catch (e) {
                void e
                resolve()
              }
            })
          } catch (e) {
            void e
          }
        }
      }
    }
    // 退出钩 beforeExit()（#18 运行时：注册退出钩调 synced，命名空间化挂 store 上，不污染全局；重复调用只注册一次）。
    let beforeExitRegistered = false
    function beforeExit(): void {
      if (beforeExitRegistered) return
      beforeExitRegistered = true
      try {
        const g = globalThis as { process?: { on?: unknown; once?: unknown } }
        const proc = g.process
        const hook = (): void => {
          try {
            void synced()
          } catch (e) {
            void e
          }
        }
        try {
          if (proc && typeof (proc as { once?: unknown }).once === 'function') {
            (proc as { once: (ev: string, fn: () => void) => void }).once('beforeExit', hook)
            return
          }
        } catch (e) {
          void e
        }
        try {
          if (proc && typeof (proc as { on?: unknown }).on === 'function') {
            (proc as { on: (ev: string, fn: () => void) => void }).on('beforeExit', hook)
          }
        } catch (e2) {
          void e2
        }
      } catch (e) {
        void e
      }
    }
    // 一批被拒（目录冲突/取不到目录）时，把批里的**自监控行**留到待办位：它记的是「本实例刚出过事」，
    // 跟着用户行一起丢就等于把唯一的诊断线索也丢了（#19 审查必改 R3/R5）。用户行照旧只计数不写盘。
    function deferSelfMonRows(batch: QueuedRow[]): void {
      if (deferredSelfMon !== null) return
      for (let i = 0; i < batch.length; i += 1) {
        if (batch[i].selfMon === true) {
          deferredSelfMon = batch[i]
          return
        }
      }
    }
    // 一次读改写：文件服务无追加原语，任何追加都是全文读改写，按天分文件把单次覆写体积封顶在一天之内。
    // 0.3.0 落盘行五键 {v,ts,level,event,fields}，v 取 config.ts 的 LOG_FORMAT_VERSION（现为 3，不兼容 0.2.x 无 v 行）。
    async function writeBatch(batch: QueuedRow[]): Promise<WriteOutcome> {
      if (!batch || batch.length === 0) return 'ok'
      const lines: string[] = []
      // 这批里用户行有几条：冲突/写失败时只按它计数，自监控行不算进 dropped（#19 审查必改 R3）。
      const userCount = userRowCount(batch)
      // 闸门必须在**这里**也看一次，不能只靠 log() 拦：队列里可能还留着闸门判下来之前排进去的行，
      // 那些行如果继续走写盘，就会出现「本实例已经宣布冲突、却还在往共享目录里写」——既有覆写风险，
      // 也让 dropped 计数说不清（探针 probe-mix：判冲突后 [user] 那批仍写成功）。用户行按丢弃计，
      // 自监控行留着补写（诊断行不是被丢的日志，不进 dropped）。
      if (conflictStillLive()) {
        dropped += userCount
        deferSelfMonRows(batch)
        return 'dropped'
      }
      for (let i = 0; i < batch.length; i++) {
        try {
          lines.push(
            JSON.stringify({
              v: LOG_FORMAT_VERSION,
              ts: batch[i].ts,
              level: batch[i].level,
              event: batch[i].event,
              fields: batch[i].fields
            })
          )
        } catch (e) {
          void e
          if (batch[i].selfMon !== true) dropped += 1
        }
      }
      if (lines.length === 0) return 'ok'
      const text = lines.join('\n') + '\n'
      let failDir = ''
      let dirUse: { key: string; held: boolean } | null = null
      // 在途写盘计数从**进入这条路径**就记：finally 里必然配一次 endWrite，任何早退（取不到目录、
      // 冲突、写失败）都不会把别的在途写盘的计数吃成 0，也就不会提前摘掉 release() 延后交还的常驻持有
      // （#19 审查必改：配对失衡会让下一个实例在别人的读改写中途接管，真丢更新）。
      beginWrite()
      try {
        const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null
        if (!dir) {
          dropped += userCount
          notePersistFail('writeBatch', 'no-dir', '')
          return 'dropped'
        }
        // 所有权判定的键是**日志目录**，不是 cacheDir：同一 cacheDir 下不同 pluginId 各写自己的
        // logs-<id>（这是隔离的正常形态，必须允许并存），会互相覆盖的只有同一日志目录本身。
        const logDir = await joinLogPath(dir, config.logDirName)
        failDir = logDir
        dirUse = await acquireDirForWrite(logDir, 'writeBatch')
        if (!dirUse) {
          dropped += userCount
          deferSelfMonRows(batch)
          return 'dropped'
        }
        await ensureLogDir(logDir)
        const now = new Date()
        const fileName = resolveLogFileName(config, now, currentPid(), currentStartedAt())
        const dayKey = logFileDate(config, fileName) || String(formatDailyFileName(now)).replace(/\.log$/, '')
        // 写盘两种形态（2026-10-14 补追加路）：
        //   · 有 appendText 能力 → 稳态只追加新增行，写量 O(新增)；文件尺寸靠自己记，首触与「要封存之前」各读一次。
        //   · 没有 → 读旧文 + 拼新行 + 全文覆写（无追加原语下的最小封顶单元）。
        // #21：写之前先判两件事——跨天了就顺手清过期（按天保留），这份当日文件要超阈值就先封存再写新文件。
        const doOnce = async (): Promise<void> => {
          const target = await resolveTarget(await joinLogPath(logDir, fileName))
          const appendable = !appendUnusable && (await canAppend())
          const sizeKnown = fileName === expectedFileName && expectedFileBytes >= 0
          let existing = ''
          let readOk = false
          let existingBytes = -1
          if (!appendable || !sizeKnown) {
            // 首触（或读改写模式）：读一次，既拿尺寸，也顺带查有没有别的写者。
            try {
              existing = await readTarget(target)
              readOk = true
            } catch (eRead) {
              void eRead
              existing = ''
            }
            existingBytes = readOk ? utf8Bytes(existing) : -1
          } else {
            // 追加模式的稳态：旧文不必读（我们不覆写它），尺寸用自己记的那个。
            existingBytes = expectedFileBytes
          }
          let extra = ''
          if (dayKey !== lastRetainDay) {
            lastRetainDay = dayKey
            extra += await retainSweep(logDir, fileName, dayKey)
          }
          // 跨进程可观测：读回来的长度与我们自己上次写完的长度对不上 → 有别的写者动过这份文件。
          // 读失败（readOk 为假）不算：那是读不出来，不是被人改过。
          if (readOk && fileName === expectedFileName && expectedFileBytes >= 0 && existingBytes !== expectedFileBytes) {
            notePersistFail('writeBatch', 'foreign-write', logDir)
          }
          const pendingBytes = utf8Bytes(text)
          if (appendable && !readOk && existingBytes > 0 && existingBytes + pendingBytes > config.maxSize) {
            // 封存是不可逆动作（改名），而追加模式下的尺寸是「自己记的」——别的写者若也追加过，记的就偏小。
            // 所以真封存之前确认一次实际长度；这次读同时把上面那条 foreign-write 判定补上。
            try {
              const confirmBytes = utf8Bytes(await readTarget(target))
              if (confirmBytes !== existingBytes) {
                notePersistFail('writeBatch', 'foreign-write', logDir)
                existingBytes = confirmBytes
              }
            } catch (eConfirm) {
              void eConfirm
            }
          }
          if (existingBytes > 0 && existingBytes + pendingBytes > config.maxSize) {
            const seal = await sealCurrentFile(logDir, fileName, dayKey)
            if (seal.ok) {
              const sealedName = seal.sealed
              const sealedBytes = existingBytes
              existing = ''
              existingBytes = 0
              await appendAudit(logDir, {
                ts: Date.now(),
                op: 'rotate.seal',
                file: fileName,
                sealed: sealedName,
                bytes: sealedBytes,
                maxSize: config.maxSize
              })
              extra += buildRowText('info', 'log.rotate.seal', {
                file: fileName,
                sealed: sealedName,
                bytes: sealedBytes,
                maxSize: config.maxSize
              })
            } else {
              // 没有 rename 能力、改名抛错、或改完回查不到目标名：降级为继续追加。
              // 宁可这份文件长过阈值，也不丢一行、更不用「复制+截断」冒充原子——那会在中途失败时真丢数据。
              // 降级本身记一行 info，reason 如实写是哪一种（no-rename / rename-threw / rename-not-effective）。
              extra += buildRowText('info', 'log.rotate.degraded', { file: fileName, reason: seal.reason })
            }
          } else if (existingBytes === 0 && pendingBytes > config.maxSize) {
            // 单批自己就超阈值（#23 审查必改 R3）：这次没有旧文可封存，整批原样写下去是唯一不丢行的选择，
            // 但绝不静默——记一行 info 自监控说明「这份文件开局就超了」，免得下次看到超阈值文件无从解释。
            extra += buildRowText('info', 'log.rotate.oversize', {
              file: fileName,
              bytes: pendingBytes,
              maxSize: config.maxSize
            })
          }
          if (appendable) {
            // 追加路：不覆写旧文，只把新增行接到末尾；尺寸自己累加（封存过就从 0 起算）。
            const appended = text + extra
            const expectedAfter = Math.max(existingBytes, 0) + utf8Bytes(appended)
            // 按行边界切成 ≤ APPEND_ATOMIC_MAX 的块再逐块追加：大块 O_APPEND 写不保证原子，
            // 两个进程各写一大段时会互相插进去、落成半行（实测 64KB 行会有坏行，4KB 行不会）。
            const pieces = splitForAppend(appended)
            try {
              for (const piece of pieces) await appendTarget(target, piece)
            } catch (eAppend) {
              void eAppend
              // 声明了追加却抛错：这条适配器这次不可信 → 判死追加能力，抛出去让 doOnce 的重试退回写路径。
              appendUnusable = true
              notePersistFail('writeBatch', 'append-failed', logDir)
              throw eAppend
            }
            if (appendVerifiedFileName === fileName) {
              expectedFileName = fileName
              expectedFileBytes = expectedAfter
            } else {
              // 每份文件的第一次追加：独立读回来确认这次追加真的进了文件。
              // 判据用「长度不小于期望」而不是「等于」——并发写者也追加时长度只会更大（O_APPEND 不覆写），
              // 用严格相等会把并发写者误判成「适配器撒谎」。
              let afterText = ''
              let afterBytes = -1
              try {
                afterText = await readTarget(target)
                afterBytes = utf8Bytes(afterText)
              } catch (eVerify) {
                void eVerify
                // 读不回来就不下结论（验证不了 ≠ 失败）：继续按自己记的尺寸走，至少不丢行。
              }
              if (afterBytes >= 0 && afterBytes < expectedAfter) {
                // 追加没生效（适配器什么都没写、写去了别处、或只写了一半）：这批行还在我们手里。
                // 判死追加能力并抛错 → doOnce 的重试退回读改写，把这批补写进去。绝不「自以为写了」。
                appendUnusable = true
                appendVerifiedFileName = ''
                notePersistFail('writeBatch', 'append-not-effective', logDir)
                throw new Error('append-not-effective')
              }
              appendVerifiedFileName = fileName
              expectedFileName = fileName
              // 用读回来的真实长度记账（可能含别人刚追加的字节），免得记账越漂越远。
              expectedFileBytes = afterBytes >= 0 ? afterBytes : expectedAfter
            }
          } else {
            const payload = String(existing || '') + text + extra
            await writeTarget(target, payload)
            // 记下我们写完的长度：下一次读回来若对不上，就是有别的写者动过（见上方 foreign-write 判定）。
            expectedFileName = fileName
            expectedFileBytes = utf8Bytes(payload)
          }
        }
        try {
          await doOnce()
        } catch (eFirst) {
          void eFirst
          // 写盘失败重试 1 次（仅重试一次，仍失败交给上层进重试位；no-dir/冲突不进这里，无需重试）。
          await doOnce()
        }
        return 'ok'
      } catch (eWrite) {
        void eWrite
        // 写盘失败（重试 1 次后仍失败）：**不在这里计 dropped**——这批行由 flushNow 放回重试位，
        // 磁盘恢复后仍能落盘（#23 审查必改 R2：写失败不等于丢行，error 尤其不许静默消失）。
        // 只记自监控行与可查状态；真丢只发生在重试位撑到内存上限时（那次计数 + onDrop）。
        notePersistFail('writeBatch', 'write-fail', failDir)
        return 'retry'
      } finally {
        // 写盘占位用完即还（常驻占位的还法在 release()）：还晚了会把别的实例卡成冲突。
        endWrite(dirUse)
      }
    }
    // 读累计丢弃数（写盘失败与通道丢弃都只计数不抛错）。
    function getDroppedCount(): number {
      return dropped
    }
    // 记录电话的宿主实现：入参 entries 加客户端累计丢弃数；回参接收条数加宿主侧累计丢弃数。
    // 回包必须如实（#23 审查必改 R1）：accepted 只数真进队列的，skipped 是「按开关/采样没进」（预期行为、不算丢），
    // 拒收（rejected）＝队列满丢新 + 目录冲突，只要有一行被拒就 ok:false。失败降级为丢弃并计数，不背压等待。
    // 注意 ok:true 的含义是「已进落盘路径」而不是「已落盘」：写盘失败时行进重试位（有界重试，磁盘恢复后补落盘），
    // 那一刻回包仍是 ok:true/accepted=N、dropped=0——要确认真的落盘请 `await store.synced()`（#19 复核记录）。
    async function handleLogBatch(args: {
      entries?: unknown
      droppedCount?: unknown
    }): Promise<{ ok: boolean; accepted: number; skipped: number; rejected: number; dropped: number }> {
      try {
        const entries = args && Array.isArray(args.entries) ? (args.entries as LogEntry[]) : []
        let accepted = 0
        let skipped = 0
        let rejected = 0
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i] || ({} as LogEntry)
          try {
            const outcome = log(item.level, item.event, item.fields)
            if (outcome === 'queued') accepted += 1
            else if (outcome === 'skipped') skipped += 1
            else rejected += 1
          } catch (e) {
            void e
            // 目录冲突：log() 里已计一次 dropped，这里只记拒收，不重复计数（#19 审查必改：一批丢行计两次）。
            rejected += 1
          }
        }
        // 回包说实话（#19 审查必改 R1 + #23 审查必改 R1）：宿主唯一真实写入通道就是这条。
        // 本批只要有一行没进队列（拒收）就回 ok:false；accepted 只数真进了的；dropped 仍是累计值。
        // 旧口径「无论丢多少都回 ok:true、accepted=entries.length」把「绝不静默丢」的承诺在回包上作废了。
        return { ok: rejected === 0, accepted: accepted, skipped: skipped, rejected: rejected, dropped: getDroppedCount() }
      } catch (e) {
        void e
        // 最外层异常：一行都没进，如实回 ok:false（旧口径在这里回 ok:true）。
        return { ok: false, accepted: 0, skipped: 0, rejected: 0, dropped: getDroppedCount() }
      }
    }

  // 下面两个读数是公开面：定义在这里而不是 return 字面量里（原实现是内联箭头函数）。
  function getLastPersistFail(): { op: string; reason: string; dirHash: string; at: number } | null {
    return lastPersistFail
  }
  function getPendingCount(): number {
    return queue.length + retryBuffer.length + (deferredSelfMon !== null ? 1 : 0)
  }

  return {
    log: log,
    isEnabled: isEnabled,
    flush: flush,
    handleLogBatch: handleLogBatch,
    notePersistFail: notePersistFail,
    flushNow: flushNow,
    synced: synced,
    beforeExit: beforeExit,
    getDroppedCount: getDroppedCount,
    getPendingCount: getPendingCount,
    getLastPersistFail: getLastPersistFail,
    setOnDrop: setStoreOnDrop,
  }
}
