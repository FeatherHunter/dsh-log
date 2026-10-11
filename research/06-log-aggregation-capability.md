# 结论

**整体判定：部分具备（按 2026-10-09 用户确认口径；严格读法下的判定见本节末）。**

判据按票面口径取「跨插件**或**跨进程的集中收集与查询」两项能力，拆成四个可查面：跨进程收集、跨插件集中、查询、以及「相对现在只本地落盘+手动导出」的增量。逐面判定如下。

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 把日志送出本进程／本目录的**通道** | **有**（一条，且只有一条） | 客户端经宿主调用器把批次发给宿主的 `logBatch` 电话，宿主接住后按本地落盘链路写自己的当天文件（`src/client.ts:478-479`、`src/store.ts:477-497`、`src/store.ts:403`）。全包**零网络**：`src/*.ts` 与全仓文本产物里没有任何 `node:http`／`node:https`／`node:net`／`fetch`／`upload`／`remote`／`transport`／`sink` 的实用引用（探针 A：首扫 29 个文件、Lead 复跑 33 个文件，`src/` 命中数都只有 1，且那 1 处是文档示例里的 `fetch` 字符串） |
| 2 | 跨**进程**集中收集 | **部分**（通道成立，集中落点只到本插件宿主） | 那条唯一通道真的把行并入宿主同一落点（探针 C 实测 `guest.exec` 进宿主文件），但落点是「当前插件自己的宿主实例用自己的 `getCacheDir()` 写的自己那份目录」（`src/store.ts:385-403`），不是任何第三方可查的集中点。进程边界实测：两个独立子进程各建库写日志 → 各写 `<cacheDir>/logs-<标识>/<当天>.log`，没有第三个汇总落点（探针 D） |
| 3 | 跨**插件**（多 pluginId）集中收集 | **无** | 目录与开关文件按 `pluginId` 天然分开（`src/config.ts:87-98`），实测 `logs-alpha` / `logs-beta` 互不串（探针 B）；电话注册表由调用方传入、每实例一份，没有全局表（`src/host.ts:55-80`）；包内没有任何把多个插件的行收进同一处的机制 |
| 4 | **查询**（检索／合并／过滤接口） | **无** | 唯一读日志的电话 `logExport` 只读**一个**按日期拼出的文件（`src/phones.ts:129-138`），回 8 键 `ok/fileName/bytes/fallback/text/summary/dir/path`（`src/phones.ts:188-197`）；跨天、跨目录、跨插件的检索入口不存在；多传 `format`/`level`/`pluginId`/`limit`/`query` 一律被忽略、`text` 逐字不变（探针 C）。本仓也没有任何日志查询用的 GUI／命令行入口 |
| 5 | 相对「只本地落盘+手动导出」的增量 | **有，且只此一处** | 增量就是第 1 条那条「插件客户端半区 → 宿主半区」的**自动**转发链；它把行从客户端内存队列搬进宿主私有目录（探针 C 实测转发行确实落进宿主文件）——按确认口径，这一条算「跨进程收集」的达成部分；但**不跨插件**、也不提供任何查询面 |

## 判定口径（2026-10-09 用户确认，本票据此定稿）

1. client→宿主自动批量转发（`logBatch`，跨插件客户端半区／宿主半区边界）**算**「跨进程集中收集」的达成部分——票面写「跨插件**或**跨进程」，且排除项只有「本地落盘+手动导出」。
2. 「查询」必须存在不靠人手翻文件的检索面才算；仅 `logExport` 回当天原文+目录/摘要**不算** ⇒ 查询这一半判「无」。
3. 判定单元以本包三入口（host/client/node）自身提供的能力为准，平台或外部收集器只作旁证。

口径落地后的判定 = **部分具备**：第 2 条（跨进程收集）**部分**成立——这条通道与 electron-log 的 IPC transport 同型（第 5.3 节把两者都记「有一条」），但它只在**同一插件的两个半区**之间，集中落点就是该插件自己的宿主目录；第 3 条（跨插件集中）**无**、第 4 条（查询）**无**，两半合起来即「部分」。

## 严格读法：同样记录在案（供升级建议票取用）

**读法 B（严格要求存在一个第三方可查的集中汇点，pino transport / electron-log remote 那种）→ 判定：无。**

- 全包没有任何「第三方／外部落点」概念：5 个电话动作名冻结为 `['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']`（`src/config.ts:26`），其中没有任何一条能把行送到本插件之外；`dsh-log/node` 入口的 import 只有 `node:fs/promises`、`node:path` 与包内三文件（`src/node.ts:20-26`，探针 E 实测导出键仅 `createNodeFileService`／`createNodeHostLog`／`createNodeTimer`）。
- 落盘者唯一且私有：`src/store.ts:6`「宿主是唯一的落盘者」，写盘路径全部由调用方传入的 `getCacheDir()` 决定（`src/store.ts:385-403`）。
- 全仓无 GUI／CLI 查询入口（`package.json:15-19` 只导出三个入口，`scripts` 只有 `typecheck`/`build`/`test`）。
- 跨插件集中同样不成立：多 pluginId 的落点天然分开（`src/config.ts:87-98`，探针 B 实测 `logs-alpha`／`logs-beta` 各自成目录且互不含对方事件），包内无任何跨插件汇聚机制；两个独立进程分别建库时各写各自目录，没有任何一处能同时看到两个进程的行（探针 D）。

**两个判定的差别只落在第 2 条那一句上**：承认「插件客户端半区 → 同一插件的宿主半区」这条跨进程通道算「跨进程收集」→ 得「部分具备」（用户确认口径）；要求必须是第三方可查的集中汇点 → 得「无」。**严格读法下的「无」照样成立**，且它标出的正是升级要补的两样：集中汇点 + 可查询。

