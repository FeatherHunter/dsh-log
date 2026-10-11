# 结论

**整体判定：部分具备。**

文件能力的主体四项齐备：本地落盘、目录派生（`logDirName` 按 `pluginId`，`wf` 兼容 `logs`）、按天文件（`daily`，另有可选的 `four-segment`）、手动导出/清空/开关五个电话。第五项「重要日志零丢失落盘」按现有代码**不成立**：错误与告警只保证「不被级别开关拦」，不保证落盘——队列满、进程直接退出、写盘失败、取不到缓存目录四条路都会丢，且队列被错误/告警占满时新来的错误与告警本身也会被丢（实测见证据清单）。同时，该子项的判定口径 Q5（队列满语义）仍未定，本票只按「分级保口径」记录现状，不给最终策略。

本票只给结论与证据，不改代码、不提实现建议。凡引用均给 `路径:行号`；实测部分为只读探针（在系统临时目录运行，未改动仓库任何文件）。

## 逐项判定

| 子项 | 判定（有/部分/无） | 一句话依据 |
|---|---|---|
| 1. 本地落盘 | 具备 | 有真实写盘链路，落盘者唯一是 `store.ts` 内的 `createLogStore`（`src/store.ts:6`「宿主是唯一的落盘者」），文件服务由调用方注入（`src/store.ts:40-47`、`src/store.ts:73-79`） |
| 2. 目录派生 | 具备 | `wf` → `logs`／其他标识 → `logs-<标识>`（`src/config.ts:87-92`，开关文件名同规则 `src/config.ts:93-98`）；缓存目录由调用方经 `getCacheDir` 传入（`src/store.ts:385`），包内写盘路径无默认目录 |
| 3. 按天文件 | 具备 | 默认 `daily`，文件名 `YYYY-MM-DD.log`（`src/config.ts:99`、`src/config.ts:142-146`）；可选四段式 `日期.插件标识.进程号.启动时间.log`（`src/config.ts:152-165`）；清空/导出按策略分支用不同正则（`src/config.ts:182-187`） |
| 4. 手动导出/清空/开关电话 | 具备 | 5 个电话名与形状在 `src/config.ts:26`、`src/phones.ts:110-306`、`src/host.ts:65-79`；实测导出成功 8 键、失败 4 键与 README §5.1 一致 |
| 5. 重要日志零丢失落盘 | 部分具备（分级口径成立，零丢失不成立） | 错误与告警恒被接收（`src/store.ts:264`），但队列满时 `dropForRoom` 只计数不抛错（`src/store.ts:270-281`）；`process.exit()` 前未刷盘的行全丢；写盘失败只计数（`src/store.ts:405-408`）。Q5 未定（`issues/01-untitled.md:15`、`issues/01-untitled.md:41`） |

---

## 1. 本地落盘

- **写盘归属**：`src/store.ts` 是唯一落盘者——`src/store.ts:6`「它只做五件事：内存队列、级别判断、按天文件名、单写者刷盘、失败计数。宿主是唯一的落盘者。」客户端侧明确不落盘：`src/client.ts:504`「客户端侧的 flush 只管转发，不管落盘」。
- **注入的文件服务**：`src/store.ts:40-47` 定义最小形状 `resolve/readText/writeText/mkdir/unlink/listDir`；装配在 `src/store.ts:104-108`（`const fs = input.fs` 等），实际写盘调用在 `src/store.ts:403`「`await writeTarget(target, String(existing || '') + text)`」。平台备用文件服务在 `src/store.ts:208-217`（`文件服务不可写` 抛错点）。
- **写入触发（防抖 + 直通）**：窗口常量 1000 毫秒（`src/config.ts:9`）；普通级走防抖合并 `src/store.ts:313-314`「`if (flushTimer !== null) return`」/「`flushTimer = later(flushNow, LOG_DEBOUNCE_MS)`」；错误与告警走 0 毫秒直通 `src/store.ts:296-297`「`if (level === 'error' || level === 'warn') scheduleFlush(true)`」。注意直通仍是定时器异步路径（`src/store.ts:310`「`later(flushNow, 0)`」），不是同步写。
- **单写者与读改写**：`src/store.ts:329`「单写者刷盘：一次只写一份」；`flushNow` 见 `src/store.ts:330-366`；每次追加都是全文读改写——`src/store.ts:367`「文件服务无追加原语，任何追加都是全文读改写，按天分文件把单次覆写体积封顶在一天之内」，读在 `src/store.ts:396-402`、写在 `src/store.ts:403`。
- **`ready` 的含义**：`dsh-log/node` 独有，`src/node.ts:172-192`。做法是先入一条 debug 级基准行（字面在 `src/node.ts:173`「`const marker = 'log.flush.marker'`」，入队在 `src/node.ts:176`「`store.log('debug', marker, {})`」），再反复 `flushNow` 并扫描文件里有没有它（`src/node.ts:112-127`、`src/node.ts:189`），最多 6 轮、每轮隔 10 毫秒（`src/node.ts:181`、`src/node.ts:190`）。因此它的实际语义是「队列被排空过一次」：写盘成功时等价于「前面写的行都在文件里」；写盘失败时队列被丢弃、`ready` 仍会 resolve（`src/store.ts:405-410`「`dropped += lines.length`」后返回 false，`src/node.ts:181-192` 六轮后无条件结束）。
- **实测**：`warn` 一行 + `await log.ready` → 文件为 `<cacheDir>/logs-<标识>/<当天>.log`，内容一行一条 JSON；未 `await` 直接 `process.exit(0)` → 连日志目录都没建（见证据清单 P3／P4）。

