# 票 09 自查：追踪标识是否具备

# 结论（一句话）

**整体判定：无。**

落盘记录里**没有任何请求级追踪标识字段**：宿主写盘的每一行顶层键恒为 `{ts, level, event, fields}` 四个（`src/store.ts:374`），其中 `ts` 是时间戳不是标识，`fields` 是调用方给什么就原样落什么、日志系统自己不产生也不要求任何请求级标识键。在票面点名的检索范围（`src/`、`dist/`、`tests/`、`README.md`、`INTEGRATION.md`、`event-list.template.json`、`package.json`，共 21 个文件）里，`trace`/`traceId`/`requestId`/`request_id`/`correlation`/`span`/`spanId` **全部零命中**（第 2 节，两条独立检索路径互证）。包内自己产生的 12 个发射点，字段全是不带请求级标识的自监控/业务字段，其中一条甚至是空字段 `{}`（第 4 节）。

**为什么不判「部分具备」**：本票口径把「具备」定义为「日志记录里确实带请求级追踪标识字段」（`issues/01-untitled.md:12`、`issues/09-untitled.md:7`）。现状是**一条都不带**，不是「有的带有的不带」。业务字段旁路（第 3 节实测：手塞 `{traceId:'XYZ'}` 能原样落盘）证明的是**数据通路不拦**，不是日志系统具备该标识——这一点票面已明确要求不得混为一谈。

**另一种读法（如实列出，本票不采纳）**：若把判据读作「字段位置是否预留、能否不改格式就装下请求级标识」，则答案是「**部分**——`fields` 是自由对象，塞进去就能落盘，不必改记录格式；缺的是产生与保证」。本票按票面确认口径判**无**，并把这条读法单列，供升级建议票取用。

本票只给结论与证据，不改代码、不选字段名、不给修复方案。凡引用均给 `路径:行号`；实测为只读探针，脚本只写在系统临时目录（第 5 节）。

---

# 口径（出处，非本票自拟）

- 票面判据：`issues/09-untitled.md:7`——「按确认口径判定追踪标识是否具备：**每条日志带的 trace/requestId 字段**。注意区分现有非请求级标识（pluginId/pid/startedAt/codes/rules/散列），它们不是请求级追踪标识。对标：各库均无保留字，需自定（见 Decisions）」；`:9`——「输出：有/部分/无 + 证据。只给结论不写代码。」
- 父图 Round1 确认口径：`issues/01-untitled.md:12`——「追踪标识=每条日志带的 trace/requestId 字段」；同处并定「链路追踪=一个请求跨宿主/客户端/插件的端到端串联」，二者是两个判据（串联是票 07，本票只判**字段是否具备**）。
- 票 09 自己的范围声明：`issues/09-untitled.md:13`——「口径按父地图 01 Round1 确认口径执行（追踪标识=每条日志带的 trace/requestId 字段；pluginId/pid/startedAt/codes/rules/散列 属非请求级标识，不计入）。范围：只判有/部分/无 + 证据，不做方案选型、不选字段名、不写代码。」
- 判「具备」的落地读法（本票采用）：**日志包在落盘记录上自己产生或自己保证带上请求级标识字段**。调用方能不能自己塞，不算「具备」（第 3 节）。

---

# 1. 现有记录字段盘点（逐字段 + 文件:行号）

## 1.1 每条落盘记录都带的四个键（宿主一处硬定）

宿主是唯一的落盘者（`src/store.ts:6`「它只做五件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数。**宿主是唯一的落盘者**。」）。序列化只挑四个键：

- `src/store.ts:374`「`JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields })`」——写入处 `src/store.ts:373-382`（一行一条 JSON，`'\n'` 结尾）。
- `dist/store.js:296` 同形（构建产物，2026-10-07 构建）。

四个键逐个盘点：

| 键 | 含义 | 取值来源 | 出处 |
|---|---|---|---|
| `ts` | 入队时刻的毫秒时间戳（数字） | `Date.now()` | `src/store.ts:291`、序列化 `:374` |
| `level` | 级别字符串，**运行期不校验**（形参是 `string`） | 调用方传入 | `src/store.ts:284`（`function log(level: string, …)`）、`:292` |
| `event` | 事件名，非字符串兜底成空串 | 调用方传入 | `src/store.ts:293` |
| `fields` | 调用方给的字段对象；**不是对象则落 `{}`** | 调用方传入，原样透传 | `src/store.ts:294`；`:374` |

要点：
- 这四个键**每条都有**（`fields` 可以是空对象但不能缺席）；`fields` 的键集合**没有任何系统级要求**，键名与数量全由调用方决定。
- `ts` 是时间戳，不是标识（既不唯一也不指向任何请求）。
- 除这四个键外，**没有任何记录级标识**（没有序号、没有 uuid、没有会话号、没有请求号）。

## 1.2 只在启动头带、且是否写由调用方决定：`pid` / `startedAt` / `dir`

- `src/store.ts:466`「`log('info', 'host.start', { pid: headerInfo.pid, startedAt: headerInfo.startedAt, dir: headerInfo.dir })`」——启动头唯一的写入点，字段就这三个。
- `headerInfo` 只在 `writeStartupHeader` 里被赋值：`src/store.ts:461-471`（`:465` 组装，`:466` 落一行）。
- **本包自己从不调用它**：全仓 `writeStartupHeader` 只出现在定义 `src/store.ts:461`、返回对象导出 `:543`、以及电话组上下文的类型传递（`src/phones.ts:30` 引的是 `getHeaderInfo`）。是否写启动头由调用方决定（`src/node.ts` 就没调它）。
- 因此「每条日志都带 pid/startedAt/dir」**不成立**：只有启动头那一行带，且那一行还要调用方主动写。

