# 上游插件给 dsh-log 提的两条需求：事实核验与第一性原理分析

- 日期：2026-10-15
- 输入：`D:\Temp\handoff-dsh-log-asks-20261015.md`（另一个插件仓的交接文档，**不在本仓**）
- 被审版本：`dsh-log@0.3.2`（本仓 HEAD `86d1ede`；对方文档写的是它们实装的 0.3.1）
- 本文的定位：把对方的两条需求逐条核到实现上，给「做 / 不做 / 怎么做」的推荐，并留下证据。细节结论以本文为准，对方文档里的措辞若有出入以实测为准。

---

## 0. 判据（第一性原理那一段）

对方给的尺子是三件事：**①每个环节都能交日志 ②多插件不覆盖 ③第三方能用一条命令把日志交给我们**。这把尺子本身是对的，本文沿用。

我再补一条不变量，它是第 ③ 条能不能成立的分水岭：

> **一份日志目录 + 一个只读工具 = 交接所需的一切。** 如果一份交接产物必须先把「写日志的那个进程」重新造出来（它的依赖、它的工作目录、它的运行时），那它就不是产物，是复现步骤。

下面两条需求，A 打的是尺子 ①，B 打的是尺子 ③ 与这条不变量。

---

## 1. 需求 A：宿主侧写入路径缺 trace 槽

### 1.1 对方主张 vs 实测

| 对方主张 | 实测 | 判定 |
| --- | --- | --- |
| `core/row.js:16` / `store.d.ts:23` 只有三个参数，宿主侧「结构上没有位置」 | 签名属实（`buildRowText(level,event,fields)`、`log: (level,event,fields) => LogOutcome`） | 签名属实 |
| 因此宿主行带不了 traceId/spanId | **不成立**：`fields` 是原样透传的 map，宿主行今天就能带，而且 `--trace` 立刻命中 | 主张半错 |
| 建链只长在客户端 | **成立**：`dist/client/write.js:110-122` 有 `ensureTraceForLevel`/`ensureSpanId`；`relocateReservedFields` 只被 `dist/client/write.js` 引用，宿主路径**没有**保留字搬迁 | 成立 |

实测（`.local/probe-asks.mjs`，真 dist、真临时目录）：

```
宿主行落盘： {"v":3,"ts":...,"level":"warn","event":"probe.step","fields":{"k":1,"traceId":"T-HOST-1","spanId":"AAAA1111","seq":7}}
CLI --trace T-HOST-1 → 命中：
  2026-10-15 03:00:39.454 WARN  probe.step              (k=1, traceId=T-HOST-1, spanId=AAAA1111, seq=7)
```

也就是说：他们提的验收标准（「宿主侧写一行 → 落盘有 traceId/spanId → `--trace` 命中」）**今天手工就能满足**。

### 1.2 真实缺口在哪里

不是「没有槽」，是**没有 SDK 提供的链上下文**：

1. **没有自动建链**：宿主侧每一步都得调用方自己编 traceId，忘了就断链；
2. **没有继承**：客户端有 `child()`；宿主侧没有「这次更新 = 一条链」的载体，19 个环节只能靠人手传字符串；
3. **两套保留字语义**：客户端里 `traceId/spanId/seq` 是保留字（调用方自带会被搬进 `fields._shadow`），宿主路径则是**裸透传** —— 同一个字段名在两个面上归属不同。今天它让「手传 fields 能用」，代价是约定只兑现了一半；
4. **下游已经依赖这套约定**：`--trace` 过滤、`traceChain` 整链查询都按这些字段名工作。上游只实现一半，等于把「链能不能串起来」留给每个插件自己保证。

### 1.3 推荐设计（上下文式，不用 async_hooks）

```js
const t = host.store.trace({ traceId? })   // 一段工作流一个上下文（缺省自造 16 位十六进制）
t.log('warn', 'wf.resolve.done', { count: 3 })   // 自动带 traceId/spanId/seq
const t2 = t.child()                        // 下一步：换 spanId，seq 继续单调
t2.log('warn', 'wf.install.done', {})       // 同一 traceId，--trace 一次拉全
```

