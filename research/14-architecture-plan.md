# 0.3.0 架构与源码结构方案（推荐答案）

> 输入：用户五条质量标准（①权威 TS 项目做法 ②第一性原理 ③高级架构师思路 ④专业数据结构与算法 ⑤优秀设计模式）
> ＋用户新授权：「允许拆分所有的 ts 文件，我们的源码目录结构等都需要符合高质量 TS 项目的要求」。
> 现状基线：`src/` 7 个文件平铺（`store.ts` 1660 行、`client.ts` 1065、`phones.ts` 765、`config.ts` 520、`node.ts` 228、`host.ts` 138、`node-ambient.d.ts` 29）；
> 13 套测试全绿、变异表 37 条全 RED；缺陷票 #25/#26 已修，发行面票 #27 未做。

## 1. 一句话结论

把「一个 store 大文件 + 若干同层伙伴」改成**四层同心结构（entries → engine/client/host → platform → core）**：
领域规则（五键行、准入、追踪、保留、文件名）沉到零 IO 的 `core/`；IO 能力收进 `platform/` 的**端口 + 适配器**；
并发与落盘收进 `engine/`；查询与电话收进 `host/`；传输与队列收进 `client/`；进程入口收进 `entries/`。
对外公开面（三个子路径 + 根入口）**逐字不变**，迁移按可验证的小步走，任何一步都不允许出现红灯窗口。

## 2. 目标目录树

```
src/
  index.ts                 根入口（默认 1 行可用）：re-export quick + 常用类型
  core/                    领域层：零 IO、零平台、纯函数与纯类型
    row.ts                 LogRowV3 / LOG_FORMAT_VERSION / buildRowText（五键行的唯一构造点）
    level.ts               LogLevel 判别联合 + 严重度序（准入与折叠都读它）
    outcome.ts             LogOutcome / WriteOutcome 判别联合（替代布尔回包）
    errors.ts              DshLogError + 错误码 + 中文文案单一来源
    ids.ts                 traceId(16hex)/spanId(8hex) 生成与校验
    trace.ts               TraceState / TraceSource / child 继承规则（纯函数）
    admission.ts           队列准入三级歧视链（纯函数：输入队列快照 → 决策）
    file-name.ts           parseLogFileName / listLogFiles / 写序 rank（读写的唯一解析器）
    retention.ts           按天保留的纯计算（cutoff、受保护文件判定）
  platform/                端口与适配（能力协商：能力缺失即降级，绝不假装）
    ports.ts               LogFileService / LogPlatformFs / Timer / Clock 接口（含可选 append/rename/stat）
    fs-node.ts             node:fs/promises 适配（createNodeFileService）
    timer-node.ts          createNodeTimer
    memory.ts              内存实现（测试与嵌入方复用，可选导出）
  engine/                  宿主落盘引擎（单实例，唯一写者）
    dir-lease.ts           目录所有权登记 + 租约 + FIFO 等待（并发核心集中一处）
    flush.ts               批量写盘流水线（写序、封存、审计、重试位）
    switch-file.ts         开关文件持久化（与日志目录解耦，quiet 取占用）
    audit.ts               audit.json 逐次记账
    store.ts               createLogStore 组合根（把上面几件拼起来）
  host/                    宿主电话面（读写分治）
    phones.ts              6 个动作的注册表 + 冻结映射
    query.ts               查询 / 聚合 / keyset 游标 / traceChain
    clear.ts               清空 / 导出（含冲突态降级）
  client/                  客户端（跨进程，只有传输与队列）
    queue.ts               有界队列 + 三级准入 + 重试位
    transport.ts           宿主电话调用 + 诚实计数（accepted/skipped/rejected）
    switch-cache.ts        本地开关缓存与对账（单键）
    trace.ts               客户端追踪上下文（child/why/_shadow）
    log.ts                 createClientLog 组合根
  entries/                 进程入口适配（组合根）
    node.ts                createNodeHostLog / createQuickLog / createNodeFileService
    host.ts                createHostLog / registerHostLogPhones
  types/
    public.ts              对外契约类型（不含 Node 专有类型）
    node-ambient.d.ts      包内最小 Node 形状（**不随包发布**，见 §7）
```