## 1.3 票面点名的非请求级标识，各自身份与落点（对照用）

| 名称 | 它到底是什么 | 会不会进落盘记录 | 出处 |
|---|---|---|---|
| `pluginId` | **配置项**：插件的标识，用来派生电话名前缀、日志子目录名、开关文件名 | **不进记录**。全包运行期唯一用途是拼四段式文件名（`src/config.ts:175`）；目录/开关文件名派生在 `src/config.ts:87-98` | `src/config.ts:85`、`:87-98`、`:161`、`:175` |
| `pid` | 进程号 | 只在启动头字段里（`src/store.ts:466`）；四段式文件名里也有一段（`src/store.ts:394` 调 `resolveLogFileName`） | `src/store.ts:139-147`（`currentPid`）、`:466` |
| `startedAt` | 进程启动时刻（ISO 串） | 只在启动头字段里；取不到时回退 `new Date().toISOString()`（`src/store.ts:148-155`） | `src/store.ts:466` |
| `dir` | 缓存目录原文（绝对路径） | 只在启动头字段里；失败行只记**散列**不记原文（`dirHash`） | `src/store.ts:466`、`:355` |
| `codes` | **事件清单里的脱敏引用名**（截断或散列代号，如 `H_CWD`） | 不进记录；是清单数据模型的一列 | `src/config.ts:257`、校验 `:358` |
| `rules` | **事件清单里的具名正则名**（如 `R_WIN_ABS`） | 不进记录；同上 | `src/config.ts:259`、校验 `:359` |
| 散列 | djb2 变体，8 位十六进制（`hashText`/`hash8`） | 进记录的只有 `dirHash`（`src/store.ts:355`）与 `errorHash`（`src/phones.ts:121/200/229/250`、`src/client.ts:392/397/559`） | `src/store.ts:94-100`、`src/phones.ts:37-47`、`src/client.ts:369-379` |

要点：这些**全部不是请求级标识**（不指向任何一次请求/一次调用），而且它们**也不是每条都带**——只有 1.1 的四个键每条都带。

## 1.4 记录形状有测试守着（现状口径被固定下来了）

- `tests/node.test.mjs:144-160`「一行一条 JSON：落盘内容带时间戳、级别、事件名与字段对象」：断言 `typeof last.ts === 'number'`、`last.level`、`last.event`，并用 `assert.deepEqual(last.fields, { step: 'parse' })`（`:156`）证明 `fields` **与传入的对象逐键相等，没有系统加料**。
- `dist/store.js:217/219-220`（入队处）与 `:296`（序列化处）与 `src/` 同形（抽查一致；第 7 节说明为何未做逐字节比对）。

---

# 2. 请求级标识检索结果（检索式 + 命中/零命中）

## 2.1 检索式与范围

- **范围（票面点名，共 21 个文件）**：`src/*.{ts,d.ts}` 7 个、`dist/*.js` 6 个、`tests/*.mjs` 4 个、`README.md`、`INTEGRATION.md`、`event-list.template.json`、`package.json`。
- **两条独立路径**：① grep 工具（ripgrep 内核，本机 `rg` 不在 PATH——`Get-Command rg` 无输出，故用工具内置内核）；② PowerShell `Select-String -SimpleMatch -CaseSensitive:$false`。两者结果一致。
- **检索词**（大小写不敏感）：`trace`、`traceId`、`requestId`、`request_id`、`correlation`、`span`、`spanId`、`context`、`request`。

## 2.2 结果

| 检索词 | 命中数 | 结论与假阳性排除 |
|---|---|---|
| `trace` | **0** | **零命中** |
| `traceId` | **0** | **零命中** |
| `requestId` | **0** | **零命中** |
| `request_id` | **0** | **零命中** |
| `correlation` | **0** | **零命中** |
| `span` | **0** | **零命中** |
| `spanId` | **0** | **零命中** |
| `context` | 3 | **假阳性**：全是 TypeScript 接口名 `LogPhonesContext`（`src/phones.ts:17`、`:60`、`:83`），是电话组的依赖袋类型，不是日志字段 |
| `request` | 4 | **假阳性**：全是事件名 `snapshot.request`（`src/store.ts:247`、`src/client.ts:264`、`dist/store.js:149`、`dist/client.js:89`），意为「快照被请求了一次」，是**事件名**不是请求级标识字段 |

**零命中即为零命中**：上面 7 个词在 `src/`、`dist/`、`tests/`、`README.md`、`INTEGRATION.md`、`event-list.template.json`、`package.json` 里一次都没出现。

## 2.3 排除假阳性的补充检索（同一范围）

| 检索词 | 命中数 | 说明 |
|---|---|---|
| `sessionId` / `session_id` | 0 / 0 | 零命中 |
| `turnId` / `turn_id` | 0 / 0 | 零命中 |
| `callId` / `toolCallId` | 0 / 0 | 零命中 |
| `uuid` / `nanoid` | 0 / 0 | 零命中（无随机标识生成） |
| `sequence` / `seq` | 0 / 0 | 零命中（无单调序号） |
| `pluginId` | 138 | 配置项，见 1.3（不进记录） |
| `pid` / `startedAt` | 40 / 35 | 启动头字段 + 文件名，见 1.3 |
| `codes` / `rules` | 10 / 9 | 清单数据模型，见 1.3 |
| `hash` / `dirHash` / `errorHash` / `cwdHash` | 41 / 3 / 16 / 4 | 散列，见 1.3 |

