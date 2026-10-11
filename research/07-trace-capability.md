# 结论

**整体判定：无（零串联机制；材料层齐全，但不构成「具备」）。**

一句话：包内不存在任何把一次请求在宿主/客户端/插件之间串起来的机制——不生成 id、不继承上下文、不打序号、跨边界载荷也不带任何关联字段（第 1 节零命中、第 3 节三个候选载体逐条为空，锚点 `adopt`、`sequence` 对照各 0/5）。唯一成立的是材料层：调用方自造字段（如 `{ requestId: 'req-1' }`）会**原样透传**客户端→宿主→落盘（第 2 节、第 5 节探针 P1，Lead 探针 `probe-trace-lead.mjs` 同证）——「手工串」今天能做，但那是调用方在两侧自己写同一个值，不是日志系统的能力。

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 有：包内存在**生成或传播**请求级串联标识的机制，且跨边界可用 | **无** | 全 `src/` 对 trace/span/correlat/requestId/traceId/sequence/seq/adopt/parent/session/runId/child/getContext/asyncLocalStorage/uuid/counter… 零命中（第 1 节）；三入口运行期导出面逐键枚举无任何「生成/继承/编号」API（第 5 节探针 P1.a、P5） |
| 2 | 部分：包内已有与串联挂钩的**机制部件**（哪怕只在包内、不跨边界），只是不完整 | **无** | 三个候选载体逐条为空：上下文继承（3.1）、顺序号（3.2）、请求 id 生成与传播（3.3）；锚点 A/B 对照各 0/5 |
| 3 | 无：连材料都没有 | **不成立** | 材料在：`fields` 全链透传（2.1/2.2） |
| 锚点 A | 上下文继承（roarr `adopt` 的对应物） | **无** | 无 `adopt`/`child`/`getContext`/`AsyncLocalStorage`；无全局日志状态（`globalThis` 全 `src/` 六处全是**读** process/TextEncoder/散列钩子，第 3.1 节） |
| 锚点 B | 顺序号（roarr `sequence` 的对应物） | **无** | 落盘行键恒为 `{ts,level,event,fields}`（探针 P1.e、P4.b），无单调序号/批次号/条目号；实测 60 条连续日志共用**同一个** `ts`（探针 P4.a）；Lead 探针 200 条连发同样 `ts` 去重数 = 1（第 6 节） |
| 锚点 C | 请求 id 的生成与传播 | **无** | 五个候选载体（电话入参回参、建库参数、开关文件、导出 `summary`、启动头）逐个核过，全部无 id（第 3.3 节） |
| 材料 | 调用方自造字段能否跨边界原样落盘 | **有** | 客户端条目（`src/client.ts:298-303`）→ `wf.logBatch` 实参（`src/client.ts:468`）→ 宿主 `log()`（`src/store.ts:483-491`）→ 序列化四键（`src/store.ts:373-375`）原样带出（探针 P1.b/P1.c；Lead 探针同证） |

**为什么不判「部分具备」**（收口时定版，与姊妹票 09 对齐）：三段尺度里的中间档指「**包内已有与串联挂钩的机制部件、只是不完整**」；现状是一个部件都没有——`fields` 是结构化日志通用的自由字段袋，「透传调用方给的字段」是任何带 `fields` 形参的日志库都有的性质，把它算作链路追踪的中间档，等于把「有自由字段」读成「部分具备链路追踪」。姊妹票 09（追踪标识）按「日志包自己产生或自己保证」判**无**（`research/09-trace-identifier-capability.md`）；同一条「调用方手塞也能落盘」的事实不能在 09 处不算具备、在 07 处算部分具备，否则地图上会出现「链路追踪＝部分，而它唯一的串联载体（追踪标识字段）＝无」的自相矛盾。

**另一种读法（如实列出，本票不采纳）**：若把判据读作「**在调用方约定下**系统能否端到端串起来（不要求包内生成或保证）」，则答案是「**部分**——材料齐全且跨边界不被改写，只缺生成与保证」。两种读法**事实完全一致**（机制零、材料全），分歧只在「材料算不算具备」；本票按票面「链路追踪是否具备」的字面判**无**，并把这条读法单列，供升级建议票取用。

本票只给结论与证据，不改代码、不提实现方案、不选型。凡引用均给 `路径:行号`，外部一律给 URL；实测部分为只读探针（跑在系统临时目录 `D:\Temp`，未改动仓库任何文件）。

---

# 判据与口径（出处，非本票自拟）

- **票面判据**：`issues/07-untitled.md:5-9`——「## Question」（`:5`）／「按确认口径判定链路追踪是否具备：一个请求跨宿主/客户端/插件的端到端串联。已知 trace/span 零命中，需实锤。对标锚点：roarr adopt+sequence（见 Decisions）。」（`:7`）／「输出：有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。」（`:9`）。
  注（2026-10-09 收口时更正）：该文件此前被 markdown 后端写入过重复骨架（题头与 `## Comments`/`## Answer` 各出现过两份），Lead 已清掉重复段并置 `Status: claimed`；本报告行号以清理后的 `:5-9` 为准。
- **口径出处**：`issues/01-untitled.md:12`——「口径（Round1 已确认）：…**链路追踪=一个请求跨宿主/客户端/插件的端到端串联**；**追踪标识=每条日志带的 trace/requestId 字段**；…」。
- **锚点出处**：`issues/01-untitled.md:34`——「…链路抄 roarr adopt+sequence…」（GitHub #10，已关闭）；`issues/10-ts.md:24` 同结论「链路照抄 roarr adopt+sequence」。链接：https://github.com/FeatherHunter/dsh-log/issues/10 （resolution comment 原文，**项目内二手结论**，非一手规格）。
- **边界（票 09，本票不越界）**：`issues/09-untitled.md:7`——票 09 判「追踪标识=每条日志带的 trace/requestId 字段」，并明示 `pluginId/pid/startedAt/codes/rules/散列` 属**非请求级**标识、不计入。**本票只判「串联机制」**，不替票 09 判「字段有没有」，也不把票 09 的结论当本票结论；本票凡涉 `pluginId/pid/startedAt` 处一律只作「是不是请求级」的事实标注（第 2.4 节）。
- **姊妹票 09 已出结论（同批次并行产出，2026-10-09）**：`research/09-trace-identifier-capability.md` 判「追踪标识＝**无**」，其判定标准是「日志包在落盘记录上**自己产生或自己保证**带上请求级标识字段；调用方能不能自己塞，不算具备」。**本票收口时采用同一标准**（见「结论」一节的「为什么不判部分具备」），两票方向一致：**追踪标识＝无、链路追踪＝无**，且都如实记录「调用方手塞字段能原样落盘」这条材料层事实。该文件由另一并行会话维护，本票只引用其结论、不改动它。

