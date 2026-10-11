<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-tid -->
<!-- parentKey: 01 -->
# 自查：追踪标识是否具备

## Question

按确认口径判定追踪标识是否具备：每条日志带的 trace/requestId 字段。注意区分现有非请求级标识（pluginId/pid/startedAt/codes/rules/散列），它们不是请求级追踪标识。对标：各库均无保留字，需自定（见 Decisions）。

输出：有/部分/无 + 证据。只给结论不写代码。

## 进度

- 2026-10-09 22:34 开工；22:45 后台调研 agent 产出 `research/09-trace-identifier-capability.md`（393 行）；22:50 Lead 抽查承重结论、留档探针、更正一处措辞后收口。上报：开工与完成两次走 `deck_issue_report`。
- 判定：**无**（内置零具备，一条都不带）。
- 只读调研：票面点名范围 21 个文件逐词零命中（`trace`/`traceId`/`requestId`/`request_id`/`correlation`/`span`/`spanId`），两条检索路径互证；补查 `sessionId`/`turnId`/`callId`/`toolCallId`/`uuid`/`nanoid`/`seq` 亦全 0。
- 实测两批独立探针同向：`D:\Temp\dsh-log-probe-09\probe-09.mjs`（仓库外）与 `.local/selfcheck-09-trace-id.mjs`（Lead）；落盘键集合恒 `{ts,level,event,fields}`、`hasBuiltinTraceish` 全空。探针按本仓约定留档为 `.local/selfcheck-09-probe.mjs`（可复跑）。
- Lead 复核：`src/store.ts:374`、`dist/store.js:296`、`src/client.ts:95`、`issues/05-untitled.md:7`、asar 可达性与大小、GitHub #10 resolution（api.github.com 直读）逐条抽查一致；更正调研稿 §1.2 一处「全仓」措辞（`tests/host.test.mjs:152` 有 1 处调用，产品代码仍无调用点）。
- 基线：`npm test` 23 过 / 2 套起不来（老 monorepo 路径 `D:\src\host\logStore.js`，票 02/03 已记），与本票无关。
- 澄清检查：票面 + 父图 Round1 口径已唯一确定「具备」的定义（= 记录里真带该字段），未发现需 grilling 的猜测点，故未开 grilling 轮次；「另一种读法（fields 位置预留 ⇒ 部分）」如实列入 Answer 但不采纳。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

**整体判定：无。** 落盘记录里没有任何请求级追踪标识字段——不是「有的带有的不带」，是一条都不带。全部证据、两批探针原始输出与 Lead 复核补记见 `research/09-trace-identifier-capability.md`。

**1. 记录形状：顶层键恒四个，无 trace 类字段。**
宿主是唯一落盘者（`src/store.ts:6`），序列化只挑四个键：`src/store.ts:374`「`JSON.stringify({ ts, level, event, fields })`」（`dist/store.js:296` 同形）。`ts` 是时间戳不是标识；`level`/`event` 是调用方传的字符串；`fields` 是调用方给什么就落什么（`src/store.ts:294`）。实测 6 行落盘（含启动头、info/warn 两级、客户端入口）顶层键集合全为 `{ts,level,event,fields}`，`hasBuiltinTraceish`（`trace`/`traceId`/`requestId`/`request_id`/`span`/`spanId`/`correlation`）**全空**。

**2. 检索：票面点名范围 7 词全部零命中。**
范围为 `src/`、`dist/`、`tests/`、`README.md`、`INTEGRATION.md`、`event-list.template.json`、`package.json`（21 个文件）；`trace`/`traceId`/`requestId`/`request_id`/`correlation`/`span`/`spanId` 各 `0 hit(s)`（PowerShell `Select-String -SimpleMatch -CaseSensitive:$false` 与 grep 工具双路互证，结果一致）。两个疑似命中已排除：`context`×3 = TS 接口名 `LogPhonesContext`（`src/phones.ts:17/60/83`）；`request`×4 = 事件名 `snapshot.request`（`src/store.ts:247`、`src/client.ts:264`、`dist/store.js:149`、`dist/client.js:89`）。补查 `sessionId`/`turnId`/`callId`/`toolCallId`/`uuid`/`nanoid`/`sequence`/`seq` 亦全 0。放宽到全仓后 `traceId`/`spanId` 的命中只在探针脚本与票面文字里，产品代码与随包文档里从未出现。