## 2. 目录派生

- **规则（源码即字面）**：`src/config.ts:87-92`

  「`const logDirName = input.logDirName !== undefined ? input.logDirName : pluginId === 'wf' ? LEGACY_LOG_DIR_NAME : LEGACY_LOG_DIR_NAME + '-' + pluginId`」

  其中旧字面在 `src/config.ts:22`「`export const LEGACY_LOG_DIR_NAME = 'logs'`」。开关文件名同规则：`wf` → `log-switch.json`，其他 → `log-switch-<标识>.json`（`src/config.ts:93-98`、`src/config.ts:23`）。允许显式覆盖（`src/config.ts:41`、`src/config.ts:44`）。插件标识约束为 `^[a-z0-9-]{1,32}$`（`src/config.ts:71`）。
- **兼容断言**：`src/store.ts:28-29` 仍导出旧字面「`export const LOG_DIR_NAME = LEGACY_LOG_DIR_NAME`」；`tests/host.test.mjs:132-135` 断言 `wf` → `logs`/`log-switch.json`、`demo` → `logs-demo`/`log-switch-demo.json`。
- **cacheDir 从哪来**：由调用方注入，包内不抓全局——`src/store.ts:76`「`getCacheDir?: () => Promise<string | null | ''> | string | null | ''`」，读值处 `src/store.ts:385`「`const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null`」。宿主入口接入写法见 `src/host.ts:49-53` 与 `README.md:67-71`（五个依赖全由调用方传入）。Node 入口由调用方给 `cacheDir`：`src/node.ts:140-142`「必须给 cacheDir：日志写到哪由调用方决定，本入口不猜位置」，并自建该目录 `src/node.ts:149`。
- **有没有默认路径**：**没有**。`README.md:32`「它**不决定日志写到哪**——目录由调用方传入，入口自己不读任何环境变量、也不带默认路径」；代码同口径 `src/node.ts:6-7`。写盘路径取不到目录时只记丢弃与失败行：`src/store.ts:386-390`「`if (!dir) { dropped += lines.length; notePersistFail('writeBatch', 'no-dir', '') ... }`」。唯一的路径回退在导出电话：`src/phones.ts:126`「`const baseDir = dir || (headerInfo && headerInfo.dir) || ctx.DEFAULT_CWD || ''`」。
- **实测**：`pluginId: 'your-program'` → `logDirName=logs-your-program`、`switchFileName=log-switch-your-program.json`、`prefix=your-program`、`fileNamePolicy=daily`、`maxQueue=1000`、`eventList=null`（与 `README.md:50`、`README.md:88-93` 全部相符）。

## 3. 按天文件

- **默认策略**：`src/config.ts:99`「`const fileNamePolicy = input.fileNamePolicy === undefined ? 'daily' : input.fileNamePolicy`」，非法值抛错 `src/config.ts:100-102`；类型只有两个 `src/config.ts:31`「`export type FileNamePolicy = 'daily' | 'four-segment'`」。
- **daily 文件名形状**：`YYYY-MM-DD.log`（本地时区年月日）——`src/config.ts:145`「`return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'`」。选哪个文件在刷盘时定：`src/store.ts:394`「`resolveLogFileName(config, new Date(), currentPid(), currentStartedAt())`」，即按**写入时刻**分桶（行自身的 `ts` 仍是入队时刻，`src/store.ts:291`）。
- **四段式（可选项）**：四段为「日期点插件标识点进程号点启动时间」——`src/config.ts:148-150` 注释、实现 `src/config.ts:152-165`；冒号与斜杠转写为中横线 `src/config.ts:163`「`.replace(/[:/\\]/g, '-')`」；取不到进程号回退 0 `src/config.ts:162`；启动时间取不到时回退当前时刻 `src/store.ts:148-155`「`return headerInfo && headerInfo.startedAt ? headerInfo.startedAt : new Date().toISOString()`」。实测形状：`2026-09-11.demo.4242.2026-09-11T18-20-30.123Z.log`。
- **清空/导出用的正则随策略分支**：`src/config.ts:182-187`——daily 为 `/^\d{4}-\d{2}-\d{2}\.log$/`（`src/config.ts:186`），四段式为 `/^\d{4}-\d{2}-\d{2}\.[a-z0-9-]{1,32}\.\d+\..+\.log$/`（`src/config.ts:184`）。电话侧在 `src/phones.ts:85`「`const filePattern = logFileNamePattern(config)`」取一次，清空时按策略匹配（`src/phones.ts:222` 全清、`src/phones.ts:238` 某天四段式、`src/phones.ts:246` 某天 daily）；导出按日期挑文件走 `src/config.ts:191-205`（daily 直接拼 `wantDate + '.log'`，四段式列出候选取排序后第一个）。
- **不做轮转/清理**：`src/config.ts:141`「每个自然天一个文件……只分桶，不自动清理」；`README.md:34`「不自动轮转，也不自动清理旧文件」。轮转能力属另一张票（`issues/04-untitled.md`），本票不判。
- **实测**：daily 文件名为当天 `2026-10-09.log`；四段式策略下 Node 入口开箱即用（文件名匹配正则、按日期导出命中该文件、按日期清空 removed=1）。