> **过程注记（诚实记录）**：后台研究批次在收到上述确认口径之前先写了初稿，初稿在两种读法下都判「无」；本票按用户确认口径把 headline 定为「部分具备」，并把初稿的严格读法结论原样保留在上面，不作掩盖。

本票只给结论与证据，不改代码、不提实现建议、不做方案选型。凡引用均给 `路径:行号`；外部来源给 URL；实测部分为只读探针（跑在 `D:\Temp`，未改动仓库任何文件）。

---

# 判据与口径（出处，非本票自拟）

- **票面判据**：`issues/06-untitled.md:7`——「按确认口径判定日志聚合是否具备：跨插件或跨进程集中收集与查询（相对现在只本地落盘+手动导出）。已知 README 明说不自动上报，需实锤。对标锚点：pino transport / electron-log remote（见 Decisions）。」；输出为「有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。」（`issues/06-untitled.md:9`）
- **父图口径（本票沿用的「聚合」定义）**：`issues/01-untitled.md:12`——「口径（Round1 已确认）：**聚合=跨插件或跨进程集中收集与查询（相对现在只本地落盘+手动导出）**；链路追踪=一个请求跨宿主/客户端/插件的端到端串联；追踪标识=每条日志带的 trace/requestId 字段；第三方=泛指未来任意插件；隔离=全栈（电话名/落盘目录/开关文件/客户端存储键/全局函数）。」
- **本票要实锤的那句文档**：`README.md:34`——「**本包不做什么**（需要这三样得在调用方自己那层做）：不自动上报日志，只做本地落盘加手动导出；不自动轮转，也不自动清理旧文件。」
- **父图 Out of scope（不在本票范围）**：`issues/01-untitled.md:50`——「自动上报/轮转/清理的实现本身（超出自查）」。
- **对标锚点的用途（只看能力面，不做选型）**：`issues/06-untitled.md:7` 与 `issues/10-ts.md:26`（GitHub #10 已结，结论「聚合借鉴 pino+electron-log」）。本节只把「聚合」这个词在两个成熟库里的最小能力面写清楚，**不写本包该照哪个做**。
- **跨进程这一半的一手出处（父仓，不在本仓）**：本仓客户端只认调用方传入的 `call`（`src/client.ts:59-61`），它跨的是哪条边界由宿主实现决定，本包不定。父仓 DSH 插件的真机实现是：客户端侧把 `host.call('wf.logBatch', …)` 去掉 `wf.` 前缀交给 `conn.rpc.call(...)`（`D:\dsh-plugin\dsh-main-check\src\seam\rpc.js:31-40`、同文件 `:22-24` 通道名 `dsws`、`:14-19` 载体口径 `/api/dsws`），宿主侧在同一个 `_log()` 单例上注册五个电话名（`D:\dsh-plugin\dsh-main-check\src\host\index.js:311-317`），宿主经 `rpcChannel.js` 把通道注册上去（同文件 `:330-337`）；父仓研究记为「权限为只接受本机回环」（`D:\dsh-plugin\dsh-main-check\research\330-host-persistence.md:27`）。**这是本机回环 RPC，不是网络上报；本票未在活的 DSH 宿主里直接观测过这一跳**（见「未定项」）。

---

# 1. 「把日志送出本进程／本目录」的通道：有，且只有一条

## 1.1 全仓通道扫描：零网络、零外部 sink

只读扫描 29 个文本文件（`.ts`/`.mjs`/`.js`/`.json`/`.md`/`.sh`/`.d.ts`，跳过 `node_modules`、`.git`、`.local`、`issues`、`dist`），词表 `upload/remote/http/https/fetch/post/transport/sink/socket/WebSocket/net./axios/sendBeacon/上报/上传/远程/集中/聚合/aggregate/collect/采集/汇聚`，另单扫 `node:http`、`node:https`、`node:net`、`node:dgram`、`node:tls`、`undici` 六种网络模块引用（探针 `D:\Temp\probe-agg-06a.mjs`）：

| 位置 | 命中 | 是否构成送出通道 |
|---|---|---|
| `src/` 全目录 | **1 行**：`src/node.ts:16` 注释里的示例 `{ step: 'fetch' }` | 否——字符串示例，不是调用 |
| `README.md:34`、`README.md:105` | 「不自动上报日志」；电话表里的「客户端调宿主，批量上报」 | 否——前者是文档声明，后者指的是插件内部那条链 |
| `INTEGRATION.md:52`、`tests/node.test.mjs:48` | 示例字段 `step: 'fetch'` | 否 |
| `notes-publish-drill.md`、`package.json`、`publish-wizard.sh` | `https://registry.npmjs.org/` 等发布目标 URL | 否——发布流程，与运行期日志无关 |
| `docs/agents/*.md` | `postgres`、`fetch the relevant ticket` | 否 |
| 六种网络模块引用 | **全仓零命中** | — |

**结论**：本包运行期不存在任何 http／网络／远程／上传／外部 sink 代码路径。这也正面回答第 6 项：`README.md:34` 的「不自动上报日志」在**送出通道**这一层成立（详见第 5 节）。

## 1.2 唯一那条通道：client → host 的 `logBatch` 转发链