---

# 1. 零命中复核（检索口径 + 命中数 + 反证）

**检索口径**：对 `src/` 全量 **7 个文件**（`client.ts`、`config.ts`、`host.ts`、`node-ambient.d.ts`、`node.ts`、`phones.ts`、`store.ts`）做**大小写不敏感子串**匹配，词表 30 个：`trace`、`span`、`correlat`、`requestId`、`traceId`、`correlationId`、`requestid`、`traceid`、`sequence`、`seq`、`adopt`、`parent`、`session`、`runId`、`run_id`、`child`、`getContext`、`context`、`asyncLocalStorage`、`async_hooks`、`AsyncLocalContext`、`uuid`、`randomUUID`、`Math.random`、`counter`、`batchId`、`entryId`、`spanId`、`parentId`、`reqId`、`logId`。
探针：`D:\Temp\probe-trace-07-scan.mjs`（只读；逐词给总命中数与逐行落点）。

**结果：29/30 词零命中。** 零命中含 `trace`、`span`、`correlat`（连带 `correlationId`）、`requestId`、`traceId`、`sequence`、`seq`、`adopt`、`parent`、`runId`、`run_id`、`child`、`getContext`、`asyncLocalStorage`、`async_hooks`、`AsyncLocalContext`、`uuid`、`randomUUID`、`Math.random`、`counter`、`batchId`、`entryId`、`spanId`、`parentId`、`reqId`、`logId`。

唯一非零两词：

- `session` ×2：`src/store.ts:255`、`src/client.ts:272`，两处都在常驻事件名单里，命中的是**事件名** `'sessionTickets.chain'`（宿主 monorepo 的事件名，不是会话/串联机制）。
- `context` ×3：`src/phones.ts:17/60/83` 的 `LogPhonesContext`，是依赖注入的类型名，与「日志信封的 context」无关。

**交叉复核（换工具、换口径）**：

- grep 工具（ripgrep 正则）在 `src/` 上检索 `trace|span|correlat|requestId|traceId|sequence|adopt|runId|run_id` → `No matches found`；检索 `parent|session|child|getContext|asyncLocal|async_hooks|uuid|randomUUID|Math\.random|batchId|entryId|logId|reqId` → 仅 2 条（同上两处 `sessionTickets.chain`）。
- 编译产物同口径：`dist/` 6 个 JS 上检索 `trace|span|correlat|requestId|traceId|sequence|adopt|child|getContext` → **零命中**。
- 测试同口径：`tests/` 上检索 `trace|span|correlat|requestId|traceId|sequence|adopt|child|context` → **零命中**（即本概念在本仓**没有任何测试守护**）。
- 文档同口径：全仓 `*.md` 上检索 `trace|span|correlat|requestId|traceId|sequence|adopt` → 命中只落在 `research/`、`issues/`（本次自查自己的文字）；**`README.md` 与 `INTEGRATION.md` 零命中**，即包的两份对外文档从未提过链路追踪/串联标识/序号。

**反证尝试（不是「找不到就算无」）**：

1. **换成语义检索而不是字面**：`parent`、`child`、`inherit`、`scope`、`with*` 类词零命中；`context` 只有类型名（上）。即不是「名字取别的」。
2. **换到运行期而不是源码**：把三入口返回对象逐键枚举（第 5 节探针 P1.a/P5）——`store` 16 键、`client` 22 键，无一个方法名或字段名带 id/序号/上下文语义。
3. **换到全局状态**：`globalThis` 全 `src/` 仅 6 处，且全是**读**——`src/store.ts:141`（读 `process.pid`）、`src/phones.ts:91/146/153`（读 `process.*`）、`src/client.ts:340`（读 `TextEncoder`）、`src/client.ts:385`（读 `dswsLogHash/dswsLogTrunc` 钩子）。包内**没有** roarr 那种 `globalThis.ROARR` 型全局日志状态可挂上下文。
4. **换到依赖**：`package.json:36-38` 的 `devDependencies` 只有 `typescript`，**没有 `dependencies` 段**——不存在 uuid/nanoid/cls-hooked 之类的 id 或异步上下文依赖。

**唯一可能的反例方向**：机制藏在消费方（宿主 monorepo 或插件）而不在本包。**本票主线覆盖范围限本 checkout 的 `src/`+`dist/`+`tests/`+包内两份文档**；包外只做了两处定点旁证（旧实现两模块、消费方日志调用粗筛，见第 6 节），未做包外全仓系统检索，如实记入「未独立核验 / 存疑项」。

---

# 2. 字段携带面：「手工串」到底能不能串起来

## 2.1 落盘行的真实形状

- 条目类型（跨边界通道用）：`src/store.ts:81-85`「`export interface LogEntry { level: string; event: string; fields: Record<string, unknown> }`」。
- 队列行（宿主内部）：`src/store.ts:87-92`（`ts` / `level` / `event` / `fields`）。
- 入队：`src/store.ts:290-295`——`{ ts: Date.now(), level: level, event: String(event || ''), fields: fields && typeof fields === 'object' ? fields : {} }`。**`fields` 是调用方对象的引用，不做拷贝、不做键过滤、不做重命名**。
- 序列化：`src/store.ts:373-375`——`JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields })`。**行内顶层键恒为四个**；实测 6 条落盘行的键集合都等于 `event,fields,level,ts`（探针 P1.e），60 条批量行同理（探针 P4.b）。
- 逐字落盘样例（探针 P1.c，原样粘自文件）：

  ```
  {"ts":1791556969061,"level":"info","event":"probe.host.req","fields":{"requestId":"req-A","traceId":"tr-A","side":"host"}}
  ```

## 2.2 客户端条目形状与跨边界实参

- 客户端条目类型：`src/client.ts:142-148`（比宿主多一个可选 `truncated?: boolean`）。该标记只在裁剪时被置位：`src/client.ts:463`「`entries[entries.length - 1].truncated = true`」——这是包内**唯一**会给条目追加标注的地方，是布尔标记，不是 id。
- 客户端入队：`src/client.ts:298-303`，形状与宿主同构（ts/level/event/fields），同样直接持有引用。
- 跨边界实参：`src/client.ts:468`「`const args = { entries: entries, droppedCount: logDroppedState.count }`」；发送处 `src/client.ts:477-479`（`host.call(phoneNames.logBatch, args)`）。
- **`wf.logBatch` 的宿主实体不在 `src/phones.ts`**：`phones.ts` 只有导出/清空/开关四个电话体（`src/phones.ts:307-312` 的返回面）；`logBatch` 的实体是 `src/store.ts:477-497`（`handleLogBatch`），注册处 `src/host.ts:66`，动作名全集 `src/config.ts:26`（`PHONE_ACTIONS`）。
- 实测实参（探针 P1.b，走真实注册表 + 真宿主 handler）：电话名 `traceprobe.logBatch`，实参键**恰好两个** `["droppedCount","entries"]`，`entries[i]` 形状 `{ts, level, event, fields}`，**调用方自造字段 `requestId`/`traceId`/`side` 原样在 `fields` 里**。
- 宿主收下：`src/store.ts:477-497`——`:482` 取 `args.entries`，`:483-491` 逐条 `log(item.level, item.event, item.fields)`（**把客户端条目的 fields 直接交给同一个 `log()`**）；回参 `src/store.ts:492`「`{ ok: true, accepted: entries.length, dropped: getDroppedCount() }`」——**无任何 id/批次号回传**。

