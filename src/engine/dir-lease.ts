// src/engine/dir-lease.ts —— 目录所有权登记与写盘租约（并发核心集中一处）。
//
// S4 第一块：从 store.ts 原样搬出，行为零变化。它是**模块副本级**状态：每个模块副本一份登记表，
// 同进程里两份 dist 互相看不见，跨进程更是零保护（README 已如实写明这是风险提示而非保证）。
// 判定冲突之后 store 侧要做的动作（本批不入队、dropped 计数、抛中文错、记自监控行）留在 store.ts，
// 这里只回答一件事：此刻谁有权写这个目录。

// ---- 模块副本级目录占用登记（#19 隔离，P0）----
//
// 粒度假诚：登记表活在**这个模块副本**里（import 一次一份），不是进程级、更不是跨进程。同一个进程里
// 两份 dist（不同 query 后缀的 import）各有一张表，互相看不见；两个进程更是零保护。所以本仓的口径是
// 「同一目录不要多写者」，登记只是把「同进程同副本里两个活着的写者」挡在建库/写盘那一刻。
//
// 为什么要有它：两个活着的写者同时对同一文件做读-改-写，后写的整篇覆写会把先写的快照抹掉——不是丢一行，
// 是丢一整个快照。这里抓的是「两个活着的写者」，不是「第二次 new」：上一个实例结束（release()）之后，
// 下一个实例接管同一目录是合法形态（短命 CLI 连跑两次、换一个进程接着写），那时必须能正常追加。
//
// 两种持有，键都是规范化后的目录，值是该目录上的持有者与计数（同一实例可重入，计数归零即摘除）：
// 1. 常驻持有：目录在建立时同步可知（Node 入口的 cacheDir），登记后一直持有到 release()；被别人占着就当场抛。
// 2. 写盘租约：目录只能异步得知时（getCacheDir 是 Promise），在写任何一行之前登记、写完立即交还；
//    与他人短暂重叠按序等待，等不到（对方的常驻持有，或卡住的写者）才判冲突。
//
// 数据结构：Map<目录, Map<持有者令牌, 持有>>。令牌用对象身份（每次建库一个），嵌套 Map 让
// 登记与交还都是 O(1)，不必扫描持有者数组；等待者按目录挂一张唤醒表，租约交还时 O(1) 唤醒，
// 唤醒后各自重新判定（唤醒即抢，抢不到重新排队），既不轮询也不丢唤醒。
//
// 判定冲突之后（绝不静默、绝不写共享文件）：这批行不入队、dropped 计数、log.persist.fail 记
// reason='dir-conflict'（入队但不落盘——冲突期本实例不许写那个目录；冲突解除后随下一批落盘），
// 之后本实例每次记行都当场抛中文错点明出路，直到 release() 交还占用。
interface DirHolder {
  n: number
  permanent: boolean
}
const dirHolders = new Map<string, Map<object, DirHolder>>()
// 等待唤醒表：目录 → 正在等它空出来的等待者。租约交还时整表摘掉并逐个唤醒，
// 被唤醒者自行重新判定；抢不到就重新登记，所以不会丢唤醒，也不会有人被永久饿死。
const dirWaiters = new Map<string, Set<() => void>>()
// 写盘租约的等待预算：租约只跨一次刷盘（毫秒级），等这么久还等不到就按冲突处理（防卡死的写者拖住整条流水线）。
export const DIR_LEASE_WAIT_MS = 200

// 目录规范化：去空白、反斜杠归一、折叠重复斜杠与 `.` 段、`..` 出栈、去尾部斜杠；Windows 上不区分大小写。
// 同一目录的不同写法必须撞成同一个键：否则同一文件会被当成两个目录各自加锁，两个活跃写者并发读改写它，
// 后落盘的那次整篇快照会静默覆盖前一次（两侧丢弃计数都是 0，没有任何提示）。
export function normalizeLogDir(dir: unknown): string {
  let s = ''
  try {
    s = String(dir === undefined || dir === null ? '' : dir).trim()
  } catch (e) {
    void e
    return ''
  }
  if (!s) return ''
  s = s.replace(/\\/g, '/')
  const rooted = s.charAt(0) === '/'
  const segs: string[] = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      segs.pop()
      continue
    }
    segs.push(seg)
  }
  s = (rooted ? '/' : '') + segs.join('/')
  if (!s) s = rooted ? '/' : ''
  if (!s) return ''
  let win = false
  try {
    const g = globalThis as { process?: { platform?: unknown } }
    win = !!(g.process && g.process.platform === 'win32')
  } catch (e2) {
    void e2
  }
  return win ? s.toLowerCase() : s
}

// 冲突文案（冻结形状）：点明矛盾是什么、为什么危险、出路在哪。noun 用来区分被抢的是目录还是开关文件。
export function dirConflictMessage(dir: string, noun?: string): string {
  return (
    '[dsh-log] 该' + (noun || '目录') + '已有活跃写者：' + String(dir || '') +
    '；同一目录多实例会互相覆盖日志。若上一个实例已结束，请先 release() 再接管。'
  )
}

