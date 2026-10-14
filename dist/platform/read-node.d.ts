export type PathKind = 'file' | 'dir' | 'missing';
/** 文件身份与大小：follow 模式靠 `ino` 认「还是不是同一个文件」（rename 后 ino 不变、path 变）。 */
export interface FileStat {
    size: number;
    ino: string;
    kind: PathKind;
}
export declare function pathKind(path: string): Promise<PathKind>;
export declare function statFile(path: string): Promise<FileStat | null>;
export declare function readTextFile(path: string): Promise<string | null>;
export declare function listDirNames(path: string): Promise<string[] | null>;
export declare function sleep(ms: number): Promise<void>;
/** 从某个模块 URL 往上找一份 package.json 的版本号（CLI 的 `--version` 用它，避免版本号写第二份）。 */
export declare function packageVersionNear(moduleUrl: string): Promise<string | null>;