结论：**同一个 `requestId` 在客户端写的行与宿主写的行会逐字出现在同一个文件里**，可以用 grep 串起来——这是**材料层**的实锤（**不构成「具备」**：串起来靠的是调用方两侧各写一次同一个值，包内不生成、不补充、不改写任何字段；判定尺度见「结论」与「判定尺度与边界说明」）。

## 2.3 运行时字段是否透传（含 eventList 白名单独立复核）

- 透传成立：见 2.1/2.2 的行号与探针。`log(level, event, { requestId: 'x' })` → 原样落盘（探针 P1.c 第 4 行：`"fields":{"requestId":"req-A","traceId":"tr-A","side":"client"}`）。
- **独立复核票 03 的结论「eventList 只在解析时验形、运行期不读」→ 成立**：
  - 全 `src/` 的 `eventList` 读取点只有四处：`src/config.ts:107-114`（宿主建库取值+验形）、`src/config.ts:122`（存进 config）、`src/client.ts:110-114`（客户端建库取值+验形）、`src/client.ts:115`（存进 config）。**没有任何一处把它交给选择/放行/序列化路径**。
  - 放行只看级别与事件名名单：`src/store.ts:263-267`、`src/client.ts:279-288`；序列化只看 `fields` 本身：`src/store.ts:373-375`。
  - 清单只被三个纯函数消费：`src/config.ts:299-333`（`parseEventListManifest` 验形）、`src/config.ts:379-391`（`checkEventFields` 字段白名单检查）、`src/config.ts:401-415`（`checkEventCounts` 计数检查）——都是**调用方自己调**的离线检查器，不在 `log()` 链路上。
  - **实测（探针 P2，本票新增）**：建库传一份清单，其中 `probe.host.manifest` 只允许字段 `["allowed"]`；检查器对带 `requestId/traceId` 的字段集回 `{"ok":false,"unknownEvent":false,"unknownFields":["requestId","traceId"]}`，**但同一份清单装进 store 后落盘行是**：

    ```
    {"ts":1791556991814,"level":"info","event":"probe.host.manifest","fields":{"allowed":1,"requestId":"req-M","traceId":"tr-M","notInManifest":"x"}}
    {"ts":1791556991814,"level":"info","event":"probe.not.in.manifest","fields":{"requestId":"req-N"}}
    ```

    连**事件名不在清单里**的 `probe.not.in.manifest` 也照落 ⇒ 运行期既不拦字段、也不拦事件名。
- **文档口径与实测的出入（只记事实，不改文档）**：`README.md:153`「允许字段（之外的键一律不记）」、`README.md:180` 与 `INTEGRATION.md:205` 同口径；按现有实现，这句话只对**调用方主动调 `checkEventFields`** 成立，对落盘不成立。

## 2.4 包内自动附加的标识：逐个行号 + 逐个判「是不是请求级」

| # | 标识 | 附加位置（`路径:行号`） | 出现在哪 | 是不是请求级 |
|---|---|---|---|---|
| 1 | `ts`（`Date.now()` 入队时刻） | 宿主 `src/store.ts:291`；客户端同构 `src/client.ts:299` | 每一行（唯一恒有） | **不是**：毫秒时间戳，实测 6 行同一毫秒（探针 P1.e）、60 行同一毫秒（探针 P4.a），不唯一、不可当序号 |
| 2 | `pid` | 取值 `src/store.ts:139-147`；用于文件名 `src/store.ts:394`；用于启动头 `src/store.ts:466` | 四段式文件名、`host.start` 行 | **不是**：进程级 |
| 3 | `startedAt` | `src/store.ts:148-155`、`src/store.ts:465` | 四段式文件名、`host.start` 行 | **不是**：进程启动级 |
| 4 | `pluginId` | 配置 `src/config.ts:85`；派生目录名/开关名 `src/config.ts:87-98`；四段式文件名 `src/config.ts:161/175`；电话名前缀 `src/config.ts:128/137` | **只在目录名、文件名、电话名里；落盘行里没有** | **不是**：包级常量 |
| 5 | 目录名 / 文件名 | `src/config.ts:87-92`、`src/config.ts:142-146`（daily）、`src/config.ts:152-165`（四段式） | 文件系统 | **不是**：与请求无关（实测四段式 `2026-10-09.traceprobe.41944.2026-10-09T14-43-11.833Z.log`，探针 P3.c） |
| 6 | 启动头 `host.start` | 实现 `src/store.ts:461-471`，导出于 `src/store.ts:543`，**包内无调用点**（全 `src/` 仅这一处定义+这一处导出） | 一行 `info/host.start`，fields 为 `{pid, startedAt, dir}` | **不是**：进程级；且要调用方显式调 `writeStartupHeader()` 才有（探针 P3.a/P3.b） |
| 7 | 客户端开关键 `dsws.debug` | `src/client.ts:121`；读写 `src/client.ts:209-244` | 客户端本地存储 | **不是**：整机开关 |
| 8 | `truncated` 标记 | `src/client.ts:147`（类型）、`src/client.ts:463`（置位） | 被裁剪批次的最后一条 | **不是**：一次转发的布尔标记 |
| 9 | `droppedCount`（跨边界计数） | 客户端 `src/client.ts:468`；宿主回参 `src/store.ts:492` | 电话入参/回参 | **不是**：累计丢弃数，不区分行 |

结论：**自动附加的标识全是进程级/包级/整机级，无一条是请求级**；落盘行里除 `ts` 外没有任何自动标识，连 `pluginId`/`pid` 都要靠目录名或文件名反推。

---

# 3. 跨边界串联的三个候选载体：逐个判有无

## 3.1 上下文继承（roarr `adopt` 的对应物）：无

