import type { LogTimer } from './ports.js';
/** 造一个 `later(fn, ms)`：优先用注入的计时器（宿主可 unref），否则退回全局 setTimeout。 */
export declare function createLater(timer?: LogTimer | null): (fn: () => void, ms: number) => unknown;