- **跨的是哪条边界**：跨的是「插件客户端半区（内存队列）→ 宿主半区（电话处理函数）」这条边界。客户端只把批次交给调用方传入的宿主调用器——`src/client.ts:59-61`「`export interface ClientHost { call: (name: string, args?: unknown) => Promise<unknown> }`」；发送处 `src/client.ts:478-479`「`return host.call(phoneNames.logBatch, args).then(...)`」。真机上这一跳是本机回环 RPC（父仓出处见「判据与口径」末条）；**是否真是两个 OS 进程由宿主实现决定，本包不定义也不假设**（`src/client.ts:56-61` 只声明「宿主调用器」这一形状）。
- **落点是否集中到同一处**：**不是**。宿主收到批次后逐条走同一个本地 `log`（`src/store.ts:483-491`），最终由 `writeBatch` 写到「本实例的 `getCacheDir()` + 本实例的 `config.logDirName` + 按天文件名」——`src/store.ts:385-403`。落盘者唯一且私有：`src/store.ts:6`「宿主是唯一的落盘者」。
- **每批／时序口径**：客户端每批最多 50 条、每 1000 毫秒发一次、单包约 128KB 或队列 100 条先到先截（`src/config.ts:16-19`、`src/client.ts:448-458`）；错误与告警走 0 毫秒直通（`src/client.ts:304-305`）；宿主侧接住后按级别定刷盘时序——错误与告警 0 毫秒、其余 1000 毫秒防抖（`src/store.ts:296-297`、`src/config.ts:9`）。
- **回参的含义（一个容易误读的点）**：`handleLogBatch` 回的 `accepted` 是**入参数组长度**，不是落盘条数（`src/store.ts:492`）；`dropped` 是宿主累计丢弃数（`src/store.ts:413-415`）。实测：宿主开关关闭时发一条非常驻 `info`，回包 `{"ok":true,"accepted":1,"dropped":0}`，而**宿主文件里一行都没有、`dropped` 也不涨**（探针 C 的 2a 段）。
- **实测（探针 C，`D:\Temp\probe-agg-06c.mjs`）**：照 `INTEGRATION.md:126-129` 的三行桥接写法搭注册表与宿主调用器，打开宿主开关后，客户端 `log('info','guest.exec',…)` 经一批转发，宿主文件出现该行：

  | 观测点 | 实测值 |
  |---|---|
  | 桥接记录 | `{"name":"wf.logBatch","args":{"entries":1,"droppedCount":0}}` |
  | `logBatch` 回包 | `{"ok":true,"accepted":1,"dropped":0}` |
  | `sendLogBatch` 回包 | `{"ok":true,"sent":1}` |
  | 宿主文件 | `<cacheDir>\logs\2026-10-09.log` = `{"ts":…,"level":"info","event":"guest.exec","fields":{"step":"forwarded-through-logBatch"}}` |

  ⇒ 这条链**真的把行送到了宿主文件**；它跨的是「半区 → 半区」，落点是宿主私有目录，**不是跨插件或第三方汇点**。

- **通道数量**：宿主只注册 5 条电话，动作名冻结——`src/config.ts:26`「`export const PHONE_ACTIONS = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']`」，注册处 `src/host.ts:63-80`（撞名报错不覆盖，`src/host.ts:75-77`）。**没有第六条通道可供第三方接入**。

---

# 2. 跨进程集中收集：无

## 2.1 落点全部由「本实例的 getCacheDir」决定，没有第三方落点

- 写盘路径：`src/store.ts:385-395`——取 `getCacheDir()` → 取不到则只计数丢弃（`src/store.ts:386-390`）→ `joinLogPath(dir, config.logDirName)` → `resolveLogFileName(...)` → `writeTarget(target, existing + text)`（`src/store.ts:403`）。
- `getCacheDir` 由调用方注入（`src/store.ts:76`、`src/store.ts:106`），包内不带默认路径（`src/node.ts:6-7`、`README.md:32`）。
- 因此「行落到哪」完全等于「调用方给了哪个目录」，包内没有任何一处写第二份、也没有任何一处写「公共/汇总」文件。

## 2.2 进程边界实测：两个独立进程各写各的，无集中落点

探针 `D:\Temp\probe-agg-06d.mjs` 用 `child_process.spawn` 起独立 Node 进程（子脚本 `D:\Temp\probe-agg-06d-child.mjs`，每进程各建一次 `createNodeHostLog` 并 `await log.ready`），三组结果：

| 组 | 子进程 | 退出码 | 落点树 | 关键输出 |
|---|---|---|---|---|
| 1 | 2 个，`pluginId` 不同（`proc-one`/`proc-two`） | 0 / 0 | `<cacheDir>/logs-proc-one/2026-10-09.log`；`<cacheDir>/logs-proc-two/2026-10-09.log` | 两行分别带 `"pid":42360` 与 `"pid":35288`，各在自己的目录里 |
| 2 | 2 个，同一 `pluginId`（`shared-id`） | 0 / 0 | 只有 `<cacheDir>/logs-shared-id/2026-10-09.log` | 文件里两行（`p1` pid 24760、`p2` pid 23444）——同标识共写一个文件，只是同文件共存 |
| 3 | 4 个，同一 `pluginId`（`quad`） | 0/0/0/0 | 只有 `<cacheDir>/logs-quad/2026-10-09.log` | 行数随并发时序变化（Lead 复跑三次存活 4／2／4 行，见第 7 节复跑注记），无汇总文件 |

**观察**：每个进程都只写自己的 `<cacheDir>/logs-<标识>/<当天>.log`；除开关文件 `log-switch-*.json` 外没有任何进程间共享文件，也没有任何进程写到本 `cacheDir` 之外。**没有任何集中落点**。

**环境如实记录**：本机 `child_process` 的 stdout/stderr **管道捕获正常**（子进程自报 JSON 被父进程拿到），探针未遇到 `EPERM` 类限制；`spawn` 使用 `stdio: ['ignore','pipe','pipe']`。

## 2.3 同目录共写甚至不能算退化的「集中」

探针 B（`D:\Temp\probe-agg-06b.mjs`）第 2 段把两个实例**显式**指到同一目录（`logDirName: 'logs-shared'`）：

