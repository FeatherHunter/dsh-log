export declare function findEvictableIndex(rows: readonly {
    level: string;
}[]): number;
export type ScanDirection = 'oldest-first' | 'newest-first';
export declare function findTrimmableIndex(rows: readonly {
    level: string;
}[], direction: ScanDirection): number;
