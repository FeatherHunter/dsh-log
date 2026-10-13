// packages/dsh-log/src/node.ts —— 日志包的 Node 程序入口（dsh-log/node）。
//
// 给谁用：不是 DSH 插件、自己独立跑的 Node 程序（例如一个技能自己的命令行）。
// 它只做一件事：把 Node 标准库的能力，抹平成日志包要的那几种依赖形状。
//
// 它不决定日志写到哪：目录由调用方通过 cacheDir 传入，本入口不读任何环境变量、
// 也不带任何默认路径。位置是调用方的事，本入口只负责把写文件这条路铺好。
//
// 与另外两个入口的关系：dsh-log/host 是 DSH 插件的入口（要传宿主的文件服务、要注册电话），
// dsh-log/client 是插件客户端侧入口。本入口不碰电话层，也没有客户端转发，
// 只有「把一行日志落到本地文件」与它背后的级别规则、目录派生、失败计数。
//
// 用法：
//   import { createNodeHostLog } from 'dsh-log/node'
//   const log = await createNodeHostLog(
//     { cacheDir: '/path/to/your/cache' },
//     { pluginId: 'my-plugin', prefix: 'my-plugin' }   // 双必填：缺任一建库即抛中文错
//   )
//   log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
//   const report = await log.ready   // 短命程序：刷完等这一下，进程退出前日志才真的落盘
//   if (!report.ok) console.error('日志没落定', report.pending, report.lastPersistFail)
//   log.store.release()  // 交还目录占用：同一目录的下一个实例才能接管

import { mkdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeFileService } from './platform/fs-node.js'
import { createNodeTimer } from './platform/timer-node.js'
export { createNodeFileService } from './platform/fs-node.js'
export { createNodeTimer } from './platform/timer-node.js'
import { createHostLog } from './host.js'
import type { HostLog } from './host.js'
import type { HostLogConfigInput, PhoneNameMap } from './config.js'
import type { LogFileService, LogStore, LogStoreDeps, LogTimer } from './store.js'

export type { HostLog } from './host.js'
export type { HostLogConfigInput, PhoneNameMap } from './config.js'
export type { LogFileService, LogStore, LogStoreDeps, LogTimer } from './store.js'

/** `ready` 的回执：刷到底之后，前面那些行到底落没落定。 */
export interface NodeReadyReport {
  /** true = 队列与重试位都空了，前面每一行都已经在文件里。 */
  ok: boolean
  /** 还压着没落定的行数（队列 + 重试位 + 待补写的自监控诊断行）；ok 为真时是 0。 */
  pending: number
  /** 最近一次写盘失败的定位元（op / reason / dirHash / at）；没失败过就是 null。 */
  lastPersistFail: { op: string; reason: string; dirHash: string; at: number } | null
}

export interface NodeCacheDirDeps {
  /** 日志与开关文件的落点，由调用方决定；本入口自己建这个目录，不读环境变量、不带默认值。 */
  cacheDir: string
  /** 覆盖文件服务（一般不用传；测试或特殊环境才传）。 */
  fs?: LogFileService
  /** 覆盖计时器（一般不用传；测试才传）。 */
  timer?: LogTimer
  /** 覆盖目录拼接方式（一般不用传；测试或特殊平台才传）。 */
  joinPath?: (...parts: string[]) => string
}

// Node 适配器已下沉 platform/（S3）：createNodeFileService 在 platform/fs-node.ts、
// createNodeTimer 在 platform/timer-node.ts；这里转出口，公开名与拆分前相同。

// 目录键归一用的 realpath：拿不到（目录还不存在、权限不足、平台不支持）就退回原字符串，
// 绝不让归一失败把建库挡下来——归一只影响「两个实例是否撞同一个键」，不影响真正写到哪。
function realCacheDir(dir: string): string {
  try {
    return realpathSync.native(dir)
  } catch (e) {
    void e
    return dir
  }
}

/**
 * 给独立 Node 程序用的日志库：一次调用得到可用的落盘日志。
 *
 * 双必填（#19 契约，已生效）：pluginId 与 prefix 均须显式传入，缺任一建库即抛中文错，
 * prefix 不再回退到 pluginId。
 * 同目录隔离（#19 P0，已生效）：同一目录同时只许一个活跃写者——第二个实例建库当场抛中文错，
 * 上一个实例 release() 之后才能接管同一目录（跨进程同目录不支持，隔离靠目录按 pluginId 派生）。
 *
 * 返回的对象里，store 是日志库本体（isEnabled / log / flush / getDroppedCount 等），
 * phoneNames 只是照标识派生出来的名字，本入口不注册电话、独立程序也用不着；
 * ready 是一个 Promise<NodeReadyReport>，等它等于等日志刷到底，并且如实告诉你落没落定。
 */