| 写法 | 结果 |
|---|---|
| 两实例**同一时刻**各 `flushNow` 一次 | 文件只剩 **1 行**（`delta.event`），`gamma.event` 被吃掉 |
| 两实例**隔开**写（先 c 落盘再 d 落盘） | 文件 **2 行**（`epsilon.event`、`zeta.event`），两行都在 |

机制是「读—拼—写」全文覆写且无锁（`src/store.ts:367` 注释「文件服务无追加原语，任何追加都是全文读改写」、`src/store.ts:396-403`），与票 02 的多进程实测同源（`research/02-log-file-capability.md` §附 A）。⇒ **「把多个插件的日志放到同一个目录」这条退化路本身就不成立**：即使调用方手工把落点叠在一起，同刻写会互相覆盖，仍然不是一个可靠的集中落点。

---

# 3. 跨插件集中：无

## 3.1 多 pluginId 的落点天然分开

- 目录名派生：`src/config.ts:87-92`——`pluginId === 'wf'` → `logs`，其他 → `logs-<标识>`；开关文件同规则 `src/config.ts:93-98`。
- 实测（探针 B）：同一 `cacheDir` 下建两个宿主实例，

  | 实例 | `config` | 落盘文件 | 交叉污染 |
  |---|---|---|---|
  | `pluginId: 'alpha'` | `{"logDirName":"logs-alpha","switchFileName":"log-switch-alpha.json","prefix":"alpha"}` | `<cacheDir>\logs-alpha\2026-10-09.log`（1 行 `alpha.event`） | alpha 目录里出现 beta 事件 = **false** |
  | `pluginId: 'beta'` | `{"logDirName":"logs-beta","switchFileName":"log-switch-beta.json","prefix":"beta"}` | `<cacheDir>\logs-beta\2026-10-09.log`（1 行 `beta.event`） | beta 目录里出现 alpha 事件 = **false** |

- 两实例互不共享：`a.store === b.store` 为 `false`，`a.phoneNames === b.phoneNames` 为 `false`（`src/host.ts:48-53`「一次调用得到一个独立实例（内存队列、累计丢弃数、开关状态各自独立，互不串）」）。

## 3.2 宿主电话注册表：每插件一份（由调用方传入），不是全局一份

- 形状：`src/host.ts:55-59`「电话名注册表最小形状（宿主侧用内存表登记，**调用方传入自己的表**）：`has` / `set`」；注册函数把 5 个名字逐个塞进这张表（`src/host.ts:63-80`），撞名抛错（`src/host.ts:75-77`）。
- 实测（探针 B）：每个实例用各自的 `Map` 注册 → `regA` 5 键全是 `alpha.*`、`regB` 5 键全是 `beta.*`；把两个实例注册进**同一张**表也成功（名字不同不撞，表内 10 键）。
- **读法要点**：注册表不是「全局一份」，也不是「多插件共用一份自动汇聚」——它是调用方给的普通 `Map`，**只提供名字到处理函数的查表**。多插件共表只是名字不撞，**不会**因此产生任何跨插件的日志汇聚点（各自的处理函数仍写各自实例的私有目录）。

## 3.3 不存在任何「把多个插件的日志收进一处」的机制

- 全包 5 个电话动作（`src/config.ts:26`）逐条看：`logBatch` 收本插件客户端转发、`logExport` 导本实例目录里的一天、`logClear` 删本实例目录里的文件、`logGetSwitch`/`logSetSwitch` 读写本实例开关——**没有任何一条的语义是「接收别的插件」或「汇入公共处」**。
- 唯一「显式同目录」的可能是调用方自己覆盖 `logDirName`（`src/config.ts:88-89` 允许显式覆盖）：实测这条退化路不可靠（第 2.3 节），且它仍不提供任何查询面。
- 因此多插件的日志在本包里是**若干个互不相同的私有目录**，不是一处。

---

# 4. 查询：无

## 4.1 唯一读日志的电话 `logExport` 只读一个文件

- 选文件：`src/phones.ts:113-134`——默认 `want` = 今天（`formatDailyFileName(now)` 去掉 `.log`），`daily` 策略下直接拼 `want + '.log'`（`src/phones.ts:133`），四段式策略下从目录列表里挑排序第一个（`src/phones.ts:129-131`、`src/config.ts:191-205`）。
- 读文件：`src/phones.ts:136-142`——`readTarget(target)`，读不到当空串。
- 回参：`src/phones.ts:188-197` 回 8 键 `ok/fileName/bytes/fallback/text/summary/dir/path`（实测键序一致）；失败 4 键 `ok/fileName/bytes/fallback`（`src/phones.ts:208`）。
- `summary` 是**系统信息摘要**，不是索引：`src/phones.ts:158-164`——`{ pluginVersion, os, cwd, logSwitch, header }`，实测 `{"pluginVersion":"unknown","os":"win32","cwd":"D:\\dsh-plugin\\dsh-log","logSwitch":{"enabled":true,"sampleRate":1},"header":null}`。
- ⇒ **回的就是「某一天的一个文件的原文 + 目录 + 系统信息摘要」**，没有任何索引、清单或分段结构。

## 4.2 实测：没有跨天、跨目录、跨插件的检索

探针 C（`D:\Temp\probe-agg-06c.mjs`）实测：

