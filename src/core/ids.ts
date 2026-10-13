// src/core/ids.ts —— 纯标识与指纹（领域层：零 IO、零平台、零全局状态）。
//
// 为什么下沉：同一套 djb2 短指纹原先在 store.ts（叫 hashText）、client.ts（叫 hash8）、
// phones.ts（也叫 hash8）各写一份。三份实现只要有一处漂移，同一条目录/同一批字段在两个入口算出的
// 散列就对不上——而散列正是「只记指纹、不记原文」的脱敏口径，对不上等于审计线断在中间。
// 单源一份，谁要谁 import。

/**
 * 短指纹：djb2 → 8 位十六进制小写。
 *
 * 目录、字段、导出内容都只记它，不记原文（脱敏）。**不抛错**：调用方多在写盘/回包路径上，
 * 不能因为一次散列失败把整批行带下水；出错回 `'00000000'`（与旧实现同形，历史散列值不变）。
 */
export function hash8(value: unknown): string {
  try {
    const t = String(value || '')
    let h = 5381
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0
    return ('0000000' + h.toString(16)).slice(-8)
  } catch (e) {
    void e
    return '00000000'
  }
}

/**
 * 短 id：`len` 位十六进制（traceId 16 位、spanId 8 位）。
 *
 * 用 Math.random 而不是 crypto：宿主与浏览器闭包两边都要跑，本包不引入任何运行环境专属能力
 * （tsconfig 的 types 为空）。**它不是安全标识**——只用来把同一件事的多行串成一条链，
 * 不承担防伪职责；要防伪的场合调用方自己注入。
 */
export function genHex(len: number): string {
  try {
    const digits = '0123456789abcdef'
    let out = ''
    for (let i = 0; i < len; i++) out += digits[Math.floor(Math.random() * 16)]
    return out || '0'.repeat(len)
  } catch (e) {
    void e
    return '0'.repeat(len > 0 ? len : 8)
  }
}
