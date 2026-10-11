# 结论

**整体判定：部分具备。**

三块判据：第一块**具备**（附一处运行期不设防），第二块**部分具备**（只在数据模型层具备），第三块**部分具备**（「零丢弃」不成立）：

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | `error`/`warn`/`info`/`debug` 四级 | **有**（附一处运行期不设防） | 四个字面在三个入口各有一份定版枚举（`src/config.ts:243`、`src/store.ts:33`、`src/client.ts:133`），清单里写错级别当场抛错（`src/config.ts:342-344`），且级别真的驱动三条执行路径：放行、刷盘时序、队列压力取舍（第 1 节）。不设防处：`log(level: string)` 运行期不拦越界级别，四级只在清单层被硬校验（第 1.1 节） |
| 2 | `resident`/`ondemand`/`selfmon` 归类 | **部分**（仅数据模型层具备） | 三字面定版枚举 + 计数门禁确实存在（`src/config.ts:247`、`src/config.ts:404`、`tests/eventList.test.mjs:83-96`）；但**运行期没有任何判定读 `kind`**：真正决定「常驻信息开关关着也落盘」的是另一张手写 43 条事件名名单（`src/store.ts:246-259`、`src/client.ts:263-276`），`ondemand` 靠开关兜底、`selfmon` 无标记载体，两者靠人工同步、无程序化绑定（第 2 节） |
| 3 | 开关语义（Q2=B：开关保留、只管详细度、落盘零丢弃；错误与告警恒落盘） | **部分具备** | 「开关保留」「只管详细度」「错误与告警在选行时恒被接收」成立；**「落盘零丢弃」不成立**：队列满、写盘失败、转发失败、超包/超队裁剪四条路都在丢行且只计数（第 3 节）。其中队列满语义属未定的 Q5，本票只报现状、不替它定调 |

本票只给结论与证据，不改代码、不提实现建议。凡引用均给 `路径:行号`，实测部分为只读探针（跑在系统临时目录 `D:\Temp`，未改动仓库任何文件）。

---

# 判据与口径（出处，非本票自拟）

- 票面判据：`issues/03-untitled.md:5-9`——「判定日志级别能力是否具备：error/warn/info/debug 四级、常驻(resident)/按需(ondemand)/自监控(selfmon)归类、开关语义（Q2=B：开关保留、只管详细度，落盘零丢弃；错误与告警恒落盘）」；输出为「有/部分/无 + 证据（src/store.ts、src/client.ts、src/config.ts 的文件行与测试）」，只给结论不写代码。
- 父图既定前提：`issues/01-untitled.md:14`——「全量要求（2026-10-09 用户立；Q1=A：最核心信息走脱敏、记规则名不记原文；**Q2=B：开关保留、只管详细度、落盘零丢弃**；门禁红灯=抑制）：日志须应有尽有，不得立'某某场景不要打印'式抑制规则」；同处 `:15` 记 grill-me R1 复述 Q2=B，并明说「队列满语义与门禁红黄（Q5/Q6）待 R2」。
- **未定项**：`issues/01-untitled.md:41`——「队列满语义与门禁红黄待 R2，**影响级别/格式/轮转票口径**」。本票凡结论落在队列满处，一律标「待 Q5」，**不猜**。

---

# 1. 四级级别：有

**四个字面三处定版，且互相独立可查：**

- 清单/配置面：`src/config.ts:243`「`export const EVENT_LEVELS = ['error', 'warn', 'info', 'debug'] as const`」；类型别名 `src/config.ts:244`；口径注释 `src/config.ts:242`「事件级别（沿用附录定版：错误与告警始终落盘，信息中常驻落盘，其余只在调试开关打开时落盘）」。
- 宿主落盘引擎：`src/store.ts:33`「`export type LogLevel = 'error' | 'warn' | 'info' | 'debug'`」；`src/store.ts:282`「记一行日志：只进内存队列就返回，不等写盘完成。级别只有 error、warn、info、debug。」
- 客户端引擎：`src/client.ts:132-134`「级别只有四个：error、warn、info、debug。」→「`export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const`」→「`export type ClientLogLevel = (typeof LOG_LEVELS)[number]`」。