| 试法 | 实测结果 | 判定 |
|---|---|---|
| 不传参导出 | 8 键；`fileName=2026-10-09.log`、`bytes=104`、`text` 1 行 | 只有当天原文 |
| 传 `{format:'zip', level:'error', pluginId:'other', limit:10, query:'boom'}` | 仍是同样 8 键；`text` 行数 1；**`text` 与不传参逐字相同** | 多余字段被显式忽略（`src/phones.ts:115-116` 注释「多余字段现状忽略（例如多传 `format:'zip'` 也不改变行为），保零变化」）⇒ **没有按级别／插件／关键词／条数过滤** |
| 传 `{date:'2020-01-01'}` | 8 键；`fileName=2020-01-01.log`、`bytes=0` | **一次导出只覆盖一个日期**，不会合并多天 |
| 同 `cacheDir` 下两个插件各导出一次 | alpha 的 `text` 里没有 `other.event`，`path=<cacheDir>/logs/…`；`other-plugin` 的 `text` 里没有 wf 的行，`path=<cacheDir>/logs-other-plugin/…` | **跨插件检索不存在**；各自只看自己目录里那一个文件 |
| `logClear({date})` 当查询用 | `{"ok":true,"removed":1}` | 是删除，不是查询 |
| `logGetSwitch()` | `{"ok":true,"enabled":true,"sampleRate":1}` | 是开关状态，不是查询 |
| `logBatch({entries:[]})` | `{"ok":true,"accepted":0,"dropped":0}` | 是写入，不是查询 |

**可用的方法全集**（实测 `Object.keys`）：宿主侧 `config/isEnabled/log/flush/flushNow/getDroppedCount/loadSwitch/setSwitch/getSwitchState/writeStartupHeader/getHeaderInfo/handleLogBatch/handleLogExport/handleLogClear/handleLogGetSwitch/handleLogSetSwitch`；客户端侧 21 项（`logQueue`/`logDroppedState`/`getDroppedCount` 等）。**两列里都没有任何 query/search/merge/filter 语义的成员**；`logExportFail`（`src/client.ts:383-402`）只是「导出失败时记一行」，不是查询。

## 4.3 本仓没有任何日志查询用的 GUI／命令行入口

- `package.json:15-19` 只导出三个运行入口（`./host`、`./client`、`./node`）；`package.json:31-35` 的 `scripts` 只有 `typecheck`/`build`/`test`。
- 全仓可执行的入口文件只有 `build.mjs`（构建）与 `publish-wizard.sh`（发布向导，`publish-wizard.sh:193` 的 `REGISTRY` 是 npm 源）；**没有读日志的 CLI**。
- 「导出」在文档里是界面动作（`INTEGRATION.md:211`「在状态栏菜单与设置页各放一个导出入口」），出口是「把回参的 `text` 存成文件给用户」——即**手动导出到用户自己那里**，不回流到任何可再查询的地方。

---

# 5. 对标锚点：「聚合」这个词的最小能力面（只描述，不做选型）

两个锚点都来自官方一手来源。下表只写「它们各自提供什么」，供判断本包缺的是哪一半；**不含任何本包该照哪个做的建议**。

## 5.1 pino transport（官方文档 getpino.io）

- 来源：<https://getpino.io/#/docs/transports>（正文取自仓库 `docs/transports.md`，<https://raw.githubusercontent.com/pinojs/pino/master/docs/transports.md>）。
- **多落点**：`pino.transport({ targets: [ … ] })` 支持一次挂多个目标，每个目标还能带自己的 `level`；文档明确「Single `target`: only `logger.level` filters messages / Multiple `targets`: `logger.level` is applied first, then each `targets[i].level`」，缺省 `targets[i].level` 为 `info`。
- **跨进程/跨线程**：transport 模块「will be executed in a separate worker thread」，主线程把日志写进 worker；v7 之前的形式更是「operate in a separate process」。
- **可以送到本进程之外**：文档列出的 Known Transports 里包含网络与远端服务目的地，例如 `pino-http-send`（「batch logs and send to a specified URL」）、`pino-socket`（「forward logs to an IPv4 UDP or TCP socket」）、`pino-elasticsearch`（bulk 上传给 Elasticsearch，再在 Kibana 里看）、`pino-loki`、`pino-datadog`、`pino-cloudwatch`、`pino-sentry`、`pino-opentelemetry-transport`（转发到 OpenTelemetry log collector）等。
- **集中之后的查询**：pino 自身不做查询；文档给出的办法是把行送进带检索的外部系统（Elasticsearch+Kibana、Loki、Seq、Datadog 等），检索由那些系统提供。
- **能力面小结**：**多落点 + 跨线程/跨进程 + 可送进程外目的地**；查询能力由目的地系统承担。

## 5.2 electron-log remote transport（官方仓库 README/docs）

- 来源：<https://github.com/megahertz/electron-log>（README，正文取自 <https://raw.githubusercontent.com/megahertz/electron-log/master/README.md>）与其中的 <https://github.com/megahertz/electron-log/blob/master/docs/transports/remote.md>。
- **Remote transport**：「Sends a JSON POST request with `LogMessage` in the body to the specified url.」选项：`level`（默认 `false`，即默认关）与 `url`（远端端点）。⇒ **明确把日志 POST 出本机**。
- **IPC transport（跨进程边界的收集）**：「It displays log messages from main process in the renderer's DevTools console.」渲染进程侧则相反：「it sends the data to the main process via IPC. Then, the data is written to the console and the filesystem.」⇒ 主进程充当**汇总落盘处**，渲染进程的行经 IPC 收进主进程。
- **多落点**：「By default, two transports are active: console and file.」，并可用 `log.transports.<name>.level = false` 逐条关闭。
- **能力面小结**：**跨进程（IPC 进主进程汇总）+ 可出本机（remote POST 到指定 url）+ 多 transport**；查询同样由 url 那一端的系统承担，库自身不做检索。

## 5.3 与本包现状的对照（只列事实差）

