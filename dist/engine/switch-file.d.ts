import type { LogFileService } from '../platform/ports.js';
import type { ResolvedHostLogConfig } from '../config.js';
import type { EngineIo } from './io.js';
export interface SwitchFileInput {
    config: ResolvedHostLogConfig;
    fs?: LogFileService | null;
    io: EngineIo;
    getCacheDir?: () => Promise<string | null | ''> | string | null | '';
    notePersistFail: (op: string, reason: string, dir: string) => void;
    /**
     * 取开关文件的常驻持有。返回 true＝可以写（本次拿到，或本来就持有，或不需要持有）；
     * false＝别人持有同一个键，调用方按 dir-conflict 记一笔并放弃。
     * 注意：撞开关文件**不设全局闸门**——冲突的是开关文件，不是本实例的日志目录，本实例照旧能记自己的日志。
     */
    claimSwitchKey: (switchKey: string, failDir: string) => boolean;
    /** 写开关文件用的租约（组合根传 acquireDirForWrite(path, 'persistSwitch', { quiet: true })）。 */
    acquireSwitchWrite: (switchPath: string) => Promise<{
        key: string;
        held: boolean;
    } | null>;
    beginWrite: () => void;
    endWrite: (use: {
        key: string;
        held: boolean;
    } | null) => void;
}
export interface SwitchFile {
    getState: () => {
        enabled: boolean;
    };
    load: () => Promise<{
        enabled: boolean;
    }>;
    persist: () => Promise<void>;
    set: (enabled: boolean) => Promise<{
        enabled: boolean;
    }>;
}
export declare function createSwitchFile(input: SwitchFileInput): SwitchFile;
