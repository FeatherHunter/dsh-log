import type { FileNamePolicy } from '../core/file-name.js';
export interface HostLogConfigInput {
    pluginId: string;
    prefix: string;
    pluginVersion?: string;
    logDirName?: string;
    switchFileName?: string;
    fileNamePolicy?: FileNamePolicy;
    maxQueue?: number;
    maxSize?: number;
    maxDays?: number;
    eventList?: string | Record<string, unknown>;
}
export interface ResolvedHostLogConfig {
    pluginId: string;
    prefix: string;
    pluginVersion: string;
    logDirName: string;
    switchFileName: string;
    fileNamePolicy: FileNamePolicy;
    maxQueue: number;
    maxSize: number;
    maxDays: number;
    eventList: string | Record<string, unknown> | null;
}
export interface ClientLogConfigInput {
    pluginId: string;
    prefix: string;
    eventList?: string | Record<string, unknown> | null;
}
export interface ResolvedClientLogConfig {
    pluginId: string;
    prefix: string;
    eventList: string | Record<string, unknown> | null;
}
export declare function resolveHostLogConfig(input: HostLogConfigInput): ResolvedHostLogConfig;
export declare function resolveClientLogConfig(input: ClientLogConfigInput): ResolvedClientLogConfig;
export type OnDropCallback = (dropped: number, reason: string) => void;