- **理由**：trace 是**相关性**机制，它的生产者必须是「一段工作流」的拥有者。宿主侧 `store.log` 是低层写入面，不该猜；给一个显式上下文对象，与客户端 `child()` 同构，语义可以逐字复用。
- **seq/spanId 语义与客户端对齐**：同一 traceId 内容内 `seq` 单调、`child()` 换 `spanId` —— 这样 `query.traceChain` 的 `(seq, ts)` 排序对宿主行同样成立。
- **保留字所有权规则（推荐）**：谁声明了链路，谁拥有保留字。用了 `store.trace()` → SDK 拥有，调用方再传 `traceId` 进 `fields._shadow`（与客户端一致）；直接 `store.log(...)` → 没人声明链路，`fields` 原样透传（**保持今天的行为不变**，不破坏现有手动用法）。
- **不做**：`AsyncLocalStorage`/`async_hooks` 自动继承。隐式全局状态、把环境面从「Node 宿主」扩到「有 async_hooks 的运行时」，与本包三入口零运行期依赖、类型只认最小形状的纪律冲突；显式传递是这个仓一贯的选择。
- **能力归属**：这套东西属于引擎/领域层（`core/` + `engine/`），不属于插件。理由：保留字、`_shadow`、`--trace`、`traceChain` 都是本包的约定与能力，让每个插件各写一遍必然漂移。

### 1.4 修订后的验收

1. 宿主侧用 `store.trace()` 写 3 步：落盘行都带同一 `traceId`、`spanId` 每步不同、`seq` 单调；
2. `dsh-log --trace <id>` 与 `handleLogQuery({traceId})` 都能按序拉回这三行；
3. 上下文里再显式传 `traceId` → 进 `fields._shadow`（与客户端同一条断言）；
4. **不破坏**：不经上下文直接 `store.log(level,event,fields)` 的行，落盘形状与今天逐字节一致（回归线）。

---

## 2. 需求 B：读侧拿不到打包导出

### 2.1 对方主张 vs 实测

| 对方主张 | 实测 | 判定 |
| --- | --- | --- |
| 导出是 store 的方法 | 属实：`store.handleLogExport(args)` 回 `{ok,fileName,bytes,fallback,text,summary,dir,path}`（`dist/store.d.ts:63`） | 成立 |
| CLI 只有 `tail`，没有 export | 属实：选项只有 `-f/-n/--level/--since/--trace/--json/--no-color/-h/-v` | 成立 |
| 导出要建写侧实例才能拿到 | 属实：它是 store 的方法，而 store 要先有宿主依赖、要登记目录、开关/启动头都在写侧 | 成立 |
| 导出含 `pluginVersion/os/cwd/logSwitch/header` 摘要 | 属实，但**这四项里有三项是「导出者进程」的事实**，不是日志产生者的事实 | 半错（见 2.2） |

实测（同一探针）：

```
summary = {"pluginVersion":"unknown","os":"win32","cwd":"D:\\dsh-plugin\\dsh-log","logSwitch":{"enabled":false},"header":null}
调用 handleLogExport 前后，日志目录内容不变 → 导出本身不写日志目录
```

`cwd` 那一格是**当时那个进程的工作目录**（也就是跑 CLI 的机器/目录），`pluginVersion` 在没给版本时是 `"unknown"`。所以「照原样搬到读侧」会产出一份**写着读者环境**的交接文本 —— 比没有更糟。

### 2.2 关键发现：目录不自描述

写侧其实已经把一部分事实写进日志了——`store.writeStartupHeader()` 落的是一条普通行（实测）：

```json
{"v":3,"ts":...,"level":"info","event":"host.start","fields":{"pid":40844,"startedAt":"2026-10-14T19:01:25.715Z","dir":"D:\\Temp\\dsh-hdr-PNlif0\\c"}}
```