依赖方向（只允许向右）：

```
entries → engine | client | host → platform → core
```

`core/` 不 import 任何 IO；`platform/` 不 import 上层；这条线由 `tests/arch.test.mjs` 静态扫描 import 强制。

## 3. 五条标准逐条落点

| 标准 | 落点 |
| --- | --- |
| ① 权威 TS 项目做法 | 目录即边界（core/platform/engine/…）；`exports` 子路径 + `types` 条件；判别联合回包；`readonly` 输入；`noUncheckedIndexedAccess` 待评估；零 `any`（现状已 0 命中） |
| ② 第一性原理 | 先把「什么必须为真」写成不变式（五键行、error 永不丢、同一目录单写者、查询可见 == 磁盘存在），再让结构服务于不变式；能力（rename/append/stat）缺失时**降级而不是假装** |
| ③ 高级架构师思路 | 端口-适配器 + 组合根；依赖倒置；公开面与实现面分离；先可观测（lastPersistFail/pendingCount）再谈性能；破坏性变更集中在一个版本里一次做完 |
| ④ 数据结构与算法 | 见 §4（所有权登记、FIFO 等待、keyset 游标、三级准入、按天保留） |
| ⑤ 设计模式 | 端口-适配器、组合根、策略（准入/保留/封存策略）、状态（WriteOutcome 三态）、判别联合替代布尔、不变式测试（契约测试） |

## 4. 数据结构与算法（具体落地）

1. **所有权登记（`engine/dir-lease.ts`）**：`Map<key, Map<token, { n: number; permanent: boolean }>>`，登记/交还 O(1)；
   等待者用 **FIFO 队列 `Map<key, token[]>`**（现状是无序 `Set`，已发现「新到者直取越过排队者」的饿死面），唤醒只弹队首，杜绝广播惊群。
   租约预算 200ms 为**有界等待**，超时判冲突且可自愈（`conflictStillLive()`）。
2. **keyset 游标（`host/query.ts`）**：游标 = `epoch|ts|file|line`（物理位置）而不是行偏移；`epoch = 日期 + '#' + hash8(文件集合)`，
   封存/清理/跨天自动失效为 `expired`；追加行不会让翻页重复（偏移游标曾实测重复上一页）。
3. **三级准入（`core/admission.ts`）**：`error/warn` 永不因配额丢弃（挤最旧普通行；无普通行可挤时越过配额，直到 `maxQueue × 10` 病态上限）；
   普通行满则丢新并 `onDrop('queue-full')`。纯函数化后可用属性测试覆盖边界。
4. **写失败重试位（`engine/flush.ts`）**：`retryBuffer` 按**总量**收口（`retryBuffer + queue > cap` 才丢最旧普通行），保序回写、有界重试（5 次、退避 1s、定时器 unref）。
5. **保留（`core/retention.ts`）**：`cutoff = today − (maxDays − 1)`；受保护集合 = 当日可写文件 + 当日封存件 + 开关文件 + audit.json；
   封存件按**写序 rank** 排序（`YYYY-MM-DD.N.log` 的 N 是数字序，字典序会把 `.10` 排在 `.2` 前）。
6. **文件名单源（`core/file-name.ts`）**：`parseLogFileName(name) → { date, seq, sealed } | null`，写侧封存/查询/导出/清理四处共用——
   缺陷 #25（封存件对读侧不可见）的根因正是两侧各自用正则猜文件名。

## 5. 迁移顺序（每步可独立验证）

