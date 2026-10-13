# dsh-log（日志包）

把本仓日志系统装成的 npm 包：DSH 插件与独立跑的 Node 程序都能照着它集成使用。本包由三块合成——宿主落盘引擎（#559）、客户端转发引擎（#560）、事件清单格式与通用检查器（#561），是地图 #556 的产物。

全程用词：日志系统指日志功能本身（引擎、对外接口、检查器、文档）；日志包指装着日志系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。

## 先跑起来（quick 默认入口，30 秒）

独立 Node 程序（4 行）：

```js
import { createQuickLog } from 'dsh-log/node'
const log = await createQuickLog('/你自己决定的/日志目录')
log.store.log('warn', 'your.step.fail', { step: 'fetch' })
await log.ready   // Node 入口的 ready：基准行落定才算完，等它即前面每一行都已落盘
```

> 同一**日志目录**（以及同一个开关文件）同一时刻只许一个活跃写者（0.3.0 口径）：实例的日志目录是 `<cacheDir>/logs-<pluginId>`（`pluginId` 为 `wf` 时为 `logs`，`quick` 缺省为 `logs-quick`）。
>
> - **同步入口**（`dsh-log/node`，目录同步可知）：同一日志目录的第二个活跃实例**建库当场抛**中文错；上一个实例 `release()` 之后才能接管。入口把目录解析成真实路径（`realpath`），符号链接/junction 指向同一个真实目录时同样撞键抛错。
> - **宿主入口**（`dsh-log/host`，目录要异步问宿主）：建库不抛，冲突在**写盘那一刻**判——拿不到写盘租约时最多等 200 毫秒，等不到就判冲突：那批行计入丢弃数、**不写共享文件**，之后 `log()` 抛中文错；判冲突后队列里残留的行也一律不写共享文件（同样按丢弃计），只有 `log.persist.fail` 这类自监控诊断行不丢、留着闸门解除后补写。冲突期间清空与导出降级为失败形状，不碰共享文件。开关文件同样在写盘那一刻判占用：共用同一个 `switchFileName` 的第二个实例不会覆盖前一个写下的开关。这条路径**不解析符号链接**（键取自宿主给的路径），链接与真实路径会被当成两个目录，别拿链接绕。
> - **冲突会自愈**：闸门只在「判定那一刻的持有者还在」时有效；对方写完交还或 `release()` 之后，本实例的下一行照常落盘，不必等自己 `release()`。
> - `release()` 同步幂等；释放那一刻若还有一批正在写盘，交还会延后到这批写完（同步路径下写盘在途时第二个实例仍当场抛）。
> - `await synced()` 会把闸门解除后攒下的诊断行也带出去；**闸门仍活**（对方还持有目录）时它合法滞留，此时 `getPendingCount()` 会如实大于 0，不会假报刷完。
> - 同一 `cacheDir` 下不同 `pluginId` 各写自己的目录与开关文件，可以并存。
> - **跨进程没有登记（风险提示，不是保证）**：登记表是模块副本级的，另一个进程看不见。实测两个真进程同目录各写各的都能成功、两边的行都在；危险窗口是**并发读改写**——两个进程同时刷盘时，后写者按自己读到的旧内容整份覆写，可能吃掉对方刚写的行。不要这样用。