**级别不是只写在文档里——它在三条执行路径上真的起作用：**

1. **放行（选行）**：错误与告警无条件放行（`src/store.ts:264`、`src/client.ts:280`）；其余看开关（`src/store.ts:266`、`src/client.ts:283`）。
2. **刷盘时序**：错误与告警走 0 毫秒直通、其余走 1000 毫秒防抖——`src/store.ts:296-297`「`if (level === 'error' || level === 'warn') scheduleFlush(true) else scheduleFlush(false)`」，同构在 `src/client.ts:304-305`；窗口常量 `src/config.ts:9`「`export const LOG_DEBOUNCE_MS = 1000`」。
3. **队列压力取舍**：宿主侧按级别挑牺牲者（`src/store.ts:270-281`，见第 3 节）；客户端侧不看级别（`src/client.ts:293-297`，见第 3 节）。

**入参校验（越界级别被挡在运行期之前）：** `src/config.ts:342-344`「`if (EVENT_LEVELS.indexOf(input['level'] as LogEventLevel) < 0) throw new Error('…level 只许 error、warn、info、debug')`」。

**测试（本仓实跑，全通过）：**

| 测试 | 守的是什么 | 引用 |
|---|---|---|
| 「非法形状直接报中文错：级别写错」 | 把 `level` 改成 `fatal` 必须抛错 | `tests/eventList.test.mjs:98-102`（实跑通过） |
| 「级别规则照旧：告警恒落，信息只在开关打开后落」 | 开关关着 `warn` 落盘、`info` 不落；写开关后换新进程 `info` 落盘 | `tests/node.test.mjs:119-142`（实跑通过） |
| 「一行一条 JSON：落盘内容带时间戳、级别、事件名与字段对象」 | 落盘行里 `level` 字段的真实形状 | `tests/node.test.mjs:144-160`（实跑通过） |

**实测补充**：探针 C 里开关关闭时 `warn` 落盘、非常驻 `info`/`debug` 不落盘（与 README:56 同口径）。

## 1.1 判「有」的口径，以及一处运行期不设防

- 判「有」的依据是：四级**存在且真的在用**（三条执行路径 + 清单硬校验），而不是「四级是运行期不变量」。
- 不设防处：两个入口的 `log` 形参都是 `string`，不是 `LogLevel`——`src/store.ts:284`「`function log(level: string, event: string, fields: Record<string, unknown>): void`」、`src/client.ts:291` 同形；客户端转发进宿主时也不校验（`src/store.ts:483-491` 直接 `log(item.level, …)`，而 `LogEntry.level` 是 `string`，`src/store.ts:81-85`）。
- **实测（探针 D，本票新增）**：开关打开后写 `log('trace', …)` 与 `log('FATAL', …)`，落盘级别序列为 `["trace","FATAL","error"]`、丢弃数 0 ⇒ 越界级别原样落盘，运行期不拦。
- **实测（探针 E，本票新增）**：开关**关闭**时，`log('debug','host.start',…)` 与 `log('trace','host.start',…)` **都落盘**（`host.start` 在常驻名单内，`src/store.ts:253`），而同为开关关闭时 `log('debug','guest.exec',…)`、`log('info','guest.exec',…)` 都不落盘 ⇒ 常驻名单那一支**先于级别与开关**生效（`src/store.ts:265` 在 `:266` 的开关判断之前）；客户端同口径（`isEnabled('trace','host.start')===true`、`isEnabled('trace','guest.exec')===false`）。
- 这一支与 `README.md:56`「常驻信息落盘」**一致，不构成文档偏差**；它加强的是上一条：越界级别不只在开关打开时能落盘，事件名落在常驻名单里时开关关着也能落。地图里票 02 留给本票的「先行实锤」把这一现象读作「README 的『其余信息与调试只在开关打开时落盘』不成立」，**本票不采纳**：`host.start` 属常驻（不是「其余」），该句在现有实现下成立。
- 附带事实：全包**没有任何一处 `log('error', …)` 发射点**（全 `src/` 检索：`'error',` 只命中 `src/config.ts:243`、`src/client.ts:133` 两处枚举定义）。包内实际发射点为 `src/store.ts:355`（warn）、`src/store.ts:466`（info）、`src/client.ts:358/392/397/424/559`（warn）、`src/phones.ts:121/200/229/250`（warn）、`src/node.ts:176`（debug）。即 error 级完全由调用方（消费插件）发出，「错误恒落盘」这条在本包内从未被自身行使过。
- 若把判据读作「四级必须是运行期不变量」，本块应降为**部分**；本票按「能力是否具备」judge 为**有**，并把缺口如实列出，供升级建议票取用。

