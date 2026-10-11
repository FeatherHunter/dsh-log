<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-agg -->
<!-- parentKey: 01 -->
# 自查：日志聚合是否具备

## Question

按确认口径判定日志聚合是否具备：跨插件或跨进程集中收集与查询（相对现在只本地落盘+手动导出）。已知 README 明说不自动上报，需实锤。对标锚点：pino transport / electron-log remote（见 Decisions）。

输出：有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。

## 进度

- 2026-10-09 口径澄清（grilling R1，用户已答）：① client→宿主自动批量转发（`logBatch`，跨插件客户端半区/宿主半区边界）**算**「跨进程集中收集」的达成部分；② 「查询」必须有不靠人手翻文件的检索面才算，仅 `logExport` 回当天原文+目录/摘要不算；③ 判定单元以本包三入口（host/client/node）自身能力为准，平台或外部收集器只作旁证。⇒ headline 定为「部分具备」。
- 2026-10-09 Lead 独立初查 + 后台研究批次（只读）：`src/` 全量检索零网络/零远程/零 sink（唯一命中 `src/node.ts:16` 注释示例 `fetch`）；`src/host.ts:63-80` 电话注册走调用方传入的表（每插件一份）；`src/store.ts:477-497` 宿主收客户端批量并入本实例队列；`src/phones.ts:110-142/188-197` 导出只回一天单文件原文+摘要+目录/路径；多传 `format/level/pluginId/limit/query` 一律被忽略。
- 2026-10-09 实测复核（探针 `D:\Temp\probe-agg-06a`～`06e` + Lead 自建 `probe-agg-06-lead.mjs`，跑 `dist/`，只读）：两 pluginId 落点 `logs-alpha`/`logs-beta` 互不串；client→宿主 batch 转发行真进宿主文件（`guest.exec` 在 alpha 文件 true、beta false）；2/2/4 个独立进程各写各自 `logs-<标识>/<当天>.log`，无汇总文件；导出回参 8 键，无跨天/跨目录/跨插件检索；宿主/客户端方法全集无 query/search/merge/filter 成员。
- 2026-10-09 定稿：判定「部分具备」；严格读法（须有第三方可查的集中汇点）判「无」，两者差别只在「跨进程自动转发算不算集中收集」这一句，已原样保留在研究报告里。证据全文见 `research/06-log-aggregation-capability.md`。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

**整体判定：部分具备**（按 2026-10-09 用户确认口径）。

三块判据：跨进程收集＝**部分**（有一条真通道，出口是本插件私有目录）；跨插件集中＝**无**；查询＝**无**。

1. **跨进程收集：部分。** 唯一一条送出通道是 client→宿主的 `logBatch` 自动批量转发（`src/client.ts:478-479` → `src/store.ts:477-497`），实测把 `guest.exec` 送进了宿主文件（探针 C）；但它只在同一插件的两个半区之间，落点仍是该插件自己的宿主目录（`src/store.ts:385-403`）。与 electron-log 的 IPC transport 同型。
2. **跨插件集中：无。** 落点按 `pluginId` 天然分开（`src/config.ts:87-98`；实测 `logs-alpha`/`logs-beta` 交叉污染均 false）；电话注册表由调用方传入（`src/host.ts:55-80`），没有全局表；5 个电话动作冻结（`src/config.ts:26`），没有第六条通道。调用方显式共用同一目录也不成立：读—拼—写无锁覆写，同刻写互相吃掉（探针 B；与票 02 同源）。
3. **查询：无。** 唯一的读面 `logExport` 只读一天的一个文件（`src/phones.ts:110-142`），回 8 键 `ok/fileName/bytes/fallback/text/summary/dir/path`（`src/phones.ts:188-197`）；多传 `format/level/pluginId/limit/query` 被显式忽略、`text` 逐字不变；跨天/跨目录/跨插件检索与本仓 GUI/CLI 入口都不存在。
4. **README 那句实锤成立。** `README.md:34`「不自动上报日志，只做本地落盘加手动导出」无出入：全仓运行期零网络（`node:http|https|net|dgram|tls|undici` 零命中），没有任何定时器/钩子在无人调用时把行送出去。
5. **附带事实（易误读）**：`logBatch` 回参 `accepted` 恒等于入参数组长度（`src/store.ts:492`），**不代表落盘**——宿主开关关闭时发一条非常驻 `info` 仍回 `accepted:1`，而盘上零行、`dropped` 不涨。
6. **未定项**：Q5/Q6 口径一律标「待 Q5/Q6」，不猜；本票判定目前无本仓门禁守着（四套测试里「集中汇点/查询面/跨进程汇总」一条断言都没有）。严格读法对照（须有第三方可查的集中汇点 → 判「无」）与全部逐条引用见 [research/06-log-aggregation-capability.md](../research/06-log-aggregation-capability.md)。