**3. 票面点名的非请求级标识：全都不指向任何一次请求，且多数不在记录里。**
`pluginId` = 配置项，运行期唯一用途是拼四段式文件名（`src/config.ts:175`），目录/开关名派生在 `:87-98`，**不进记录**；`pid`/`startedAt`/`dir` 只在启动头那一行的字段里（`src/store.ts:466`），且产品代码无调用点（测试里 1 处）；`codes`/`rules` 是清单里的脱敏引用名（`src/config.ts:257-260`），是数据模型不是记录字段；散列只作为个别事件的字段值出现（`dirHash` `src/store.ts:355`；`errorHash` `src/phones.ts:121/200/229/250`、`src/client.ts:392/397/559`）。包内 12 个发射点逐点核对，无一带请求级标识，其中 `src/node.ts:176` 连业务字段都是空对象 `{}`。

**4. 业务字段旁路：能落盘，但不是「具备」（本票关键区分项）。**
`fields` 原样透传、运行期完全无字段白名单：`checkEventFields`（`src/config.ts:379-391`）是纯函数检查器，`src/store.ts`/`src/client.ts` 里零调用；`src/client.ts:95` 自述「客户端运行时不拿清单做字段拦截，检查跑在通用门禁里」。实测最锋利一条：**传入只允许 `step` 的事件清单，`traceId`/`requestId`/`spanId` 照样落盘（丢弃 0），而离线 `checkEventFields` 对同一批字段回 `{"ok":false,"unknownFields":["traceId","requestId","spanId"]}`** —— 门禁红灯、运行期照落。README:153 / INTEGRATION.md:205 的「允许字段（之外的键一律不记）」是门禁口径，不是运行期保证（`issues/05-untitled.md:7` 已同口径写明）。按确认口径，调用方塞就有、不塞就没有 ⇒「每条日志都带」永远不成立，故判**无**而非部分。

**5. 另一种读法（如实列出，本票不采纳）。**
若把判据读作「字段位置是否预留、能否不改记录格式就装下请求级标识」，答案是**部分**——`fields` 是自由对象，塞进去就能落盘、不必改格式；缺的是产生与「每条都带」的保证。本票按票面确认口径判**无**，此读法留供升级建议票取用。

**6. 附带约束（不选型，只列现状给出的硬约束）。**
①「让每条日志带请求级标识」是**新增**，不是打开某个开关或改某个配置能得到的；②字段名必须自定——包内三入口、记录格式、清单模型里都没有任何保留字（第 2 条零命中），GitHub #10 resolution 第 7 条一手复核为「标识：自定保留字（traceId/requestId/logId），各库均无保留字」；③落盘行顶层键由 `src/store.ts:374` **一处硬定**（客户端行上多塞的顶层键 `truncated` 在 `src/store.ts:486` → `:290-295` → `:374` 被丢掉），要「每条都带」必须动这一处；④三个入口入参形状（`src/store.ts:73-79`、`src/client.ts:78-85`、`src/node.ts:32-41`）与电话入参 `LogEntry`（`src/store.ts:81-85`）都没有承载位置；⑤宿主侧源头确实有（有界旁证：`sessionId`/`callId`/`toolCallId`/`requestId` 在 DSH 自身层命中），缺的是通路——不属本票设计范围。

**7. 未确证项。** 宿主是否把 sessionId/callId 交给消费插件未核；`sessionKeys.header` 是否含会话标识未确证；全宿主零命中只在 9 个包 86 个 `.js` 的有界范围成立（未全量扫 asar）；`src`↔`dist` 未逐字节比对（但落盘结论跑的就是 `dist/`）；消费插件真实发出的行未看（属包外，且自带标识也只是调用方自己塞的，不改判定）。