- 零命中（第 1 节）：无 `adopt`、`child`、`getContext`、`AsyncLocalStorage`、`async_hooks`。
- 无等价实现：三个入口的工厂（`src/host.ts:49-53`、`src/client.ts:198-206`、`src/node.ts:136-154`）都只返回**一个**日志器实例，没有「由已有实例派生子实例」的形参或方法；运行期逐键枚举（探针 P1.a/P5）：`store` 16 键、`client` 22 键，无一个能承接「父上下文」。
- 客户端实例状态是**闭包私有**的（`src/client.ts:246-255`：开关、队列、丢弃数、转发状态、计时器、写开关代际），建两个日志器各拿一份、互不继承——`src/client.ts:168-169` 自陈「一次调用得到一个独立实例（内存队列、累计丢弃数、开关状态各自独立，互不串）」。
- 无全局状态可挂（第 1 节反证 3）；也**没有**任何「字段容器」概念可继承：调用方只能每次调用自己带 `fields`（`src/store.ts:284`、`src/client.ts:291` 的形参都是逐次传入的 `fields`）。
- 跨进程侧同样无：包内唯一的「跨调用状态」是建库形参（`src/config.ts:34-54`）与开关文件（`src/store.ts:438-459`），两者都不带上下文字段（见 3.3）。

## 3.2 顺序号（roarr `sequence` 的对应物）：无

- 无单调递增序号/批次号/条目号：`sequence|seq|counter|batchId|entryId` 全 `src/` 零命中（第 1 节）。
- 行内键恒为 `{ts,level,event,fields}`（探针 P1.e、P4.b），没有 `i`/`n`/`index`/`seq` 之类的第 5 键。
- 队列顺序即写入顺序，但**顺序信息一旦落盘只以「文件里的物理行序」存在**，没有任何字段可复算：一次 `writeBatch` 是 `lines.join('\n')`（`src/store.ts:370-382`），不插序号。
- 实测（探针 P4.a）：同进程连续 60 条日志，`ts` 只有 **1 个不同值**（59 条重复）⇒ 想靠 `ts` 排序/配对在毫秒内无从下手，包内也没有任何序号兜底。
- 跨边界顺序更弱：客户端条目先入客户端队列（`src/client.ts:298-303`），要等 `sendLogBatch`（`src/client.ts:446-503`）转发后才进宿主队列，因此**落盘顺序 ≠ 调用顺序**。实测（探针 P1.d）：调用顺序 `client-A, host-A, client-B, host-B, client-plain, host-plain`，落盘顺序却是 `host-A, host-B, host-plain, client-A, client-B, client-plain`（客户端三条因晚转发而整体排在宿主三条之后），而这 6 条的 `ts` 完全相同。
- 批内保序但不编号：`entries = logQueue.splice(0, LOG_BATCH_MAX)`（`src/client.ts:448`）按入队顺序切片；实测一批 5 条的发送顺序=入队顺序（探针 P4.c）。
- 反向核对：包内确有一个会自增的数——`dropped`（`src/store.ts:117`）与 `logDroppedState.count`（`src/client.ts:250`）——但它是**累计丢弃条数**，只在丢弃时 `+= 1`（`src/store.ts:275/280/344/378/387/407/489`、`src/client.ts:294/460/472/483/491/498`），不逐行、不能当序号；`sampleRate` 全程惰性（票 03 §3.4 已记）。

## 3.3 请求 id 的生成与传播：无（五个候选载体逐个核）

| 载体 | 行号 | 有没有 id |
|---|---|---|
| 电话入参 `wf.logBatch` | `src/client.ts:468`（`{entries, droppedCount}`）、宿主收 `src/store.ts:477-497` | **无**；实测实参键恰为 `["droppedCount","entries"]`（探针 P1.b） |
| 电话回参 | `src/store.ts:492`（`{ok, accepted, dropped}`）、`:493-496` 最外层例外 | **无** |
| 建库参数 | `src/config.ts:34-54`（`pluginId`/`prefix`/`logDirName`/`switchFileName`/`fileNamePolicy`/`maxQueue`/`eventList`）、生效形状 `src/config.ts:57-65` | **无**任何 id/关联键参数 |
| 开关文件 | 写 `src/store.ts:448`、读 `src/store.ts:429-431`；电话 `src/phones.ts:295-306` | **无**；实测内容 `{"enabled":true,"sampleRate":1}`（探针 P3.d） |
| 导出 `summary` | 组装 `src/phones.ts:158-164`、回参 `src/phones.ts:188-197` | **无**；实测 summary 键 `pluginVersion/os/cwd/logSwitch/header`，`header` 内只有 `{pid,startedAt,dir}`（探针 P3.e） |
| 启动头 | `src/store.ts:461-471`（`host.start` 的 fields=`{pid, startedAt, dir}`） | **无**；探针 P3.a |
| 四段式文件名 | `src/config.ts:152-165` | 只有 `pluginId + pid + startedAt`（进程级组合），**无**请求级 |
| 客户端自监控行 | `src/client.ts:358-363`（`log.forward.summary` 的 `droppedDelta/totalDropped/reason/windowMs`） | **无**请求级字段 |

- 「生成」这一半直接不存在：全 `src/` 无 `Math.random`、无 `uuid`/`randomUUID`、无任何计数器用于生成 id（第 1 节），`package.json` 也无相关依赖。
- 「传播」这一半也不存在：客户端只把 `entries + droppedCount` 递上去（`src/client.ts:468`），宿主回 `ok/accepted/dropped`（`src/store.ts:492`），**没有一个字段是包内加的**。调用方写在 `fields` 里的东西能过去（2.2），但那是调用方自己写的，不是包在传。
- 结论：请求 id 的**生成=无、传播=无**；唯一的「串」是调用方在**两侧都自己写同一个值**，靠 `fields` 原样透传实现。

---

# 4. 三入口 + 电话层覆盖

| 入口 | 文件 | 本票覆盖到的位置 | 串联机制 |
|---|---|---|---|
| `dsh-log/host` | `src/host.ts` | `:49-53` `createHostLog`；`:63-80` `registerHostLogPhones`（`:65-71` 五个 handler、`:72` 动作名） | **无**（只建库与注册） |
| `dsh-log/client` | `src/client.ts` | `:198-206` 工厂；`:291-306` 入队；`:446-503` 批量转发；`:504-520` flush；`:121` 本地开关键 | **无**（只有本地队列与转发） |
| `dsh-log/node` | `src/node.ts` | `:136-154` 建库；`:172-192` `ready` 基准行（`:173` 字面 `log.flush.marker`、`:176` `store.log('debug', marker, {})`） | **无**（`ready` 是刷盘路标，见下） |
| 电话层 | `src/phones.ts` | `:110-210` 导出；`:212-260` 清空；`:295-306` 开关；`logBatch` 实体不在此文件（在 `src/store.ts:477-497`） | **无**（导出/清空/开关均无 id，见 3.3） |