| 能力面 | pino transport | electron-log | 本包实测 |
|---|---|---|---|
| 多落点（同时送多处） | 有（`targets` 数组） | 有（console + file + remote） | **无**——一个实例只有一个落点（`src/store.ts:385-403`），5 个电话里没有多播 |
| 跨线程/跨进程搬运 | 有（worker thread / 独立进程） | 有（IPC 从渲染进程进主进程） | **有一条**（客户端半区 → 宿主半区的 `logBatch`，第 1.2 节实测） |
| 出本机/出本进程的第三方落点 | 有（多种远端 transport） | 有（remote POST 到 url） | **无**——全仓零网络（探针 A） |
| 集中之后可查 | 由目的地系统提供 | 由 url 那端提供 | **无**——只有单文件导出（第 4 节） |

---

# 6. 与文档的出入

## 6.1 票面指定的那句：`README.md:34`「不自动上报日志，只做本地落盘加手动导出」

**成立**（实锤如下）：

| 分句 | 判定 | 实锤 |
|---|---|---|
| 「不自动上报日志」 | **成立** | 全仓运行期零网络／零外部 sink：`src/*.ts` 命中数 1 且是文档示例字符串（探针 A）；`src/node.ts:20-26` 的 import 只有 `node:fs/promises`、`node:path` 与包内三文件（探针 E `src/node.ts 的 import 行`）；唯一的送出通道出口仍是本插件的宿主私有目录（`src/store.ts:385-403`）。「自动」二字也成立：没有任何定时器／钩子会在没人调用时把行送出去，唯一的定时器是刷盘防抖（`src/store.ts:313-314`）与客户端转发防抖（`src/client.ts:330-334`） |
| 「只做本地落盘」 | **成立** | `src/store.ts:6`「宿主是唯一的落盘者」；落盘调用点唯一在 `src/store.ts:403` |
| 「加手动导出」 | **成立** | 导出是电话，要人调（`src/phones.ts:110`、`README.md:106`、`INTEGRATION.md:211`）；导出**不触发刷盘**、只读盘上原文（`src/phones.ts:136-142`），实测「未刷盘时导出 `text` 为空」与票 02 §4 一致 |

**结论**：暂未发现 README 没写、代码里实际存在的送出路径，也未发现 README 写了而代码里不存在的送出路径。**没有出入**。

## 6.2 其余相关出入（逐条比对过）

| # | 文档说的 | 代码/实测 | 引用 |
|---|---|---|---|
| D1 | 「不自动上报日志」在 `README.md:34` 成立，但同一句里的「上报」二字在 `README.md:105` 又用来描述 `logBatch`（「客户端调宿主，批量上报」） | 两者不冲突但是两个意思：105 行的「上报」指**插件内部**客户端半区向宿主半区的转发（`src/client.ts:478-479`），不是往本插件外上报。建议读作「同插件半区之间的搬运」以免与 34 行的「不自动上报」混淆。**这不是文档失实，是用词重叠** | `README.md:34`、`README.md:105` vs `src/client.ts:478-479`、`src/store.ts:477-497` |
| D2 | 文档没有承诺任何查询能力，也没写「不能查询」 | 实际能拿到的只有单文件导出（`src/phones.ts:129-138`）与 8 键回参（`src/phones.ts:188-197`）。文档侧相符，只是**没把「没有检索」写明** | `README.md:106`、`INTEGRATION.md:211` vs `src/phones.ts` 同上（探针 C） |
| D3 | `README.md:111`「前缀只隔离电话名，不隔离磁盘上的文件，磁盘隔离靠上面的目录名与开关文件名默认派生」 | **相符**，实测同 cacheDir 两插件 `logs-alpha` / `logs-beta` 与 `log-switch-alpha.json` / `log-switch-beta.json` 各自分开（探针 B） | `README.md:111` vs `src/config.ts:87-98` |
| D4 | `README.md:78`「第二个插件把 `pluginId` 换成自己的标识即可……不得共用同一目录」 | 相符（`src/config.ts:87-92`）；补充一条文档没写的后果：**共用目录是「读—拼—写」无锁覆写，同刻写会互相吃掉**（探针 B 2a：两行只剩一行） | `README.md:78`、`INTEGRATION.md:219`「多进程同时写同一个目录会写坏」 vs `src/store.ts:367`、`src/store.ts:396-403` |
| D5 | 「客户端调宿主，批量上报」的**回参语义**：`README.md:105` 写「接收条数（`accepted`）」 | 字面相符但极易误读：`accepted` 恒等于入参数组长度（`src/store.ts:492`），**不代表落盘**。实测宿主开关关闭时回 `accepted:1` 而盘上零行、`dropped` 也不涨（探针 C 2a）。`README.md:92` 的「满时按级别丢弃、只计数不抛错」同样没覆盖「被开关拦掉的行不进任何计数」 | `README.md:105`、`README.md:92` vs `src/store.ts:483-492`、`src/store.ts:263-267` |
| D6 | 相符项（逐条比对过，不算出入） | 「宿主是唯一的落盘者……转发走电话，落盘走宿主刷盘链路」（`INTEGRATION.md:149`）与代码一致；「电话名带前缀隔离 / 撞名不覆盖」（`README.md:111`、`src/host.ts:75-77`）实测一致；「客户端批量口径 50 条 / 1000 毫秒 / 128KB / 100 条」（`README.md:135` vs `src/config.ts:16-19`）一致；`README.md:32`「入口自己不读任何环境变量、也不带默认路径」实测一致（`tests/node.test.mjs:58-80` 可跑，探针 E 实测落点只由 `cacheDir` 决定） | `INTEGRATION.md:149`、`README.md:32`、`README.md:111`、`README.md:135` |

---

# 7. 实测清单

**探针位置**：全部在 `D:\Temp`（`probe-agg-06*.mjs`），跑 `dist/` 产物（`dist/*.js` 构建于 2026-10-07 03:47，晚于 `src/*.ts` 最后修改 2026-10-04），只读仓库、不改任何仓库文件。落点全部在 `os.tmpdir()` 下的临时目录并在探针结束时删除。

