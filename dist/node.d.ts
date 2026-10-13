export { createNodeFileService } from './platform/fs-node.js';
export { createNodeTimer } from './platform/timer-node.js';
import type { HostLog } from './host.js';
import type { HostLogConfigInput } from './config.js';
import type { LogFileService, LogTimer } from './store.js';
export type { HostLog } from './host.js';
export type { HostLogConfigInput, PhoneNameMap } from './config.js';
export type { LogFileService, LogStore, LogStoreDeps, LogTimer } from './store.js';
export interface NodeCacheDirDeps {
    /** 日志与开关文件的落点，由调用方决定；本入口自己建这个目录，不读环境变量、不带默认值。 */
    cacheDir: string;
    /** 覆盖文件服务（一般不用传；测试或特殊环境才传）。 */
    fs?: LogFileService;
    /** 覆盖计时器（一般不用传；测试才传）。 */
    timer?: LogTimer;
    /** 覆盖目录拼接方式（一般不用传；测试或特殊平台才传）。 */
    joinPath?: (...parts: string[]) => string;
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
 * ready 是一个 Promise，等它等于等日志真的进了当天文件。
 */
export declare function createNodeHostLog(deps: NodeCacheDirDeps, configInput: HostLogConfigInput): Promise<HostLog & {
    ready: Promise<void>;
}>;
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
export declare function createQuickLog(cacheDir: string, pluginId?: string): Promise<HostLog & {
    ready: Promise<void>;
}>;