| 步 | 内容 | 验证 |
| --- | --- | --- |
| S1 ✅ | 删死参数 `sampleRate`（开关文件 `{enabled}`、`setLogSwitch(enabled)`、debug 恒建链） | tsc 0 + 全量绿 + 文档同步（已完成：124/124、tsc 0） |
| S2 ✅ | 建 `core/`：搬 `file-name` / `row` / `level` / `outcome` / `ids` / `trace` / `admission` / `retention`；原文件改为引用 | tsc 0 + 全量绿（行为零变化）。**八块全落**：`file-name`（解析单源 + `logFileDate`）、`ids`（hash8/genHex）、`outcome`（LogOutcome/WriteOutcome 判别联合）、`row`（五键行文本 + utf8Bytes）、`level`（级别语义单源：`isKnownLevel`/`isUrgentLevel`/`isErrorLevel`，收掉散在 store/client 的 11 处字面）、`admission`（腾位/裁剪选行 `findEvictableIndex`/`findTrimmableIndex`，收掉 5 处重复循环）、`trace`（保留字 `RESERVED_TRACE_FIELDS` + 影子搬迁 `relocateReservedFields`，从 client 的 log() 体内抽出）、`retention`（`dayNumber`/`retentionCutoff`/`selectExpiredFiles`/`nextSealIndex`/`sealedNameOf`）。config.ts 原样 re-export（公开面快照逐字不变）。证据：tsc 0、`npm test` 140/140（15 套）、变异表全 RED（M9 锚点改指 `core/retention.js`、M20 改指 flush 循环排空重试位）、dist 15 个 `.d.ts`；store.ts 1663 → 1600 行 |
| S3 ✅ | 建 `platform/`：端口与适配器 | tsc 0 + 全量绿 + 消费者实跑。**已落**：`ports.ts`（`LogFileService`/`LogTimer`/`LogPlatformPath`/`LogPlatformFs`/`LogPlatform` 形状单源，store.ts 改为转出口）、`fs-node.ts`（`createNodeFileService` + 路径↔目标对象转接）、`timer-node.ts`（`createNodeTimer`）；node.ts 转出口，`dsh-log/node` 四个公开名不变。**并落静态门禁** `tests/arch.test.mjs`（8 例）：扫描 src 全部 `.ts` 的 import，强制 core 只引 core、platform 只引 node:/core/platform、config 只引 core、引擎/客户端面不许引入口层与 node:、全包零运行时依赖、`node:` 只出现在 platform 与 node.ts、不许 `require`。`platform/memory.ts` **暂不做**：目前没有消费方，写出来就是无人使用的死代码（等测试或嵌入方真的复用再加） |
| S4 ✅ | 拆 `engine/`：`store.ts` → `dir-lease` + `flush` + `switch-file` + `audit` + 组合根 | 并发/耐久/轮转套件绿。**已落第一块**：`engine/dir-lease.ts`（**215 行**，从 store.ts 原样搬出、逐字比对一致、只加 `export` 前缀；此处原写 216，2026-10-14 复核更正）——目录规范化 / 持有登记 / 写盘租约 / FIFO 唤醒 / 等待预算集中一处；store.ts 1572 → 1367 行。变异 M1a/M2/M19 锚点改指 `engine/dir-lease.js`。证据：tsc 0、148/148、变异全 RED。**已落第二块**：`engine/io.ts`（IO 端口：路径拼接、`路径→目标对象` 解析、读/写服务选择——注入 fs 优先、其次平台对象 fs、都没有就抛中文错）；store.ts 用同名局部引用接线，调用点零改动，1572 → 1331 行。**顺带修正架构门禁**：`layerOf` 原先不认识 `engine/` 目录，把 `engine/io.ts` 误判成入口层而报红——门禁自己把新目录纳入了分层（`engine|client|host/` 与根目录三文件同属第 3 层）。**已落第三块**：`engine/rotation.ts`（131 行，目录清单 / 封存改名 / audit 记账 / 按天保留清理——用工厂把 `config`/`fs`/`io`/`sealSeq` 显式传进来，四个函数体逐字搬运、零改写），store.ts 再降 95 行（1331 → 1236）。**已落第四块**：`engine/pipeline.ts`（821 行，**行流水线**：准入（开关/折叠/配额）→ 队列 → 刷盘（批次/重试位/自监控/退避）——用 Node 脚本按块切片、逐字搬运 707 行，只有 `isEnabled` 读开关那一行改成读注入回调；store.ts 1236 → **541 行**）。同轮新增 `platform/later.ts`（计时器适配，引擎与组合根共用一份）。**已落第五块（收官）**：`engine/switch-file.ts`（123 行，开关状态的读/写/持久化与常驻持有——`createSwitchFile` 注入 `config`/`fs`/`io`/`getCacheDir`/`notePersistFail`/`claimSwitchKey`/`acquireSwitchWrite`/`beginWrite`/`endWrite`；「认领开关文件键」留在组合根，因为它动的是本实例的占用登记）。store.ts 541 → **504 行**：它现在只剩「建库装配 + 常驻持有 + 冲突闸门 + 组合根返回对象」。证据：tsc 0、`node build.mjs` 24 个 `.d.ts`、npm test 148/148、变异全 RED |
| S5 ✅ | 拆 `host/`：`phones.ts` → `query` + `clear` + 注册表 | 查询/分页/接缝套件绿。**已落**：`phones.ts` 746 → **44 行**（只剩组装与转出口），实现按职责拆成 `host/types.ts`（类型契约 81 行）、`host/context.ts`（冲突态查询/目标拆盒/目录清单/今天日期/pid 与启动时间，69 行）、`host/query.ts`（只读查询电话 232 行）、`host/files.ts`（导出/清空/删除，246 行）、`host/aggregate.ts`（查时授权聚合 92 行）。搬运用 TypeScript 编译器 API 取声明区间、逐字搬运（脚本内置逐字校验：24 个声明必须原样出现在新文件里），只有 `pidOf`/`startedAtOf` 由闭包改成显式收 `ctx`（函数体一字不改）。证据：tsc 0、`node build.mjs` 29 个 `.d.ts`、npm test 148/148 |
| S6 ✅ | 拆 `client/`：`client.ts` → `types` + `queue` + `transport` + `switch` + `trace` | 客户端/端到端套件绿。**已落第一步**：类型契约整块下沉 `client/types.ts`（206 行，19 个接口/类型别名逐字搬运，含声明上方注释；`ClientLogInstance` 与 `ClientLogLevel` 留在 `client.ts`——前者引用实现函数、后者依赖运行期常量 `LOG_LEVELS`）。`client.ts` 999 → **880 行**，用 `import type` + `export type` 双份保持公共面与内部可用性一字不变。搬运用 TypeScript 编译器 API 取 **字符区间**（不是行号：`getFullStart()` 落在上一行行尾换行符上，按行删会连带上一个声明的收尾行——第一版就踩了这个坑）。证据：tsc 0、`node build.mjs` 30 个 `.d.ts`、npm test 148/148、变异 48/48 RED。**已落第二步**：再拆三块低耦合实现——`client/switch-cache.ts`（59 行，本地开关读写，`storage`/`debugKey`/`LOG_REV` 由闭包改为显式注入）、`client/transport.ts`（23 行，包体积估算纯函数 + 重试策略常量）、`client/trace.ts`（37 行，traceId/spanId 自动建链）。搬运用**同名包装**（`const ensureSpanId = () => trace.ensureSpanId()` 一类），`client.ts` 里的调用点一个都没改；`client.ts` 880 → **822 行**。证据：tsc 0、33 个 `.d.ts`、npm test 148/148、变异 48/48 RED。**已落第三步**：`client/switch-ops.ts`（171 行，开关对账/保存/超时/代际/失败分类；依赖 `host`/`phoneNames`/`timer`/`state`/`gen`/`cache`/`broadcast`/`log`/`watch` 全部显式注入），`client.ts` 822 → **713 行**。**连带修一条静态断言**：`tests/client.test.mjs` 的「电话名全走前缀拼装、无写死旧字面」原来只读 `src/client.ts`，改成扫「客户端这一层的全部源码」（`src/client.ts` + `src/client/*.ts`）——否则搬走一段就等于把这条检查悄悄删掉。证据：tsc 0、34 个 `.d.ts`、npm test 148/148、变异 48/48 RED。**已落第四步**：`client/forward.ts`（141 行，丢弃汇总行 / 导出失败行 / 开关操作看护；只有 `input.hashFn` → `hashFn` 一处有意改写），`client.ts` 713 → **635 行**。**已落第五步**：`client/send.ts`（193 行，取批与裁剪、宿主回包三态、失败进重试位、有界重试、诚实计数、立刻转发、丢弃计数），`client.ts` 635 → **522 行**；连带把 `LOG_QUEUE_MAX` 从写死的 100 改为配置面单源 `CLIENT_QUEUE_MAX`。**已落第六步（收官）**：`client/write.ts`（212 行，准入判定 / 满时腾位 / 记一行 / 安排转发 + 43 条常驻事件名单，唯一有意改写是 `logSwitch.enabled` → `getSwitchEnabled()`——开关状态仍住组合根），`client.ts` 522 → **394 行**：它现在只剩「依赖装配 + 各 rig 接线 + `child`/`why`/`queryLogs` 三个薄转发 + 返回对象」。证据：tsc 0、`node build.mjs` 37 个 `.d.ts`、npm test 148/148、变异 48/48 RED（M32/M33/M39/M40 四条客户端变异已改指 `client/send.js`） |
| S7 ✅ | 配置面按关注点拆分（`config.ts` 退化为门面）；`entries/` 目录搬迁**不做** | 公开面快照测试（导出名集合）。**已落**：`config.ts` 482 行 → 门面 **61 行** + `config/` 六个小件——`validate.ts`（19 行，标识校验）、`constants.ts`（52 行，公开常量与级别/归类全表）、`phones.ts`（25 行，电话名拼装）、`log-names.ts`（44 行，写侧文件名）、`resolve.ts`（142 行，配置补齐与入参形状）、`event-list.ts`（202 行，事件清单格式与离线检查器）。搬运用脚本按声明逐字搬运（45 个顶层声明**全部**指派去向，否则中止不写盘），门面只 re-export，公开名与类型逐字不变——`tests/public-surface.test.mjs` 的四个入口导出名集合快照就是这条的守卫。**门禁扩展**：`tests/arch.test.mjs` 的 config 规则从「只许引 core」改为「只许引 core 与 config 内部（门面也算配置层）」，并新增一条**循环依赖检查**（config 面内部 import 图无环）；两条新断言都用 %TEMP% 副本故意改坏验证过会红（加 `validate → resolve` 边 → 环检查红；`constants → engine/io` → 越界红）。**`entries/` 目录搬迁不做**：四个入口文件已按层被门禁钉住（入口层只许被入口层引用），搬进子目录要动 `package.json` 的 exports、测试里的 dist 路径与文档，收益只是目录观感——与本仓「不加无人消费的抽象」同一条纪律（同 `platform/memory.ts` 的处理）。证据：tsc 0、`node build.mjs` **43 个 `.d.ts`**、npm test **150/150（16 套）**、变异表 **49/49 RED、0 SKIP、0 GREEN**（新增 M48：门面丢掉 `EVENT_LEVELS` 转出口 → 根入口导入失败，发行面套件红） |
| S8 ✅ | 发行面（#27）：`tsc` 生成 `.d.ts`、`exports` 加 `types` 条件与根入口、ambient 移出发布面、清 deprecated shim | 已完成：`tsconfig.build.json` + build.mjs 产出 8 个 `.d.ts`（缺一个即构建失败）、`exports` 四处带 `types`、根入口 `dsh-log`（环境无关公共面 `src/index.ts`）、`npm pack` 21 文件 88339 字节、消费方临时工程 strict+Bundler/NodeNext 编译 0 错误、与 `@types/node` 形状共存不冲突、故意写错一行必报错；135/135（15 套）、变异 45 条全 RED |
| S9 ✅ | 文档（README 结构图 + INTEGRATION 迁移）+ 变异表补条目 + 终局独立对抗审查 | 变异全 RED + 审查 Go。**已落文档**：README §9 的构建段按现状重写（43 个可转译 src TS → 43 JS + 43 `.d.ts`、发布 91 个文件、压缩包 110.1 kB / 解包 346.8 kB；散列以当次 dry-run 输出为准）、门禁段补第十六套「架构门禁」与用例总数（现 **153 例 / 17 个测试文件 / 16 套**）；新增 **§9.1 源码分层（贡献者视角）**——**五层**树（入口 ← 面与引擎 ← 配置面 ← 平台 ← 领域）+ 每层能引什么 + 门禁规矩 + 两条结构测试（`tests/arch.test.mjs` 分层与环、`tests/public-surface.test.mjs` 导出名快照）。**变异表**已 50 条全 RED（S7 补 M48：门面丢掉 `EVENT_LEVELS` 转出口；S9 补 M49：引擎面反向依赖客户端面），S9 之后补 M50（客户端不按 `entries.length - accepted` 兜底 → 静默丢账）。**门禁再加一条**：`tests/arch.test.mjs` 新增「engine/ 与 client/ 与 host/ 三个面互不认识，也不许反向引用组合根（store.ts / phones.ts / client.ts）」——理由是面与面互相 import 会让同一份语义在两个面里各长一份（历史上 store 与 client 的级别判定与常驻事件表就是这么分家的）；已用 %TEMP% 副本故意改坏验证会红（`engine/io.ts → client/send.js`），未变异副本 **11/11** 绿。**审查**：终局独立对抗审查两轮（77760636、277d5b3e）均回 **Go（窄口径）**，其必改项（多行 import 解析盲区、重试位子句无回归网、README 六层/散列/套件清单口径、`send.ts` 静默丢账）已逐条修掉并复验。**真机验收（Lead 亲跑，2026-10-14）**：`npm pack` 出 `dsh-log-0.3.0.tgz`（91 文件）；`npm publish --dry-run` 实测压缩包约 111 kB / 解包约 349 kB（体积与散列随打包时刻变化，以当次输出为准）→ 装进临时工程 `%TEMP%\consumer-real` → ①运行时冒烟：`await createQuickLog(dir)` 写 warn+error 两行、`await log.ready` 后落盘 `<cacheDir>/logs-quick/2026-10-14.log`，2 行、键恰 `[event, fields, level, ts, v]`、`v===3`；②类型验收：消费方 `tsconfig` 用 **`types: []`（不装 @types/node）** 编译 `import ... from 'dsh-log' | '/node' | '/host' | '/client'` 四个入口 → **0 错误**；③故意写错一行 → `error TS2339`（类型不是 any）；④从零构建可复现：删掉 `dist` 重跑 `node build.mjs` → 86 个产物与删除前**逐字节一致**（43 JS + 43 `.d.ts`）。**发布状态（2026-10-14 更新）**：0.3.0 **已发布**到官方源（`latest` = 0.3.0、`gitHead` = `c77ea6e`、93 文件 / 134.0 kB 压缩 / 410.9 kB 解包、包内文档与仓库逐字一致、陌生工程装一次运行与类型冒烟都过；原始输出与四项核对见 `notes-publish-drill.md` 第〇节）。上面那句「发布前提：`npm whoami` 报 `ENEEDAUTH`、需先 `npm login`」是发布之前的状态，现已由维护者提供的自动化 token 完成，不再需要交互式登录 |