## 2.4 全仓检索里真正命中 `traceId`/`requestId`/`spanId` 的是什么

把范围放宽到**全仓**（88 个文件，排除 `node_modules/` 与 `.git/`）后，这三个词确实有命中，但**一处都不在产品代码或文档里**：

| 词 | 命中文件 | 是什么 |
|---|---|---|
| `traceId` | `.local/selfcheck-09-trace-id.mjs` ×3 | **Lead 为票 09 写的只读探针**（未跟踪目录 `.local/`；文件首行自述「不属于产品代码，落在未跟踪目录 .local/」；`git status` 显示 `?? .local/`）。它只是把 `traceId` 当**字符串样本**用，不是产品里的字段 |
| `spanId` | `.local/selfcheck-09-trace-id.mjs` ×4 | 同上 |
| `requestId` | `.local/selfcheck-09-trace-id.mjs` ×4、`issues/01-untitled.md` ×1、`issues/09-untitled.md` ×2 | 探针 + **票面文字本身**（口径里写的就是「trace/requestId 字段」） |
| `request_id` / `correlation` | 全仓 **0** | 零命中 |
| `trace` | 10 个文件共 25 次 | 全部是别的东西：`research/02:192`、`research/03:55/56/174/216/217`、`issues/02:64`、`issues/03:31` 把 `trace` 当**非法级别**用（探针里 `log('trace', …)`）；`issues/07:1` 是幂等键里的 `-child-trace`；`issues/01/02/03/07/09` 其余是「**链路追踪**」这个词；`.local/selfcheck-09-trace-id.mjs` 是探针文件名与样本字符串。**没有一处是「trace 字段」** |

即：**产品代码与随包文档里，请求级追踪标识字段名从未出现过。**

---

# 3. 业务字段旁路能力（关键区分项）

## 3.1 结论

`log(level, event, data)` **允许调用方把任意键塞进记录并原样落盘**，包括 `{ traceId: 'abc' }`。这条通路**运行期不设字段白名单、不做键过滤**。

但——按票 09 确认口径，**这不等于日志系统具备请求级追踪标识**：日志系统自己不产生、不填充、不校验、也不保证任何请求级标识；调用方塞就有、不塞就没有，「每条日志都带」这条**永远不成立**。旁路只说明一件事：**未来真要接一个请求级标识，落盘这一环不必改记录格式**（塞进 `fields` 即可原样落盘），缺的是从入口到调用点的通路与「每条都带」的保证。

## 3.2 通路上确实没有白名单

- 入队处原样收：`src/store.ts:294`「`fields: fields && typeof fields === 'object' ? fields : {}`」——只判断是不是对象，不检查键名。
- 序列化处原样写：`src/store.ts:374` 只挑四个键，**对 `fields` 内部一个键都不动**。
- 客户端同理：`src/client.ts:302` 同形（`:298-303`）；转发批次里的行也是 `{ts, level, event, fields}`（`src/client.ts:142-148`）。
- `checkEventFields`（`src/config.ts:379-391`，「字段白名单检查」）是**纯函数检查器**，不是写盘门禁：全包只有定义（`src/config.ts:379`）、注释（`:236`）、从宿主入口转出口（`src/host.ts:23`），调用方示例 `README.md:173-176`、`INTEGRATION.md:195-201`，测试 `tests/eventList.test.mjs:65/71/79/124/140`。**`src/store.ts` 与 `src/client.ts` 里没有任何调用点**。
- 客户端源码自己写明运行期不拦：`src/client.ts:95`「客户端运行时不拿清单做字段拦截，检查跑在通用门禁里」。
- 清单注入本身也只验形不落地拦：`config.eventList` 在 `resolveHostLogConfig` 里被验形状后就存起来（`src/config.ts:107-113`、`:122`），`src/store.ts` 里 `eventList` 只出现在一句注释（`:110`），运行期从不读它。

## 3.3 文档说的是门禁口径，不是运行期保证

- `README.md:153`「允许字段（**之外的键一律不记**）」与 `INTEGRATION.md:205` 同句——这句描述的是**清单纪律/门禁**（靠离线 `checkEventFields` 红灯来守），**运行期并没有实现「不记」**。
- 同仓另一张票的面口径已把这层意思写明：`issues/05-untitled.md:7`「字段白名单**运行时不丢字段**但门禁红灯=抑制（Q1 已定）」。本票实测与之相符（3.4）。

## 3.4 实测（详第 5 节）

- 本票探针：`log('info','probe.custom',{traceId:'XYZ',requestId:'REQ-1',note:'hand-injected'})` → 落盘行 `"fields":{"traceId":"XYZ","requestId":"REQ-1","note":"hand-injected"}`，丢弃计数 0。
- **更强的一条**（Lead 已有探针场景 B）：**即使传入只允许 `step` 的事件清单**（`probe09.custom` 的 `fields: ['step']`），运行期照样把 `traceId`/`requestId`/`spanId` 一起落盘、丢弃计数 0；而离线跑 `checkEventFields` 对同一清单同一批字段回 `{"ok": false, "unknownFields": ["traceId","requestId","spanId"]}`。**同一批字段，门禁红灯、落盘照旧**——运行期与门禁是两条路。