| 探针 | 覆盖 | 关键输出 |
|---|---|---|
| `D:\Temp\probe-agg-06a.mjs` | 全仓关键词扫描（通道词表 + 6 种网络模块） | 扫描 29 文件、命中 20 行；`src/` 命中 1 行（`src/node.ts:16` 注释示例 `fetch`）；网络模块引用 **全仓零命中** |
| `D:\Temp\probe-agg-06b.mjs` | (a) 两个 pluginId 的落点分离；(e) 显式同目录共写 | `alpha` → `logs-alpha/2026-10-09.log`（`alpha.event`）；`beta` → `logs-beta/2026-10-09.log`（`beta.event`）；交叉污染 false/false；同表注册 10 键不撞；同目录同刻写 → **2 行只剩 1 行**，隔开写 → 2 行都在 |
| `D:\Temp\probe-agg-06c.mjs` | (b) client→host 转发链真的落进宿主文件；(c) 导出/查询面 | 桥接 `wf.logBatch` → `{"ok":true,"accepted":1,"dropped":0}`；宿主文件出现 `forwarded-through-logBatch`；导出 8 键；多传 4 个查询类字段 `text` 逐字不变；跨天/跨插件都只看单文件；开关关闭时 `accepted:1` 而盘上零行 |
| `D:\Temp\probe-agg-06d.mjs` + `probe-agg-06d-child.mjs` | (d) 进程边界（2／2／4 个独立进程） | 各进程各写 `<cacheDir>/logs-<标识>/<当天>.log`；无汇总文件；无 `cacheDir` 之外的落点；管道捕获正常、未遇 `EPERM` |
| `D:\Temp\probe-agg-06e.mjs` | `dsh-log/node` 的跨进程/远程面 | 导出键仅 3 个；`createNodeHostLog` 返回 `store/phoneNames/ready`；「注册/发送/连接/远端」类成员 **`[]`**；「查询」类成员 **`[]`**；`src/node.ts` 的 import 无任何网络模块 |

**Lead 独立复跑（2026-10-09，本票定稿前）**：五支探针 `probe-agg-06a`～`06e` 在 Lead 侧重跑一遍，关键输出与本表一致（06a 因期间新增了同系列研究文件，扫描文件数由 29 变 33，但 `src/` 命中仍只有 `src/node.ts:16` 那一处文档示例字符串）。另加一支 Lead 自建独立探针 `D:\Temp\probe-agg-06-lead.mjs`（自带真实文件服务，落点 `D:\Temp\probe-agg-06-lead\`），三面复核：两个 pluginId → `logs-alpha`／`logs-beta` 各 1 文件、交叉含对方事件均为 `false`；client→宿主桥接后 `guest.exec` 在 alpha 文件里为 `true`、beta 文件里为 `false`；导出回参 8 键，宿主/客户端两侧方法全集里没有任何 query/search/merge 成员。

**复跑发现一处观测差异（不影响判定）**：探针 D 第 3 组「同 pluginId 四进程共写」的存活行数三次重跑为 4／2／4 行（丢行随并发时序变化），机制与第 2.3 节、`research/02-log-file-capability.md` 的「读—拼—写、无锁」同源；「无集中落点、无汇总文件」这一主结论三次一致。

**本仓既有测试对本判据的覆盖（实跑核对，非转引）**：

- 有覆盖的：`tests/client.test.mjs:137-157`（120 条进 100 条、一次发 50 条、`seen[0].name === 'wf.logBatch'`）——即**转发的存在与批量口径**有测试守着；`tests/node.test.mjs:38-56`、`:58-80`、`:82-96`（建库—写—等落盘、落点只由 `cacheDir` 决定、目录按标识派生）守落点派生。
- **没有覆盖的**：「有没有集中汇点」「有没有查询面」「跨进程有没有汇总」三类断言在 `tests/` 里**一条都没有**（四套测试通读：`host.test.mjs`、`client.test.mjs`、`eventList.test.mjs`、`node.test.mjs`）。也就是说，本票的判定目前**没有本仓门禁守着**——将来若有人加了跨插件汇聚或检索，现有测试不会变红。
- 测试可跑性现状（与票 02／03 一致，本票未重跑）：`tests/host.test.mjs:15` 与 `tests/client.test.mjs:19` 引用父仓旧路径 `ROOT/src/host/logStore.js`、`ROOT/src/client/kernel/log.js`，在本仓不存在，两套在本仓跑不起来；`tests/client.test.mjs` 的转发断言因此在本仓等于没有守护（本票的转发实测改由探针 C 完成）。

---

# 8. 未定项

- **Q5／Q6 不猜**：`issues/01-untitled.md:15`「队列满语义与门禁红黄（Q5/Q6）待 R2」、`:41` 同。本票凡涉及「丢行」都只报现状（第 1.2 节末、D5），不裁策略。**待 Q5/Q6。**
- **哪种读法为准：已于 2026-10-09 由用户确认**（① 跨进程自动转发算「跨进程集中收集」的达成部分；② 查询要有检索面才算；③ 以本包三入口自身能力为准）⇒ 本票 headline 取「**部分具备**」；严格读法（须有第三方可查的集中汇点）的「无」作为对照原样保留在 `# 结论`（见「判定口径」与「严格读法」两节）。
- **未在活的 DSH 宿主里直接观测「客户端半区 → 宿主半区」那一跳**：本票对该跳的跨进程性质只引父仓一手来源（`D:\dsh-plugin\dsh-main-check\src\seam\rpc.js:31-40`、`src\host\index.js:311-317`、`research\330-host-persistence.md:27`），未连真实宿主抓包验证；本仓层面能证实的只有「客户端只认调用方传入的 `call`」（`src/client.ts:59-61`）。**这不影响两个读法的判定**（第 1 节已论证：无论那条边界是不是跨进程，落点都是每插件私有目录且无查询面）。
- **`dist/` 与 `src/` 未做字节级重生成比对**：本仓无 esbuild（`devDependencies` 只有 `typescript`，`package.json:36-38`），`build.mjs` 跑不起来，与票 02／03 同款缺口。已做的佐证：机制在 `dist/` 里逐条存在——`dist/store.js:148`（常驻名单）、`:195`（按事件名放行）、`:394`（`handleLogBatch`）、`dist/client.js:88`（同名单）、`:136`、`:313`（`host.call(phoneNames.logBatch, args)`）、`dist/config.js:24`（目录名派生）、`dist/phones.js:115`（`pluginVersion: "unknown"`）、`:147`（`fallback: true`）、`:163`（失败 4 键）。
- **真实宿主里的绝对落点未验**：`getCacheDir` 实现在宿主侧、不在本仓；包内无默认目录（`README.md:32`、`src/node.ts:6-7`），故「日志究竟落在哪个绝对路径」本仓无法证实。父仓记的宿主可写目录受沙箱限制一条（`D:\dsh-plugin\dsh-main-check\research\330-host-persistence.md:33`）本票未复核。
- **未测「多插件共用一张注册表 + 共用目录」在真实宿主下的表现**：本票只测了同进程两实例（探针 B）与独立进程（探针 D）；真机是「一个宿主进程内多个插件各自注册」还是「每插件一个宿主」，取决于 DSH 插件装载方式，本票未取证。
- **外部锚点子页（2026-10-09 Lead 复验后收敛）**：pino 取官方 `docs/transports.md` 正文；electron-log 的 remote 子页已由 Lead 单独抓取原文（<https://raw.githubusercontent.com/megahertz/electron-log/master/docs/transports/remote.md>），首行为「# Remote transport (main process only)」、正文「Sends a JSON POST request with `LogMessage` in the body to the specified url.」，选项含 `level`（默认 `false`）与 `url`——与本票第 5.2 节的摘要一致。仍未逐条核对两个库的版本号与全部子页。
- **不属于本票**：文件落盘/目录/按天（票 02）、级别（票 03）、轮转（票 04）、格式（票 05）、链路追踪（票 07）、隔离（票 08）、追踪标识（票 09）；方案选型（`issues/06-untitled.md:9`「方案选型是雾区，不在本票」、`issues/01-untitled.md:42`）。