---

# 2. `resident` / `ondemand` / `selfmon` 归类：部分（数据模型具备，运行期不认）

**判「部分」的口径**：作为**数据模型与计数门禁**，三类归类真实存在且真的在跑（验形 + 计数对账，测试可跑）；但作为**行为分类**（resident 恒落 / ondemand 只在开关打开时记 / selfmon 恒落），运行期一条都不认 `kind`——三类语义分别由硬编码名单、开关默认值、以及事件自身的级别实现。所以「归类」具备，「归类驱动行为」不具备。

**归类确实存在：**

- 定版枚举：`src/config.ts:247`「`export const EVENT_KINDS = ['resident', 'ondemand', 'selfmon'] as const`」；类型 `src/config.ts:248`。
- 语义注释：`src/config.ts:232-233`「`kind` 说明这条归哪类计数：resident 常驻（始终落盘的轻量轨迹）、ondemand 按需（只在调试开关打开时记）、selfmon 自监控（日志管道自己的故障行，错误与告警级、始终落盘）」。
- 计数形状与门禁：`src/config.ts:265-269`（`LogEventCounts` 三个必填数字）、`src/config.ts:316-323`（自报计数必须是非负整数）、`src/config.ts:404`「`actual[manifest.events[name].kind] += 1`」（实际条数与自报 `counts` 逐项核对）。
- 校验：`src/config.ts:345-347`「`kind` 只许 resident、ondemand、selfmon」。
- 测试：`tests/eventList.test.mjs:83-96`（三类计数对上/对不上）、`:128-132`（`kind='always'` 当场抛）——实跑全通过。
- 一级口径（上游附录）：`D:\dsh-plugin\dsh-main-check\research\489-appendix.md` §1.4「常驻 43 条（P0，始终落盘，低频轻量）」（`:166`，表 `:176-224`）、§1.5「按需 45 条（P1，只在调试开关打开时记）」（`:228`）、§1.6「自监控 5 条（#499，错误与告警级、始终落盘）」（`:279`，表 `:283-289`）。

**关键结构事实：`kind` 不参与放行，放行认的是另一张手写名单。**

- 三级代码全仓检索：`kind` 只在 `src/config.ts:404` 的计数里被读（以及校验处 `:345-347`）；`eventList` 只在配置解析时验形并存放（`src/config.ts:107-122`、`src/client.ts:96-115`、`src/store.ts:110`），**没有任何一处拿清单去决定一条日志放不放行**。
- 真正决定「常驻信息开关关着也落盘/也转发」的是硬编码名单：`src/store.ts:246-259`（`RESIDENT_EVENTS`，43 名）、`src/client.ts:263-276`（同表，两份逐字相同）。放行处只认事件名：`src/store.ts:265`「`if (typeof event === 'string' && RESIDENT_EVENTS.has(event)) return true`」，客户端同构 `src/client.ts:282`。
- 名单与清单的关系是**人工同步**，代码自己承认：`src/store.ts:239-245`「常驻事件（#731 一次性修好…）为什么是名单而不是逐个开后门：以后新增常驻只改这张表…名单与 research/489-appendix.md 第 1 章常驻 43 条一致」（客户端 `src/client.ts:257-262` 同款注释）。

**独立核验（本票实测，非转引注释）：**

- `src/store.ts` 与 `src/client.ts` 两份名单各 43 条、**逐字相同**。
- 与上游附录 §1.4 的现行 43 条常驻**集合完全相同**：在两个独立 checkout（`dsh-main-check` 2026-10-09、`dsh-deck-final` 2026-10-04）上分别比对，结果均为「代码 43 条 ↔ 附录 43 条，无缺无多」；附录该表尾部另有 `#96 vc.cache.screen`、`#97 labelColors.listed` 两行是**调试**级（属 §1.5 按需），不计入这 43 条。
- 脚本：`D:\Temp\probe-resident-list.mjs`、`D:\Temp\probe-resident-2.mjs`（只读）。
- 因此源码注释「与附录第 1 章常驻 43 条一致」这句话**本票可独立证实**；但注释里提到的对照门禁 `tests/verify-log-count.js` 在本仓**不存在**（见「与文档的出入」D2），这条一致性目前靠人工维护、没有自动门禁在本仓守着。