---

# 4. 哪些日志路径不保证带标识

分两类：**落盘了但没有标识**，与**根本没有记录**。

## 4.1 落盘了，但字段全是非请求级的（包内 12 个发射点，逐点字段）

| # | 发射点 | 事件名 | `fields` 的键 | 出处 |
|---|---|---|---|---|
| 1 | 宿主写盘失败自监控 | `log.persist.fail` | `op`, `reason`, `dirHash` | `src/store.ts:355` |
| 2 | 启动头 | `host.start` | `pid`, `startedAt`, `dir` | `src/store.ts:466` |
| 3 | 导出失败（取不到目录） | `host.call.fail` | `method`, `kind`, `errorHash` | `src/phones.ts:121` |
| 4 | 导出失败（异常兜底） | `host.call.fail` | `method`, `kind`, `errorHash` | `src/phones.ts:200-204` |
| 5 | 清空失败（日期非法） | `host.call.fail` | `method`, `kind`, `errorHash` | `src/phones.ts:229` |
| 6 | 清空失败（异常兜底） | `host.call.fail` | `method`, `kind`, `errorHash` | `src/phones.ts:250-254` |
| 7 | Node 入口落盘路标 | `log.flush.marker` | **空对象 `{}`** | `src/node.ts:176` |
| 8 | 客户端转发丢包汇总 | `log.forward.summary` | `droppedDelta`, `totalDropped`, `reason`, `windowMs` | `src/client.ts:358-363` |
| 9 | 客户端导出失败（有截断函数） | `log.export.fail` | `op`, `reason`, `errorHash` | `src/client.ts:392` |
| 10 | 客户端导出失败（回退散列） | `log.export.fail` | `op`, `reason`, `errorHash` | `src/client.ts:397` |
| 11 | 客户端开关看门狗超时 | `log.switch.watchdog` | `op`, `timeoutMs`, `stage` | `src/client.ts:424` |
| 12 | 客户端开关写失败 | `host.call.fail` | `method`, `kind`, `errorHash` | `src/client.ts:559-563` |

**这 12 条一条都不带请求级标识**；其中第 7 条连业务字段都没有（`{}`），第 1、8 条带的是日志管道自己的健康指标。也就是说：**日志包自己发的行，连「有个字段可以挂标识」都不成立**。

## 4.2 根本没有记录（连字段都没有，谈不到有没有标识）

| 路径 | 后果 | 出处 |
|---|---|---|
| 宿主队列满（默认 1000） | 告警/错误挤掉最旧的普通行；挤不动就直接丢新行；**只加计数** | `src/store.ts:270-281`、`:286-289` |
| 客户端队列满（100） | 直接丢弃、**只加计数**（`error`/`warn` 一样丢） | `src/client.ts:293-297` |
| 客户端超包（128KB）/超队裁剪 | 裁掉的行只计数，最后一条打 `truncated` 标记 | `src/client.ts:450-467` |
| 单行 `JSON.stringify` 抛错 | 丢该行 + 计数 | `src/store.ts:376-379` |
| 写盘失败 | 整批丢 + 计数（另发一条 `log.persist.fail`，它自己也可能丢） | `src/store.ts:344`、`:405-410` |
| 转发失败/宿主拒收/无宿主 | 整批丢 + 计数 | `src/client.ts:472`、`:483`、`:491`、`:498` |

## 4.3 三入口一致性问题：只有宿主持有记录，客户端多塞的顶层键会被丢掉

- 客户端**不落盘**，只入队转发（`src/client.ts:289-306`）；宿主是唯一落盘者（`src/store.ts:6`）。
- 客户端队列行的顶层键与宿主相同四个（`src/client.ts:298-303`），但类型上允许一个额外顶层键 `truncated?: boolean`（`src/client.ts:147`，由 `:463` 打上）。
- 宿主收到批次后**按三个键重打包**：`src/store.ts:486`「`log(item.level, item.event, item.fields)`」→ `:290-295` → `:374`。**所以 `truncated` 到了落盘行就没了**；电话入参形状 `LogEntry` 也只有 `level`/`event`/`fields` 三个键（`src/store.ts:81-85`）。
- 归纳：**落盘行的键集合由宿主一处硬定（四个键）**——多塞的**顶层**键一律不留，`fields` 里的键一律都留。这条约束对「未来把标识放哪」直接相关（第 8 节），但本票不选型。

---

# 5. 实测（命令 + 原始输出）

## 5.1 本票探针（脚本在仓库外）

脚本位置：`D:\Temp\dsh-log-probe-09\probe-09.mjs`（**仓库外**，未往仓库写任何文件、未改 `src/`/`dist/`/`tests/`/`package.json`）。落点用仓库外目录 `D:\Temp\dsh-log-probe-09\cache`。跑的是 `dist/node.js`（发布产物）。

命令：

```
node D:\Temp\dsh-log-probe-09\probe-09.mjs
```

原始输出（逐字，含落盘行原文与每行键集合）：

