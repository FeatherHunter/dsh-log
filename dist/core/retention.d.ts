import { type FileNameConfig } from './file-name.js';
export declare function dayNumber(dateStr: string): number;
export declare function retentionCutoff(todayDay: number, maxDays: number): number;
export declare function selectExpiredFiles(config: FileNameConfig, names: readonly string[], currentFileName: string, cutoffDay: number): string[];
export declare function nextSealIndex(config: FileNameConfig, names: readonly string[], fileName: string, localSeq: number): number;
export declare function sealedNameOf(fileName: string, index: number): string;
