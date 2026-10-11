<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-trace -->
<!-- parentKey: 01 -->
# 自查：链路追踪是否具备

## Question

按确认口径判定链路追踪是否具备：一个请求跨宿主/客户端/插件的端到端串联。已知 trace/span 零命中，需实锤。对标锚点：roarr adopt+sequence（见 Decisions）。

输出：有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。

## 进度

- 2026-10-09 认领（Lead）：口径已由地图 Round1 确认为「一个请求跨宿主/客户端/插件的端到端串联」；锚点=roarr adopt+sequence（GitHub #10 已结）。本票不含方案选型。
- 2026-10-09 已派后台研究 agent 取证：全包检索 + 字段透传/跨边界载体核查 + D:\Temp 只读探针 + roarr 一手来源对照；产物落在 research/07-trace-capability.md。
- 2026-10-09 研究产出落定：`research/07-trace-capability.md`（后台研究分支写成；只读探针全在 `D:\Temp`，未改仓库源码/测试/文档，未 commit）。
- 2026-10-09 收口复核（Lead，独立重跑）：①真电话通道字段透传；②客户端条目的 `ts` 被丢弃、改用宿主接收时刻重打；③200 条连发无序号、`ts` 去重数 1；④两处包外定点旁证——抽包前旧实现两模块（`dsh-main-check` 的 `logStore.js`/`log.js`）零命中（不是抽包丢失），消费方日志调用粗筛唯一一条带会话散列（`src/probe-stale.js:60` 的 `sessionIdHash`，单点、debug、非请求级）。
- 2026-10-09 判定定版：按票面字面与姊妹票 09 同标准（「包内自己产生或自己保证」才算具备）判**无**；材料层事实（调用方自造字段全链透传）单列，另一种读法如实列出但不采纳。研究分支原判「部分具备（材料在、机制无）」，收口时改判并在报告「收口说明」里写明理由与差异。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments


## Answer

**整体判定：无。** 一句话：包内不存在任何把一次请求在宿主/客户端/插件之间串起来的机制（不生成 id、不继承上下文、不打序号、跨边界载荷不带关联字段）；唯一成立的是**材料层**——调用方自造字段原样透传，「手工串」今天能做，但那靠调用方在两侧各写一次同一个值，不是日志系统的能力。全部证据、探针与一手来源见 `research/07-trace-capability.md`。

**1. 三段判据逐条**（尺度与姊妹票 09 同标准：「包内自己产生或自己保证」才算具备）

| 判据 | 判定 | 依据 |
|---|---|---|
| 有：生成/传播请求级串联标识的机制、且跨边界可用 | **无** | `src/` 7 文件 × 30 词检索 29 词零命中（含 trace/span/correlat/requestId/traceId/sequence/seq/adopt/parent/child/getContext/asyncLocalStorage/uuid/counter…）；`dist/`、`tests/`、README/INTEGRATION 同批词零命中。唯一非零是常驻**事件名** `sessionTickets.chain`（`src/store.ts:255`、`src/client.ts:272`，是工单依赖链不是链路追踪）与依赖注入类型名 `LogPhonesContext`（`src/phones.ts:17/60/83`） |
| 部分：包内已有与串联挂钩的机制部件 | **无** | 三个载体逐条为空：①上下文继承（roarr `adopt` 对应物）无——工厂只返回单实例（`src/host.ts:49-53`、`src/client.ts:198-206`、`src/node.ts:136-154`），无 `adopt`/`child`/`getContext`/`AsyncLocalStorage`，`globalThis` 全 `src/` 仅 6 处且全是**读**；②顺序号（roarr `sequence` 对应物）无——落盘行顶层键恒为 `{ts,level,event,fields}`（`src/store.ts:373-375`），实测 60 条、200 条连发 `ts` 去重数都是 1；③请求 id 生成与传播无——电话入参 `src/client.ts:468`（`{entries, droppedCount}`）、回参 `src/store.ts:492`、建库参数 `src/config.ts:34-54`、开关文件 `src/store.ts:448`、导出 summary `src/phones.ts:158-164`、启动头 `src/store.ts:461-471` 逐个核过，全部无 id |
| 无：连材料都没有 | **不成立** | 材料在：客户端条目（`src/client.ts:298-303`）→ `wf.logBatch` 实参（`src/client.ts:468`）→ 宿主逐条 `log(item.level, item.event, item.fields)`（`src/store.ts:483-491`）→ 四键序列化（`src/store.ts:373-375`）；实测调用方 `{requestId:'req-1'}` 两侧原样落盘。**跨边界只保 `fields`**：客户端条目的 `ts` 被丢弃、改用宿主接收时刻重打（喂 `ts:111` → 落盘为宿主接收时刻） |
| 自动附加的标识 | 全是进程/包级 | `ts`（毫秒时间戳，不唯一）、`pid`/`startedAt`（`src/store.ts:461-466`）、四段式文件名、导出 `summary` 的 `header`（`src/phones.ts:158-164`）、`pluginId`（**只在目录名/文件名/电话名里，不在落盘行里**）——无一条是请求级 |

**2. 锚点对照（一手来源）**：roarr `adopt`＝用 Node `async_context`（`AsyncLocalStorage`）把上下文下传给「同一异步上下文内的每一行」，`child` 派生子 logger、`getContext` 读当前上下文，仅 Node 可用；`sequence`＝日志信封固定顶层字段（无 adopt 时为进程内全局自增，adopt 域内为 `root.<域内自增>` 的 ltree 形式），用于同一毫秒内判定先后。dsh-log 对两者**各 0/5 无对应物**。来源：https://github.com/gajus/roarr/blob/main/README.md 、https://github.com/gajus/roarr/blob/main/src/factories/createLogger.ts 、https://github.com/gajus/roarr/blob/main/src/types.ts ；GitHub #10 只作**项目内已结决定（二手）**。

**3. 边界与不裁项**

- **另一种读法（如实列出，本票不采纳）**：若把「具备」读作「**在调用方约定下**能否端到端串起来」，因 `fields` 全链透传且跨边界不被改写，应记「部分」；本票按票面字面判「无」。两种读法**事实完全一致**（机制零、材料全），分歧只在「材料算不算具备」。
- **不判方案选型**（票面明示是雾区）；**不判追踪标识字段本身**（票 09 范围）。同批次票 09 已判「追踪标识＝无」，两票同标准、方向一致。
- **一处只记事实、不裁的出入**：`README.md:153` 与 `INTEGRATION.md:205` 写「允许字段（之外的键一律不记）」，但运行期不执行白名单（`eventList` 只在建库时验形：`src/config.ts:107-114`、`src/client.ts:110-115`），`checkEventFields` 只是**可选手工检查**——实测清单外字段与清单外事件名照落。
- **待 Q5**：队列满语义与门禁红黄未定（`issues/01-untitled.md:15/41`），本票不裁。