```
=== FILE: D:\Temp\dsh-log-probe-09\cache\logs-probe09\2026-10-09.log
=== RAW LINES (verbatim) ===
{"ts":1791556771540,"level":"info","event":"host.start","fields":{"pid":13884,"startedAt":"2026-10-09T14:39:31.540Z","dir":"D:\\Temp\\dsh-log-probe-09\\cache"}}
{"ts":1791556771540,"level":"info","event":"probe.plain","fields":{"step":"plain","n":1}}
{"ts":1791556771540,"level":"info","event":"probe.custom","fields":{"traceId":"XYZ","requestId":"REQ-1","note":"hand-injected"}}
{"ts":1791556771540,"level":"warn","event":"probe.custom.warn","fields":{"traceId":"XYZ","requestId":"REQ-1"}}
=== PER-LINE TOP-LEVEL KEYS + fields KEYS ===
{"topLevelKeys":["ts","level","event","fields"],"event":"host.start","level":"info","fieldsKeys":["pid","startedAt","dir"],"hasBuiltinTraceish":[]}
{"topLevelKeys":["ts","level","event","fields"],"event":"probe.plain","level":"info","fieldsKeys":["step","n"],"hasBuiltinTraceish":[]}
{"topLevelKeys":["ts","level","event","fields"],"event":"probe.custom","level":"info","fieldsKeys":["traceId","requestId","note"],"hasBuiltinTraceish":[]}
{"topLevelKeys":["ts","level","event","fields"],"event":"probe.custom.warn","level":"warn","fieldsKeys":["traceId","requestId"],"hasBuiltinTraceish":[]}
=== CLIENT QUEUED + HOST RECEIVED ===
client queue rows left: []
host received (verbatim): [{"name":"probe09c.logBatch","args":{"entries":[{"ts":1791556771603,"level":"warn","event":"cli.plain","fields":{"step":"c"}},{"ts":1791556771603,"level":"warn","event":"cli.custom","fields":{"traceId":"XYZ","requestId":"REQ-1"}}],"droppedCount":0}}]
```

读法：
1. **`hasBuiltinTraceish` 四行全空**：`trace`/`traceId`/`requestId`/`request_id`/`span`/`spanId`/`correlation` 里没有任何一个出现在记录顶层。
2. **顶层键恒为 `["ts","level","event","fields"]`**（四行一致，含启动头那一行）。
3. 启动头那行的字段就是 `["pid","startedAt","dir"]`（且必须调用方主动写才有，见 1.2）。
4. **自定义 `traceId`/`requestId` 原样落盘**（`info` 与 `warn` 两级都试了，与级别无关）——这是旁路，不是「具备」（第 3.1）。
5. **客户端入口同形**：队列行与宿主实收批次的行都是 `{ts, level, event, fields}`，自定义字段原样过通道。

## 5.2 Lead 已有探针（交叉复核，只读跑）

脚本位置：`.local/selfcheck-09-trace-id.mjs`（**并非本票所写**，是 Lead 为票 09 准备的复核探针，落在**未跟踪**目录 `.local/`；本票只读它、跑一次，未改动）。落点用 `mkdtemp(tmpdir())`，即系统临时目录。

命令：

```
cd D:\dsh-plugin\dsh-log
node .local/selfcheck-09-trace-id.mjs
```

原始输出（逐字）：

```
=== 场景 A 不传事件清单 ===
开关：无 setLogSwitch（info 级按开关关着处理）
文件：2026-10-09.log（2 行）
  键集合={ts,level,event,fields}  原文={"ts":1791556982897,"level":"warn","event":"probe09.plain","fields":{"step":"started"}}
  键集合={ts,level,event,fields}  原文={"ts":1791556982897,"level":"warn","event":"probe09.custom","fields":{"traceId":"XYZ","requestId":"REQ-1","spanId":"SPAN-1"}}
丢弃计数：0
=== 场景 B 传事件清单（probe09.custom 只允许字段 step） ===
开关：无 setLogSwitch（info 级按开关关着处理）
文件：2026-10-09.log（1 行）
  键集合={ts,level,event,fields}  原文={"ts":1791556983017,"level":"warn","event":"probe09.custom","fields":{"step":"started","traceId":"XYZ","requestId":"REQ-1","spanId":"SPAN-1"}}
丢弃计数：0
=== 离线检查器 checkEventFields 对同一清单 + 同样字段的看法 ===
{
  "ok": false,
  "unknownEvent": false,
  "unknownFields": [
    "traceId",
    "requestId",
    "spanId"
  ]
}
```

两批独立探针得同一方向：**记录无内置 trace 类字段；自定义 traceId/requestId/spanId 无论有没有清单都照样落盘；离线门禁红灯、运行期不拦。**

## 5.3 关于测试

本票未新增/未改测试（票面禁止改仓库）。既有 `tests/node.test.mjs:144-160` 是唯一断言落盘行形状的用例，它断言的是 `{ts, level, event, fields}` 与 `fields` 逐键等于传入对象——与本次实测同向。

---

# 6. 宿主侧旁证（有界）

问题：未来若要接一个请求级标识，**源头有没有**。

## 6.1 可达性

