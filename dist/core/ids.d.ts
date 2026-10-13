/**
 * 短指纹：djb2 → 8 位十六进制小写。
 *
 * 目录、字段、导出内容都只记它，不记原文（脱敏）。**不抛错**：调用方多在写盘/回包路径上，
 * 不能因为一次散列失败把整批行带下水；出错回 `'00000000'`（与旧实现同形，历史散列值不变）。
 */
export declare function hash8(value: unknown): string;
/**
 * 短 id：`len` 位十六进制（traceId 16 位、spanId 8 位）。
 *
 * 用 Math.random 而不是 crypto：宿主与浏览器闭包两边都要跑，本包不引入任何运行环境专属能力
 * （tsconfig 的 types 为空）。**它不是安全标识**——只用来把同一件事的多行串成一条链，
 * 不承担防伪职责；要防伪的场合调用方自己注入。
 */
export declare function genHex(len: number): string;