export async function createNodeHostLog(
  deps: NodeCacheDirDeps,
  configInput: HostLogConfigInput
): Promise<HostLog & { ready: Promise<NodeReadyReport> }> {
  if (!deps || typeof deps.cacheDir !== 'string' || deps.cacheDir === '') {
    throw new Error('[dsh-log] 建 Node 日志库必须给 cacheDir：日志写到哪由调用方决定，本入口不猜位置')
  }
  const cacheDir = deps.cacheDir
  const fs = deps.fs ?? createNodeFileService()
  const timer = deps.timer ?? createNodeTimer()
  const joinPath = deps.joinPath ?? ((...parts: string[]) => join(...parts))

  // 目录先建好：开关文件直接写在根目录下，包不建它的父目录。
  await mkdir(cacheDir, { recursive: true })

  const hostLog = createHostLog(
    // syncCacheDir：这里是目录唯一同步可知的入口（cacheDir 是实参），传进去让「同目录第二个活跃写者」
    // 在建库当场就抛中文错（#19 隔离，P0），赶在任何一行落盘之前判定；写完不释放的常驻占位由 release() 交还。
    // realpath 先归一：同一目录的不同写法（`base`、`base/.`、符号链接）必须撞同一个键，
    // 否则两个实例各拿一把锁去写同一个文件，后落盘的那次整篇快照会静默覆盖前一次。
    { fs, timer, getCacheDir: () => cacheDir, syncCacheDir: realCacheDir(cacheDir), DEFAULT_CWD: cacheDir },
    configInput
  )
  const store = hostLog.store

  // 把上次留下的开关读回来。
  //
  // 为什么要这一步：引擎自己不会在新建时读开关（插件那边由宿主在同一进程里一直持有开关状态），
  // 而独立程序每次调用都是新进程——不读回来，上一轮打开的详细日志这一轮就不生效。
  try {
    await store.loadSwitch()
  } catch (e) {
    void e
  }

  // 等队列真的落盘，并如实回报「落定没落定」。
  //
  // 为什么不是「调一次 flush 就完事」：刷盘是防抖加单写者，写盘正在进行时再叫一次会直接返回，
  // 所以「叫过了」不等于「写完了」。synced() 才是引擎里那条「刷到底」的路径
  // （队列空 + 无在途刷盘 + 重试位空 + 闸门解除后的诊断行补写）。这里直接用它。
  //
  // 0.3.0 修正（2026-10-14 独立审查必改 #2/#3）：从前这里往用户日志里写一行 debug 级
  // log.flush.marker 当路标，靠轮询它出现来判断「前面每一行都进了文件」。两个毛病：
  //   ① debug 在开关关着时是 skipped —— 基准行默认根本不落盘，实际靠 6 轮 flushNow + 10ms 蒙混；
  //   ② 写盘失败时照样 resolve —— 调用方以为落定了，磁盘上一行都没有。
  // 现在不再往用户文件里塞内部路标行（那行会污染用户当天文件的第一行），改为回报真实状态：
  // ok = 队列与重试位都空；没落定就 pending > 0、lastPersistFail 给出最近一次失败的定位元。
  const settle = async (): Promise<NodeReadyReport> => {
    try {
      await store.synced()
    } catch (e) {
      void e
    }
    const pending = typeof store.getPendingCount === 'function' ? store.getPendingCount() : 0
    const lastPersistFail = typeof store.getLastPersistFail === 'function' ? store.getLastPersistFail() : null
    return { ok: pending === 0, pending: pending, lastPersistFail: lastPersistFail }
  }

  // ready 是「读一次就刷一次」的只读属性，不是一个在建库时就结算好的 Promise。
  // 为什么：建库那刻算好的 Promise 只覆盖那一刻之前入队的行——之后 log() 的行不在它的等待范围里，
  // `await log.ready` 会立刻返回而磁盘上什么都没有（2026-10-14 探针实测：ok:true / pending:0 / 目录都还没建）。
  // 取属性才执行，语义就变成「把此刻为止的行刷到底，再回执」，短命程序在任何时间点 await 都对。
  return {
    store: hostLog.store,
    phoneNames: hostLog.phoneNames,
    get ready(): Promise<NodeReadyReport> {
      return settle()
    }
  }
}

/**
 * 默认快捷入口（#19 P0 门）：一行可用的落盘日志。
 *
 * 依赖预设照抄本文件 createNodeHostLog 的拼装形状：文件服务走 Node 标准库实现
 * （createNodeFileService）、计时器走全局定时函数（createNodeTimer）、目录拼接走
 * node:path 的 join；调用方只给 cacheDir（必填，无默认、不读环境变量），其余全默认。
 * pluginId 默认 'quick'（前缀默认等于插件标识，落点为 `<cacheDir>/logs-quick/`）。
 *
 * 用法（1 行可用）：
 *   const log = await createQuickLog('/path/to/your/cache')
 *   log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
 *   await log.ready
 */
export async function createQuickLog(
  cacheDir: string,
  pluginId = 'quick'
): Promise<HostLog & { ready: Promise<NodeReadyReport> }> {
  return createNodeHostLog({ cacheDir: cacheDir }, { pluginId: pluginId, prefix: pluginId })
}