**自监控（selfmon）与级别的关系**：附录 §1.6 五行级别为「错误/告警」，因此它们落在「恒落盘」一侧；本包内对应的自监控事件（`log.persist.fail` `src/store.ts:355`、`log.forward.summary` `src/client.ts:358`、`log.switch.watchdog` `src/client.ts:424`、`log.export.fail` `src/client.ts:392/397`、`host.call.fail` `src/phones.ts:121/200/229/250`）确实都是 `warn` 级。

**测试守护的实情**：`kind` 的验形与计数有可跑测试守着（`tests/eventList.test.mjs:83-96`、`:128-132`，实跑通过）；**但「resident 名单与清单 `kind` 是否一致」「`kind` 是否影响放行」没有任何测试断言**——注释所称的逐项核对门禁 `tests/verify-log-count.js` 不在本仓（见 D2）。

---

# 3. 开关语义（Q2=B）：部分具备

## 3.1 成立的部分

| Q2=B 的分句 | 判定 | 证据 |
|---|---|---|
| 开关保留 | 有 | 客户端本地键 `src/client.ts:121`「`export const LOG_DEBUG_KEY = 'dsws.debug'`」+ 开关文件读写 `src/store.ts:419-459`（`loadSwitch` / `persistSwitch` / `setSwitch`）+ 两条电话 `src/phones.ts:295-306`；开关文件名派生 `src/config.ts:93-98`；默认关闭 `src/store.ts:118-119`「开关：全局整机一个开关，默认关闭；…」+「`let switchEnabled = false`」 |
| 只管详细度（不抑制错误与告警） | 有 | `src/store.ts:263-267` 与 `src/client.ts:279-288`：error/warn 恒放行，常驻名单内 info 恒放行，其余 info/debug 看开关；开关关闭时非常驻 info/debug **连队都不进**（探针 C：只有 `warn` 落盘，`getDroppedCount()=0`，即门禁不记为丢弃）。测试守住：`tests/node.test.mjs:119-142` |
| 错误与告警「恒落盘」（在**选行**这一层） | 有 | `src/store.ts:264`、`src/client.ts:280`；README:56「级别规则与插件侧完全一致：错误与告警恒落盘…」 |

## 3.2 不成立的部分：「落盘零丢弃」

现行代码有**四条会丢行的路径**，且都只累加计数、不抛错：

| # | 丢弃路径 | 位置 | 是否看级别 |
|---|---|---|---|
| 1 | 宿主队列满 | `src/store.ts:286-289`（满则 `dropForRoom` 后再满就 `return`）+ `src/store.ts:270-281`（`dropForRoom`） | **看**：错误/告警来时挤掉**最旧的普通行**（`:272-278`）；若队里全是错误/告警，挤不动，`dropped += 1`（`:280`）且新行进不去 ⇒ 连错误/告警也会丢 |
| 2 | 客户端队列满 | `src/client.ts:293-297`「`if (logQueue.length >= LOG_QUEUE_MAX) { logDroppedState.count += 1; lastReason = 'queue-full'; return }`」 | **不看**：任何级别一视同仁地丢 |
| 3 | 超包/超队裁剪 | `src/client.ts:448-458`（每批 50 条、单包 128KB 超了 `entries.pop()`、队列超 100 条 `shift()`，都计入 `trimmed`）+ `:459-467` | 不看 |
| 4 | 写盘/转发失败 | 宿主：`src/store.ts:344`（整批 `dropped += batch.length`）、`:376-379`（单行序列化失败）、`:386-390`（取不到缓存目录）、`:405-410`（写盘失败整批）；客户端：`src/client.ts:471-501`（无宿主/被拒/抛错整批计数） | 不看 |

