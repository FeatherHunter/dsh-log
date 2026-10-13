import type { ClientDebugSwitch, ClientStorage } from './types.js';
export interface SwitchCacheInput {
    storage: ClientStorage | null;
    debugKey: string;
    rev: number;
}
export interface SwitchCache {
    read: () => ClientDebugSwitch;
    persist: (state: ClientDebugSwitch) => boolean;
}
export declare function createSwitchCache(input: SwitchCacheInput): SwitchCache;