## 4. 手动导出/清空/开关电话

电话名集合（5 个，冻结不改）：`src/config.ts:26`「`export const PHONE_ACTIONS = ['logBatch', 'logExport', 'logClear', 'logGetSwitch', 'logSetSwitch']`」，拼法 `前缀 + '.' + 动作名`（`src/config.ts:127-139`），默认前缀 `wf` 下与旧字面一字不差；注册处 `src/host.ts:65-79`（撞名报错不覆盖，`src/host.ts:75-77`）。

| 电话 | 实际入参 | 实际回参（源码位置） | 实测结果 |
|---|---|---|---|
| `wf.logBatch` | `{ entries, droppedCount }`（`src/store.ts:482`） | `{ ok, accepted, dropped }`（`src/store.ts:492`）；最外层异常回 `{ ok: true, accepted: 0, dropped }`（`src/store.ts:495`） | `{"ok":true,"accepted":1,"dropped":0}` |
| `wf.logExport` | `{ date?, ...多余字段忽略 }`（`src/phones.ts:114`、`src/phones.ts:115-116`） | 成功 8 键 `ok/fileName/bytes/fallback/text/summary/dir/path`（`src/phones.ts:188-197`）；失败 4 键 `ok/fileName/bytes/fallback`（`src/phones.ts:208`） | 成功键数=8、失败键数=4；`bytes` 为字符串长度（`src/phones.ts:191`「`bytes: String(text || '').length`」） |
| `wf.logClear` | `{ date }`：某天或 `'all'`（`src/phones.ts:213`、`src/phones.ts:218`） | `{ ok, removed }`（`src/phones.ts:216`、`src/phones.ts:225`、`src/phones.ts:233`、`src/phones.ts:244`、`src/phones.ts:247`） | `bad-date` → `{"ok":false,"removed":0}`；`'all'` → `{"ok":true,"removed":1}` |
| `wf.logGetSwitch` | 无参（`src/phones.ts:295`） | `{ ok, enabled, sampleRate }`（`src/phones.ts:297`） | `{"ok":true,"enabled":false,"sampleRate":1}` |
| `wf.logSetSwitch` | `{ enabled, sampleRate? }`（`src/phones.ts:301-303`） | `{ ok, enabled }`，**不回采样率**（`src/phones.ts:305`） | `{"ok":true,"enabled":true}` |

补充事实（均为代码行为，非缺陷）：

- 清空的删除实现是「优先 `unlink`，没有就写空串」——`src/phones.ts:261-293`（`src/phones.ts:283`「`await ctx.writeTarget(target, '')`」）。
- 导出**不触发刷盘**，读的是盘上原文：`src/phones.ts:137-142`（读失败当空串）。实测：`warn` 入队后立刻导出的 `text` 为空，`await flushNow()` 之后再导出才含该行。
- 不传 `date` 时清空直接回失败（`src/phones.ts:227-234`）；`README.md:107` 只写「日期或全部」。
- 导出回参 `fallback` 在成功路径也硬编码为 `true`（`src/phones.ts:192`），实测成功导出 `fallback=true`。

## 5. 重要日志零丢失落盘（Q5 未定，暂按分级保口径记录）

**分级保口径成立**：错误与告警不受开关拦——`src/store.ts:264`「`if (level === 'error' || level === 'warn') return true`」；常驻名单内的 info 也不受开关拦（`src/store.ts:265`、名单 `src/store.ts:246-259`）；其余 info/debug 只在开关打开时进队列（`src/store.ts:266`）。开关默认关闭（`src/store.ts:119`）。