计数出口：宿主 `src/store.ts:412-415`、客户端 `src/client.ts:521-524`；README/代码自陈口径见 `src/client.ts:249-250`「累计丢弃数：队列满丢弃、超包裁剪、转发失败都只计数不抛错」。

**只读探针实测（`D:\Temp\probe-levels-03.mjs`，跑 `dist/`，未改仓库任何文件）：**

- **探针 A（客户端队列满，最锋利的一条）**：`LOG_QUEUE_MAX=100` 塞满后推一条 `error` → 丢弃数 0→1、队列里**没有**这条 error、随后宿主实收的 50 条里也**没有**它。⇒ **「错误与告警恒落盘」在客户端这一侧不成立**：队列满时错误行被静默丢掉，只看计数。
- **探针 B（宿主队列满）**：`maxQueue=3` 塞满普通行后推一条 `error` → 丢弃数 1、error 进队；落盘顺序 `info,info,error`，被挤掉的是最早的 `n=1`。⇒ 宿主侧确有级别优先级，牺牲的是普通行。
- **探针 C（开关关闭）**：非常驻 `info`/`debug` 不落盘、丢弃数为 0；`warn` 照落。⇒ 「只管详细度」成立，且门禁不产生丢弃。

**上游权威旁证**：附录 §1.6 把 `log.forward.summary` 的 `reason` 枚举写死为「`queue-full`、`packet-trim`、`send-fail`、`host-reject`」（`489-appendix.md:291`），与 `src/client.ts:295/461/473/484` 一一对应。⇒ **丢弃是现行设计的一部分，不是漏网缺陷**：系统自己为丢行留了自监控行。

**文档亦自陈**：`README.md:54`「结尾调了 `process.exit()`…队列里还没写下去的那批就随进程消失（`warn` 与 `info` 一样会丢）」。

**测试守护的实情（含一处更正）**：两条丢弃路径**有**现成测试——客户端队列满丢行 `tests/client.test.mjs:137-157`（120 条进 100 条、丢 20、`reason='queue-full'`）、宿主队列满丢行 `tests/host.test.mjs:167-177`（`maxQueue:3` 写 4 条 info，断言 `getDroppedCount()===1`）。但**这两套测试在本仓都跑不起来**（D3：引用父仓旧路径），所以在本仓等于没有守护；后台取证批次曾据「文件跑不动」判「宿主 `dropForRoom` 无任何测试覆盖」，**本票更正**：测试是存在的（`tests/host.test.mjs:167-177`），只是跑不动。真正**没有测试**的是宿主 `dropForRoom` 的两档级别分支——「错误/告警挤掉最旧普通行」与「队列全是错误/告警时新来的错误也被丢」（现成测试只写了普通行被丢那一档）——本票用探针 B 与探针 A 补测。

## 3.3 待 Q5（本票不裁）

- 「落盘零丢弃」按逐字口径**与现状冲突**，而队列满语义正是未定的 Q5：`issues/01-untitled.md:15`、`:41`。
- 本票据此只报三件事：现状会丢、丢在哪四条路、客户端丢行不看级别。**是否允许队列满时丢错误/告警，属 Q5，本票不给结论性策略。**
- 与票 02（文件能力）第 5 节的判定**一致**，两票互相印证：`research/02-log-file-capability.md`（§5「重要日志零丢失落盘（Q5 未定，暂按分级保口径记录）」，其探针 P3 实测 `maxQueue=2` 连写 3 条 error 只落前两条、`droppedCount=1`，与本票探针 A/B 同向）。

## 3.4 附带事实：开关里的 `sampleRate` 是惰性的

`sampleRate` 只被存储、读回、经电话透传（`src/store.ts:416-418/429-431/448/456/530`、`src/client.ts:210-235/595-598`、`src/phones.ts:297/300-304`），**全包没有任何一处用它做采样或取舍**（全 `src/` 检索 `sampleRate` 36 处，全部是形状/存取/透传）。即：当前开关实际只有一个布尔维度（开/关），不存在「按比例丢弃」的实现。

---

# 与文档的出入（只列与本票判据相关的）

