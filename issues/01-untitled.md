<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-map -->
# 日志系统升级自查：七项能力与多插件隔离地图

## Destination

日志系统升级自查结论规格：7 项能力（级别/文件/格式/轮转/聚合/链路追踪/追踪标识）有无判定 + 多插件全栈隔离冲突结论 + 升级建议清单。只决策不写代码。

## Notes

- Domain：dsh-log 日志包（三入口 host/client/node；用词：日志系统=功能本身，日志包=npm 包；电话=宿主方法，落盘=写本地文件）。
- Skills：research（AFK 事实票）；必要时 prototype/grilling；domain-modeling 术语口径沿用本次确认。
- 口径（Round1 已确认）：聚合=跨插件或跨进程集中收集与查询（相对现在只本地落盘+手动导出）；链路追踪=一个请求跨宿主/客户端/插件的端到端串联；追踪标识=每条日志带的 trace/requestId 字段；第三方=泛指未来任意插件；隔离=全栈（电话名/落盘目录/开关文件/客户端存储键/全局函数）。
- Standing：plan-don't-do（map 只决策不交付）；refer by name；issue 操作走 deck_ 工具并用 deck_issue_report 上报。
- 全量要求（2026-10-09 用户立；Q1=A：最核心信息走脱敏、记规则名不记原文；Q2=B：开关保留、只管详细度、落盘零丢弃；门禁红灯=抑制）：日志须应有尽有，不得立“某某场景不要打印”式抑制规则。
- grill-me R1（2026-10-09）：Q1 门禁红灯=抑制；Q2 开关=B（保留，只管详细度，落盘零丢弃）；队列满语义与门禁红黄（Q5/Q6）待 R2。
- 后端注记（2026-10-09）：后端由 GitHub 保留式切换为 markdown（GitHub 数据 #1–#10 仍在，切回可见）；本图为 md 重建，GitHub 原图结论摘要并入 Decisions so far。

## Tickets

<!-- md 后端无 setParent：父子以文件同 effort 目录 + 子票顶 parentKey 注释为承载体，快照数不清子票，以本清单与逐张 parentKey 读回为准。 -->

- [x] 02 自查：日志文件是否具备（已结：部分具备）
- [x] 03 自查：日志级别是否具备（已结：部分具备）
- [x] 04 自查：日志轮转是否具备（已结：部分具备）
- [x] 05 自查：日志格式是否具备（已结：部分具备）
- [x] 06 自查：日志聚合是否具备（已结：部分具备）
- [x] 07 自查：链路追踪是否具备（已结：无）
- [x] 08 审查：多插件全栈隔离是否冲突、能否隔离（已结：部分隔离）
- [x] 09 自查：追踪标识是否具备（已结：无）
- [ ] 10 调研：成熟 TS/前端日志库做法与可否照搬（本轮关闭归档）

## Decisions so far