**零丢失不成立**。队列上限与丢弃规则：

- `maxQueue` 默认 1000（`src/config.ts:12`、`src/config.ts:103-106`），入队处 `src/store.ts:286-289`「`if (queue.length >= config.maxQueue) { dropForRoom(level); if (queue.length >= config.maxQueue) return }`」。
- `dropForRoom` 只计数不抛错（`src/store.ts:270-281`）：错误/告警来时挤掉**最旧的普通行**（`src/store.ts:272-278`）；若队列里全是错误/告警，则找不到可挤的行，直接 `dropped += 1`（`src/store.ts:280`）并让新行进不去（回到 `src/store.ts:288` 的 return）。

因此**能被丢的行**（都只累加到 `droppedCount`，`src/store.ts:413-415`）：

1. **队列满**：普通行在队列满时被丢（`src/store.ts:280`、`src/store.ts:288`）；**错误与告警在队列被错误/告警占满时同样被丢**。实测：`maxQueue=2` 连写 3 条 error → 文件只有前两条，`getDroppedCount()=1`。
2. **进程退出**：错误/告警走的是 0 毫秒定时器（`src/store.ts:296`、`src/store.ts:310`），不在调用点同步写。实测：`log('error', …)` 后立即 `process.exit(0)` → 日志目录与文件都不存在（该行丢失且不计入任何计数，进程已消失）；同一脚本让事件循环自然结束则落盘成功。
3. **写盘失败**：`src/store.ts:405-410`「`dropped += lines.length; notePersistFail('writeBatch', 'write-fail', failDir); return false`」。失败行本身的自我繁殖被抑制（`src/store.ts:126-128`），且失败行也要走同一条队列（`src/store.ts:349-360`），写盘持续失败时**连自监控行也可能丢**（本票未逐条实测）。
4. **取不到缓存目录**：`src/store.ts:386-390`（实测 `getCacheDir` 返回空串时 `dropped=1`，不抛错）。
5. **序列化失败**：单行 `JSON.stringify` 抛错时只丢该行并计数（`src/store.ts:376-379`）。

**保证范围**：代码保证的是「级别上不被开关抑制」（error/warn 与常驻 info 一定进队列，`src/store.ts:263-267`），**不保证**「进了队列就一定落盘」。README 的措辞「错误与告警始终落盘」（`src/config.ts:242` 同口径注释）应读作「不被级别开关拦」，不是持久性承诺。

**与 Q2=B 的关系**：`issues/01-untitled.md:14` 记「Q2=B：开关保留、只管详细度、落盘零丢弃」。按逐字口径，本项**不达标**；按「分级保口径」（本票给定口径）则记为「错误与告警恒被接收（直到队列满）」——是否允许队列满时丢错误/告警，正属未定的 Q5（`issues/01-untitled.md:15`「队列满语义与门禁红黄（Q5/Q6）待 R2」、`issues/01-untitled.md:41`）。本票不给结论性策略。

---

## 与 README 的出入

共 6 条，其中 2 条属「文档与本仓实际不符」，4 条属「文档未写明/有条件成立」。

| # | 文档说的 | 代码/实测 | 引用 |
|---|---|---|---|
| D1 | 当前版本 `0.2.1` | `package.json` 为 `0.2.2`（提交 `2eb0969`「版本号推到0.2.2」） | `README.md:22` vs `package.json:3` |
| D2 | 文档与测试里的仓库路径、发布与门禁命令按宿主 monorepo 写：`node packages/dsh-log/build.mjs`、`npm --prefix packages/dsh-log test`、14 条 `tests/verify-log-*.js` 门禁、`research/489-appendix.md`；测试里引用旧实现 `ROOT/src/host/logStore.js`、`ROOT/src/client/kernel/log.js` | 本仓（独立包仓库）里这些路径不存在：`build.mjs`、`notes-publish-drill.md`、`tests/*.test.mjs` 都在根目录；`verify-log*.js` 全仓不存在；`package.json` 的 `test` 脚本 4 套里 2 套起不来（`tests/host.test.mjs:15` 找不到 `D:\src\host\logStore.js`，`tests/client.test.mjs:19` 找不到 `D:\src\client\kernel\log.js`），实测 `npm test` 23 过 / 2 套失败 | `README.md:192`、`README.md:201`、`README.md:200-216`、`README.md:180`、`README.md:218`、`INTEGRATION.md:235`、`tests/host.test.mjs:15`、`tests/client.test.mjs:19` |
| D3 | 退出丢失只点明「`warn` 与 `info` 一样会丢」；并说「错误与告警两级直通，不用等满防抖」 | 直通仍是 0 毫秒定时器，不是同步写；实测 `error` 后立即 `process.exit(0)` 一样丢（连目录都不建），故丢失范围应涵盖全部四级 | `README.md:54`、`INTEGRATION.md:60`、`INTEGRATION.md:153` vs `src/store.ts:296`、`src/store.ts:310` |
| D4 | 「`log.ready` 返回时表示「前面写的每一行都已经在文件里」」 | 只在写盘成功时成立；写盘失败时队列被丢弃并计数，`ready` 仍 resolve | `README.md:54`、`INTEGRATION.md:60` vs `src/store.ts:405-410`、`src/node.ts:181-192` |
| D5 | 导出回参含「回退标记（`fallback`）」，未说取值语义 | 成功路径也硬编码 `fallback: true`（实测成功导出 `fallback=true`），该键目前恒真 | `README.md:106` vs `src/phones.ts:192` |
| D6 | 清空入参写「日期或全部（`date` 为某天或 `all`）」，未写缺省行为 | 不传/传空 `date` 时按坏日期处理，回 `{ ok: false, removed: 0 }`（实测） | `README.md:107`、`INTEGRATION.md:212` vs `src/phones.ts:213`、`src/phones.ts:227-234` |

