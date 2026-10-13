import type { LogFileService } from './ports.js';
/**
 * 用 Node 标准库拼出日志包要的文件服务。
 *
 * 两个要点：写之前先建父目录（开关文件写在缓存根目录下，包不建它的父目录），
 * 以及不存在的文件读成空串而不是抛错（第一次运行时当天日志文件还不存在）。
 */
export declare function createNodeFileService(): LogFileService;