DSH 插件宿主侧（3 行）：

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'
const hostLog = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
registerHostLogPhones(new Map(), hostLog)
```

两条规矩（0.3.0）：保落盘认 `store.synced()`（已落地）——刷完当期队列、等到在途写盘真的收尾才 resolve，杀进程前调此即不丢；`store.flush()` 只管安排刷盘，调了不等于写完；查日志先判无权（查询电话名 = 前缀加 `.logQuery`，六参：`timeRange`、`pluginId`、`level`、`keyword`、`traceId`、`page`；宿主入口注册 5 个写侧动作加这个只读查询，共 6 个）：

```js
const res = await phones.handleLogQuery({ pluginId: 'wf' })
if (res.denied) return '无权：只查自己插件的日志'
```

宿主侧 `await store.synced()` 等落盘；Node 短命程序注册退出钩 `store.beforeExit()`（重复调用只注册一次），或直接 `await log.ready`（Node 入口的 ready，基准行落定判据）。

## 0. 我该读哪儿

| 你的情况 | 从哪儿开始 |
|---|---|
| 写 DSH 插件，要给插件接日志 | 包内 `INTEGRATION.md` 路线 A：步骤 0 到 4 一路到底 |
| 写独立 Node 程序（不是插件），要往本地写日志 | 包内 `INTEGRATION.md` 路线 B：步骤 0、1、2B，再看步骤 4 的落点说明 |
| 已经装好，要查接口形状（电话、配置、回参） | 本文第 4 到 7 节 |
| 改了本包要发版 | 本文第 9 节；发布记录与向导在包根的 `notes-publish-drill.md`（不随包发布） |

## 1. 安装

```sh
npm install dsh-log
```

要求 Node 22 或更高（`package.json` 的 `engines`）。当前版本 `0.3.0`（以包内 `package.json` 为准）——0.3.0 是断裂版本：不兼容 0.2.x，插件按本仓迁移 7 步重开发（第 12 节）。

包自带类型声明（`dist/*.d.ts`，`exports` 每个子路径都带 `types` 条件）：纯 TS 工程装上就能编译，**不需要** `@types/node`——本包公共面里不出现任何 Node 专有类型（Node 能力由 `dsh-log/node` 在实现里用，不进签名）。

## 2. 入口，按运行位置选用

- `dsh-log`：根入口，**与运行环境无关**的那一半。配置解析（`resolveHostLogConfig`/`resolveClientLogConfig`）、事件清单检查器（`parseEventListManifest`/`checkEventFields`/`lintEventFields`/`computeEventCounts`）、文件名解析（`parseLogFileName`/`listLogFiles`/`logFilesOfDate`）、行格式常量（`LOG_FORMAT_VERSION`）都在这里。宿主与客户端两半都能用，也不拖 Node 进来。
- `dsh-log/host`：DSH 插件宿主侧用。建日志库、拼电话名、注册电话名、事件清单检查器。
- `dsh-log/client`：DSH 插件客户端侧用。建日志器、电话名拼法、批量转发口径数字。
- `dsh-log/node`：**不是插件的独立 Node 程序用**（例如一个技能自己的命令行）。一句话建好落盘日志，不必自己拼文件服务与计时器。

四个入口在同一个包里，装一次全都有。

`dsh-log/node` 与前两个的区别：它不碰电话层、也没有客户端转发，只有「把日志落到本地文件」以及它背后的级别规则、目录派生与失败计数。它**不决定日志写到哪**——目录由调用方传入，入口自己不读任何环境变量、也不带默认路径。

**本包不做什么**（需要这三样得在调用方自己那层做）：不自动上报日志，只做本地落盘加手动导出；不自动轮转，也不自动清理旧文件。

## 2.1 独立 Node 程序怎么接（`dsh-log/node`）

```js
import { createNodeHostLog } from 'dsh-log/node'

const log = await createNodeHostLog(
  { cacheDir: '/你自己决定的/日志目录' },
  { pluginId: 'your-program', prefix: 'your-program' }
)

log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
await log.ready   // Node 入口的 ready：等这一下，前面每一行都已落盘
```

建库配置双必填：`pluginId` 与 `prefix` 都要显式传，缺任一即抛中文错（0.2.x 的「prefix 缺省回退到 pluginId」已删）。两者用同一套字符约束（小写英文字母、数字、中横线，1 到 32 个字符）。

落点由 `cacheDir` 与 `pluginId` 一起决定：日志写在 `<cacheDir>/logs-your-program/2026-09-11.log`，调试开关写在 `<cacheDir>/log-switch-your-program.json`。目录不存在时入口自己建。

三条要知道的事：

1. **`await log.ready` 不能省**。落盘是先入内存队列、再由约 1000 毫秒的防抖窗口异步写下去的：程序顺着事件循环自然跑完，Node 会等这个定时器，日志自己会落；但结尾调了 `process.exit()`、抛错退出或被强杀的程序，队列里还没写下去的那批就随进程消失（`warn` 与 `info` 一样会丢）。命令行工具通常在结尾显式退出，所以这条按必须处理。`log.ready` 返回时表示「前面写的每一行都已经在文件里」。同一件事也可以改用 `await log.store.synced()`（刷完当期队列才 resolve，口径见第 12 节步骤 4），或先 `log.store.beforeExit()` 注册退出钩（重复调用只注册一次）。
2. **开关每次新建时会被读回来**。独立程序每次调用都是新进程，所以入口建库时会把上次留下的开关读回来，打开的详细日志在下次调用仍然生效；写入用 `log.store.handleLogSetSwitch({ enabled: true })`。
3. **级别规则与插件侧完全一致**：错误与告警恒落盘，常驻信息落盘，其余信息与调试只在开关打开时落盘。

## 3. 三步接入（宿主侧）

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'

// 五个运行依赖全部由调用方传入，包内不自己抓：
// fs 文件服务、timer 计时器、getCacheDir 取缓存目录函数、
// getPlatform 取平台函数、DEFAULT_CWD 默认工作目录。
// 每个依赖的最小形状与可省略项见 INTEGRATION.md 步骤 2 的形状表。
const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', prefix: 'my-plugin' }
)
registerHostLogPhones(new Map(), hostLog)
```

1. 装包。
2. 调用建日志库工厂并传插件标识与前缀（`pluginId` 与 `prefix` 双必填，缺任一即抛中文错；其余全有默认）。
3. 前缀传 `wf` 时零配置即跑：5 个动作电话名、目录名、开关文件名、按天文件名与本仓现状一字不差（`wf` 是保留命名空间，只给首个官方插件用）；注册时另加第 6 个只读查询电话 `wf.logQuery`。

第二个插件把 `pluginId` 与 `prefix` 都换成自己的标识即可：电话名自动加前缀隔离，目录与开关文件名按 `pluginId` 默认派生为不同名字，不得共用同一目录。

一次建库调用得到一个独立实例：内存队列、累计丢弃数、开关状态各自独立，互不串。

## 4. 配置默认值派生（#558 冻结）

必填两项：插件标识 `pluginId` 与电话名前缀 `prefix`，都要显式传入，缺任一即抛中文错（0.2.x 的「prefix 缺省回退到 pluginId」已删）。两者同一套字符约束：只能用小写英文字母、数字、中横线，长度 1 到 32。收到大写直接报错，不做静默转小写；收到含点或文件不安全字符（斜杠、反斜杠、冒号、星号、问号、引号、尖括号、竖线、空格）的值同样报错，因为点留作前缀与动作名之间的分隔符，拼进目录名与文件名后必须仍是合法名字。

| 配置键 | 默认 | 说明 |
|---|---|---|
| `pluginId` | 必填，无默认 | 插件标识；目录名与开关文件名按它派生 |
| `prefix` | 必填，无默认（不再回退到 `pluginId`） | 电话名前缀；新电话名 = 前缀 + 点 + 动作名 |
| `logDirName` | 派生 | 标识为 `wf` 时为 `logs`，其他标识时为 `logs-标识`；允许显式覆盖 |
| `switchFileName` | 派生 | 标识为 `wf` 时为 `log-switch.json`，其他标识时为 `log-switch-标识.json`；允许显式覆盖 |
| `fileNamePolicy` | `daily` | 按天（年月日点 log，如 `2026-09-06.log`）；四段式只作可选项 |
| `maxQueue` | `1000` | 宿主内存队列上限，满时按级别丢弃、只计数不抛错 |
| `maxSize` | `5242880`（5MB） | 单个当日日志文件的封存阈值（字节，按 UTF-8 计）；超了就把当日文件封存成 `<日期>.N.log` 再开新文件 |
| `maxDays` | `14` | 保留天数：早于「今天往前 `maxDays - 1` 天」的封存件会被清掉（当日文件永不清） |
| `eventList` | `null` | 事件清单注入点位（对象形式，见第 7 节；不传为 `null`，主路径零变化） |

四段式文件名的四段定死为日期点插件标识点进程号点启动时间：插件名取配置里的插件标识，进程号取不到时回退 0，启动时间取宿主建日志库那一刻（以启动头写入的 `pid` 与 `startedAt` 为准，里面的冒号与斜杠转写为中横线后才拼入）。清空与导出里按文件名匹配的正则随策略分支：`daily` 走按天正则，四段式走对应的四段正则。

## 5. 电话名、前缀隔离与客户端接入

### 5.1 五个电话

新电话名 = 前缀 + 点 + 动作名。前缀传 `wf` 时 5 个字面与现状一字不差（`wf` 是保留命名空间，只给首个官方插件）：

| 电话名（默认前缀下） | 方向 | 入参 | 回参 |
|---|---|---|---|
| `wf.logBatch` | 客户端调宿主，批量上报 | 日志条目数组（`entries`）加客户端累计丢弃数（`droppedCount`） | 是否成功（`ok`）加接收条数（`accepted`）加宿主侧累计丢弃数（`dropped`） |
| `wf.logExport` | 客户端调宿主，导出 | 可选日期（`date`），多余字段忽略 | 是否成功加文件名加长度（`bytes`，日志原文的字符串长度，不是真实字节数）加回退标记（`fallback`）加当天日志原文（`text`）加系统信息摘要（`summary`）加目录与路径（`dir`/`path`） |
| `wf.logClear` | 客户端调宿主，清空 | 日期或全部（`date` 为某天或 `all`） | 是否成功加删掉几个文件（`removed`） |
| `wf.logGetSwitch` | 客户端调宿主，读开关 | 空对象 `{}` | 是否成功加是否开启（`ok` 与 `enabled`） |
| `wf.logSetSwitch` | 客户端调宿主，写开关 | 是否开启（`enabled`；0.3.0 起没有采样率这个参数） | 是否成功加实际生效的是否开启（`ok` 与 `enabled`） |

前缀只隔离电话名，不隔离磁盘上的文件，磁盘隔离靠上面的目录名与开关文件名默认派生。宿主注册电话名时，若该名字已被注册，则报错、不覆盖旧的。第二个插件必须显式传自己的 `prefix`（前缀不再回退，缺即抛中文错）；`wf` 是保留命名空间，新插件传自己的标识才自然隔离。

写侧 5 个动作之外还有一个只读查询电话 `前缀.logQuery`（由 `buildLogQueryPhoneName` 派生，六参见第 7 节前的查询说明）：宿主入口 `registerHostLogPhones` 一共注册 6 个（上面 5 个写侧 + 这个只读查询），撞名同样抛、不覆盖旧的；`hostLog.phoneNames` 那份冻结映射仍只有 5 个写侧动作名。

导出成功回 8 个键（含原文 `text`、摘要 `summary`、目录与路径 `dir`/`path`）；导出失败只回 4 个键（`ok`、`fileName`、`bytes`、`fallback`），调用处走失败分支处理。

### 5.2 客户端两种消费方式（二选一）

两种方式行为一致，选一种即可，推荐直接 import。

方式一，直接 import（推荐）：调用方写 `import { createClientLog } from 'dsh-log/client'`，把四个依赖与插件配置传进来，当场得到日志器，打包工具正常解析 import。

```js
import { createClientLog } from 'dsh-log/client'

const clientLog = createClientLog(
  { host, timer, storage, broadcastLogSwitch },
  { pluginId: 'wf', prefix: 'wf' }
)
clientLog.log('info', 'my.event', { step: 'started' })
```

客户端配置同样双必填：`pluginId` 与 `prefix` 都要显式传，缺任一即抛中文错；两端（宿主与客户端）传同一对值，拼出的电话名自然对上。

四个依赖全部由调用方传入（全可选，缺了走退化路，不抛错）：宿主调用器 `host`（只用 `call` 一个方法，桥接写法见 INTEGRATION.md 步骤 3 的三行示例）、计时器 `timer`（只用 `timeout` 一个方法，没有就回退全局函数）、存储 `storage`（只用读写两个方法，没有就每次用默认；旧闭包名 `localStorage` 仍认，两个都传以 `storage` 为准，新接入只传 `storage`）、开关广播 `broadcastLogSwitch`（一个无参函数，没有就不广播，不报错）。另有一个可选依赖 `hashFn`（`(字符串) => 字符串`），用来替换包内默认的 8 位十六进制散列，见第 8 节。

方式二，文本拼接（只给把客户端拼进插件主文件闭包一起运行的插件用）：构建时取客户端入口编译后的声明体，去行首 `export` 后拼进插件主文件闭包，调用时把闭包里现成的四个名字原样传给工厂。文本拼接消费方式只走客户端入口的声明体文本。本仓当前插件本次不切拼接源（默认 `wf` 下行为零变化），拼接形态留给第二个插件验证。

客户端批量转发口径（#558 冻结，复用 `CLIENT_BATCH` 常量，不另写一遍）：每批最多 50 条、每 1000 毫秒发一次、单包约 128KB 或队列 100 条先到先截，裁掉的记入丢弃数。开关看门狗超时 5000 毫秒，只记一行告警，不改返回值。本地开关存在本地存储里，键名是 `dsws.debug.<pluginId>`（0.2.x 的单键 `dsws.debug` 已作废），形状是 `{ enabled, rev }`（0.3.0 删掉了从没生效过的 `sampleRate`；旧值里多带的键一律忽略、照旧读得回来），默认关闭。建日志器时同步读本地做界面秒显，随后启动对账再向宿主看齐（以宿主为准）。

日志器的调用面（`createClientLog` 的返回对象）里，接入要用的是下面两类；对象上还有队列、开关状态等内部字段，调用处可以直接读，改开关请走第二类里的两个方法：

- 与宿主同名同参同语义的四个：是否允许记（`isEnabled`）、记一行（`log`）、立刻转发或刷盘（`flush`，客户端侧只管转发，不管落盘；调转发后约 1 秒可见、不调约 2 秒、错误与告警直通，见 INTEGRATION.md 步骤 4）、读累计丢弃数（`getDroppedCount`）。
- 客户端独有的两个开关动作（写开关界面时要用，最容易漏）：`setLogSwitch(是否开启)` 写开关（宿主生效才更新本地与内存；失败原因只给机器码），`reconcileLogSwitch()` 启动时向宿主对账（以宿主为准）。用法见 INTEGRATION.md 步骤 4 与步骤 6。

### 5.3 追踪链路（#24）

三件套 `traceId`/`spanId`/`seq` 只住 `fields` 里，落盘行仍是五键 `{v,ts,level,event,fields}`——不给行加键，老解析器不会因为多一列而崩。

- **自动建链**：没传 `traceId` 时 SDK 自己建（16 位十六进制）。`error`/`warn`/`info`/`debug` **一律建链**（0.3.0 删掉了只影响建链、不拦行的采样率——要抑制 `debug` 请用开关，别用「半建链」）。
- **显式继承**：`log.child(ctx)` 继承父链的 `traceId`、刷新 `spanId`、子实例 `seq` 从 0 重起。不用 `async_hooks`（DSH 双端都跑不动它）——**漏传 `child` 就是新链**，不做隐式合并。
- **可解释**：`log.why()` 回报三件套的来源（新建/继承/透传）与影子计数（`shadowWarns`）。
- **保留字冲突永不整行拒收**：`fields` 里误带 `traceId`/`spanId`/`seq` 时，`error`/`warn` 照落盘，冲突的值搬进 `fields._shadow`，另落一行 `log.trace.shadow`（warn 级）并计入 `shadowWarns`。可靠性优先于正确性。
- **查询联动**：`logQuery` 的 `traceId` 是一等参；整链查询走独立 `traceChain` 通道，**超 100 行也不断链**（不受 `limit ≤ 100` 截断）。跨桶伪造 `traceId` 的读会被拒（`denied`），但源行不会被删。

## 6. 失败语义（#558 冻结）

失败只计数不抛错：队列满、转发失败都只加到累计丢弃数里；写盘失败**先不丢行**——整批进重试位，有界自动重试（退避定时器，到顶后等下一次 `log()`/`flushNow()`/`synced()` 再试），只有**还压在内存里的行**（重试位 + 队列）超过上限（`maxQueue × 10`）才丢最旧的**普通行**并响一次 `onDrop('write-fail')`，`error/warn` 留到最后。所有电话失败都回是否成功为假的结构，不抛异常。三处例外原样保留，不扩大：

- 唯独记录电话（`logBatch`）的最外层例外（入参本身爆炸、一行都没进）回**失败**加接收 0 条（`ok` 为假、`accepted` 为 0）——0.2.x 曾回 `ok` 为真，0.3.0 起如实报失败。
- 导出电话多余字段忽略（多传的字段不改变行为）。
- **目录冲突（#19 隔离）**：同一个日志目录已有别的活跃写者时，`log()` 抛中文错——这是唯一会抛的运行时路径（同步入口连建库都抛）。冲突期间清空与导出降级为失败形状（`ok` 为假、不删不读共享文件）：宁可失败，也不并发覆写同一份日志。

`logBatch` 的回包说实话（#19 审查必改 R1）：`accepted` 只数**真进了队列**的条数，本批有一行没进就回 `ok` 为假（调用方由此可算被拒条数＝`entries.length - accepted`）；`dropped` 仍是宿主侧**累计**丢弃数，不是本批的。累计数只数用户行：`log.persist.fail`、`log.rotate.*` 这类内部诊断行不计入（它们自己落盘失败也不计）。注意 `ok` 为真只代表**已进落盘路径**，不代表已落盘——写盘失败时行进重试位（有界重试，磁盘恢复后补落盘），那一刻仍是 `ok` 为真加 `dropped` 不变；要确认真的落盘请 `await store.synced()`。

开关读写失败保持旧值，不回退为开启。客户端写开关失败原因只给机器码（`host-unavailable`、`host-rejected`、`switch-timeout`、`stale` 等），面向用户的文案由界面经多语言系统转换。

## 6.1 轮转与保留（#21）

一天一个可写文件：`<cacheDir>/logs-<pluginId>/YYYY-MM-DD.log`。写盘是「读旧文 + 拼新行 + 全文覆写」（文件服务没有追加原语），所以按天分文件把单次覆写体积封顶在一天之内；再超就在写之前封存。

- **封存**：写这批之前，若「当日文件已有内容 + 这批要写的字节数 > `maxSize`」，先把当日文件**原子改名**成 `YYYY-MM-DD.N.log`（`N` 从 1 起取当前没占用的最小序号），再新建当日文件写这批；封存成功记 `audit.json` 一条 `rotate.seal`，并落一行 info 自监控 `log.rotate.seal`（带 `file`/`sealed`）。
- **没有 rename 能力就降级**：宿主给的 fs 没有 `rename` 时不封存、继续追加（绝不拿「复制 + 截断」冒充原子改名），并落一行 info 自监控 `log.rotate.degraded`（`reason` 为 `no-rename`）。一行都不丢。
- **保留按天**：每次写盘前顺手清过期——日期早于「今天往前 `maxDays - 1` 天」的 `.log` 删掉；当日可写文件、开关文件、`audit.json` 永不删。清理记 `audit.json` 一条 `retain.evict`（带 `removed` 列表与 `keptDays`），并落一行 info 自监控 `log.retain.evict`。
- **单批自己就超阈值**：这批的字节数本身就大于 `maxSize` 时无法封存（没有旧文可封），照常写入并落一行 info 自监控 `log.rotate.oversize`（带 `file`/`bytes`/`maxSize`）——不静默。
- **审计**：日志目录里的 `audit.json` 逐条记账（`rotate.seal`、`retain.evict`），一行一条 JSON。
- **自监控不进告警面**：`log.rotate.*` 与 `log.retain.*` 都是 **info** 级，不占 `warn`/`error` 的队列配额与告警面，也不计入累计丢弃数（`dropped` 只数用户行）。
- **清空**：`logClear` 点名某天只删那一天的 `YYYY-MM-DD.log`（四段式策略下删那一天的全部文件）；点今天直接回 0、不碰文件；`date: 'all'` 删日志目录里所有匹配文件名的 `.log`，但**当天可写文件**、开关文件与 `audit.json` 永不删。封存件 `<日期>.N.log` 在点名模式下不动（它们由上面的保留清理按天回收）。

## 7. 对象清单、模板与检查器（#561）

每条事件四样东西：事件名、级别（`error`、`warn`、`info`、`debug`）、允许字段（fields，清单内登记、自查用；运行期原样透传、不裁剪）、脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，命中只记规则名不记原文）。`kind` 只为计数服务：`resident` 常驻（始终落盘的轻量轨迹）、`ondemand` 按需（只在调试开关打开时记）、`selfmon` 自监控（日志管道自己的故障行）；三类条数由实现自算（`computeEventCounts`），清单里不再手填 `counts`（0.3.0 已删：解析时忽略，缺失也不抛）。`guard` 可选，一句话写清采样或节流，无特殊守卫不写。

空模板见包内的 `event-list.template.json`（模板里的 `pluginId` 换成自己插件的标识；模板已按 0.3.0 删掉 `counts`——老清单里若还留着那一行，解析时忽略，删不删都行。只含一条事件的最小填好例子见 INTEGRATION.md 步骤 5）。调用方把清单拼成对象传给 `eventList`：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-plugin.json', 'utf8'))

const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', prefix: 'my-plugin', eventList: myEventList }
)
```

路径形式请调用方自己读成对象再传入，日志包不读盘（字符串直接传给 `eventList` 只存不解析，检查器收到字符串会报错并提示先读成对象）。对象形式的清单当场验形状，错了直接报错（含中文说明），不静默修补；数组形式同样被拦下（只收对象，数组多半是把事件表直接当成了清单）。

检查器经宿主入口导出，都是纯函数，不新增日志事件：

```js
import { parseEventListManifest, lintEventFields, computeEventCounts } from 'dsh-log/host'

const manifest = parseEventListManifest(myEventList)
lintEventFields(manifest, 'gh.exec', ['argv0', 'cwdHash'])
computeEventCounts(manifest)
```

`parseEventListManifest` 验形状；`lintEventFields` 做字段白名单检查，只有黄/红两档（未知字段键 warn、未知事件名 error，红不拦上线）；`computeEventCounts` 按 `kind` 自算三类条数（清单里的 `counts` 不再手填，唯一真源就是它）。0.3.0 起 `checkEventCounts` 已删（拿自算值和自算值核对是同义反复，检查不出东西），`checkEventFields` 保留。

门禁走快照确认制（#18 Q6），只有黄/红两档：黄 warn——清单新增字段但快照未更新（跑 `node tests/update-snapshots.mjs` 转绿，不拦排障）；红 error——未知事件名、envelope 非法（落盘行五键 `{v,ts,level,event,fields}` 中 `v` 不为 3 或形状不对）、事件总数突变（与 `tests/event-snapshots/_baseline.json` 比 ±超 5 且 `tests/event-snapshots/CHANGELOG.md` 无说明；红的是“无 changelog”不是字段本身）。每事件批准字段集 check-in 在 `tests/event-snapshots/`（初始从 `tests/eventList.test.mjs` 的 `makeSample` 事件生成），`tests/snapshot.test.mjs` 守两档口径，跑法见第 9 节。本仓的事件对照表就是这套快照（条数会随票增删，别在文档里抄一个数字）；宿主 monorepo 里的 `research/489-appendix.md` 不在本包、也不在本仓，不是这里的门禁依据。

## 8. 已知事项（0.3.0 收口的两条）

1. **散列与截断不再走全局**：`dswsLogHash` 与 `dswsLogTrunc` 两个全局裸函数已删，包内不再读全局对象。导出失败行（`log.export.fail` 的 `errorHash`）默认用包内 8 位十六进制散列；要用自己的散列（例如与旧模块一字相同），经 `createClientLog` 的可选依赖 `hashFn`（`(字符串) => 字符串`）注入，注入失败时回退包内散列。截断固定为错误消息前 120 字切片，不再有注入位。
2. **存储键仍认一个旧名**：正式键是 `storage`；旧闭包名 `localStorage` 仍被接受（迁移期兼容），两个都传以 `storage` 为准。新接入只传 `storage`。

## 9. 发布前 build 与门禁跑法

发布前按顺序两步（演练只跑 dry-run，不真发）。本节命令都在包根（本仓根目录）执行：

```sh
node build.mjs
npm publish --dry-run
```

`node build.mjs` 先跑 `tsc --noEmit` 类型检查，把 `src` 下 43 个可转译 TS（含子目录，按目录结构一对一转译；不含 `node-ambient.d.ts` 这类声明文件）写进 `dist`（转译优先用 esbuild，没装 esbuild 时自动回退 TypeScript 自带转译器），最后再用 `tsconfig.build.json` 产出与 `src` 同形的 `dist/**/*.d.ts`——**声明由 tsc 出，不由转译器猜**（缺一个声明，构建就报错退出）。发布白名单（`files`）打进 91 个文件：`dist` 下 43 个 JS + 43 个 `.d.ts`、`event-list.template.json`、`INTEGRATION.md`、`README.md`、`LICENSE`、`package.json`（`npm publish --dry-run` 实测：压缩包约 111 kB、解包约 349 kB；**体积与散列都以当次 dry-run 输出为准**，它们随打包时刻变化，本文件不再抄具体值）。加新文件进包时同步改 `files` 并重跑 dry-run 确认文件数；改了 `src` 必须重跑 build——本仓当前把 `dist` 一并提交，只改 `src` 不生成产物会留下过期实现。

门禁跑法（改包后全跑，退出码全 0 才算过）：

```sh
npm test                              # = node --test "tests/*.test.mjs"：宿主、客户端、事件清单、Node 入口、全栈隔离、轮转与保留、运行时行为（T7）、快照门禁、查询分页（#20）、追踪链路（#24）、端到端真机链路、接缝不变式（#25）、硬杀耐久（#23）、发行面（#27）、消费方类型编译（#27）、公开面快照、架构门禁（分层与环）——共十七个测试文件、node 自报 16 套（公开面快照与架构门禁同属门禁类）
node --test tests/snapshot.test.mjs   # 单跑快照确认制门禁
node tests/update-snapshots.mjs       # 清单新增字段后：先把黄转绿再提交（这是更新快照，不是判绿）
```

快照门禁只有黄/红两档（#18 Q6）：黄 warn——清单新增字段但快照未更新（`tests/snapshot.test.mjs` 只警告不判红，跑 `node tests/update-snapshots.mjs` 一键更新即转绿，不阻排障）；红 error——未知事件名、envelope 非法（落盘行五键 `{v,ts,level,event,fields}` 中 `v` 不为 3 或形状不对）、事件总数突变（与 `tests/event-snapshots/_baseline.json` 比 ±超 5 且 `tests/event-snapshots/CHANGELOG.md` 无说明；红的是“无 changelog”不是字段本身，补说明后跑更新命令即转绿）。事件条数就记在 `tests/event-snapshots/` 这套快照里，别在文档里抄数字。

`npm test` 的用例清单来自 `package.json` 的 `test` 脚本（上面那十七个文件、共 **153 例**；`pretest` 会先跑 `node build.mjs`，所以测试一定在最新产物上跑）。类型检查：`npm run typecheck`（脚本内已直调 `node node_modules/typescript/bin/tsc`，绕开仓库里那个指向失效路径的 `.bin/tsc` 垫片）。发行面那两套（`release-surface`、`consumer-types`）会把包按 junction 装进临时工程、用真 tsc 编译一次，所以「类型能不能被消费者用上」是门禁里跑出来的结论，不是文档里的承诺。

### 9.1 源码分层（贡献者视角）

`src` 按「依赖只许向右」分成五层（`tests/arch.test.mjs` 的 `layerOf()` 就是这五档，违反即红，不是文档约定）：

```
入口层    index.ts（根入口）· node.ts（Node 入口）· host.ts（宿主入口）
   ↓