**同时核对相符、不算出入的断言**（逐条比对过）：§4 表格默认值 `prefix` 回退 `pluginId`（`README.md:88` vs `src/config.ts:86`）、`logDirName` 与 `switchFileName` 派生（`README.md:89-90` vs `src/config.ts:87-98`）、`fileNamePolicy` 默认 `daily`（`README.md:91` vs `src/config.ts:99`）、`maxQueue` 默认 `1000`（`README.md:92` vs `src/config.ts:12`）、`eventList` 默认 `null`（`README.md:93` vs `src/config.ts:107`）；§5.1 导出成功 8 键/失败 4 键（`README.md:113` vs `src/phones.ts:188-197`、`src/phones.ts:208`，实测 8/4）、`bytes` 是字符串长度不是真实字节数（`README.md:106`、`INTEGRATION.md:225` vs `src/phones.ts:191`）、`logSetSwitch` 不回采样率（`README.md:109` vs `src/phones.ts:305`）；§2.1 落点 `<cacheDir>/logs-your-program/…` 与 `<cacheDir>/log-switch-your-program.json`（`README.md:50` vs `src/config.ts:87-98`，实测相符）、目录不存在时入口自建（`README.md:50` vs `src/node.ts:149`）、`dsh-log/node` 不读环境变量不带默认路径（`README.md:32` vs `src/node.ts:6-7`、`src/node.ts:140-142`）；`dsh-log/node`「级别规则与插件侧完全一致」（`README.md:56`）成立——Node 入口直接走 `createHostLog`（`src/node.ts:151-154`）同一套 `isEnabled`，且宿主与客户端的常驻名单逐项相同（各 43 条，`src/store.ts:246-259` vs `src/client.ts:263-276`）；「不自动轮转，也不自动清理」（`README.md:34` vs `src/config.ts:141`，全仓无轮转/清理代码）；`listDir` 缺省按空目录处理导致清空删 0 个（`INTEGRATION.md:98` vs `src/phones.ts:72`）。

## 遗留与未定

- **Q5（队列满语义）未定**，本票不裁：`issues/01-untitled.md:15`「队列满语义与门禁红黄（Q5/Q6）待 R2」、`issues/01-untitled.md:41` 同。本票只记录现状：满时按级别挤掉最旧普通行，全为错误/告警时连错误/告警也丢（`src/store.ts:270-281`、`src/store.ts:286-289`）。
- **Q2=B「落盘零丢弃」与现状冲突未解**：`issues/01-untitled.md:14`。本票给出冲突事实（第 5 节），不给策略。
- **宿主侧单测在本仓不可运行**：`tests/host.test.mjs`（含「串行不丢行」「命名规则」「失败计数」等直接覆盖文件能力的断言，`tests/host.test.mjs:98-116`、`tests/host.test.mjs:118-177`、`tests/host.test.mjs:179-219`）因 `tests/host.test.mjs:15` 引用不存在的宿主 monorepo 旧实现而整套起不来；本票结论中的宿主行为改由 `dist/` 产物只读探针实测（`dist/*.js` 构建于 2026-10-07，晚于 `src/*.ts` 最后修改 2026-10-04），**未重跑 `build.mjs` 校验字节一致**。这是本票证据强度的最大缺口。
- **未验证：真实宿主里的绝对落点**。`getCacheDir`／`getPlatform` 的实际实现在宿主侧、不在本仓；包内无默认目录（第 2 节），故「日志究竟落在哪个绝对路径」本仓无法证实。
- **未验证：多进程/多实例共用同一目录**。代码是「读—拼—写」全文覆写且无锁（`src/store.ts:367`、`src/store.ts:396-403`），文档自认会写坏（`INTEGRATION.md:219`「多进程同时写同一个目录会写坏」）；本票未做并发实测。
- **未验证：失败链路的自监控丢失**。写盘持续失败时 `log.persist.fail` 行也走同一队列（`src/store.ts:349-360`），最坏情况自监控行一并丢失；本票未逐条实测。
- **未验证：四段式跨重启的重名与启动时间缺失分支**。只验证了形状与正则匹配（第 3 节实测）。
- **不属于本票**：轮转/清理（票 04）、级别（票 03）、格式（票 05）、聚合（票 06）、链路追踪（票 07）、隔离（票 08）、追踪标识（票 09）。