| # | 文档说的 | 代码/实测 | 引用 |
|---|---|---|---|
| D1 | 「级别规则与插件侧完全一致：错误与告警恒落盘…」 | 「恒落盘」应读作「在选行层不被开关拦」；客户端队列满时错误行会被丢（探针 A） | `README.md:56` vs `src/client.ts:293-297` |
| D2 | 本仓不存在 README 点名的门禁：`tests/verify-log-*.js` 共 14 条、`research/489-appendix.md` | 本仓 `tests/` 只有 4 套 `*.test.mjs`；`verify-log*.js` 全仓不存在；附录在**父仓** checkout 里（本票用的是 `D:\dsh-plugin\dsh-main-check\research\489-appendix.md`）。⇒ 常驻 43 条一致性目前**无本仓门禁守着** | `README.md:180`、`README.md:202-215`、`README.md:218`、`INTEGRATION.md:235` |
| D3 | `npm test` 四套 | 实跑 23 过 / 2 套失败：`tests/host.test.mjs:15` import 不存在的 `D:\src\host\logStore.js`；`tests/client.test.mjs:14+19` 拼 `<包>/../../src/client/kernel/log.js` → `D:\src\...`。属老 monorepo 布局遗留，**与本票级别判据无关** | `package.json:34`、`tests/host.test.mjs:15`、`tests/client.test.mjs:14`、`tests/client.test.mjs:19` |
| D5 | README 里的命令与路径按「宿主 monorepo 根」写：`node packages/dsh-log/build.mjs`（`README.md:192`）、`npm --prefix packages/dsh-log test`（`README.md:201`）、`packages/dsh-log/notes-publish-drill.md`（`README.md:220`） | 本 checkout 是包目录本身、没有 `packages/dsh-log` 层级：对应命令应为 `node build.mjs` / `npm test`，发布记录就在根目录 `notes-publish-drill.md`。另：`package.json:34` 的 `test` 脚本只跑测试、不先构建，而四套测试 import 的都是 `dist/` | `README.md:192`、`README.md:201`、`README.md:220`、`package.json:31-35`、`tests/node.test.mjs:18` |
| D4 | 相符项（逐条比对过，不算出入） | 级别四字面三处一致；`kind` 三字面与计数门禁一致；常驻 43 条名单与附录 §1.4 集合相同；`README.md:153` 对 `kind` 三类的解释与 `src/config.ts:232-233` 一致 | `README.md:153`、`INTEGRATION.md:173-184` vs `src/config.ts:243`、`src/config.ts:247`、`src/store.ts:246-259` |

---

# 取证批次与更正（两份产出的合并说明）

本报告由两个独立取证批次合并而成，证据一律以能复跑者为准：

- **批次 A（本票主取证）**：读 `src/store.ts` / `src/config.ts` / `src/client.ts` 全文 + 四套测试；探针 A/B/C/D；对照父仓附录 §1.4 做名单集合比对（两个 checkout）。
- **批次 B（后台研究 agent，独立读同一批源码）**：另跑 `node --test` 逐套、`node ./node_modules/typescript/bin/tsc -p tsconfig.json`（无输出、退出码 0）、`node build.mjs`（`Cannot find package 'esbuild'`、退出码 1）；并用独立探针复现了宿主/客户端丢行三档（结论与探针 A/B 同向）。
- 两批独立得出同一方向（三块判据都在「部分」量级）。本报告在批次 B 的提法上做了两处收紧，均已在上文就地标注：
  1. 判据 1 由批次 B 的「部分」记为「**有**（附一处运行期不设防）」：四级存在且在三条执行路径上真实生效，缺的是运行期拦截，而非能力本身；从严读法则降为部分（第 1.1 节已写明两种读法）。
  2. 更正批次 B 的「宿主 `dropForRoom` 无任何测试覆盖」：测试**存在**（`tests/host.test.mjs:167-177`），只是在本仓跑不起来（第 3.2 节末）。
- 批次 B 的原始产出 `notes-log-levels-selfcheck.md` 已并入本报告后删除：/research 要求单一 Markdown 文件，且姊妹票 02 已定下 `research/<NN>-<slug>.md` 约定。

---

# 未独立核验 / 存疑项

