import type { PhoneNameMap } from '../config.js';
import type { SwitchCache } from './switch-cache.js';
import type { ClientBroadcast, ClientDebugSwitch, ClientHost, ClientSetSwitchResult, ClientSwitchResult, ClientTimer } from './types.js';
export interface SwitchOpsInput {
    host: ClientHost | null;
    phoneNames: PhoneNameMap;
    timer: ClientTimer | null;
    watchdogMs: number;
    /** 开关内存值（本对象被就地更新，调用方看得到）。 */
    state: ClientDebugSwitch;
    /** 写开关代际：调用 hang 住时超时放行，迟到回包按代际丢弃。 */
    gen: {
        n: number;
    };
    cache: SwitchCache;
    broadcast: ClientBroadcast | null;
    log: (level: string, event: string, fields: Record<string, unknown>) => void;
    watch: (op: string, pending: unknown) => void;
}
export interface SwitchOps {
    reconcile: () => Promise<ClientSwitchResult>;
    set: (enabled: boolean) => Promise<ClientSetSwitchResult>;
}
export declare function createSwitchOps(input: SwitchOpsInput): SwitchOps;