- [调研：成熟 TS/前端日志库做法与可否照搬](https://github.com/FeatherHunter/dsh-log/issues/10)（GitHub #10，已关闭；结论原文见该票 resolution comment）：无直接照搬；pino 底座、轮转抄 winston-daily-rotate-file、链路抄 roarr adopt+sequence、多入口对标 electron-log，丢弃类一律不抄，门禁自建。
- [自查：日志文件是否具备](02-untitled.md)（票 02，已结）：**部分具备** —— 本地落盘／目录派生（`wf`→`logs`）／按天文件（daily，另有可选四段式）／导出·清空·开关电话 四项具备；「重要日志零丢失落盘」**不成立**（错误与告警只保证不被级别开关拦，不保证落盘）。四条实测丢失路径：队列满（错误/告警占满时错误本身也丢）、进程立刻退出（直通是 0ms 定时器，四级全丢）、写盘失败（只计数，`log.ready` 仍 resolved）、多进程共写同目录（读改写无锁，6 轮 4 轮整批丢行）。另附 6 条 README 出入（版本号、宿主 monorepo 路径与 `npm test` 2 套起不来、`fallback` 恒真等）。证据：`research/02-log-file-capability.md`；Q5 仍开放留 R2。
- [自查：日志级别是否具备](03-untitled.md)（票 03，已结）：**部分具备** —— ①四级**有**（`src/config.ts:243`／`src/store.ts:33`／`src/client.ts:133` 三处定版，清单层硬校验 `src/config.ts:342-344`，级别真驱动放行·刷盘时序·队列取舍；缺口：`log(level: string)` 运行期不拦越界级别，实测 `trace`/`FATAL` 原样落盘）。②三类归类**部分**（数据模型与计数门禁在 `src/config.ts:247/345-347/404`，但**运行期不读 `kind`**：常驻靠手写 43 条事件名名单 `src/store.ts:246-259`／`src/client.ts:263-276`，该名单与父仓附录 §1.4「常驻 43 条」集合完全相同，已独立复核；`ondemand` 靠开关兜底、`selfmon` 无标记载体）。③开关语义 Q2=B **部分**（开关保留／只管详细度／错误与告警在选行层恒被接收成立；**「落盘零丢弃」不成立**：宿主队列满、客户端队列满（`src/client.ts:293-297` **完全不看级别，error/warn 一律丢**）、超包/超队裁剪、写盘/转发失败四条路都只计数不落盘）。实测最硬一条：客户端队列塞满 100 条后推一条 `error` → 丢弃 +1，队列与宿主实收里都没有它。Q5 未定，凡依赖处已标「待 Q5」。证据：`research/03-log-level-capability.md`。
- 给票 03（自查：日志级别是否具备）的先行实锤：`src/store.ts:263-267` 先按 `error/warn`、再按**事件名**查常驻名单、最后才看开关，与级别无关 —— 实测开关关闭时 `log('debug','host.start')` 与非法级别 `log('trace','host.start')` 都落盘，`log('debug','guest.exec')` 不落盘；README §2.1/§4 与 `src/config.ts:242` 的「其余信息与调试只在开关打开时落盘」按现有实现不成立。**（票 03 结票时更正（2026-10-09）：前半段代码读法正确，已被票 03 采纳为依据；但末句结论不成立——`host.start` 在常驻名单内（`src/store.ts:253`），属 `README.md:56` 写明的「常驻信息落盘」例外，不是「其余」；探针 E 实测开关关闭时 `debug/host.start`、`trace/host.start` 落盘而 `debug/guest.exec`、`info/guest.exec` 不落盘，故该句在现有实现下成立。此处真正成立的发现是另一条：常驻名单那一支先于级别与开关生效，越界级别落在常驻事件名上时开关关着也照样落盘。详见 `research/03-log-level-capability.md` §1.1。）**
- [自查：日志轮转是否具备](04-untitled.md)（票 04，已结）：**部分具备** —— 三条判据里只有最弱的一条以退化形态存在：①**按大小切分＝无**（全包无一处测量文件体积，`statSync`/`.size`/`byteLength`/`fileSize` 在 `src/`+`dist/` 零命中；配置面只有 7 键、无任何大小阈值；实测单日写满 5,008,700 字节仍是同一文件、无计数后缀，Lead 缩放复核 6 轮×10 行×50KB → 单文件 3,004,920 字节）。②**按时间切分＝部分（仅「按自然天分桶」）**（桶按**刷盘时刻**决定文件名 `src/store.ts:394`，跨午夜自动换文件；但轮转三动作全缺：无轮转事件——store 实例 `on`/`once`/`emit`/`addListener` 全 `undefined`、无封存/改名——`rename` 零命中且跨午夜后旧文件字节/mtime/inode 逐一同前、无压缩——`gzip|compress|archive` 零命中）。③**旧文件清理/保留策略＝无**（唯一删除路径是手动电话 `logClear`，无任何内部或定时调用点；实测 40 个自然天 → 40 个文件一个不少，空转 300ms 一个不删）。手动 `logClear` **不是保留策略**（无「留多少」旋钮、不自动、粒度只有「某天/全删」、`'all'` 无下限保护），只是唯一的手动清理手段。**对标差距（一手来源 winston-daily-rotate-file 5.0.0）**：基准把「切分（`maxSize`／`datePattern`+`frequency`）＋封存（发 `rotate` 事件）＋压缩（`zippedArchive`）＋保留（`maxFiles` 按数量或天数、靠 `auditFile` 记账）」做成闭环链路，本包只有「按天换文件名」一环，另三环一环都没有。**文档出入：矛盾数 0**（README「不做」与代码一致），新增 4 条「未写明」（单文件体积与单次刷盘写入量无界、桶由刷盘时刻定、跨午夜无事件无封存、`logClear` 就是清理能力全部且非保留策略）。**从严读法**（轮转须有封存或切换动作）则判据 2 亦为「无」、整体降「无」，两种读法依据都写在报告第 2.5 节。另：本包**没有任何测试**断言过轮转/切分/清理。证据：`research/04-log-rotation-capability.md`（354 行，81 处引用逐条自核 0 处不符；含 Lead 独立复核）。
- [自查：追踪标识是否具备](09-untitled.md)（票 09，已结）：**无** —— 落盘记录里没有任何请求级追踪标识字段；不是「有的带有的不带」，是一条都不带。宿主是唯一落盘者，序列化只挑四个键（`src/store.ts:374`「`JSON.stringify({ts,level,event,fields})`」，`dist/store.js:296` 同形），四键里 `ts` 是时间戳不是标识。票面点名范围 21 个文件里 `trace`/`traceId`/`requestId`/`request_id`/`correlation`/`span`/`spanId` **零命中**（PowerShell 与 grep 两条检索路径互证），补查 `sessionId`/`turnId`/`callId`/`toolCallId`/`uuid`/`nanoid`/`seq` 亦全 0；包内 12 个发射点无一带标识（`src/node.ts:176` 连业务字段都是空对象）。票面点名的既有标识逐个核对，全是非请求级且多数**不进记录**：`pluginId` 只拼四段式文件名（`src/config.ts:175`）、`pid`/`startedAt`/`dir` 只在启动头 `host.start` 那一行（`src/store.ts:466`，产品代码无调用点）、`codes`/`rules` 只是清单里的脱敏引用名、散列只是个别事件的字段值。**关键区分**：`fields` 原样透传且运行期无字段白名单（`checkEventFields` 是纯函数、`src/store.ts`/`src/client.ts` 零调用），实测「传只允许 `step` 的清单仍把 `traceId`/`requestId`/`spanId` 落盘、丢弃 0，而离线门禁对同批字段回红灯」——那是数据通路不拦，不是系统具备；调用方塞就有、不塞就没有 ⇒「每条都带」永远不成立。另一种读法「`fields` 位置预留、不改记录格式就装得下 ⇒ 部分」已在报告与 Answer 单列，留供升级建议票取用。附带硬约束：落盘行顶层键由 `src/store.ts:374` **一处硬定**（客户端多塞的顶层键 `truncated` 在该处被丢），三入口入参形状（`src/store.ts:73-79`／`src/client.ts:78-85`／`src/node.ts:32-41`）与电话入参 `LogEntry`（`src/store.ts:81-85`）都没有承载位置；字段名须自定（GitHub #10 resolution 第 7 条「各库均无保留字」，本次已一手复核）。宿主侧源头有界旁证：`sessionId`/`callId`/`toolCallId`/`requestId` 在 DSH 自身层命中（9 包 86 个 `.js` 有界检索），缺的是通路。证据：`research/09-trace-identifier-capability.md`（含两批独立探针原始输出与 Lead 复核补记）。

- [自查：日志格式是否具备](05-untitled.md)（票 05，已结）：**部分具备** —— 三块判据 有／部分／有：①JSON 行**有**（落盘行唯一形状 `JSON.stringify({ts,level,event,fields})`（`src/store.ts:374`），一行一 JSON、`\n` 分隔、无 BOM/前后缀；`fields` 原样透传 `src/store.ts:294`）；②事件清单格式**部分**（格式层真验形：六键白名单、`level` 四值、`kind` 三值、`fields` 必填、中文报错齐（`src/config.ts:299-367`，31 组矩阵）；语义层零落地：运行期只验形不消费 —— 清单外字段与事件名照落、`kind` 不驱动行为、`codes`/`rules`/`guard` 零实现）；③通用检查器**有**（三纯函数 `src/config.ts:299/379-414`、`src/host.ts:23` 导出、零 import 不读盘、单测 14/14 绿）。关键实锤：注入合法清单后明文密钥与清单外字段**原样落盘**、规则名一个不落，而把宿主自己写的同一行喂回 `checkEventFields` 才判红；`BigInt`/循环引用值整行丢 +1、无 `log.persist.fail`、`ready` 仍 resolved，整批全坏时连日志目录都不建；`fields` 只做 `typeof object` 兜底（数组穿透）。按 Q1「门禁红灯=抑制」，「允许字段（fields，之外不记）」计入判定、最终口径**待 Q6**；丢整行/丢字段只计数**待 Q5**。文档出入 3 条（DF1「之外的键一律不记」运行期无执行者、DF2 `codes`/`rules` 脱敏零实现、DF3 `research/489-appendix.md` 与 14 条 `tests/verify-log-*.js` 门禁不在本仓）。附带面：仓内无任何 CI，包内真脱敏只在自监控/失败行（`errorHash`）。证据：`research/05-log-format-capability.md`（含 Lead 独立复核附录；另一支探针 `.local/selfcheck-05-format-lead1.mjs`）。

- [自查：日志聚合是否具备](06-untitled.md)（票 06，已结）：**部分具备** —— ①跨进程收集**部分**：唯一一条送出通道是 client→宿主的 `logBatch` 自动批量转发（`src/client.ts:478-479` → `src/store.ts:477-497`），实测把 `guest.exec` 送进宿主文件（探针 C），但它只在同一插件的两个半区之间、落点仍是该插件自己的宿主目录（`src/store.ts:385-403`），与 electron-log 的 IPC transport 同型。②跨插件集中**无**：落点按 `pluginId` 天然分开（`src/config.ts:87-98`，实测 `logs-alpha`/`logs-beta` 交叉污染均 false），注册表由调用方传入、无全局表（`src/host.ts:55-80`），5 个电话动作冻结（`src/config.ts:26`）；调用方显式共用同一目录也不成立（读—拼—写无锁，同刻写互相吃掉，同票 02 同源）。③查询**无**：`logExport` 只读一天的一个文件、回 8 键（`src/phones.ts:110-142`、`:188-197`），多传 `format`/`level`/`pluginId`/`limit`/`query` 被显式忽略、`text` 逐字不变；跨天/跨目录/跨插件检索与本仓 GUI/CLI 入口都不存在。④`README.md:34`「不自动上报日志，只做本地落盘加手动导出」**实锤成立**（全仓运行期零网络，`node:http|https|net|dgram|tls|undici` 零命中；无定时器/钩子在无人调用时送出）。⑤附带：`logBatch` 回参 `accepted` 恒等于入参条数、**不代表落盘**（`src/store.ts:492`）；本票判定目前无本仓门禁守着。口径（2026-10-09 用户确认）：跨进程自动转发算达成部分／查询要有检索面才算／以本包三入口自身能力为准；**严格读法（须有第三方可查的集中汇点）判「无」**，两者差别只在这一句，已原样保留在报告里。证据：`research/06-log-aggregation-capability.md`。

- [自查：链路追踪是否具备](07-untitled.md)（票 07，已结）：**无** —— 包内零串联机制：不生成 id、不继承上下文、不打序号、跨边界载荷不带关联字段。①**零命中**：`src/` 7 文件 × 30 词检索 29 词零命中（trace/span/correlat/requestId/traceId/sequence/seq/adopt/parent/child/getContext/asyncLocalStorage/uuid/counter…），`dist/`、`tests/`、README/INTEGRATION 同批词零命中；唯一非零是常驻**事件名** `sessionTickets.chain`（`src/store.ts:255`、`src/client.ts:272`，是工单依赖链不是链路追踪）与依赖注入类型名 `LogPhonesContext`（`src/phones.ts:17/60/83`）。②**三个载体全空**：上下文继承（roarr `adopt` 对应物）无——工厂只返单实例（`src/host.ts:49-53`、`src/client.ts:198-206`、`src/node.ts:136-154`），无 `adopt`/`child`/`getContext`/`AsyncLocalStorage`，`globalThis` 全 `src/` 仅 6 处且全是读；顺序号（roarr `sequence` 对应物）无——落盘行顶层键恒为 `{ts,level,event,fields}`（`src/store.ts:373-375`），实测 60 条与 200 条连发 `ts` 去重数都是 1；请求 id 生成与传播无——电话入参（`src/client.ts:468` `{entries,droppedCount}`）、回参（`src/store.ts:492`）、建库参数（`src/config.ts:34-54`）、开关文件（`src/store.ts:448`）、导出 summary（`src/phones.ts:158-164`）、启动头（`src/store.ts:461-471`）六个载体逐个核空。③**材料层一条（单列，不计入具备）**：调用方自造字段全链原样透传（`src/client.ts:298-303` → `:468` → `src/store.ts:483-491` → `:373-375`），且跨边界只保 `fields`——客户端条目的 `ts` 会被丢弃、改用宿主接收时刻重打（实测喂 `ts:111` → 落盘为宿主接收时刻），所以「手工串」今天能做、机制不在包里。**锚点一手来源**：roarr `adopt`＝Node `async_context` 上下文下传（仅 Node 可用），`sequence`＝信封固定顶层字段（无 adopt 时为进程内全局自增），dsh-log 各 0/5 无对应物（https://github.com/gajus/roarr/blob/main/README.md 、…/src/factories/createLogger.ts 、…/src/types.ts ）。**判定尺度**与票 09 同标准（包内自己产生或自己保证才叫具备）；另一种读法「调用方约定下能串 ⇒ 部分」已单列、不采纳。**旁证**：抽包前旧实现两模块（`dsh-main-check` 的 `host/logStore.js`、`client/kernel/log.js`）零命中 ⇒ 不是抽包丢失；消费方日志调用粗筛唯一一条带会话散列（`src/probe-stale.js:60` 的 `sessionIdHash`，单点、debug、非请求级）。证据：`research/07-trace-capability.md`（含 Lead 独立复核第 6 节）。

- [审查：多插件全栈隔离是否冲突、能否隔离](08-untitled.md)（票 08，已结）：**部分隔离** —— 五层里三层靠「默认派生 + 调用方纪律」隔离（电话名前缀、落盘目录 `logs-<标识>`、开关文件 `log-switch-<标识>.json`），两层**现状不隔离**：①客户端本地存储键是全插件单键 `dsws.debug`（`src/client.ts:121`；配置面注释自认「存储键沿现状不参数化」`src/client.ts:87`），实测 A 开开关 → 后建的 B 读到 `enabled:true` 且 `log('debug',非名单事件)` 真的入队，B 关开关或 B 启动对账（`src/client.ts:537-539`）把 A 的持久值抹成 `false`；②全局函数 `dswsLogHash`/`dswsLogTrunc` 是**调用时实时读**（`src/client.ts:385-388`），一份实现服务所有同进程实例、后挂盖先挂。另两条硬实锤：目录/开关文件的**显式覆盖值零校验**（`src/config.ts:87-98` 原样直用，`'../escaped'` 都收），同名目录下 A 的 `logExport` 原文里含 B 的行、A 的 `logClear({date:'all'})` 把共用文件删掉（`removed=1`）B 的行一并消失；`pluginId:'wf'` 走旧字面 `logs`/`log-switch.json`/`wf.*`（`src/config.ts:90-98`），声明 `wf` 的第三方插件不写任何覆盖字段就默认全撞。电话名是五层里唯一有硬门禁的（`src/host.ts:75-77` 撞名抛错不覆盖），但它是否生效取决于宿主是否共用一张注册表（仓内未证实：`README.md:71` 示例各用一张表 vs `INTEGRATION.md:222` 隐含共表，全域检索未找到宿主侧集成代码）。对标 electron-log（一手核）：**多实例≠隔离** —— `Logger.instances[logId]` 是类级注册表（同名后建静默覆盖）、文件 transport 共享模块级 `globalRegistry`（同路径按绝对路径去重后合成一个 `File` 单写者）、`errorHandler` 被 `create()` 按引用共享且每个新实例重绑、后建者接管（**`create()` 不传 `eventLogger`**，新建实例的 `eventLogger` 为 `undefined`）、`maxSize` 轮转判据取**共享** `file.size`（一个实例轮转会 `renameSync` 掉别人正在写的文件）、默认落点所有实例都是同一个 `main.log`；它没有开关文件/本地键机制（本票第 3、4 层无对应物），`log.scope()` 只加行内标签。「互相不知对方存在」只在「标识互不相同且谁都不写覆盖字段」这一条路径上成立。现有测试对这一层零覆盖（两套单测只有「单插件+自定前缀」断言 `tests/host.test.mjs:118-148`、`tests/client.test.mjs:298-310`，且在本仓跑不起来）；方案前置条件已清楚（第 4、5 层连命名空间入口都没有，第 2、3 层缺覆盖值校验）。收尾后两个后台 agent 交付：对标节升级为 `electron-log@5.4.4` 基准并更正初稿一处错误（`create()` 不传 `eventLogger`）；仓库取证 agent 的三条新发现（电话名注册**非原子**——撞名抛错后表里已留下前两个动作、同进程两实例共写同目录 5 轮每轮只活 1 行、扁平 `cacheDir` 命名空间跨层互踩）经 Lead 独立复跑后收入报告「补充实测」，另补「不传配置 = 落 `wf`」「开关读回一次性」两条。证据：`research/08-plugin-isolation.md`。

## Not yet specified

- 升级建议的具体条目（待 8 票结论收齐后成票）
- 轮转/聚合/追踪若判无，其方案选型（待前票实锤后成票；外部对标见 GitHub #10（已结），结论回流升级建议）
- 隔离若实锤冲突，其修复方案（待隔离票结论后成票）
- 升级建议须满足全量无抑制要求（Q1=A、Q2=B、门禁红灯=抑制已定；队列满语义与门禁红黄待 R2，影响级别/格式/轮转票口径）
- 追踪标识若判无（票 09 已判无），其字段名与接入通路待成票：现无保留字需自定；落盘行顶层键由一处硬定，且宿主是否把 `sessionId`/`callId` 交给消费插件**未核**（票 09 只核到宿主自身层有这些标识），要接就得先补这一核

## Out of scope

- 具体代码实现（map 完成后另起执行）
- 点名插件逐个适配（本次泛指未来任意插件）
- 自动上报/轮转/清理的实现本身（超出自查）

Status: ready-for-agent
Type: map
Blocked by:
Labels: wayfinder:map

## Comments


## Answer

## 状态

- 2026-10-09 md 重建完成：map 01 + 子票 02–10 共 10 张全建好；父边 9/9 建边失败（后端明示 markdown setParent unsupported，回退 in-file parentKey 注释承载，不冒充原生）；快照在该后端数不清子票（0/0），以 ## Tickets 清单 + 逐张 parentKey 读回为准；labels 原生落地（map=wayfinder:map，子票=wayfinder:research+task）。
- 2026-10-10 02:10 deck 工具升级后复测（三轮共 5 张临时票实测写路径，验完全部删除；全仓 28 张票已审：H1/Status/Type 无一受损）：
  - **已修（两点）**：①**读路径不再重渲染**——`deck_issue_get` 回的 body 与磁盘逐字一致；②**标题块重复已消失**——显式传 `idempotencyKey` 建票实测标题只出现一次（仓内 `11/12/13/18/19/20/21` 那 7 张仍带双 H1，是修复前留下的旧痕迹，非当前版本行为）。
  - **仍存在（写路径）**：①**`create` 恒定追加必备骨架**，不管正文写了什么：实测四种正文（只含 Comments/Answer；含 Comments/Answer+Status 全套；自动锚；显式锚）**全部**在末尾多出一组 `## Comments`+空 `## Answer`，含 Status 全套的还**再重复一遍 Status/Type/Blocked by/Labels**（票 `29-temp-3.md` 实测双 Status 块）。⇒ **没有任何正文写法能避免重复段**。
    ②**`patch` 传 `body` 会丢元数据**：H1、`DSH-IDEMPOTENCY-KEY`、`parentKey` 注释**全被抹掉**且不恢复；正文**无 H1** 时标题被取成首个标题行（实测标题变成「Question」）。幂等锚丢失后同标题再建票**不再复用而是新建**（实测两张同标题票，锚 `…3c-5971896` 与 `…3d-5971897`）。带 H1 传 body 则标题正确、H1 留在正文，但幂等锚**仍不恢复**。
    ③**`patch` 传 `progress` 会把 `Status/Type/Blocked by/Labels` 块插到 `## Answer` 标题与正文之间**，答案正文被挤到 Status 块之后（本图 `## 状态` 同款：内容落在 `## Answer` 之后）。
  - **对引用方式的影响**：行号在并发写入下持续漂移（本图 Q5 原文本轮实测走过 `:41` → `:51` → `:54`，`## Not yet specified` 起于 `:49`、`## Out of scope` 起于 `:57`），跨票引用**应以段名+原文为准，不要只写行号**。
  - **使用建议**：改正文**不要传 `body`**（会丢锚，改用 `comment` 或直接编辑文件）；必须传 `body` 时务必自带 H1 标题行，并事后补回幂等锚；建票后如发现末尾重复段，需人工删一次。
