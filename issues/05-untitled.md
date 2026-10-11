<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-fmt -->
<!-- parentKey: 01 -->
# 自查：日志格式是否具备

## Question

判定日志格式能力是否具备：JSON 行（event/level/fields）、事件清单格式（level/kind/fields/codes/rules/guard）、通用检查器。口径：脱敏（记名不记文）=合规；字段白名单运行时不丢字段但门禁红灯=抑制（Q1 已定）。

输出：有/部分/无 + 证据（src/config.ts 事件清单一节、event-list.template.json、tests）。只给结论不写代码。

## 进度

<!-- 做到哪一步了，在这里一行一行记 -->
- 2026-10-09 起：读票 05、父图 01 口径（Q1=A、Q2=B、门禁红灯=抑制；Q5/Q6 待 R2）与已结票 02/03 的答案形状，确认本票三块判据与输出形状由票面给死；grilling 一轮三问 + 收尾一问全部落定（依赖处理=先例法标「待 Q6」不阻塞；「fields 之外不记」按 Q1 计入判定、总判「部分具备」；行健壮性纳入实测与判定；收尾按 02/03 先例）。
- 2026-10-09 研究：后台研究 agent 通读 src/{store,config,client,phones,host,node}.ts、README §7/§9、INTEGRATION.md 步骤 5、event-list.template.json 与四套测试，跑只读探针 .local/selfcheck-05-format1..7.mjs，产出 research/05-log-format-capability.md（逐条 file:line，含 31 组验形矩阵与 7 组实测）。
- 2026-10-09 复核：Lead 用另一支只读探针 .local/selfcheck-05-format-lead1.mjs（L1–L5 五组）独立复跑，结论逐条一致；Lead 侧另补两条（dist 侧机制逐项命中；仓内无任何 CI 配置）。
- 2026-10-09 收尾：答案写回本票并置 Status: resolved；研究稿补「附：Lead 独立复核与口径落地」，并在成稿后追加三节收口（§4 运行期是否按格式做事／§5 脱敏实现面／§6 行健壮性），Lead 逐条核对与本节判定一致；同步地图 01 的 Decisions so far 与 Tickets。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

- 2026-10-09（口径注记，grilling R1 用户全取推荐项）：①Q6 未定项用先例法——出结论 + 依赖处标「待 Q6」，不阻塞、不裁策略；②「允许字段（fields，之外不记）」按 Q1「门禁红灯=抑制」**计入判定**，总判「部分具备」，最终口径待 R2；③行格式健壮性（不可序列化值/换行/超长值）纳入实测与判定。

## Answer

**判定：部分具备。** 三块判据 有／部分／有；总判定落「部分」的两个来源：清单格式「格式层有、语义层无」，以及按 Q1「门禁红灯=抑制」计入的那条抑制式设计（`fields` 之外不记，最终口径**待 Q6**）。

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | JSON 行（event/level/fields） | **有**（附三缺口） | 落盘行唯一形状 `JSON.stringify({ts,level,event,fields})`（`src/store.ts:374`）：一行一 JSON、`\n` 分隔、末尾一个换行、无 BOM/无前后缀；`fields` 运行期**原样透传**（`src/store.ts:294`）。缺口：客户端 `ts` 被宿主重打且 `truncated` 标记不落盘；不可序列化值整行静默丢；行内无追踪标识（归票 09） |
| 2 | 事件清单格式（level/kind/fields/codes/rules/guard） | **部分**（格式层有、语义层无） | 六键白名单 + `level` 四值 + `kind` 三值 + `fields` 必填 + 去重/空名拦截 + 中文报错**全部真验形**（`src/config.ts:299-367`，31 组矩阵），空模板合法（`tests/eventList.test.mjs:55-61` 实跑通过）；但**运行期只验形不消费**：清单外字段与事件名照落、`kind` 不驱动行为、`codes`/`rules`/`guard` 零实现 |
| 3 | 通用检查器 | **有**（附两缺口） | 三个纯函数齐备（`src/config.ts:299`、`:379-414`），经 `src/host.ts:23` 导出、`src/config.ts` **零 import**（语法上不可能读盘）、单测 **14/14 通过**。缺口：包内**零运行期/门禁调用方**；`checkEventFields` 第三参非数组时静默判绿（`src/config.ts:387-389`） |

证据全集：`research/05-log-format-capability.md`（研究 agent 独立产出，逐条 `file:line`；文末「附：Lead 独立复核与口径落地」是 Lead 的第二路取证 + 本次口径落地）。只给结论，**未改任何代码**。

### 关键实锤（本票最硬的六条）

