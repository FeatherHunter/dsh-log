<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-file -->
<!-- parentKey: 01 -->
# 自查：日志文件是否具备

## Question

判定日志文件能力是否具备：本地落盘、目录派生（logDirName 按 pluginId，wf 兼容 logs）、按天文件（daily）、手动导出/清空/开关电话；重要日志零丢失落盘（Q5 待定，暂按分级保口径记录）。

输出：有/部分/无 + 证据（src/store.ts、src/phones.ts、README 第 4-5 节）。只给结论不写代码。

## 进度

<!-- 做到哪一步了，在这里一行一行记 -->
- 2026-10-09 起：读票 02 与父图 01 口径（Q1=A、Q2=B、门禁红灯=抑制、Q5 待 R2），确认本票是 AFK 事实票、范围与输出形状已由地图给死，无「我猜」点，不需要 grilling 澄清。
- 2026-10-09 研究：后台研究 agent 通读 src/{store,config,phones,node,host}.ts、README、INTEGRATION.md、tests/*.test.mjs、package.json，产出 research/02-log-file-capability.md（逐条带 file:line 引用）。
- 2026-10-09 复核：Lead 用 .local/selfcheck-02-file*.mjs 只读探针（dist 产物 + 系统临时目录）独立复核，结论一致；补上研究稿列为「未验证」的两项实测（多进程共写同目录、开关关闭时的级别闸门绕过），并复核 npm test 现状。
- 2026-10-09 收尾：答案写回本票并置 Status: resolved；同步给地图 01 的 Decisions so far 加一条引用。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

- 2026-10-09（收尾注记）：deck 的 markdown 后端在本次改正文时把新正文追加到了旧正文之后（首部出现重复的 Idempotency/父票注释与重复标题，Answer 落成两个），已由人工整理为当前这一份：单一首部、Answer 只留一份、Status 置 resolved。内容与 deck readBack 一致，未改任何结论。

## Answer

**判定：部分具备。** 文件能力主体四项全部具备；第 5 项「重要日志零丢失落盘」不成立（分级保口径成立、零丢失不成立），且其口径 Q5 仍未定，本票只记现状不裁策略。

证据全集（逐条带 `file:line` 引用 + 两路实测记录）：`research/02-log-file-capability.md`（主体由研究 agent 独立产出，文末「附：Lead 独立复核」是 Lead 的独立实测）。只给结论，未改任何代码。

### 逐项判定

| # | 子项 | 判定 | 一句话依据（详细引用见研究稿） |
|---|---|---|---|
| 1 | 本地落盘 | 具备 | 宿主唯一落盘者，真实 fs 写链路：`src/store.ts:6`、`src/store.ts:40-47`、`src/store.ts:403`；客户端只管转发不落盘 |
| 2 | 目录派生 | 具备 | `wf` → `logs`、其他标识 → `logs-<标识>`（`src/config.ts:87-92`）；开关文件名同规则（`src/config.ts:93-98`）；`cacheDir` 由调用方注入，包内无默认路径 |
| 3 | 按天文件 | 具备 | 默认 `daily`，`YYYY-MM-DD.log`（`src/config.ts:99`、`src/config.ts:142-146`）；可选四段式（`src/config.ts:152-165`）；清空/导出正则随策略分支（`src/config.ts:182-187`）；只分桶不清理 |
| 4 | 手动导出/清空/开关电话 | 具备 | 5 个电话名与拼法（`src/config.ts:26`、`src/config.ts:127-139`）；实现 `src/phones.ts:110-306`；导出成功 8 键/失败 4 键与 README §5.1 逐项相符（实测同） |
| 5 | 重要日志零丢失落盘 | **不成立**（分级口径成立） | 错误与告警只保证「不被级别开关拦」（`src/store.ts:264`），不保证落盘。四条丢失路径实测全部复现，详见下 |

### 第 5 项：四条实测丢失路径（本票最关键结论）

1. **队列满**：`maxQueue` 默认 1000（`src/config.ts:12`），满时 `dropForRoom` 只计数不抛错（`src/store.ts:270-281`、`src/store.ts:286-289`）。实测 `maxQueue=2` 连写 3 条 `error` → 文件只剩前 2 条、`droppedCount=1`：**队列里全是错误/告警时，错误与告警本身也会被丢**。
2. **进程退出**：错误与告警的「直通」是 0 毫秒**定时器**不是同步写（`src/store.ts:296`、`src/store.ts:310`）。实测子进程写 `error`+`warn` 后立刻 `process.exit(0)` → `cacheDir` 内空无一物；同脚本改为自然结束 → 两行都落盘。`README.md:54` 只点明「`warn` 与 `info` 一样会丢」，实际丢失范围涵盖全部四级。
3. **写盘失败**：`src/store.ts:405-410` 只 `dropped += lines.length`。实测注入必失败的 `writeText` 后写 `error`+`warn`+`info` → 一个文件都没生成，`dropped=3`，且 `log.ready` 状态为 **resolved**（`src/node.ts:181-192`），与 `README.md:54`「`log.ready` 返回时表示前面写的每一行都已经在文件里」冲突。
4. **多进程共写同一目录**：落盘是「读—拼—写」全文覆写、无锁、无原子替换（`src/store.ts:367`、`src/store.ts:396-403`）。实测两进程共用同一 `cacheDir`+`pluginId`、同刻各写 40 条 `error`，6 轮里 **4 轮有一整个进程的行被整批覆盖掉**。默认 `daily` 文件名不含进程号，`four-segment` 才按进程号天然分开（可选项，非默认）。`INTEGRATION.md:219` 自认「多进程同时写同一个目录会写坏」——即零丢失依赖调用方守住「一个目录一个写者」，包内无机制强制。

**与 Q2=B 的关系**：地图记「Q2=B：开关保留、只管详细度、落盘零丢弃」（`issues/01-untitled.md:14`）。按逐字口径本项不达标；按本票给定的「分级保口径」则记为「错误与告警恒被接收，直到队列满」。是否允许队列满时丢错误/告警正属未定的 Q5（`issues/01-untitled.md:15`、`issues/01-untitled.md:41`），**本票不裁，留给 R2**。

### 与 README 的出入（共 6 条，详细对照见研究稿）

- D1 版本写 `0.2.1`，`package.json` 实为 `0.2.2`（`README.md:22` vs `package.json:3`）。
- D2 文档与测试沿用宿主 monorepo 路径（`packages/dsh-log`、14 条 `tests/verify-log-*.js` 门禁、`research/489-appendix.md`），本仓都不存在；实测 `npm test` 为 23 过 / 2 套失败（`tests/host.test.mjs`、`tests/client.test.mjs` 引用不存在的 `ROOT/src/...` 旧实现），与 README §9 声称的四套全跑不符。
- D3 退出丢失只点了 `warn`/`info`，实测 `error` 同样丢（见上第 2 条）。
- D4「`ready` 返回即每行都在文件里」只在写盘成功时成立（见上第 3 条）。
- D5 导出回参 `fallback` 在成功路径也硬编码 `true`（`src/phones.ts:192`），文档未说该键恒真。
- D6 `logClear` 不传 `date` 按坏日期处理回 `{ok:false,removed:0}`，文档未写明（实测；另：清空不存在的日期反而回 `removed:1`）。

### 顺带给兄弟票的两条（本票只记录，不越界裁定）

- 级别票（03）：`src/store.ts:263-267` 的判断顺序是先 `error/warn`、再按**事件名**查常驻名单、最后才看开关，与级别无关。实测开关关闭时 `log('debug','host.start')` 与 `log('trace','host.start')`（非法级别）**都落盘**，而 `log('debug','guest.exec')` 不落盘。README §2.1/§4 与 `src/config.ts:242` 的「其余信息与调试只在开关打开时落盘」按现有实现不成立。
- 隔离票（08）：磁盘隔离目前只靠目录名/开关文件名的默认派生（`src/config.ts:87-98`）；前缀只隔离电话名。两插件若显式覆盖成同一 `logDirName`，按上面第 4 条会互相覆盖。

### 遗留与未定

- **Q5（队列满语义）未定**，本票不裁，只记现状（满时按级别挤掉最旧普通行；全为错误/告警时连错误/告警也丢）。
- **Q2=B「落盘零丢弃」与现状的冲突未解**，本票只给冲突事实，不给策略。
- 未验证：`dist/`（2026-10-07 构建）与 `src/`（最后改 2026-10-04）的字节一致未做到重生成比对——本仓跑不了 `build.mjs`（它 `import esbuild`，而本仓 `node_modules` 只有 `typescript`，实测直接 `ERR_MODULE_NOT_FOUND`；同属 D2 的宿主 monorepo 遗留）。已做的佐证是逐项比对产物机制与源码一致（`dist/store.js:148/195/198-214/309/329`、`dist/config.js:24-26`、`dist/phones.js:144-151/163`），故落盘机制这一层判 `dist ≡ src`，全部实测数字仍以 `dist` 产物为准；真实宿主 `getCacheDir` 给出的绝对落点不在本仓；写盘持续失败时自监控行 `log.persist.fail` 是否一并丢失未逐条实测。
- 不属于本票：轮转/清理（票 04）、级别（票 03）、格式（票 05）、聚合（票 06）、链路追踪（票 07）、隔离（票 08）、追踪标识（票 09）。