- **测试跑的是 `dist/`，不是 `src/`**：`tests/node.test.mjs:18` 动态 import `dist/node.js`；本机 `node_modules` 只装了 `typescript`、**没有 esbuild**，`build.mjs` 跑不起来（`build.mjs:16` `import * as esbuild from 'esbuild'`），因此无法重跑构建做 `src/`↔`dist/` 逐字节比对。实测抽查：关键语义（`LOG_LEVELS`、`EVENT_KINDS`、`RESIDENT_EVENTS` 含 `git.exec`/`git.exec.fail`、`dropForRoom`、`isEnabled`）在 `dist/*.js` 里逐条存在，且 `dist/` 构建于 2026-10-07、晚于 `src/` 最后修改 2026-10-04。**这是本票证据强度的最大缺口**（与票 02 第 112 行同款缺口）。
- **真实宿主内的端到端表现未验**：客户端探针用的是测试桩宿主，不是真实 RPC 通道；「宿主实收有没有那条 error」是桩上结论，但丢弃发生在客户端入队之前，与通道实现无关。
- **附录的叙述段含历史快照，读时别当现状**：`489-appendix.md` 正文里有多段带日期的历史计数（例如 `dsh-main-check:168` 是 2026-09-21 那一版留下的「现行清单：常驻 32 条」），与 §1.4 标题/表（43 条）并存属文档分层而非自相矛盾；本票一律以 §1.4 标题 + 表格为准。后台取证批次曾把这类历史段读作「附录内部不一致」，本票不采纳该读法。
- **附录是包外一级来源，不是本包的运行时保证**：本包默认 `eventList=null`（`src/config.ts:107`、`tests/eventList.test.mjs:114-119`），运行时并不加载附录里的清单；「43 条一致」验证的是**代码名单 ↔ 附录表**，不是「包在跑附录」。
- **`#731` / `#817` 的工单正文未核验**：只在附录里找到对应记述（`489-appendix.md` §1.4 标题里「#94、#95 为 2026-10-04 版本管理宿主侧 git 适配器新增」与代码注释「41 变 43」互证），没有可点开的工单原文；「41→43」目前属注释 + 附录互证。
- **四级之外没有第五级（但运行期也不拦第五级）**：三个入口的枚举都只有这四个字面，全仓无 `fatal`/`trace`/`silent` 等额外级别的定义（`tests/eventList.test.mjs:100` 用 `fatal` 当**反例**）；也没有「最小级别阈值」概念（不存在「只落 error 以上」的配置）。运行期对越界级别不设防，见第 1.1 节探针 D。
- **`error` 级在本包内无发射点**：包内实际发射的级别只有 `warn`/`info`/`debug`（第 1.1 节清单）；消费插件侧是否真发 `error` 未去父仓核验。
- **`selfmon` 与实际事件的绑定未逐条核验**：本包内 5 条自监控事件都是 `warn` 级（与附录 §1.6 口径一致），但「清单里这条事件的 `kind` 真是 selfmon」只能在**宿主 monorepo 的事件清单文件**里看到，本仓默认 `eventList=null`（`tests/eventList.test.mjs:114-119` 实测默认 `wf` 配置 `eventList` 为 null），故未逐条比对。
- **不属于本票**：文件落盘/目录/按天（票 02）、轮转（票 04）、格式（票 05）、聚合（票 06）、链路追踪（票 07）、隔离（票 08）、追踪标识（票 09）。

---

# 证据清单

**读过的文件与行范围**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全） |
| `src/config.ts` | 1-415（全） |
| `src/client.ts` | 1-683（重点 96-135、240-360、440-525、595-660） |
| `src/phones.ts` | 级别相关处（28、110-306） |
| `src/node.ts` | 132-195（`ready` 与 marker） |
| `tests/node.test.mjs`、`tests/eventList.test.mjs` | 全文读 + 实跑 |
| `tests/client.test.mjs`、`tests/host.test.mjs` | 首 40 行 + 失败点（D3） |
| `README.md`、`INTEGRATION.md` | 级别/清单/门禁相关节（README 32-56、145-165、178-220；INTEGRATION 173-190、235） |
| `issues/01-untitled.md`、`issues/03-untitled.md` | 全文（口径出处） |
| `D:\dsh-plugin\dsh-main-check\research\489-appendix.md` | §1.4（166-224）、§1.5（228）、§1.6（279-291）——**父仓一级口径，不在本仓** |
| `D:\dsh-plugin\dsh-deck-final\research\489-appendix.md` | §1.4 交叉复核 |
| `research/02-log-file-capability.md` | 全文（姊妹票交叉印证） |