- 三入口的导出面运行期枚举见第 5 节探针 P1.a/P5；`package.json:15-19` 的 `exports` 也只有 `./host`、`./client`、`./node` 三个子路径。
- `src/node.ts:172-192` 的 `log.flush.marker` 单独点一句：它是包内唯一「为一次动作写一行专门标记」的用法，但那行 fields 是 `{}`（`:176`），且每轮 `ready` 都用同一个字面 ⇒ **不能当序号或请求 id**；它属 `dsh-log/node` 独有的刷盘等待机制，与链路无关。

---

# 5. 实测（只读探针，全部跑在 `D:\Temp`）

探针脚本一律放 `D:\Temp`（沿用票 02/03 先例）；**本票未在仓库内新建/修改任何文件（除本报告），未 commit**。脚本正文不入报告，只列命令与关键观测。

| # | 命令 | 关键观测（原样摘录） |
|---|---|---|
| S | `node D:\Temp\probe-trace-07-scan.mjs` | `src/` 7 文件 × 30 词：**29 词零命中**；`session` 2 次（事件名 `sessionTickets.chain`）、`context` 3 次（类型名 `LogPhonesContext`） |
| P1 | `node D:\Temp\probe-trace-07-runtime.mjs` | **P1.a** 导出面逐键：`store` 16 键 / `client` 22 键，无 id/序号/上下文 API。**P1.a2** 开关默认关闭时：宿主 `isEnabled('info','probe.host.req')=false`、`isEnabled('warn','probe.host.req')=true`、`isEnabled('info','host.start')=true`。**P1.b** 电话实参键恰为 `["droppedCount","entries"]`，字段原样。**P1.c** 6 条落盘行（见 2.1 样例）。**P1.d** 落盘顺序 ≠ 调用顺序（见 3.2）。**P1.e** 6 行 `distinctTs=1`，行键集合恒为 `["event,fields,level,ts"]` |
| P2 | 同上 P2 段 | 检查器回 `{"ok":false,"unknownFields":["requestId","traceId"]}`，落盘行仍含全部四个字段；清单外事件名同样落盘 |
| P3 | 同上 P3 段 | `host.start` 行 fields=`{pid,startedAt,dir}`；四段式文件名 `2026-10-09.traceprobe.41944.2026-10-09T14-43-11.833Z.log`；开关文件 `{"enabled":true,"sampleRate":1}`；导出 summary 键 `pluginVersion/os/cwd/logSwitch/header` |
| P4 | 同上 P4 段 | 60 条连续日志 `distinctTs=1`（59 条重复）；行键集合 `["event,fields,level,ts"]`；客户端一批 5 条发送顺序=入队顺序 |
| T | `npm test`（仓库根） | **实测 25 用例：23 过 / 2 套失败**（`tests/host.test.mjs`、`tests/client.test.mjs`，`ERR_MODULE_NOT_FOUND` 指向 `file:///D:/src/host/logStore.js`、`file:///D:/src/client/kernel/log.js`，非断言失败），退出码 1——与票 02/03 记录一致；本票结论不依赖这两套 |

**实跑失败如实记录**：

- `npm test` 退出码 1，两套起不来的原因（老 monorepo 布局遗留）与本票判据无关；本票的宿主/客户端/电话行为改由 `dist/` 产物的只读探针实测。
- 首次跑探针时在 **P1.c** 处撞到 `Error: ENOENT ... scandir 'D:\Temp\probe07-…-a\logs-traceprobe'`——原因不是崩溃，而是「宿主 store 开关默认关闭 + `info` 级 + 事件名不在常驻名单」被 `isEnabled` 拦掉（`src/store.ts:263-267`）、**压根没进队**，所以连日志目录都没建。改成先 `setSwitch(true,1)` 后复现成功；这条已作为探针 P1.a2 的观测写进上表（作为「放行口径」的事实记录，不当缺陷）。

---

# 6. Lead 独立复核（收口方，独立于第 5 节的重跑）

收口方（Lead）不依赖研究分支的探针与数字，另起三个只读探针 + 两处定点检索，结论与研究分支一致（机制零、材料在），并补上研究分支标为「未查证」的两处包外定点旁证：

| 复核项 | 命令 / 出处 | 观测（原样） |
|---|---|---|
| 真实电话通道上的字段透传 | `node D:\Temp\probe-trace-lead.mjs` | 宿主 `createHostLog` + `registerHostLogPhones`（真 handler）→ 客户端 `createClientLog` 经 `host.call` 走 `wf.logBatch`：批实参键**恰好** `["droppedCount","entries"]`；调用方自造 `{requestId:'req-1'}` 在电话实参里原样、在落盘行里原样；不带字段的行落 `"fields":{}` |
| 客户端侧时间戳是否过界 | `node D:\Temp\probe-trace-lead-2.mjs` | 直接喂 `handleLogBatch({entries:[{ts:111, level:'error', event:'guest.exec', fields:{requestId:'req-9'}}]})` → 落盘行 `ts`＝**宿主接收时刻**（实测 `1791556861716`），**客户端条目的 `ts` 被丢弃**；`fields` 原样保留 ⇒ 跨边界只保 `fields`，连时间戳都由宿主重打 |
| 行内是否有序号/批次号 | `node D:\Temp\probe-trace-lead-3.mjs` | 同进程连发 **200** 条：落盘行顶层键集合恒为 `["event,fields,level,ts"]`；`ts` **去重数 = 1**（200 行同一毫秒）；落盘顺序＝入队顺序；无任何序号/批次号字段 |
| 旧实现是否本来就没有 | `D:\dsh-plugin\dsh-main-check\src\host\logStore.js`（279 行）、`src\client\kernel\log.js`（292 行）——本包 README/测试注记的抽包来源 | 对 trace/span/correlat/requestId/sequence/adopt **命中 0** ⇒ 「无」**不是抽包丢失，旧实现同样没有**（范围仅这两个模块，非整个 monorepo） |
| 消费方是否已在 `fields` 里塞 id | `D:\dsh-plugin\dsh-main-check\src` 388 个文件，正则 `(log\|store\.log\|clientLog)\s*\(.*(traceId\|spanId\|correlationId\|requestId\|runId\|sessionId)`（多行调用可能漏） | **只命中 1 条**：`src/probe-stale.js:60`「`log('debug','snapshot.fanout',{ sessionIdHash: dswsLogHash(String((st && (st.sessionId \|\| st.cwd)) \|\| '')), stale: false, force: … })`」——**散列后的会话标识、单点、debug 级**，属非请求级（会话级、人工约定），不构成机制。（同一 checkout 另有大量 `sessionId`/`requestId` 命中，集中在 deck/API/会话模块，不在日志调用上。） |