每一步都是「先绿后动」：移动代码时**不改行为**，行为变更单独成步（S1）。

## 6. 不做的事（以及为什么）

- **不拆成多包（monorepo/workspaces）**：包只有 6 个模块、单一发布面；多包会带来版本对齐与构建复杂度，收益为负。
- **不引入依赖注入框架 / 装饰器 / 元数据反射**：与「三入口零依赖 + `types: []` + 手写最小形状」冲突。
- **不实现采样**：`sampleRate` 是死状态（写了从不读），实现它等于新增一条丢行通道，与「error 永不丢」冲突 → 删参（S1）。
- **不追 100% 覆盖**：以**接缝不变式**为主（磁盘本桶行多重集 === 查询可见行多重集），单点覆盖为辅。
- **不拆 `store.ts` 只为行数**：拆的依据是「职责与变化原因」，不是行数；`engine/` 的四个文件各自有独立失败面。

## 7. 已知边界（写进 README，不藏）

- 跨进程零保护（登记表是模块副本级）：同目录两个进程会交错，文档已写成风险提示。
- 包内最小 Node 形状（`node-ambient.d.ts`）**不发布**：发布面只给 `.d.ts`，消费者用真 `@types/node`，避免 TS2451/TS2309 冲突。
- 宿主入口不解析符号链接（键取调用方给的路径），同步入口解析（realpath）。
- 真机 rename/append 失败面只在内存 fs 验过。