---

# 9. 证据清单

**读过的文件与行范围**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全） |
| `src/client.ts` | 1-683（全） |
| `src/config.ts` | 1-415（全） |
| `src/phones.ts` | 1-315（全） |
| `src/host.ts` | 1-81（全） |
| `src/node.ts` | 1-195（全） |
| `README.md` | 1-228（全，重点 32-34、76-78、88-93、99-113、135） |
| `INTEGRATION.md` | 1-235（全，重点 40-72、94-104、123-131、137-153、209-215、219） |
| `tests/host.test.mjs`、`tests/client.test.mjs`、`tests/node.test.mjs` | 全文读（转发与落点断言、失败点） |
| `tests/eventList.test.mjs` | 未逐行读（与本票无关，只确认无查询断言） |
| `package.json` | 1-39（全） |
| `issues/01-untitled.md`、`issues/06-untitled.md` | 1-64 / 1-24（全，口径出处） |
| `issues/10-ts.md` | 1-30（对标锚点的来源说明） |
| `research/02-log-file-capability.md` | 全文（同目录共写覆写的同源实测） |
| `dist/{store,client,config,phones,host,node}.js` | 只读产物，检索关键机制行号（2026-10-07 构建） |
| 父仓 `D:\dsh-plugin\dsh-main-check\src\host\index.js` | 300-349（日志电话注册与 RPC 通道注册） |
| 父仓 `D:\dsh-plugin\dsh-main-check\src\seam\rpc.js` | 1-60（`host.call` → `conn.rpc.call` 的载体口径） |
| 父仓 `D:\dsh-plugin\dsh-main-check\research\330-host-persistence.md` | 23-33、61-65、109-110（通道形状与只接受本机回环） |
| 父仓 `D:\dsh-plugin\dsh-main-check\research\489-appendix.md` | 57-58、299-317、337、356、377（通道批量口径与跨进程不加锁） |

**外部一手来源**

| 来源 | 用途 | URL |
|---|---|---|
| pino 官方文档 · Transports | 能力面：多 `targets`、worker thread/独立进程、远端 transport 清单（http-send / socket / elasticsearch / loki / datadog / opentelemetry 等） | <https://getpino.io/#/docs/transports>（正文 <https://raw.githubusercontent.com/pinojs/pino/master/docs/transports.md>） |
| electron-log 官方仓库 README | 能力面：Remote transport（JSON POST 到指定 url）、IPC transport（渲染进程经 IPC 送主进程汇总落盘）、console+file 默认双 transport | <https://github.com/megahertz/electron-log>（正文 <https://raw.githubusercontent.com/megahertz/electron-log/master/README.md>，remote 子页 <https://github.com/megahertz/electron-log/blob/master/docs/transports/remote.md>） |

**报告位置说明（仓库约定）**：本仓 `research/` 由票 02、03 建立同系列约定 `research/<NN>-<slug>.md`（前两篇：`research/02-log-file-capability.md`、`research/03-log-level-capability.md`）。本报告沿用该约定落在 `research/06-log-aggregation-capability.md`，未改动任何源码、README、`INTEGRATION.md`、`tests/` 或 `issues/` 下的文件。探针全部写在 `D:\Temp`，与仓库无关。