**复核结论**：与研究分支一致——机制零、材料在。研究分支的「部分具备」是按「材料算具备」的读法；收口方按票面字面与姊妹票 09 同尺度改判为**无**（两读法事实完全一致，边界见「判定尺度与边界说明」）。改判只动判定档位与两处包外旁证，**未改动任何研究分支的代码引用、探针数字与检索结果**。

---

# 锚点对照（roarr `adopt` / `sequence`；一手来源）

**一手来源（本票实读）**：

- README：https://github.com/gajus/roarr/blob/main/README.md （`### adopt`、`#### sequence value`、`## Log message format`、`### Context property names`、`## Motivation`）。本次经 `https://raw.githubusercontent.com/gajus/roarr/main/README.md` 取得全文；`main` 是该仓库默认分支（经 GitHub API `https://api.github.com/repos/gajus/roarr` 的 `default_branch` 字段核实＝`main`），README 两处锚点原文另经 `/master/` 同名路径取回逐段比对，文字一致。
- 源码：https://github.com/gajus/roarr/blob/main/src/factories/createLogger.ts （`getSequence`、`loggerPrototype.adopt`、`logMessage` 里的 sequence 分支）。
- 类型：https://github.com/gajus/roarr/blob/main/src/types.ts （`Logger.adopt/child/getContext`、`RoarrGlobalState.sequence`、`NestedAsyncLocalContext.sequence/sequenceRoot`）。
- **项目内二手结论（已标注）**：https://github.com/FeatherHunter/dsh-log/issues/10 的 resolution comment（「链路照抄 roarr adopt+sequence（8 库唯一开箱请求级串联）」），落档文字 `issues/10-ts.md:24`、`issues/01-untitled.md:34`。**该结论只是本仓已结决定，不是一手规格**；本票的锚点事实一律以 roarr 的 README/源码为准。

## 锚点 A：`adopt` 是什么（一手）

- 签名（README `### adopt` 原文）：`<T>(routine: () => Promise<T>, context: MessageContext | TransformMessageFunction<MessageContext>) => Promise<T>`。
- 语义（README 原文）：「`adopt` function uses Node.js `async_context` to pass-down context properties. When using `adopt`, context properties will be added to all _all_ Roarr messages within the same asynchronous context」——即在异步上下文里**继承并合并**上下文属性，该上下文内的所有日志自动带上。
- 源码佐证（`createLogger.ts`）：`loggerPrototype.adopt` 内 `nextContext = { ...asyncLocalContext.messageContext, ...context }`，随后 `asyncLocalStorage.run({ messageContext: nextContext, sequence: 0, sequenceRoot, transforms }, () => routine())` ⇒ 子上下文**继承父上下文**再叠加自己的键。
- 限制（README `#### Requirements`）：「`adopt` method only works in Node.js.」；源码里 `isAsyncLocalContextAvailable()` 为假时，先发一条 `logLevel: warn` 的日志「async_hooks are unavailable; Roarr.adopt will not function as expected」，再直接执行 routine ⇒ 浏览器侧没有 `adopt` 能力。
- 相邻 API：`child`（返回追加了 context 的子 logger）、`getContext`（读当前上下文），见 README 与 `types.ts` 的 `Logger` 类型。

**逐条对照 dsh-log**：

| roarr `adopt` 的构成 | dsh-log 有无对应物 | 证据 |
|---|---|---|
| 子日志器继承父上下文字段（`adopt`/`child` 合并 `messageContext`） | **无** | `src/` 无 `adopt`/`child`/`getContext`/`messageContext`（第 1 节）；工厂只返回单实例（`src/host.ts:49-53`、`src/client.ts:198-206`、`src/node.ts:136-154`） |
| 用异步上下文（`AsyncLocalStorage`）自动带给「同一异步上下文内的每一行」 | **无** | `asyncLocalStorage`/`async_hooks` 零命中（第 1 节）；`globalThis` 六处全是读（第 1 节反证 3） |
| 读当前上下文（`getContext`） | **无** | 运行期导出面逐键（探针 P1.a/P5）：`store` 16 键、`client` 22 键，无此方法 |
| 上下文只对「本实例/本异步域」生效、不污染全局 | 无对应物（`src/client.ts:168-169`、`:246-255` 的实例独立性与该性质同向，但它连上下文都没有） | `src/client.ts:246-255` |
| 浏览器侧不可用（roarr 自己明示的限制） | 不适用（dsh-log 无此机制可比） | — |

⇒ **锚点 A：dsh-log 无对应物（0/5）。**

## 锚点 B：`sequence` 是什么（一手）