1. **行形状唯一**：12/12 行键集合 `["ts","level","event","fields"]`，`level`/`event` 原样字符串、`ts` 为毫秒数；值里的换行/引号/制表符/中文/emoji 被转义后**仍是单行**；单个字段值 200000 字符**不截断**仍一行（探针 1；Lead L1 用 1 MiB 值复现）。
2. **运行期不认清单**：注入合法清单后，清单里没有的事件名、没登记的字段、以及明文 `token:"ghp_plainTextSecret_…"` **全部原样落盘**，清单里配的 `rules`/`codes` 规则名一个都没出现（探针 4；Lead L2 用 `madeUpKey` + `RAW-SECRET-123` 复现）；把宿主自己写下的那行喂回 `checkEventFields` 才判 `ok:false, unknownFields:['forbidden','token']` —— **"检查器的判决"与"盘上事实"当场相反**。
3. **`kind` 不驱动行为**：清单自报 `kind:'resident'` 的 info 事件在开关关闭时被拦、不落盘；而**不在清单里**但硬编码 43 条名单里的 `host.start` 照落（`src/store.ts:246-259`、`:265`，探针 6）。清单在运行期只被读一次（建库验形），此后无人读（`src/store.ts:110` 只有一句注释）。
4. **清单层的脱敏零实现**：`codes`/`rules`/`guard` 在 `src/` 的全部命中只有注释、类型与验形（`src/config.ts:224-231/257-262/349/358-364`），**没有任何一处读它们来做事**。包内**确实有**散列脱敏，但只覆盖自监控失败行：`hash8`（`src/client.ts:369-374`，与 `src/phones.ts:37-45` 逐字同实现）挂在 6 个写点只记 `errorHash`（`src/client.ts:392/397/562`、`src/phones.ts:121/203/229/253`）——与清单里的 `codes`/`rules` 没有对接。
5. **行健壮性有静默缺口**：`BigInt`（`1n`）与循环引用值 → **整行不落盘** + `dropped +1`，同批其它行照落，**不产生 `log.persist.fail` 自监控行，`log.ready` 仍 resolved**（`src/store.ts:371-381`；探针 1/7，Lead L3 复现 `dropped+2 / ready resolved`）；整批全坏时连日志目录都不建（`:381` 把空批按写成功返回）。另：`fields` 只做 `typeof object` 兜底，**数组穿透**成非对象 `fields`；值为 `undefined`/函数/符号的键被 JSON 静默丢掉；`NaN`/`Infinity`→`null`、`Date`→ISO。
6. **检查器可用但没人接线**：`dsh-log/host` 三函数可达（`client`/`node` 不可达），不读盘且在 `INTEGRATION.md:167-182` 的最小清单例子三检查器全过；但 `src/` 内除建库验形外**没有任何调用方**，仓内也**没有任何 CI 配置**（无 `.github/`、无 `*.yml`）——"门禁"目前只有 `tests/eventList.test.mjs`（14/14 绿）与文档要求的发布前自查（`INTEGRATION.md:195`）。

### 与 Q1 全量口径的冲突（本票口径要点，待 Q6）

- 「**允许字段（fields，之外不记）**」（`src/config.ts:230`、`:255`、`README.md:153`、`INTEGRATION.md:205`）按 Q1「门禁红灯=抑制」是**一条抑制式设计**，且它的唯一执行者是**没有调用方**的检查器（红灯要由调用方自己在门禁里跑）。本票按已定口径**计入判定**（这正是总判定落「部分具备」的原因之一），但**不裁"红灯之后怎样"——待 R2 的 Q6**。
- 「脱敏（记名不记文）=合规」：格式**能表达**记名不记文（`codes`/`rules` 位置齐备且验形），但**能力不在包里**——业务事件的 `fields` 无任何脱敏/截断/白名单，明文照落；包内真脱敏只覆盖自监控/失败行（见实锤 4）。消费插件是否自己做脱敏，本仓无从核验。
- 所有「丢整行/丢字段只计数」的现状只记录、不裁可接受性——**待 Q5**。

### 与文档的出入（3 条，另 2 条与票 02/03 同源只引用）

- **DF1**「之外的键一律不记」：运行期**不做任何拦截**（清单外字段/事件名照落）；读作"检查器会判红"成立，读作"运行期不会记进去"不成立，文档未写明执行者是谁（`README.md:153`、`INTEGRATION.md:205` vs `src/store.ts:294`、`:374`）。
- **DF2**「`codes` 是截断或散列代号、`rules` 是具名正则名，命中只记规则名不记原文」：**清单层零消费**——包内无一处按 `codes`/`rules` 挑散列或截断函数；包内确有散列脱敏，但只在自监控失败行（只记 `errorHash`，见实锤 4），与清单无对接。§7 这句在清单侧没有代码对应物（`README.md:153`）。
- **DF3**「事件对照表以 `research/489-appendix.md` 与 `tests/verify-log-*.js` 为准」：两者**在本仓都不存在**（附录在父仓 checkout；`README.md:202-215` 列的 14 条门禁脚本全无，本仓 `tests/` 只有 4 个 `*.test.mjs`），且 `src/config.ts:239` 的「本仓现有 55 事件对照」与父仓附录「九十二事件对照表」不符（**存疑，本票不裁**）。
- 相符项已逐条比对（行形状有测试守着、`eventList` 默认 `null` 主路径零变化、空模板随包发布且 11 个文件对账一致、导出 8/4 键与 `bytes`/`fallback` 语义、INTEGRATION 步骤 5 例子三检查器全过）。

### 遗留与未定

- **Q5（丢弃语义）**：序列化失败整行丢只计数、`ready` 仍 resolved、无自监控行——是否可接受未定，本票不裁。
- **Q6（门禁红黄）**：「fields 之外不记」这条抑制式设计的最终口径（红灯之后怎样）待 R2。
- **未独立核验**：`dist ≡ src` 未做字节级重生成比对（`build.mjs` 缺 esbuild，只做逐项行级比对一致）；真实宿主 RPC 通道未验（客户端探针用的是桩宿主直连 `handleLogBatch`）；包外消费方是否自行脱敏未验；`src/config.ts:239` 的「55」存疑。
- **不属本票**：轮转（04）、聚合（06）、链路追踪（07）、隔离（08）、追踪标识（09）。