面与引擎  store.ts · phones.ts · client.ts          ← 组合根：只做装配与接线
          engine/  pipeline（行流水线：准入/队列/刷盘/重试）· dir-lease（目录租约）·
                   io（IO 端口）· rotation（封存/保留/审计）· switch-file（开关文件）
          host/    query（只读查询电话）· files（导出/清空）· aggregate（查时授权聚合）· context · types
          client/  write（主写路径）· send（取批/裁剪/重试位）· switch-ops · switch-cache ·
                   trace（追踪三件套）· forward（丢弃汇总）· transport · types
   ↓
配置面    config.ts（门面，只 re-export）+ config/  validate · constants · phones · log-names · resolve · event-list
   ↓
平台层    platform/  ports（端口形状）· fs-node · timer-node · later
   ↓
领域层    core/  file-name（文件名解析单源）· level（级别语义单源）· row · retention · admission · trace · ids · outcome
          ← 零 IO、零上层：换平台、纯函数单测、以及「哪些级别永不丢」这类判定都靠这一层
```

门禁规矩（逐条与 `tests/arch.test.mjs` 的断言一致）：`core/` 只引 core 内部；`platform/` 只引 `node:` 内置、core 与 platform 内部；配置面只引 core 与配置面内部**且内部无环**；面与引擎不许引入口层；`node:` 内置的**白名单只有三个文件**——`platform/fs-node.ts`、`platform/timer-node.ts`、`node.ts`（入口层的 `index.ts`、`host.ts` 与组合根都不许碰 `node:`，IO 一律走 platform 端口）；`engine/`、`client/`、`host/` 三个面**互不认识**、也不反向引用组合根（跨面组合只发生在组合根与入口——否则同一份语义会在两个面里各长一份）；全包零运行时依赖、不许 `require`。另一条守卫是 `tests/public-surface.test.mjs`——四个入口的导出名集合快照，搬代码时护着公开面不漂移（要改公开面就得同时改名单与文档）。

官方源上现存的版本是 0.2.x（`npm view dsh-log version` 自查）；**0.3.0 还没发布**，发布前先把本节两步与门禁全跑过。再发新版本时，除了上面两步，还要按第 10 节的版本策略定版本号、把实际发布输出记进发布记录（包根的 `notes-publish-drill.md`），或用包目录下的发布向导脚本 `publish-wizard.sh` 走一遍完整流程（体检、登录、升版本、干跑、发布、发布后验证六段）。发布后有一件事向导不代做、但必须自己做：核对包内 `README.md` 与 `INTEGRATION.md` 跟仓库一致——发出去的是发布那一刻的文档，仓库里改的不会自动跟上。

## 10. 版本策略

语义化版本。破坏性变更有 5 类：电话改名、增删改入参回参形状、改配置写法、改事件清单字段形状、改文件名策略的默认形状。自首个公开发布起算，日志系统的公共接口连续 3 个版本无破坏性变更之前不议拆。

## 11. 安全声明与许可证

用包的人发现安全漏洞，请走本仓 GitHub Issues 报告（标题注明安全字样），紧急情况可直接联系维护人。MIT 许可证，版权人王辰浩，与仓库根 LICENSE 一致。

## 12. 0.3.0 迁移 7 步（从 research/11-migration-checklist-draft.md 搬入）

> 0.3.0 为全新版本，不兼容 0.2.x：无 shim、无双读、无回退。旧 `logs/*.log` 手动导出一次，新目录从空开始。

1. **建库双必填**：补 `pluginId`＋`prefix`（各 1 行）。`wf` 只留旧版，新插件传自己 id，不传直接抛，不再回退。
2. **删手拼目录**：目录／开关／存储键改自动派生（`logs-<id>`、`log-switch-<id>.json`、`dsws.debug.<id>`），删手拼代码 3 处；旧开关作废，需重开一次。
3. **切 quick 入口**：首屏换 `quick` 默认入口（依赖预设，3 行可用）；老三入口按新签名重接。
4. **`flush/ready` → `synced()`**：全局替换；`ready()` 只表示 sink 已开＋队列就绪，保落盘只认 `synced()`；Node 短命程序注册 `beforeExit` 钩。
5. **清单删 `counts`**：删 1 块手填计数（实现自算）；`checkEventFields` 换 `lintEventFields`（未知字段 warn、未知事件 error，红不拦上线）。
6. **解析加 `v===3` 断言**：追踪改从 `fields.traceId/spanId/seq` 取；跨边界原样透传，禁重写 `traceId`；调用方显式处理查询 `denied`（`if(res.denied)` 样板）。
7. **旧日志手动导出一次**：`v!=3` 旧行跳过＋计数不抛错，error 旧行仍可查；新目录从空开始。

走不完就别升级——0.2.x 目录和包继续可用，但不再跟新规格（只修 CVE）。