有了它，纯读者能忠实重建 `pid/startedAt/dir`。**但 `pluginVersion/os/cwd` 不在任何一行里** —— 它们只存在于写侧进程的内存中，进程一走就没了。这就是 B 的病根：不是导出能力放错了层，而是**日志目录没有把「谁写的、在什么环境写的」记全**。

### 2.3 推荐设计（三层，全是加法）

1. **写侧补一次环境自述**：`host.start` 行的 `fields` 可选扩为 `{pid, startedAt, dir, pluginVersion?, os?, arch?, node?, cwdHash?}`（缺就省略）。取不到的不猜；`cwd` 用哈希（与既有「诊断行不带真实路径」的口径一致），需要粗定位的人仍能看出「同一台机器同一目录」。
2. **读侧纯函数**：`summarizeLogDir(dir)`（只读、零写）→ 与 store 导出**同形**的摘要；文本装配提成共用函数（`assembleExportText`），两条产出路径字体一致，下游工单处理不必分支。取不到的字段一律 `null`/`"unknown"`，**禁止用读者环境顶替**。
3. **CLI 薄壳**：`dsh-log export <目录> [-o 文件] [--json]`，默认打到 stdout；仍然只读日志目录（产物写到别处，或由人重定向）。

### 2.4 修订后的验收

1. 只给一个日志目录（不建 store、不写任何文件）→ 产出含 `dir/files/行数/按级别与事件统计/首末时间/host.start 的 pid+startedAt+（若有）pluginVersion+os+cwdHash/logSwitch（旁边有开关文件才读）` 的自包含文本；
2. 在**没有**环境自述的旧目录上，这些格子显式给 `unknown`，且**不得**出现读者的 `cwd`/`os`（这条要写成断言）；
3. 同一目录下 `dsh-log export` 跑完前后，目录内容逐字节不变（只读承诺的回归线）。

---

### 2.5 顺带一问（**不是**我提的需求，取决于他们的流程）

如果他们的「一次更新」会跨进程（例如某一步 spawn 子进程、子进程再记日志），那么链上下文必须**跨进程传递**：环境变量是本包里唯一不需要新依赖的载体（`DSH_LOG_TRACE_ID` 之类），SDK 只需给一个 `store.trace({ traceId: process.env.DSH_LOG_TRACE_ID })` 的取用姿势就够了 —— 机制在调用方，约定可以写进文档。这条**没有被他们的材料证实**（他们的 19 个环节是否跨进程，我不知道），所以我只把它列成问题，不列成需求。

---

## 3. 对方撤回的三条：复核（我不重新提出）

| 撤回项 | 他们的理由 | 我的复核 |
| --- | --- | --- |
| ① 跨进程租约 | 实测 2×1200 行一条不少；上游主动检测 `foreign-write` 并留 warn 自监控行；重试位明写 | **同意**。与我们自己的 0.3.x 证据一致（追加写 16/16、`foreign-write` 诊断、`log.persist.fail`）。跨进程是「容忍 + 观测 + 重试 + 计数」，是设计选择 |
| ② 清单合并上游化 | 合并是策略（同名事件谁说了算），推给上游＝替所有人裁一次 | **同意**。机制在包内（`eventList` 是普通数据输入），策略留在集成方 |
| ③ 开关热更新 | 受益路径是「第三方在运行中改另一个实例的开关」，等于造第二权威；上游把开关定为宿主权威 | **同意**。正解是走电话 `<prefix>.logSetSwitch`（宿主权威、立即生效）或把集成方的 `logCtx` 传进来 —— 文件只是持久化，不是活通道 |

结论：这三条**不要重新提出**，判定成立。唯一值得补一句的是 ③ 的正向路径（电话/上下文），写在文档里比写成需求有用。

---

## 4. 对方的另外两条对齐备注