- 它是什么（README `## Log message format` 表）：「`sequence` | Incremental sequence ID (see [`adopt`](#adopt) for description of the format and its meaning)」——**日志信封的固定顶层字段**，每条消息都有，不需开关。
- 格式与语义（README `#### sequence value`）：ltree 形式 `<top-level sequential invocation ID>[.<async operation sequential invocation ID>]`，「Members of sequence value represent log index relative to the async execution context」，并给出 `0.1.1.0` → `0.1.1.1` 的先后判定示例。
- 源码（`createLogger.ts` 的 `logMessage`）：

  ```ts
  if ('sequenceRoot' in asyncLocalContext && typeof asyncLocalContext.sequence === 'number') {
    sequence = asyncLocalContext.sequenceRoot + '.' + String(asyncLocalContext.sequence++);
  } else {
    sequence = String(globalContext.sequence++);
  }
  ```

  ⇒ 无 `adopt` 时是**全局（进程内）自增计数器** `globalThis.ROARR.sequence`（`types.ts`：`RoarrGlobalState.sequence: number`）；在 `adopt` 域内是 `root.<域内自增>`（`types.ts`：`NestedAsyncLocalContext.sequence/sequenceRoot`）。
- 本票从源码读出的三点边界（供锚点对照用，**不是选型建议**）：① `sequence` 是**字符串**，域内与全局共用同一根号；② 根号取自**进程内**全局计数器 ⇒ 跨进程/跨宿主**不唯一**，不能直接当跨端串联键；③ 浏览器侧没有 `adopt` 域，只剩全局自增。

**逐条对照 dsh-log**：

| roarr `sequence` 的构成 | dsh-log 有无对应物 | 证据 |
|---|---|---|
| 每条日志自动带一个递增序号 | **无** | 落盘行键恒为 `{ts,level,event,fields}`（`src/store.ts:373-375`；探针 P1.e/P4.b）；`sequence|seq|counter` 零命中（第 1 节） |
| 序号可跨异步上下文按层次表达先后 | **无** | 无异步上下文机制（锚点 A）；只有文件物理行序（第 3.2 节） |
| 同一毫秒内的多条仍可比先后 | **无** | 实测 60 条连续日志 `ts` 只有 1 个不同值（探针 P4.a） |
| 进程内全局计数器 | **无**（无逐行计数器；`dropped` 是累计丢弃数） | `src/store.ts:117`、`src/client.ts:250` |
| 跨进程不唯一（roarr 自身的局限） | dsh-log 连进程内序号都没有 | 同上 |

⇒ **锚点 B：dsh-log 无对应物（0/5）。**

## 锚点 C（附带）：请求 id 的官方约定

- roarr README「### Context property names」原文：「Roarr does not have reserved context property names.」随后建议的约定名是 `application`/`logLevel`/`namespace`/`package`——**没有** `requestId`/`traceId` 之类的请求级保留字，也没有跨进程/跨服务串联的官方方案；README 的 `## Motivation` 只说它「allows me to correlate logs between the main application code and the dependency code」（应用代码与依赖代码之间），**未**承诺跨宿主/跨进程。
- 对照 dsh-log：同样无保留字、无跨进程串联（第 3.3 节），且连 roarr 那种「上下文字段容器」都没有（只有逐次传入的自由 `fields`）。
- **这一条与票 09 的口径相邻，本票只标边界，不替票 09 下判断**（`issues/09-untitled.md:7`）。

---

# 判定尺度与边界说明（先写清，再判定）

**本票采用的三段尺度（收口时定版，与姊妹票 09 同标准）**：

- **有** = 包内存在**生成或传播**请求级串联标识的机制，且**跨边界可用**；
- **部分** = 包内已有与串联挂钩的**机制部件**（哪怕只在包内、不跨边界），只是不完整；
- **无** = 包内没有任何串联机制；材料层（调用方自造字段可透传）不计入「具备」。

**按此尺度**：第 1 档不成立（第 1 节零命中 + 第 3 节三个载体全空）；第 2 档也不成立（一个机制部件都没有，只有 `fields` 这个通用自由字段袋）；第 3 档「连材料都没有」不成立（材料在，第 2 节）⇒ **机制维度判「无」，材料维度单列一条事实**。

**边界说明（若把判据读作另一种口径，应升为「部分」）**：

1. 若把「具备」读作「**在调用方约定下**系统能否端到端串起来（不要求包内生成或保证）」⇒ 应记**部分**：材料齐全（`fields` 全链透传、跨边界不被改写，探针 P1.b/P1.c；Lead 探针同证）、两侧行可在同一个文件里对上。**两种读法在事实上完全一致**（机制零、材料全），分歧只在「材料算不算具备」；本票按票面「链路追踪是否具备」的字面判**无**并把这条读法单列，**不替用户定调**。
2. 若把「跨宿主/客户端/插件」读作**跨进程**（插件客户端进程 ↔ 宿主进程）⇒ 无论哪种读法都是**无**：包内既无进程内序号也无跨进程 id（第 3.2、3.3 节），`ts` 在跨进程下更不可靠（毫秒级、可重复，探针 P4.a；Lead 探针 200 条 `distinctTs=1`）。
3. 若把「串联」放宽到「同一个日志文件里的物理行序 = 写入顺序」⇒ 成立，但**无标识可复算**（第 3.2 节）。这不在本票三段尺度内的任何一档，属口径问题，本票不裁。
4. **机制在包外的可能性**：本票主线只覆盖本 checkout；包外只做了两处定点旁证（旧实现两模块零命中、消费方日志调用粗筛，见第 6 节），**未做全仓检索**（见文末「未独立核验 / 存疑项」）。

---

# 待 Q5 / 与本票无关但被带出的问题（只标，不裁）

- **队列满语义与门禁红黄（Q5/Q6）未定**：`issues/01-untitled.md:15`、`:41`。本票探针顺带触到丢弃相关代码路径（客户端 `LOG_QUEUE_MAX = 100`、`src/client.ts:293-297`；宿主 `src/store.ts:286-289`），**本票不判其语义**，涉及处一律标「待 Q5」。
- **常驻名单优先于级别与开关**（`src/store.ts:263-267`）在探针 P1.a2 里再次被看到（`isEnabled('info','host.start')=true` 而 `isEnabled('info','probe.host.req')=false`）；该现象属票 03 已结范围，本票只作事实记录。
- **`README.md:153`「允许字段（之外的键一律不记）」与运行期不拦**（第 2.3 节）——属追踪标识/门禁方向的材料，本票只记录、不裁。

---

# 未独立核验 / 存疑项

- **本仓外检索只做了两处定点旁证（Lead 收口补做）**：① 抽包前的旧实现两个模块（`D:\dsh-plugin\dsh-main-check\src\host\logStore.js`、`src\client\kernel\log.js`）关键词命中 0 ⇒ 不是抽包丢失；② 消费方 `dsh-main-check\src` 388 文件粗筛（单行正则，可能漏多行调用）只命中 1 条日志调用带会话散列（`src/probe-stale.js:60` 的 `sessionIdHash`）。**未做包外全仓系统检索**：真实宿主 monorepo 与插件是否另有旁路串联、是否在别处以别的名字塞 id，仍未穷尽覆盖。本票全部主线结论的范围 = 本 checkout 的 `src/` + `dist/` + `tests/` + 包内文档。
- **`dist` ≡ `src` 未做字节级证明**：本仓 `node build.mjs` 跑不起来（缺 esbuild，票 02/03 已记），本票实测全部跑 `dist/`（2026-10-07 构建，晚于 `src/` 最后改动）。可做的佐证是逐项比对机制：`src/store.ts:290-295/373-375`（入队与序列化）、`src/client.ts:468`（批量实参）、`src/config.ts:107-114`（清单取值）与对应 `dist/*.js` 一致；**未重跑构建**，故实测数字以 `dist` 产物为准。这是本票证据强度的最大缺口（与票 02/03 同款）。
- **真实宿主 RPC 通道未验**：探针用的是「内存注册表 + 真宿主 handler（`src/host.ts:63-80` 的注册形状）」，不是真实宿主 RPC；但字段透传发生在入队与序列化两处（`src/client.ts:298-303`、`src/store.ts:483-491`），与通道实现无关。
- **`host.start` 的真实调用时机未验**：包内无调用点（第 2.4 节第 6 行），何时写启动头由消费方决定；因此「靠 `host.start` 切分进程区间」在实际部署里是否可用，本票只给包内事实。
- **`log.flush.marker` 六轮重试在极端慢盘下的行为**未测（与本票判据无关，仅列）。
- **不属于本票**：文件落盘/目录/按天（票 02）、级别（票 03）、轮转（票 04）、格式（票 05）、聚合（票 06）、隔离（票 08）、**追踪标识字段本身**（票 09）。

---

# 证据清单

**读过的文件与行范围**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全） |
| `src/client.ts` | 1-683（全） |
| `src/config.ts` | 1-415（全） |
| `src/phones.ts` | 1-315（全） |
| `src/host.ts` | 1-81（全） |
| `src/node.ts` | 1-195（全） |
| `src/node-ambient.d.ts` | 1-25（全，确认无 async_hooks 相关声明） |
| `event-list.template.json` | 1-6（全，清单形状） |
| `package.json` | 1-39（全：`exports`、`devDependencies`、`test` 脚本） |
| `README.md` | 54、106、135-147、153、180、196（落盘/字段/清单相关节） |
| `INTEGRATION.md` | 60-62、184、191-205、211 |
| `issues/07-untitled.md` | 1-25（全，票面口径；清理后 `:5-9` 为 Question 区，`Status:` 行 `:16` 已被 Lead 从 `ready-for-agent` 置为 `claimed`） |
| `issues/01-untitled.md` | 1-64（全；`:12` 口径、`:34` #10 结论、`:15`/`:41` Q5） |
| `issues/10-ts.md` | 1-32（全；`:24` roarr 结论） |
| `issues/09-untitled.md` | 1-26（全，边界） |
| `research/02-log-file-capability.md`、`research/03-log-level-capability.md` | 全文（姊妹票先例与交叉印证） |
| `research/09-trace-identifier-capability.md` | 收口时只读引用其结论（追踪标识＝无）与其判定标准 |
| `D:\dsh-plugin\dsh-main-check\src\host\logStore.js`、`src\client\kernel\log.js` | 抽包前旧实现两模块（Lead 收口时定点检索，命中 0，见第 6 节） |
| `dist/{host,client,config,node,phones,store}.js` | 只读产物，用于实测（2026-10-07 构建） |

**跑过的检索与测试（实跑结果）**

- `node D:\Temp\probe-trace-07-scan.mjs`：`src/` 7 文件 × 30 词，**29 词零命中**（详见第 1 节）。
- grep 工具（ripgrep 正则）四处交叉复核：`src/`（两条正则）、`dist/`（零命中）、`tests/`（零命中）、全仓 `*.md`（命中只在 `research/`、`issues/`）。
- `npm test`：**25 用例 23 过 / 2 套失败**（`tests/host.test.mjs`、`tests/client.test.mjs`，`ERR_MODULE_NOT_FOUND` 指向 `D:/src/host/logStore.js`、`D:/src/client/kernel/log.js`），退出码 1。
- `node ./node_modules/typescript/bin/tsc -p tsconfig.json` 与 `node build.mjs`：**本票未复跑**（票 02/03 已记：前者无输出退出 0，后者 `Cannot find package 'esbuild'`）。
- `git status --porcelain`：本票开始前工作区已有既有改动（`M docs/agents/triage-labels.md`、未跟踪 `.local/`、`issues/`、`research/`）；本票只新增本报告，未 commit。

**本票只读探针（均在 `D:\Temp`，未写任何仓库文件）**

| 探针 | 关键结果 |
|---|---|
| `probe-trace-07-scan.mjs` | 词表命中总表；29/30 零命中；非零两词均为事件名/类型名 |
| `probe-trace-07-runtime.mjs` P1 | 三入口导出面逐键；`wf.logBatch` 实参 `{entries,droppedCount}`；调用方字段原样落盘；落盘顺序 ≠ 调用顺序；6 行 `distinctTs=1`；行键恒为 `event,fields,level,ts` |
| 同上 P2 | 清单白名单在运行期不拦字段也不拦事件名；检查器只在离线回 `ok:false` |
| 同上 P3 | `host.start` 只有 `{pid,startedAt,dir}`；四段式文件名含 pid/startedAt；开关文件无 id；导出 summary 无 id |
| 同上 P4 | 60 条连续日志同一 `ts`；客户端一批保序但无编号 |

**Lead 收口复核探针（独立重跑，均在 `D:\Temp`）**

| 探针 | 关键结果 |
|---|---|
| `probe-trace-lead.mjs` | 真 handler 电话通道：批实参键恰为 `["droppedCount","entries"]`；调用方 `requestId` 原样进实参与落盘行；无字段行落 `"fields":{}` |
| `probe-trace-lead-2.mjs` | 客户端条目 `ts:111` 被丢弃，落盘改用宿主接收时刻（`1791556861716`）；`fields` 原样 |
| `probe-trace-lead-3.mjs` | 200 条连发：顶层键恒 `["event,fields,level,ts"]`、`ts` 去重数 1、落盘顺序＝入队顺序 |

**外部来源（一手）**

- https://github.com/gajus/roarr/blob/main/README.md （`### adopt`、`#### sequence value`、`## Log message format`、`### Context property names`、`## Motivation`）
- https://github.com/gajus/roarr/blob/main/src/factories/createLogger.ts （`getSequence`、`loggerPrototype.adopt`、`logMessage` 的 sequence 分支）
- https://github.com/gajus/roarr/blob/main/src/types.ts （`Logger.adopt/child/getContext`、`RoarrGlobalState.sequence`、`NestedAsyncLocalContext`）

**项目内二手结论（已标注，非一手规格）**

- https://github.com/FeatherHunter/dsh-log/issues/10 （resolution comment：「链路照抄 roarr adopt+sequence」）
- `issues/10-ts.md:24`、`issues/01-untitled.md:34`（同结论的落档文字）

**报告位置说明（仓库约定）**：本仓 `research/<NN>-<slug>.md` 的落点约定由姊妹票 02/03 建立——票 02 先说明本仓当时没有 `research/` 既有历史、按票号新建该系列（`research/02-log-file-capability.md` 文末「报告位置说明」），票 03 沿用并明文记录（`research/03-log-level-capability.md` 文末同节）。本报告沿用同一约定落在 `research/07-trace-capability.md`；除本文件外，本票**未改动**仓库内任何源码、测试、README/INTEGRATION 或 `issues/` 下文件，也**未 commit**。

**收口说明（2026-10-09）**：本文件由后台研究分支写成，Lead 收口时做了三件事：① 独立重跑（第 6 节，三个探针 + 两处包外定点检索，结果一致）；② 把判定从「部分具备」改判为**无**，写法与姊妹票 09 对齐（材料层事实单列、另一种读法单列不采纳），理由见「结论」与「判定尺度与边界说明」；③ 更正票面行号（票 07 文件已被 Lead 清掉后端写入的重复骨架，Question 区现为 `:5-9`）。研究分支的代码引用、探针数字与检索结果一字未改。