- `D:\DeepseekHarness\resources\app.asar` **不是目录，是单文件**（121,348,951 字节）；`D:\DeepseekHarness\resources\app.asar\dsh\` 用 `Test-Path` 判为不存在。同目录另有 `app.asar.unpacked/`（本次未用到）。
- 本次**未解包**：自写只读头解析器（脚本在 `D:\Temp\dsh-log-probe-09\asar-*.mjs`）读 asar 头 JSON 清单 + 按 offset 抽单个文件，全程只读、未改动 asar。
- `/dsh/package.json`：名 `@deepseek-ai/dsh-desktop-runtime`，版本 `0.2.0-rc.2`；实现由 **289 个 `@deepseek-ai/dsh-*` 包**组成。
- 这些包**只发 `.js`（实测 1195 个），没有 `.d.ts`**（扩展名分布：`.js` 1195、`.md` 609、`.json` 324、`.ts` 28、`.yaml` 278，**`.d.ts` 为 0**）。所以只能读构建后的 `.js`。

## 6.2 有界检索结果（9 个与会话/插件/工具最相关的包，86 个 `.js`，共 1,495,052 字节）

| 词 | 命中文件数 | 样例（原样） |
|---|---|---|
| `sessionId` | 24 | `dsh-agent-loop/lib/index.js:1274`「`sessionId: this.session.id,`」；`:383`「`this.attemptId = LlmAttemptId(\`${sessionId}:${attempt}\`);`」 |
| `callId` | 9 | `dsh-agent-loop/lib/index.js:512/685/693`「`callId: block.id,`」 |
| `toolCallId` | 4 | `dsh-session/lib/index.js:861`「`toolCallId: callId,`」；`:1215`「`if (messageRecord["toolCallId"] !== sourceRecord["callId"]) throw new Error(...)`」 |
| `requestId` | 10 | `dsh-api-session-controller/lib/client.js:1685`「`const requestId = randomUUID();`」 |
| `turnId` / `traceId` / `spanId` / `correlationId` | **0 / 0 / 0 / 0** | 这 9 个包的有界范围内零命中（**不是全宿主结论**） |

## 6.3 活体旁证（本会话内真实 DSH 插件的可见上下文）

`deck_probe` 回执（只回键名与布尔量，不回值）：

- `ctxKeys: ["fiber"]`
- `profileContextKeys`（11）：`cwd`, `dir`, `home`, `installAnchor`, `name`, `overlays`, `packageManager`, `patchPath`, `startedBundles`, `telemetryDisabledEnv`
- `sessionKeys`（16）：`contextFold`, `contextFoldSeq`, `derived`, `derivedGeneration`, `derivedNodes`, `eventsSnapshot`, `firstLifecycleSeq`, `firstLiveSeq`, `header`, `headerFold`, `headerFoldSeq`, `inheritedEventCount`, `log`, `surfaceManager`, `toolHistoryProjection`, `toolHistorySeq`
- `envKeys: ["DSH_CLIENT_VERSION"]`

读法：这个插件在它自己的可见面上**拿不到**名为 `sessionId`/`turnId`/`callId`/`requestId` 的键；但 `sessionKeys` 里有 `header`，会话标识**可能**藏在里面——探针只回键名不回值，**本票未确证**（第 7 节）。

## 6.4 有界结论

- **源头有**：宿主自层存在会话级标识（`sessionId`，还被拼进 LLM attempt id）、工具调用级标识（`callId`/`toolCallId`，且被用来做一致性校验）、API 层请求级标识（`requestId = randomUUID()`）。
- **通路没有**：dsh-log 三个入口的入参形状里**没有任何承载它们的位置**——`LogStoreDeps` 只有 `fs`/`timer`/`getCacheDir`/`getPlatform`/`DEFAULT_CWD`（`src/store.ts:73-79`），`ClientLogDeps` 只有 `host`/`timer`/`storage`/`localStorage`/`broadcastLogSwitch`（`src/client.ts:78-85`），`NodeCacheDirDeps` 只有 `cacheDir`/`fs`/`timer`/`joinPath`（`src/node.ts:32-41`）；电话入参 `LogEntry` 只有 `level`/`event`/`fields`（`src/store.ts:81-85`）。
- 即：**未来要接请求级标识，源头是有的，缺的是「从入口 → 调用点 → 记录格式」这条通路**。（本票不设计这条通路。）

---

# 7. 未能确证 / 存疑

- **「宿主是否把 sessionId/callId 交给 dsh-log 的消费插件」未核**：只核到宿主自层有这些标识（6.2 的有界检索）。没去核 DSH 的插件 API 面（例如 `dsh-plugin-manager` 的上下文形状、`@deepseek-ai/dsh-base/cordis.patch.yml` 里声明的服务）。缺 `.d.ts`（6.1）使这一步只能读构建产物，成本偏高，且**不影响本票主结论**（主结论只看 dsh-log 自己的记录格式）。
- **`sessionKeys.header` 里是否含会话标识未确证**：`deck_probe` 只回键名、不回值；不去取会话值（也不该取）。
- **全宿主范围的零命中未证**：`traceId`/`spanId`/`turnId`/`correlationId` 的 0 命中只在 9 个包 86 个文件的有界范围内成立。asar 内 `/dsh/` 共 12,412 个文件（其中 12,410 个在 `node_modules/` 下），未全量扫。
- **`.local/selfcheck-09-trace-id.mjs` 的作者与用途**：文件首行自述是「票 09 自查探针（Lead 复核用；不属于产品代码…）」，本票据此引用；**未与 Lead 二次确认**。它落在未跟踪目录 `.local/`（`git status`：`?? .local/`），**不在票 09 点名的检索范围**，但会让「全仓零命中」的表述失真，故在 2.4 单列。
- **消费插件侧的真实日志未看**：本票覆盖的是「日志包自己发的 12 行」+「探针写的行」。真实插件（`wf`）发出的行是否自带请求级标识，属包外，本票未核，也不替它下结论。若那些行自带 `traceId`，那也只是**调用方自己塞的**，不改变本票判定。
- **`src` ↔ `dist` 逐字节比对未做**：本机 `node_modules` 只有 `typescript`、无 esbuild，`build.mjs:16` 跑不起来（与票 02/03 同款缺口）。但本票的落盘结论**跑的就是 `dist/`**（`probe-09.mjs` import `dist/node.js`；Lead 探针 import `../dist/node.js`），所以「发布产物写出的记录没有内置 trace 字段」是实跑结论，不依赖比对；抽查 `dist/store.js:217-220/296` 与 `src/store.ts:290-295/374` 同形，`dist/store.js:385`（`host.start`）与 `src/store.ts:466` 同形。
- **`trace` 一词未来会不会被引入**：本票只报现状（零命中），不保证将来。
- **不属于本票**：链路追踪的端到端串联（票 07）、字段名选型与接入方案（雾区，属别的票）、多插件隔离（票 08）。

---

# 8. 对下游的约束（不选型：字段名须自定等）

本节只列**现状给出的硬约束**，不选字段名、不设计接入、不给实现建议。

1. **判定是「无」**：任何「让每条日志带请求级标识」的动作都是**新增**，不是打开某个开关或改某个配置能得到的（现状既没有该字段，也没有产生它的代码）。
2. **字段名必须自定**：本包三入口、记录格式、清单模型里都没有任何保留字（第 2 节零命中）。GitHub #10 的 resolution 原文（一手材料，本次已直读到）第 7 条写「标识：自定保留字（traceId/requestId/logId），各库均无保留字」，证据要点段写「**标识 8 库全无保留字**」——即对标约束成立，字段名须自定。（本票只复核这条约束，不选名。）
3. **记录格式有硬约束**：落盘行顶层键由宿主一处硬定（`src/store.ts:374`），且客户端行上已有的额外顶层键 `truncated` 会被这一处丢掉（第 4.3）。所以新增请求级标识若要「每条记录都带」，**必须动这一处**；若约定它只活在 `fields` 里，则**必须由每个调用点自己塞**，且没有「每条都带」的保证。
4. **`fields` 通路不需要改**：往里放任何键都能原样落盘（第 3 节实测），且运行期不拦、不合规只表现为离线门禁红灯（`issues/05-untitled.md:7` 同口径）。但「能落盘」≠「自动带上」。
5. **入口形状缺位**：三个入口的入参形状（`src/store.ts:73-79`、`src/client.ts:78-85`、`src/node.ts:32-41`）与电话入参 `LogEntry`（`src/store.ts:81-85`）都没有承载会话/请求标识的字段，客户端转发通道也没有（第 6.4）。
6. **源头确实存在**（宿主侧，有界结论）：`sessionId`、`callId`/`toolCallId`、`requestId` 在 DSH 自身层都有（第 6.2），所以「接一个请求级标识」不是无源之水；缺的是通路。
7. **与票 07 的边界**：本票只判「字段是否具备」；「一个请求跨宿主/客户端/插件的端到端串联」是链路追踪票（07）的范围，本票不碰。

---

# 证据清单

**读过的文件与行范围**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全） |
| `src/config.ts` | 1-415（全） |
| `src/client.ts` | 1-683（重点 40-160、240-310、336-340、444-505、554-567） |
| `src/phones.ts` | 1-315（全） |
| `src/host.ts` | 1-81（全） |
| `src/node.ts` | 1-195（全） |
| `src/node-ambient.d.ts` | 检索范围内（无命中） |
| `tests/node.test.mjs` | 1-206（全） |
| `tests/eventList.test.mjs` | 白名单相关处（63-96、124-143） |
| `event-list.template.json` | 全（6 行） |
| `README.md`、`INTEGRATION.md` | 字段/形状/清单相关节（README 32-56、84-115、145-180、196；INTEGRATION 94-101、137-149、184-207） |
| `package.json`、`AGENTS.md`、`docs/agents/*.md` | 检索范围内 |
| `issues/09-untitled.md`、`issues/01-untitled.md`、`issues/05-untitled.md` | 全文（口径出处） |
| `issues/02-untitled.md`、`issues/03-untitled.md`、`issues/07-untitled.md` | 命中行（`trace` 假阳性核查） |
| `research/02-log-file-capability.md`、`research/03-log-level-capability.md` | 命中行 + 报告体例（79-80、160-178、200-220 等） |
| `.local/selfcheck-09-trace-id.mjs` | 全文（Lead 已有探针，只读跑一次） |
| GitHub `FeatherHunter/dsh-log#10` | 该票 resolution comment 全文（经 `api.github.com/.../issues/10/comments` 直读） |
| `D:\DeepseekHarness\resources\app.asar` | 只读头解析 + 9 个包 86 个 `.js` 的有界检索（未解包） |

**检索命令（可复核）**

- 主检索（21 个点名文件）：PowerShell `Get-ChildItem` 收齐 `src`/`dist`/`tests` 下 `.ts/.js/.mjs/.json/.md` 与根下四个文件 → 逐词 `Select-String -Pattern <词> -SimpleMatch -CaseSensitive:$false` → 打印 `路径:行号: 行内容`。9 个词、逐词计数见 2.2/2.3；`trace`/`traceId`/`requestId`/`request_id`/`correlation`/`span`/`spanId` 全部 `0 hit(s)`。
- 交叉复核：grep 工具（ripgrep 内核）同范围同词，结果一致；`Get-Command rg` 无输出（本机 PATH 无 `rg`）。
- 全仓计数（88 文件，排除 `node_modules/`、`.git/`）：`traceId` 3、`requestId` 7、`request_id` 0、`correlation` 0、`spanId` 4、`trace` 25；命中文件逐条见 2.4。

**本票探针（均在仓库外 `D:\Temp\dsh-log-probe-09\`，未写任何仓库文件）**

| 脚本 | 关键结果 |
|---|---|
| `probe-09.mjs` | 4 行落盘：顶层键全为 `["ts","level","event","fields"]`；`hasBuiltinTraceish` 全空；`host.start` 字段 `["pid","startedAt","dir"]`；自定义 `{traceId,requestId}` 原样落盘（info+warn）；客户端入口行同形、宿主实收原样 |
| `asar-list.mjs` / `asar-own.mjs` / `asar-extract.mjs` / `asar-layout.mjs` | asar 总 12,967 文件、`/dsh/` 12,412；`/dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`；289 个 `@deepseek-ai/dsh-*` 包；`.d.ts` 为 0、`.js` 1195 |
| `asar-ids.mjs` | 先按 `.d.ts` 找 → 候选 0（该路径不通，如实记录） |
| `asar-idscan.mjs` | 改扫 `.js`：9 个包 86 文件 1,495,052 字节；`sessionId` 24 文件、`callId` 9、`toolCallId` 4、`requestId` 10；`turnId`/`traceId`/`spanId`/`correlationId` 全 0 |

**报告位置说明（仓库约定）**：本仓 `research/` 既有 `02-log-file-capability.md`、`03-log-level-capability.md` 两份姊妹票报告，本报告沿用同系列约定落在 `research/09-trace-identifier-capability.md`。本报告与全部探针**未改动任何源码、`dist/`、`tests/`、`README.md`、`INTEGRATION.md`、`package.json`、`issues/`**；仓库内唯一被读的文件是 `.local/selfcheck-09-trace-id.mjs`（Lead 已有，只读执行，落盘用系统临时目录）。

---

# Lead 复核补记（2026-10-09，票 09 结票前）

本报告由后台调研 agent 产出；Lead 在结票前抽查了承重结论，逐条记录如下（全部只读复核）。

**复核通过的承重结论（Lead 自己重读/重跑，与报告一致）**

- 记录顶层键恒四个、无内置 trace 类字段：`src/store.ts:374` 与 `dist/store.js:296` 同形（Lead 直读）；Lead 探针两场景行键集合全为 `{ts,level,event,fields}`。
- 业务字段旁路 + 运行期不设字段白名单：Lead 探针场景 B（传了只允许 `step` 的清单）仍把 `traceId/requestId/spanId` 落盘、丢弃 0；`checkEventFields` 对同一批字段回 `{"ok":false,"unknownFields":["traceId","requestId","spanId"]}`。
- 客户端行 → 宿主重打包：`src/store.ts:486` → `:290-295` → `:374`（Lead 直读）。
- `src/client.ts:95`「客户端运行时不拿清单做字段拦截，检查跑在通用门禁里」、`issues/05-untitled.md:7` 引文（Lead 直读，逐字一致）。
- 对标约束确为一手复核：`https://api.github.com/repos/FeatherHunter/dsh-log/issues/10/comments` 直读，comment 6074523463 第 7 条逐字为「标识：自定保留字（traceId/requestId/logId），各库均无保留字」，证据要点段「标识 8 库全无保留字」。
- 宿主侧可达性：`D:\DeepseekHarness\resources\app.asar` 存在、`121,348,951` 字节；`app.asar\dsh` 用 `Test-Path` 判为不存在（与第 6.1 节一致）。
- 基线测试：`npm test` 23 过 / 2 套起不来（`tests/host.test.mjs`、`tests/client.test.mjs` 引用老 monorepo 路径 `D:\src\host\logStore.js`，`ERR_MODULE_NOT_FOUND`），与票 02/03 记的既有缺口同一条，与本票结论无关。

**Lead 更正一处（第 1.2 节的「全仓」措辞）**

- 原文：「全仓 `writeStartupHeader` 只出现在定义 `src/store.ts:461`、返回对象导出 `:543`、以及电话组上下文的类型传递」。
- 更正：**测试里有一处调用** —— `tests/host.test.mjs:152`「`await four.store.writeStartupHeader()`」；`dist/` 侧同形为定义 `dist/store.js:380` + 导出 `:451`。
- 影响：结论不变（产品代码 `src/`、`dist/` 里没有调用点，`src/node.ts` 也不写启动头 ⇒「每条日志都带 pid/startedAt」不成立），只把「全仓只出现在」改读作「产品代码无调用点（测试里 1 处）」。

**探针留档（可复跑）**

- 本票探针原脚本在仓库外 `D:\Temp\dsh-log-probe-09\probe-09.mjs`；按本仓既有探针约定（`.local/selfcheck-02-*.mjs`、`.local/selfcheck-04-rotation.mjs`）由 Lead 复制为 **`.local/selfcheck-09-probe.mjs`**（代码未改，只改头注释说明来处）。
- 复跑命令：`node .local/selfcheck-09-probe.mjs`（落盘仍写 `D:\Temp\dsh-log-probe-09\cache`）。Lead 复跑输出与第 5.1 节同形：4 行顶层键全为 `["ts","level","event","fields"]`、`hasBuiltinTraceish` 全空、客户端转发行同形。
- Lead 的另一份交叉探针：`.local/selfcheck-09-trace-id.mjs`（第 5.2 节已逐字收录其输出）。

**判定不变：无**（内置零具备）；「另一种读法 ⇒ 部分」如实保留在结论与第 8 节，供升级建议票取用。
