import type { LogTimer } from './ports.js';
/** 用 Node 的全局定时函数拼出日志包要的计时器形状。 */
export declare function createNodeTimer(): LogTimer;