**覆盖级别能力的测试（`tests/*.test.mjs`）**

- `tests/eventList.test.mjs`（本仓可跑，`node --test tests/eventList.test.mjs` 实测 14/14 通过、退出码 0）：级别枚举兜底 `:98-102`、`kind` 枚举兜底 `:128-132`、三类计数门禁 `:83-96`、默认 `eventList=null` `:114-119`、宿主入口可导出检查器 `:138-143`。
- `tests/node.test.mjs`（本仓可跑，`node --test tests/node.test.mjs` 实测 9/9 通过、退出码 0）：「级别规则照旧：告警恒落，信息只在开关打开后落」`:119-142`、落盘行含 `level` 字段 `:144-160`、落点只由 `cacheDir` 决定 `:58-80`、开关与目录派生 `:82-96`。
- `tests/client.test.mjs`（**本仓跑不起来**，原因见 D3，退出码 1）：若可跑，其覆盖含「开关默认与秒显」`:108-122`、「关闭零调用」`:124-135`、「批量语义与队列满丢 20」`:137-157`、「超包截断」`:159-171`、「失败只计数」`:173-198`。
- `tests/host.test.mjs`（**本仓跑不起来**，原因见 D3，退出码 1）：若可跑，含「关闭零调用」`:78-96`、「20 行串行全落盘」`:98-116`、「`maxQueue=3` 丢弃计数 1」`:167-177`、「写盘失败只计数」`:179-219`。
- `npm test` 实测：25 个顶层用例 23 通过、`tests/client.test.mjs` 与 `tests/host.test.mjs` 两套起不来（模块找不到，非断言失败）。
- 类型检查：`node ./node_modules/typescript/bin/tsc -p tsconfig.json` → 无输出、退出码 0。构建：`node build.mjs` → `Cannot find package 'esbuild'`、退出码 1（本 checkout 无 esbuild）。

**本票只读探针（均在 `D:\Temp`，未写任何仓库文件）**

| 探针 | 关键结果 |
|---|---|
| `probe-levels-03.mjs` A：客户端队列满 | 100 塞满 → 推 `error`：丢弃 0→1，队列无此条，宿主实收 50 条里无此条 |
| `probe-levels-03.mjs` B：宿主队列满 | `maxQueue=3` 推 `error`：丢弃 1，落盘 `info,info,error`，被挤掉的是最早的 `n=1` |
| `probe-levels-03.mjs` C：开关关闭 | 只落 `warn`；非常驻 `info`/`debug` 不落且丢弃数 0 |
| `probe-levels-D.mjs` D：越界级别 | 开关打开后写 `trace`/`FATAL`：落盘级别序列 `["trace","FATAL","error"]`、丢弃数 0 ⇒ 运行期不拦 |
| `probe-levels-E.mjs` E：常驻名单绕过 | 开关关闭时 `debug/host.start` 与 `trace/host.start` 都落盘，`debug/guest.exec` 与 `info/guest.exec` 都不落盘 ⇒ 常驻名单先于级别与开关生效 |
| `probe-resident-list.mjs` / `probe-resident-2.mjs` | 代码两份名单 43 条逐字相同；与两个 checkout 的附录 §1.4 现行 43 条集合完全相同 |

**报告位置说明（仓库约定）**：本仓没有 `research/` 的既有历史（`research/489-appendix.md` 只作为**宿主 monorepo** 路径出现在注释与 README 里）；姊妹票 02 已按票号建立同系列约定 `research/<NN>-<slug>.md`（`research/02-log-file-capability.md`），本报告沿用该约定落在 `research/03-log-level-capability.md`。本报告与探针均未改动任何源码、README 或测试；`issues/` 下只有本票 03 由 Lead 经 deck 工具写入结论与状态（票 02 的产出与状态由姊妹票自己维护）。根目录另有 `notes-*.md` 约定（`notes-publish-drill.md`，发布记录），与本系列不同用途。
