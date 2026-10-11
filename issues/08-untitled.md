<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-isol -->
<!-- parentKey: 01 -->
# 审查：多插件全栈隔离是否冲突、能否隔离

## Question

审查泛指的未来任意第三方插件共用本日志系统时是否冲突、能否做到互相不知对方存在。全栈五层逐层判定：电话名（prefix）、落盘目录（logDirName）、开关文件（switchFileName）、客户端本地存储键（已知 dsws.debug 单键疑点）、全局函数（dswsLogHash/dswsLogTrunc）。给出最小复现思路，不写修复代码。对标：electron-log 多实例隔离（见 Decisions）。

输出：每层隔离/冲突结论 + 证据（src/host.ts 注册冲突报错、src/client.ts 存储键、README 第 5 节）。

## 进度

<!-- 做到哪一步了，在这里一行一行记 -->
- 2026-10-09 起：读票 08 与父图 01 口径（「第三方」=泛指未来任意插件；「隔离」=全栈五层，`issues/01-untitled.md:12`），确认本票是 AFK 事实票、五层与输出形状已由票面给死，**无「我猜」点，不需要 grilling 澄清**。
- 2026-10-09 取证：源码逐行核对 `src/{host,config,client,store,phones,node}.ts` + `README.md` + `INTEGRATION.md` + 两套相关单测；三支只读探针（`.local/selfcheck-08-isolation{,2,3}.mjs`，引 `dist/*.js`、系统临时目录、未改仓库任何文件）覆盖五层两个轴。
- 2026-10-09 对标：electron-log `master` 一手来源核验（`src/core/Logger.js`、`src/node/transports/file/index.js`、`FileRegistry.js`、README、docs/transports/file.md，2026-10-09 读取）。
- 2026-10-09 引用自检：抽查 66 处 `路径:行号` 逐行打印原文，全部命中、无越界。
- 2026-10-09 收尾：答案写回本票并置 Status: resolved；同步给地图 01 的 Decisions so far 加一条引用。
- 2026-10-09 合入（收尾后补）：两个后台 agent 交付——对标 agent 的取证（基准 `electron-log@5.4.4`）合入报告并**更正初稿一处错误**（`create()` 不传 `eventLogger`，初稿误写成与 `errorHandler` 一样被共享）；仓库取证 agent 的三条新发现（注册非原子、同进程共写同目录也丢行、扁平 `cacheDir` 跨层互踩）由 Lead 用 `.local/selfcheck-08-isolation4.mjs` 独立复跑确认后收入报告「补充实测」，另补两条口径（不传配置落 `wf`、开关读回一次性）。报告现 44142 B。
- 注记：两个后台 agent 均已交付（仓库取证 + electron-log 对标）；仓库取证 agent 的正文写入同一路径后被 Lead 的重建覆盖（仅留探针与原始输出于 `D:\Temp\dsh-log-08\`），其三条本稿未覆盖的新发现已由 Lead 独立复跑后收入报告「补充实测」一节；对标 agent 的取证已合入并据此更正了初稿关于 `eventLogger` 的错误（`create()` 不传 `eventLogger`）。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

- 2026-10-09（产出说明）：本票报告 `research/08-plugin-isolation.md` 由 Lead 直接产出，仓库内事实全部为「源码逐行核对 + 只读探针实测」，外部对标为一手来源；未改任何代码、未改 README/INTEGRATION，与文档的出入只记录不修改。
- 2026-10-09（合入注记）：两个后台 agent 于收尾后交付。对标 agent 的 electron-log 取证（`electron-log@5.4.4` 基准）已合入，并据其更正了报告初稿把 `eventLogger` 写成被 `create()` 共享的错误（实为不传递）；仓库取证 agent 的正文与 Lead 稿写在同一路径、已被 Lead 的 23:09 重建覆盖（其 6 支探针与原始输出留在 `D:\Temp\dsh-log-08\`），其三条新发现经 Lead 独立复跑后作为「补充实测」一节并入。`issues/` 下其余文件未由后台 agent 改动。

## Answer

**整体判定：部分隔离。** 五层里**三层靠「默认派生 + 调用方纪律」隔离**（电话名、落盘目录、开关文件），**两层现状不隔离**（客户端本地存储键 `dsws.debug`、全局函数 `dswsLogHash`/`dswsLogTrunc`）。「互相不知对方存在」只在「各插件标识互不相同、且谁都不写覆盖字段」这条路径上成立；任意第三方场景下冲突可复现，且大多**静默**（唯一报错处是电话名注册，`src/host.ts:75-77`，而它是否生效取决于宿主是否共用一张注册表）。

证据全集（逐条 `file:line` + 三支探针实测 + electron-log 一手对标）：`research/08-plugin-isolation.md`。只给结论，未改任何代码，未给修复方案。

### 五层判定（默认派生 / 任意第三方）

| 层 | 判定 | 默认派生（标识互不相同） | 任意第三方（同前缀/显式同名） |
|---|---|---|---|
| 1 电话名 prefix | 部分隔离（唯一有硬门禁的一层） | 隔离：`alpha.*` vs `beta.*`（实测） | 共用注册表→第二次注册**抛错不覆盖**（实测）；各用各的表（`README.md:71` 示例即 `new Map()`）→ **静默同名**（实测） |
| 2 落盘目录 logDirName | 部分隔离（靠约定，无校验） | 隔离：`logs-alpha`/`logs-beta`，导出/清空互不可见（实测） | 显式覆盖值**零校验**（`src/config.ts:87-92` 原样直用；`'../escaped'` 也被接受，实测）；同名后 A 导出**读到 B 的行**、A 清空把 B 的行一起删（`removed=1`，实测） |
| 3 开关文件 switchFileName | 部分隔离（靠约定，无校验） | 隔离：`log-switch-alpha.json`/`log-switch-beta.json`，A 开开关 B 仍读到 `false`（实测） | 同名后 B 建库即读到 A 写的 `enabled:true`（自己从未设置过，实测）；盘上最后写者说了算，重建实例读回它（实测） |
| 4 客户端存储键 | **不隔离** | **不隔离**：键是常量字面 `dsws.debug`（`src/client.ts:121`），前缀不参与键名，源码注释自认「存储键沿现状不参数化」（`src/client.ts:87`） | A 开 → 后建的 B 读到 `true` 且 `log('debug',非名单事件)` 真的入队；B 关或 B 对账（`src/client.ts:539`）把 A 的持久值抹成 `false`（实测） |
| 5 全局函数 | **不隔离** | **不隔离**：一份全局实现服务所有实例（实测 A、B 同为 `AAAA0000`） | 换实现后**已建实例**的输出一起变（实测 `BBBB1111`）——调用时实时读全局（`src/client.ts:385-388`），谁挂谁生效、后挂盖先挂 |

### 最硬的三条

1. **客户端存储键是全插件单键、且源码自认不参数化**：`LOG_DEBUG_KEY = 'dsws.debug'`（`src/client.ts:121`），配置面只收 `pluginId`/`prefix`/`eventList`（`src/client.ts:87-97`）。实测：A 开开关 → 后建的 B 读到 `enabled:true` 且 `isEnabled('debug','x.y')` 为真、`log('debug','x.y')` 真的入队；B 关开关（或 B 启动对账，`src/client.ts:537-539`）把 A 的持久值覆盖。**双向可读可写，谈不上「互不知」。**
2. **目录/开关文件的显式覆盖值零校验，共写后果穿透到「读」与「删」两个电话**：`src/config.ts:87-98` 直用覆盖值（连 `'../escaped'` 都收）。实测同名目录下：alpha 的 `logExport` 原文里含 gamma 的行，alpha 的 `logClear({date:'all'})` 回 `{"ok":true,"removed":1}` 把共用文件删掉、gamma 的行一并消失。
3. **全局函数是调用时实时读，一处挂载影响所有同进程插件**：`logExportFail` 只认 `globalThis.dswsLogHash`/`dswsLogTrunc`（`src/client.ts:385-388`）。实测：一份实现同时服务两个前缀不同的实例；**不重建实例**直接换实现，原实例下一行输出一起变；撤掉才回落包内散列。README §8.1 的「挂到全局对象同名位置即可」在多插件下等于「谁挂盖谁」。

补充：默认派生对互不相同的标识是单射（`logs-<标识>`、`log-switch-<标识>.json`），但 `pluginId:'wf'` 走旧字面 `logs`/`log-switch.json`/`wf.*`（`src/config.ts:90-98`）——任何声明 `wf` 的第三方插件**不写任何覆盖字段就默认全撞**（实测）。包内无「标识唯一性」注册表。

### 能不能隔离

**能**，但五层的缺口不同：电话名已有强制口子（注册报错，缺的是各表也拦或标识唯一性）；目录/开关文件缺的是覆盖值校验（默认派生本身已够）；存储键与全局函数**连命名空间入口都没有**，前置条件最重。本票只判可行性方向，不给方案、不写修复代码（方案属地图 01 的 Not yet specified，`issues/01-untitled.md:43`）。

### 对标 electron-log（一手来源）

electron-log（基准 `electron-log@5.4.4`，master 与 npm tarball 19 个 `src/**` 文件 SHA256 一致；一手来源核）给的是**多实例，不是隔离**：`Logger.instances[logId]` 是类级注册表（同名后建静默覆盖，且 `logId` 不参与任何派生、重名无校验）、文件 transport 用模块级共享 `globalRegistry`（`FileRegistry.provide` 按绝对路径去重后共用一个 `File`，并**忽略后来者的 `writeOptions`/`sync`**）、`errorHandler` 被 `create()` 按引用共享且**每个新实例重绑 `logFn`、最后建的接管**（注意：`create()` **不传 `eventLogger`**，新建实例的 `eventLogger` 为 `undefined`）、默认落点所有实例都是同一个 `main.log`（README 原文要求「configure each instance separately」）、`maxSize` 轮转虽然配置在实例上但判据取**共享文件**的 `file.size` ⇒ **一个实例的轮转会 `renameSync` 掉别的实例正在写的文件**。它**没有**任何开关文件/本地存储键机制（本票第 3、4 层无对应物），`log.scope()` 只加行内标签、不参与路径派生；跨实例的共享面还包括硬编码 IPC 通道名 `__ELECTRON_LOG__`/`__ELECTRON_LOG_IPC__`、模块级 `externalApi` 单例、`initialize` 一次性标志位与固定全局名 `window.__electronLog`。**可取之处**：同一路径由 `FileRegistry` 收敛成单写者（不丢行，只是混流），本包同目录共写是读改写无锁（票 02 实测整批丢行、本票又加深到同进程）——这是本包最值得对标的一格。

### 补充实测（后台取证 agent 首报，Lead 已独立复跑）

- **注册非原子**：`src/host.ts:72-79` 循环内先判后 `set`、撞名即抛 ⇒ 实测抛错后表里**已留下 `qa.logBatch`/`qa.logExport`**（5 个电话里 2 个半注册在位，其余 3 个静默缺失）。
- **同进程共写同目录也丢行**：两个实例同一 `logDirName`，各写一条 error 后并发 `flushNow`，5 轮**每轮只活 1 行**（把票 02 的「多进程」加深到同进程，机制同 `src/store.ts:367`/`:396-403`）。
- **顶层 `cacheDir` 是扁平命名空间**：用别人的开关文件名当自己的 `logDirName` 会让后来者自己写盘失败、先到者无损（覆盖值零校验的另一个出口）。
- **不传配置 = 落 `wf`**（`src/store.ts:111-113`、`src/client.ts:108`）：忘传配置的第三方与 wf 插件四样全撞且不报错。
- **开关读回一次性**（`src/store.ts:421-422`）：同实例第二次 `loadSwitch` 不重读盘；客户端侧最锋利形态是 A 关共享键 ⇒ B 的新客户端对非常驻 info 返 false、该行静默消失且丢弃数不涨。

### 与 README/INTEGRATION 的出入（4 条）

- I1 §4 只说「允许显式覆盖」，未说覆盖值零校验、可与别人默认名重合（`README.md:89-90`、`src/config.ts:87-98`；纪律只在 `INTEGRATION.md:104/219/222`）。
- I2 §5.2/§8.2 只说键名是 `dsws.debug`，未说**全插件共用一个键**（`README.md:135`、`:185` vs `src/client.ts:87/121`）。
- I3 §8.1 未说挂上全局函数会**影响同进程所有插件**（`README.md:184` vs `src/client.ts:385-398`）。
- I4 撞名语义两处预设不一致：README §3 示例每次 `new Map()`（各插件一表）vs `INTEGRATION.md:222`（隐含全宿主共表）；仓内无法证实真实宿主用哪种，故第 1 层保留两支判定。

### 未验证与遗留

- **真实宿主是否共用一张电话注册表**、**两插件是否同 `cacheDir`/同 origin（`window.localStorage`）/同 `globalThis`**：均在宿主侧。在 `D:\dsh-plugin` 全域检索 `registerHostLogPhones` 的消费方只命中本包历史 checkout，未见宿主集成代码；`D:\DeepseekHarness\resources\app.asar\dsh` 在本机不存在。若客户端被隔离在不同上下文，第 4、5 层结论按实况打折。
- **`dist`（2026-10-07）与 `src`（最后改 2026-10-04）未做字节级重生成比对**（本仓跑不了 `build.mjs`，缺 esbuild，同票 02 的 D2）；已逐项比对产物机制与源码一致（`dist/client.js:31/51/69`、`dist/config.js:25`），实测数字仍以 `dist` 产物为准。
- **现有测试对这一层零覆盖**：两套单测只有「单插件 + 自定前缀」的隔离断言（`tests/host.test.mjs:118-148`、`tests/client.test.mjs:298-310`），**没有一条「两个插件同时建库/建客户端」的对照**；且这两套在本仓跑不起来（`tests/host.test.mjs:15`、`tests/client.test.mjs:19` 引用宿主 monorepo 旧路径），即既有断言目前不可执行。
- **不属于本票**：文件（02）、级别（03）、轮转（04）、格式（05）、聚合（06）、链路（07）、追踪标识（09）。