1. **`tail` 子命令**：他们写「这是我们的问题：我们自己改文档即可」。**上游已经修了**：`dsh-log@0.3.2`（2026-10-15 发布，gitHead `6c8a0a5`）里 `dsh-log tail <目录>` 与 `dsh-log <目录>` 完全等价、stderr 干净。他们升级到 0.3.2 即可，不必改文档也不必迁就。
2. **`discoverLogDirs` 的 `logs-*` 注释与代码不一致**：实测——把日志放在 `<root>/<任意子目录>/<日期>.log`，给 `dsh-log <root>` **今天就能扫到**（探针 ⑤：命中、stderr 空）。他们的担心（哪天有人把代码改成跟文档一致，就扫不到了）是**真实风险**。我的推荐不是改代码，而是**把行为写成契约**：注释与 README 明确「往下看一层，不要求 `logs-` 前缀」，并补一条**回归线**（现有 `tests/cli-tail.test.mjs` 的「目录发现」用例用的是 `logs-cli-demo`，带前缀，覆盖不到这条）。

---

## 5. 我建议做 / 不做

**做（按成本排序，全是加法，不破坏 0.3.x）**

| 优先级 | 事项 | 落点 | 成本 |
| --- | --- | --- | --- |
| P0 | 读侧摘要 + `dsh-log export` | `core/`（纯函数）+ `cli/` | 小 |
| P0 | `host.start` 行补可选环境自述（`pluginVersion/os/arch/node`） | `engine/pipeline.ts` | 小 |
| P0 | `discoverLogDirs` 契约化（注释 + 一条回归线） | `cli/tail.ts` + `tests/cli-tail.test.mjs` | 很小 |
| P1 | 宿主侧 trace 上下文（`store.trace()`）+ 保留字所有权规则 | `core/trace.ts` + `engine/pipeline.ts` + `store.ts` | 中 |

**不做**：跨进程互斥、清单合并上游化、开关文件热更新（同对方撤回结论）；读侧「替调用方建一个写侧 store」（那会把只读工具变成写侧：登记目录、写开关、写启动头）；`AsyncLocalStorage` 隐式链继承。

### 5.1 做完之后是什么样子（把 A、B 合起来看）

集成方的每一次更新 = 一个 `traceId`；19 个环节各是一行带 `spanId`/`seq` 的宿主行；收尾时第三方（或他们自己）只拿那个日志目录跑一次

```
dsh-log export ./cache/x            # 自包含文本：环境自述 + 行 + 统计 + 开关状态
dsh-log --trace <id> ./cache/x      # 同一条链的全部环节，按 seq 排
```

就能把「这次更新发生了什么」完整交出去 —— 不需要 DSH、不需要他们的进程、不需要来回追问版本与系统。这才是尺子 ① 与 ③ 同时成立的样子。

---

## 6. 两个需要拍板的点

1. **A 的 API 形状**：`store.log(level, event, fields, trace?)`（参数式）还是 `store.trace()` 上下文式？**推荐上下文式**（可组合、可继承、与客户端同构；参数式会让每个调用点都要自带 span 语义）。
2. **保留字规则的范围**：只在用了上下文时启用搬迁（**推荐**，不破坏今天手传 `fields.traceId` 的用法），还是全局统一（更干净，但会让今天手传的用法在升级后丢掉 `--trace` 命中，属于行为变更）。

---

## 7. 证据清单

- 探针：`.local/probe-asks.mjs`（宿主行带三件套 + `--trace` 命中 + 导出摘要 + 无前缀目录扫描）、`.local/probe-header.mjs`（`host.start` 行真实字段 + 导出摘要）
- 引用：`dist/store.d.ts:23`（三参 `log`）、`:63`（`handleLogExport`）、`dist/core/row.js:16`、`dist/client/write.js:110-122`、`dist/core/trace.js:17`（`relocateReservedFields` 只被客户端引用）、`dist/store.js:326-336`（`writeStartupHeader`）
- 既有回归线：`tests/trace-24.test.mjs`（客户端链）、`tests/cli-tail.test.mjs`（读侧命令行）、`tests/paging-20.test.mjs`（`traceChain` 翻页）