// 看这个目录上除自己以外的持有者：常驻持有可能永不交还（当场判冲突，不必等），
// 写盘租约总会交还（可以先等一等）。返回 '' 表示空着。
type OtherHolderKind = '' | 'lease' | 'permanent'
export function otherHolderKind(key: string, token: object): OtherHolderKind {
  const m = dirHolders.get(key)
  if (!m) return ''
  let lease = false
  for (const t of Array.from(m.keys())) {
    if (t === token) continue
    const h = m.get(t)
    if (!h || h.n <= 0) continue
    if (h.permanent) return 'permanent'
    lease = true
  }
  return lease ? 'lease' : ''
}
export function takeDirHolder(key: string, token: object, permanent: boolean): void {
  let m = dirHolders.get(key)
  if (!m) {
    m = new Map<object, DirHolder>()
    dirHolders.set(key, m)
  }
  const h = m.get(token)
  if (h) {
    h.n += 1
    if (permanent) h.permanent = true
    return
  }
  m.set(token, { n: 1, permanent: permanent })
}
// 目录空出来时唤醒等待者：**一次只唤醒队首一个**（Set 保持插入顺序＝FIFO），其余的等下一次交还再唤。
// 曾经是「整表摘下→广播」，多个等待者会在同一微任务里抢租约，抢输的那个把「同伴刚抢到」当成冲突：
// ≥3 路争抢同一目录时输家整批丢行并被毒化到 release()（#19 审查必改 2）。排队唤醒后不会有人被饿死。
function wakeDirWaiters(key: string): void {
  const set = dirWaiters.get(key)
  if (!set || set.size === 0) return
  let first: (() => void) | undefined
  for (const wake of set) {
    first = wake
    break
  }
  if (!first) return
  set.delete(first)
  if (set.size === 0) dirWaiters.delete(key)
  try {
    first()
  } catch (e) {
    void e
  }
}
// 目录是否还有别人持有（没有则顺手唤醒等待者）。
function settleDirIfIdle(key: string, m: Map<object, DirHolder> | undefined): void {
  if (m && m.size > 0) return
  dirHolders.delete(key)
  wakeDirWaiters(key)
}
export function dropDirHolder(key: string, token: object): void {
  const m = dirHolders.get(key)
  if (!m) return
  const h = m.get(token)
  if (!h) return
  h.n -= 1
  if (h.n <= 0) m.delete(token)
  settleDirIfIdle(key, m)
}
// 交还本实例在该目录上的常驻持有（release() 用）：只摘常驻那**一份**，**不动在途写盘租约**——
// 租约在写盘进行中，摘掉它等于把「正在读改写」的窗口敞开给下一个实例，会并发覆写。
// 所以这里是「减掉常驻那一份计数」，不是「整条记录删掉」：同一实例若还压着租约，计数留着给那次交还。
export function dropPermanentHolder(key: string, token: object): void {
  if (!key) return
  const m = dirHolders.get(key)
  if (!m) return
  const h = m.get(token)
  if (!h || !h.permanent) return
  h.permanent = false
  h.n -= 1
  if (h.n <= 0) m.delete(token)
  settleDirIfIdle(key, m)
}
// 等目录空出来：登记成等待者，租约交还时被唤醒后重新判定（不轮询）。
// 返回 true＝等到了（可能是登记前刚好空出来的，所以登记后立刻复核一次，杜绝丢唤醒）；
// 返回 false＝预算用尽，仍被持有（对方的常驻持有，或卡死的写者）。
export function waitForDirFree(
  key: string,
  token: object,
  budgetMs: number,
  later: (fn: () => void, ms: number) => unknown
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const detach = (): void => {
      const set = dirWaiters.get(key)
      if (!set) return
      set.delete(wake)
      if (set.size === 0) dirWaiters.delete(key)
    }
    const finish = (free: boolean): void => {
      if (settled) return
      settled = true
      detach()
      resolve(free)
    }
    const wake = (): void => {
      if (settled) return
      if (!otherHolderKind(key, token)) {
        finish(true)
        return
      }
      // 被别人抢了先：重新排队到队尾，等下一次唤醒（FIFO 唤醒＋有界预算，不丢唤醒、不饿死）。
      let set = dirWaiters.get(key)
      if (!set) {
        set = new Set<() => void>()
        dirWaiters.set(key, set)
      }
      set.add(wake)
    }
    let set = dirWaiters.get(key)
    if (!set) {
      set = new Set<() => void>()
      dirWaiters.set(key, set)
    }
    set.add(wake)
    try {
      later(() => finish(false), budgetMs)
    } catch (e) {
      void e
      finish(false)
    }
    if (!otherHolderKind(key, token)) finish(true)
  })
}