## 证据清单

**读过的文件与行范围（全文通读）**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全） |
| `src/config.ts` | 1-415（全） |
| `src/phones.ts` | 1-315（全） |
| `src/node.ts` | 1-195（全） |
| `src/host.ts` | 1-81（全） |
| `src/client.ts` | 1-683（全） |
| `README.md` | 1-228（全，重点 §2.1、§3、§4、§5.1、§6） |
| `INTEGRATION.md` | 1-235（全，重点步骤 2B、步骤 4、常见坑） |
| `event-list.template.json` | 1-6（全，与本票无关，只确认清单形状） |
| `package.json` | 1-39（全） |
| `issues/01-untitled.md`、`issues/02-untitled.md` | 1-61 / 1-24（全，口径与 Q5 出处） |
| `tests/host.test.mjs` | 1-293（全） |
| `tests/node.test.mjs` | 1-206（全） |
| `tests/client.test.mjs` | 1-40 + 关键行检索（客户端转发，与本票文件能力无关） |
| `tests/eventList.test.mjs` | 未逐行读，仅跑通（与文件能力无关） |
| `dist/{host,client,config,node,phones,store}.js` | 只读产物，用于实测（2026-10-07 构建） |
| `notes-publish-drill.md` | 1-20（确认发布记录与版本线索 D1） |
| `.local/selfcheck-02-file*.mjs` | 仅列目录确认存在（非本票证据，见下「报告位置」） |

**覆盖文件能力的测试（`tests/*.test.mjs`）**

- `tests/node.test.mjs`（本仓可跑，实测 9/9 通过）：断言建库—写—等落盘三件事齐备（`:38-56`）、落点只由 `cacheDir` 决定且忽略环境变量（`:58-80`）、目录与开关文件名随标识派生（`:82-96`，`logs-calorie`／`log-switch-calorie.json`）、极深目录自建（`:98-117`）、级别规则与开关跨进程读回（`:119-142`）、一行一条 JSON 的落盘形状（`:144-160`）、不给 `cacheDir` 直接报错（`:162-166`）、文件服务边角（`:168-180`）、写盘失败只计数不抛错（`:182-205`）。
- `tests/host.test.mjs`（**本仓跑不起来**，`tests/host.test.mjs:15` 引用不存在的 `ROOT/src/host/logStore.js`）：若可跑，其断言正是宿主文件能力——关闭零调用不写盘（`:78-96`）、20 行串行全落盘（`:98-116`）、目录/开关名派生与四段式文件名形状、`maxQueue=3` 时丢弃计数 1（`:118-177`）、写盘失败丢 4 条只计数与 `logBatch` 例外形状（`:179-219`）、与旧实现逐行同形（`:221-259`）、失败行方法名随前缀（`:261-292`）。
- `tests/client.test.mjs`（**本仓跑不起来**，`tests/client.test.mjs:19` 引用不存在的 `ROOT/src/client/kernel/log.js`）：只覆盖客户端转发与开关，不覆盖落盘。
- `tests/eventList.test.mjs`（可跑，实测 14/14 通过）：事件清单与检查器，与文件能力无关。
- `npm test` 实测：23 通过、2 套失败（失败原因见 D2）。

**本票只读实测（`node --input-type=module -e` 内联探针，运行在系统临时目录，未写任何仓库文件）**

