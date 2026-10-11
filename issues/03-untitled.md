<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-lvl -->
<!-- parentKey: 01 -->
# 自查：日志级别是否具备

## Question

判定日志级别能力是否具备：error/warn/info/debug 四级、常驻(resident)/按需(ondemand)/自监控(selfmon)归类、开关语义（Q2=B：开关保留、只管详细度，落盘零丢弃；错误与告警恒落盘）。

输出：有/部分/无 + 证据（src/store.ts、src/client.ts、src/config.ts 的文件行与测试）。只给结论不写代码。

## 进度

- 2026-10-09 22:12 开工并收口：读 src/store.ts / src/config.ts / src/client.ts 全文与 tests/ 四套测试；`npm test` 实跑 23 过 / 2 套起不来（失败为老 monorepo 路径遗留 D:\src\...，与级别能力无关）；`tsc -p tsconfig.json` 退出码 0。
- 只读取证（两个独立批次合并）：探针 A/B/C/D 实跑——客户端队列满丢 error、宿主队列满挤掉最旧普通行、开关关闭时非常驻 info/debug 连队都不进、越界级别开关打开即原样落盘。
- 独立核验：src 注释引用的 research/489-appendix.md 在父仓 checkout 找到，代码两份 43 条常驻名单与附录 §1.4 现行 43 条**集合完全相同**（两个 checkout 复核）。
- 结论已写进 ## Answer；逐条引用、未核验项与探针脚本见 research/03-log-level-capability.md（后台批次产出已并入该文件）。
- Q5（队列满语义）未定：凡依赖它的判定一律标「待 Q5」，本票不替它定调。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

**整体判定：部分具备。** 三块判据：四级＝**有**（附一处运行期不设防）；归类＝**部分**（只在数据模型层具备）；开关语义 Q2=B＝**部分**（「零丢弃」不成立）。全部证据与逐条引用见 `research/03-log-level-capability.md`。

**1. error/warn/info/debug 四级：有。**
三入口各一份定版枚举（`src/config.ts:243`、`src/store.ts:33`、`src/client.ts:133`），清单里级别写错当场抛错（`src/config.ts:342-344`），且级别真的驱动三条路径：放行（`src/store.ts:264`、`src/client.ts:280`）、刷盘时序（`src/store.ts:296-297` 错误告警直通 / 其余 1000ms 防抖，`src/config.ts:9`）、队列压力取舍（`src/store.ts:270-281`）。测试实跑通过：`tests/eventList.test.mjs:98-102`、`tests/node.test.mjs:119-142`（14/14 与 9/9）。不设防处：`log(level: string)` 运行期不拦越界级别（`src/store.ts:284`、`src/client.ts:291`），实测开关打开后写 `trace`/`FATAL` 原样落盘（级别序列 `["trace","FATAL","error"]`）；四级只在清单层被硬校验。若把该判据读作「运行期不变量」，此项降为部分。

**2. resident/ondemand/selfmon 归类：部分。**
数据模型与计数门禁确实存在：枚举 `src/config.ts:247`、验形 `:345-347`、计数对账 `:404`，测试 `tests/eventList.test.mjs:83-96`、`:128-132` 通过。但**运行期没有任何判定读 `kind`**：真正让「常驻信息开关关着也落盘/也转发」的是另一张手写事件名名单（`src/store.ts:246-259`、`src/client.ts:263-276`，各 43 条、两份逐字相同，消费点只有 `src/store.ts:265` / `src/client.ts:282`），`ondemand` 靠开关兜底、`selfmon` 无 `kind` 标记载体。本票独立核验：两份名单 43 条与父仓附录 §1.4「常驻 43 条」**集合完全相同**（两个 checkout 比对无缺无多）；但注释所称的逐项核对门禁 `tests/verify-log-count.js` 不在本仓，这条一致性目前无自动门禁守着。

**3. 开关语义（Q2=B）：部分。**
- 成立：开关保留（`src/client.ts:121` 本地键、`src/store.ts:419-459` 读写、`src/phones.ts:295-306` 两条电话，默认关闭 `src/store.ts:118-119`）；开关只管详细度（`src/store.ts:263-267`、`src/client.ts:279-288`；实测关闭时非常驻 info/debug 连队都不进、不计丢弃）；错误与告警在**选行**层恒被接收（`src/store.ts:264`、`src/client.ts:280`）。
- 不成立「落盘零丢弃」：现行四条丢行路径都只计数——宿主队列满（`src/store.ts:270-281`、`:286-289`，错误告警挤掉最旧普通行；队列全是错误/告警时新错误也被丢）、客户端队列满（`src/client.ts:293-297`，**完全不看级别**）、超包/超队裁剪（`src/client.ts:448-458`）、写盘/转发失败（`src/store.ts:344/376-379/386-390/405-410`、`src/client.ts:471-501`）。
- 实测最锋利的一条：客户端队列塞满 100 条后推一条 `error` → 丢弃数 0→1、队列里没有它、宿主实收的 50 条里也没有它 ⇒ **「错误与告警恒落盘」在客户端侧不成立**。宿主 `maxQueue=3` 推 `error` → 挤掉最早的普通行、error 落盘（`info,info,error`）。
- 上游旁证：附录 §1.6 把 `log.forward.summary` 的 reason 枚举写死为 `queue-full`/`packet-trim`/`send-fail`/`host-reject`，与上面四条路一一对应 ⇒ 丢弃是现行设计的一部分，不是漏网缺陷。
- **待 Q5**：队列满语义未定（`issues/01-untitled.md:15`、`:41`），本票只报现状与冲突点，不给策略。

**4. 附带发现。** `npm test` 23 过 / 2 套起不来（`tests/host.test.mjs:15`、`tests/client.test.mjs:19` 引用老 monorepo 路径 `D:\src\...`），两套里其实**有**丢弃与级别的断言，只是在本仓跑不动；真正无测试的是宿主 `dropForRoom` 的两档级别分支（本票探针补测）。README 点名的 14 条 `tests/verify-log-*.js` 与 `research/489-appendix.md` 均不在本仓（附录在父仓 checkout）。开关里的 `sampleRate` 全包惰性：只存取透传，无任何采样取舍。