## 8. 验收门（每个 S 步都要过，终局全过）

`tsc --noEmit` exit 0；`npm test` 全绿；变异表全 RED（无 SKIP/GREEN）；`dist` 与 `src` 重建零差异；
消费者工程（`strict` + `Bundler`）`tsc` 通过、`import 'dsh-log'` 与 `dsh-log/node` 都能解析到类型；
`npm pack --dry-run` 文件清单与文档逐字一致；独立对抗审查 Go。

**收尾时的实际值（2026-10-14，commit `fd4497a` 之后又补了两处对抗审查必改）**：`npm test` **176/176（19 套）**、
变异表 **68 条全 RED**（脚本已随仓：`scripts/mutation-check.ps1`，非 RED 即 exit 1）、`npm pack --dry-run` 93 文件
（44 JS + 44 `.d.ts`、压缩包 121.0 kB）、实测长跑 6 分钟通过（`tests/soak.mjs 6`）、CI 三作业
（`.github/workflows/ci.yml`）在 push 后已触发并已有两个平台作业绿（ubuntu/Node 22、windows/Node 24）。
Track 3 也落地了：`appendText` 能力（写量 O(全文)→O(新增)，跨进程真机 16/16 全落，对照改造前 9/16）
+ `foreign-write` 事后可观测；随后对抗审查又补了两条：**追加能力的首次信任检查**（撒谎/抛错的适配器
不再静默吃行，退回读改写 + 诊断）与**按行边界切块追加**（≤4 KB，大块 O_APPEND 写会把行撕成两半，
实测 64 KB 行有 2 条坏行、切块后 0 条）。