| 探针 | 关键结果 |
|---|---|
| P1 配置与电话形状 | `logs-your-program`／`log-switch-your-program.json`／`daily`／`maxQueue=1000`／`eventList=null`；导出成功键 8、失败键 4；`getSwitch` 3 键、`setSwitch` 2 键、`logBatch` 3 键 |
| P2 文件名与正则 | `2026-09-11.log`；`2026-09-11.demo.4242.2026-09-11T18-20-30.123Z.log`；daily 正则 `/^\d{4}-\d{2}-\d{2}\.log$/`、四段正则 `/^\d{4}-\d{2}-\d{2}\.[a-z0-9-]{1,32}\.\d+\..+\.log$/`；四段候选取排序第一个 |
| P3 队列满与落盘内容 | `maxQueue=2`：info,info,error,warn,info → 文件只剩 `e1,w1`，`droppedCount=3`；连写 3 条 error → 文件只剩前两条，`droppedCount=1` |
| P4 退出丢失 | `error` 后 `process.exit(0)` → `cacheDir` 内空无一物；同脚本自然结束 → 该行落盘 |
| P5 导出与刷盘 | 未刷盘时导出 `text` 长度 0；`flushNow()` 后 74（含该行）；`getCacheDir` 返回空串时 `dropped=1` 且不抛错 |
| P6 四段式端到端 | Node 入口 `fileNamePolicy: 'four-segment'` → 文件 `<当天>.<标识>.<pid>.<ISO转写>.log`；按日期导出命中该文件（8 键）、按日期清空 `removed=1`；`'all'` 清空剩余 0 |
| P7 清空边界 | `date='bad-date'` 与不传 `date` → `{ok:false,removed:0}`；`'all'` → `{ok:true,removed:1}` |
| P8 开关关闭 | info/debug 不落盘、不计丢弃、`cacheDir` 内不产生任何文件（**注意适用范围**：所测事件名不在常驻名单内；名单内的名字连 `debug` 甚至非法级别都放行，见文末附录 B） |

**报告位置说明（仓库约定）**：本仓没有 `research/` 目录，`research/489-appendix.md` 只在文档注释里作为**宿主 monorepo** 的路径出现（`README.md:180`、`config.ts:239`）。本仓现有的相近约定有两处：根目录 `notes-*.md`（如 `notes-publish-drill.md`，发布记录）与未入库的 `.local/` 本地草稿目录（内有本票编号命名的 `selfcheck-02-file*.mjs`，非本票产物）。本报告按票面要求落在 `research/02-log-file-capability.md`，未改动任何源码、README、`issues/` 下的文件。

---

# 附：Lead 独立复核（2026-10-09，同一票）

上面主体的结论与证据由研究 agent 独立跑出。Lead 另用 `.local/selfcheck-02-file*.mjs`（只读探针，`dist/` 产物 + 系统临时目录，未改仓库任何文件）复核了同一批结论，并把它明说「未验证」的两项实测补上。两条独立路径在结论上一致（整体**部分具备**；五项判定同）。以下只列复核新增或加重的部分。

## A. 新增实测一：多进程共写同一目录会整批丢行（原报告列为未验证）

`INTEGRATION.md:219` 自认「多进程同时写同一个目录会写坏」，本票实测量化：

| 探针 | 做法 | 结果 |
|---|---|---|
| M3 | 两个独立进程共用同一 `cacheDir` + 同一 `pluginId`（即默认 `daily` 策略下同一天文件），各在**同一时刻**写入 40 条 `error`，共 6 轮 | 理想总行数 80。轮 0/3/4 实测 40 行（`p1` 0 行、`p2` 40 行），轮 5 实测 40 行（`p2` 0 行），轮 1/2 才是 80 行 —— **6 轮里 4 轮有一整个进程的行被整批覆盖掉** |
| M2 | 同上，但每轮两进程各写 3 条、中间隔 25 毫秒 | 6 行全在（说明要撞上「同时」才复现） |

机制即 `src/store.ts:367`（无追加原语，全文读改写）＋ `src/store.ts:396-403`（先读 `existing`，再写 `existing + text`），全程无锁、无原子替换。默认 `daily` 文件名不含进程号，故同一目录下两个写者必然共用同一文件；`four-segment`（`src/config.ts:152-165`，文件名含进程号）能天然分开，但那是可选项不是默认。**结论：零丢失成立的前提是调用方守住「一个目录一个写者」，包内无任何机制强制这一点。** 这一条把「重要日志零丢失落盘」从「队列满才丢」加重为「共写目录会成批丢且不可察觉」。

## B. 新增实测二：开关关闭时，级别闸门会被常驻名单绕过（含非法级别）

`src/store.ts:263-267` 的判断顺序是：先 `error/warn` 放行，**再**查 `RESIDENT_EVENTS` 名单放行，最后才看开关。所以「常驻名单」是按**事件名**放行的，与级别无关。实测（探针 T，开关默认关闭，`pluginId: wf`）：

| 调用 | `isEnabled` | 是否落盘 |
|---|---|---|
| `log('info', 'host.start')` | true | 落盘 |
| `log('debug', 'host.start')` | **true** | **落盘** |
| `log('trace', 'host.start')` | **true** | **落盘**（`trace` 不是四个合法级别之一） |
| `log('debug', 'guest.exec')` | false | 不落盘 |
| `log('info', 'does.not.exist')` | false | 不落盘 |

常驻名单里确有 `info` 级事件（`src/store.ts:246-259`），但按事件名放行意味着：**任何叫 `host.start` 的行，不论级别，开关关着也落盘；`log()` 也不校验级别取值**（`src/store.ts:284-298` 不校验，`LogLevel` 只是类型）。与 README 冲突：`README.md:56`「其余信息与调试只在开关打开时落盘」、`README.md:92` 同口径、`src/config.ts:242` 注释「其余只在调试开关打开时落盘」——这三处按现有实现不成立（条件应改为「事件名不在常驻名单时」）。级别票（`issues/03-untitled.md`）会用到这一条，本票只记录文件能力侧的落盘后果。

## C. 复核确认的关键数字（与研究 agent 一致）

- 队列满：`maxQueue=2` 连写 3 条 `error` → 文件只剩前 2 条、`droppedCount=1`（错误本身被丢，因为队列里无可挤的普通行，`src/store.ts:270-281`、`src/store.ts:286-289`）。
- 写盘失败：注入必失败的 `writeText` 后写 `error`+`warn`+`info` → 一个文件都没生成，`dropped=3`，`ready` 状态为 **resolved**（`src/store.ts:405-410`＋`src/node.ts:181-192`）。
- 进程立刻退出：子进程写 `error`+`warn` 后立刻 `process.exit(0)` → `cacheDir` 内**空无一物**；改为自然结束 → 同一脚本两行都落盘。直通是 0 毫秒**定时器**不是同步写（`src/store.ts:296`、`src/store.ts:310`），故 `error` 与 `warn` 也在丢失范围内（`README.md:54` 只点明 `warn`／`info`）。
- 计数器口径（复核后修正一处）：`handleLogBatch` 的 `accepted` 恒为入参数组长度（`src/store.ts:492`），队列满时被挤掉的行**不**从 `accepted` 里扣；同一次实测回 `{"ok":true,"accepted":4,"dropped":2}` 而文件里只有 2 行。`dropped` 是当场结算的（不是事后补记），但调用方要自己算差才知道本批丢了几条。
- 开关关闭 + 非常驻 `info`：批量入口照样回 `{"ok":true,"accepted":4,"dropped":0}`，而 `dropped` 也不涨、`cacheDir` 里一个文件都不产生——**「接受」不等于「落盘」，两种丢失都不在回包里区分**。
- 清空不存在的日期：回 `{"ok":true,"removed":1}`（`deleteOneFile` 走 `unlink`，`src/node.ts:79-86` 把 `ENOENT` 吞成成功，故计数恒 +1）；日期格式非法才回 `{ok:false,removed:0}`。
- 导出不触发刷盘：入队后立刻导出 `text` 为空，`flushNow()` 后才有内容（`src/phones.ts:137-142` 只读盘上原文）。
- 测试现状复核：`npm test` 实测 25 个用例里 **23 过 2 套失败**（`tests/host.test.mjs` 引用 `ROOT/src/host/logStore.js`、`tests/client.test.mjs` 引用 `ROOT/src/client/kernel/log.js`，两处在独立包里都不存在），与 README §9 声称的四套全跑不符；`tests/verify-log-*.js` 那 14 条日志门禁在本仓不存在。

## D. 复核后仍未验证

- **`dist` 与 `src` 的一致性：已做部分佐证，但没做到字节级证明。** 事实：`dist/*.js` 各文件头都是 `// AUTO-GENERATED by node packages/dsh-log/build.mjs — Source: packages/dsh-log/src/<x>.ts`；`dist` 六个文件均生成于 2026-10-07 03:47，晚于 `src` 里最后的改动（`store.ts`、`client.ts` 为 2026-10-04）。**但本仓跑不了 `build.mjs`**：它 `import * as esbuild from 'esbuild'`（`build.mjs:16`），而本仓 `node_modules` 只有 `typescript`（`package.json` 的 `devDependencies` 也只列了 typescript），实测重跑直接 `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`——即 `build.mjs` 在本仓不可运行（它按宿主 monorepo 写法取 `ROOT = PKG_DIR/../..`，`build.mjs:19`，与 D2 同源）。可做的佐证是逐项比对产物与源码的机制一致：`dist/store.js:148`（常驻名单）、`:195`（按事件名放行）、`:198-214`（`dropForRoom` 与队列满判断）、`:309`/`:329`（写盘失败 `dropped += lines.length`）、`dist/config.js:24-26`（目录/开关名派生与 `daily` 默认）、`dist/phones.js:144-151` 与 `:163`（导出成功 8 键含 `fallback: true`、失败 4 键）——均与 `src` 对应行一致。故「落盘机制」这一层可判定 `dist ≡ src`；**未做到的是字节级重生成比对**，所有实测数字仍以 `dist` 产物为准。
- 真实宿主里 `getCacheDir` 给出的绝对落点（`getCacheDir` 实现在宿主侧，不在本仓）。
- 写盘持续失败时自监控行 `log.persist.fail` 自身是否也丢（代码路径 `src/store.ts:349-360` 同队列，未逐条实测）。