## 9. 可复核性与诚实边界（2026-10-14 独立审查后补）

- **上表各 S 步的证据是「当时快照」**：S2 的 140/140（15 套）、S3 的门禁 8 例、S8 的 21 文件 88339 字节、S9 的「未变异副本 10/10 绿」，都是那一步跑完时的数字。测试与门禁此后仍在增长（收尾时 173 例 / 19 套），这些数字**今天复跑不出来**——它们记录的是历史进度，不是当前验收值。当前验收值看第 8 节末段的「收尾时的实际值」、README §9 与最后一次 `npm test` 输出。
- **「逐字搬运」无法用 git 独立复核**：仓库 git 历史停在 0.2.x，0.3.0 的 `src/`、`dist/` 基本未入库、没有中间提交，因此不存在「搬运前」的版本可比；搬运脚本（`.local/extract-*.mjs`）也不随包发布。可复核的替代证据是**行为等价**：每步之后跑全量测试 + 变异表，且 `dist` 能由 `src` 重建出逐字节相同的产物。要真正逐字复核，需要在重构前打一个基线提交——这次没有，如实记在这里。
- **变异脚本现已随仓**（`scripts/mutation-check.ps1`，CI 的 windows 作业直接跑）：它开跑时把 `dist`/`package.json`
  冻成快照（打印指纹）并在每轮从快照复位，所以「边改边跑」不会再让同一次跑表落在不同构建上；调单条用
  `-Only M63`，非 RED 的条目会打印原始输出（区分「断言没咬住」与「pattern 指错了用例」）。

## 10. 实现期验证记录

自查咬出的缺陷（含最严重的一条：假 rename 适配器导致整篇被覆写、12500 行静默消失）、门禁现状、长跑自检与诚实边界，见 **[research/15-implementation-verification.md](./15-implementation-verification.md)**。那份记录里的数字随每次改动刷新，本节各 S 步的数字保持「当时快照」口径。
