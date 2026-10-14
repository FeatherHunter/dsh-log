# research/16 —— 0.3.1：客户端计数口径修正、命名整改与真实样例

> **2026-10-15 后续**：这一版曾按用户决定「先不发、留在仓库里」搁置；随后用户又要求落地读侧工具（A+B+C），
> 并明确**所有改动都算 0.3.1**（不另拆 0.4.0）。所以本文的两项改动与读侧工具一起作为 0.3.1 发布。
> 读侧部分见 `research/17-read-side-toolkit.md`，发布记录见 `notes-publish-drill.md` 第〇.1 节。

> 目的：0.3.0 发布后，把「账本上一个数字怎么算」修正到与宿主同口径，并按用户六条标准
> （权威 TS 做法 / 第一性原理 / 高级架构师思路 / 数据结构与算法 / 设计模式 / 命名与结构自解释）
> 做一次命名与结构审计；同时把「日志打印出来长什么样」按原始字节抓下来，写进 README。

## 一、必改 ①：客户端丢弃计数只数用户行（行为修正）

**现象**（0.3.0 已发布版本）：宿主长坏时，1 行用户日志会让 `getDroppedCount()` 涨到 **2**。

**根因**：「客户端 → 宿主」这条线断了要留证据，库自己会写一行 `log.forward.summary`（`src/client/forward.ts`），
而这行**和用户行走同一条队列、同一批发送**；发送面统计丢弃时用整批条数（`entries.length` 或
宿主自报的 `rejected`），把库自己的便签也算成了「你的日志丢了」。宿主侧早就分得清
（`src/engine/pipeline.ts` 的 `isDiagnostic` + 计数只数用户行），客户端没有这个标记 —— 同一个系统两套口径。

**修法**（三处，均为最小改动）：

| 位置 | 改法 |
|---|---|
| `src/client/types.ts` | `ClientQueuedRow` 加 `isDiagnostic?: boolean`（内存标记，不落盘；与事件清单里公开值 `kind: 'selfmon'` 是同一件事） |
| `src/client/write.ts` | `log(level, event, fields, isDiagnostic?)` 落行时打标；新增专用入口 `logDiagnostic(...)`；保留字影子行（`log.trace.shadow`）同样打标 |
| `src/client/send.ts` | 新增 `userRowCount(rows)`，三处计数改用它：重试到顶（`:78`）、超包/积压裁剪（两处 trim）、没有宿主可发（`:128`）；`logForwardState.lastRejected` 仍如实反映宿主自报数（它描述宿主行为，不参与用户账） |
| `src/client/forward.ts` + `src/client.ts` | 转发面的三行（汇总行 / 导出失败行 / 开关看门狗行）改走 `logDiagnostic`，接线在组合根一次 |

**回归线**（`tests/client.test.mjs`）：

- 「宿主长坏链条终止」改为断言 **10 行用户行 = 10**（修前 11），并写明诊断行不计。
- 新增「诊断行不计入丢弃」：只剩汇总行时反复发送，计数必须停住；同时断言汇总行确实带
  `isDiagnostic: true`、调用方自己写的行**不许**被标记（防「所有行都标上」的假实现）。
- 导出失败行用例补两条断言：`log.export.fail` 两处都带标记。

**变异**（`scripts/mutation-check.ps1`）：M76（不打标记）、M77（计数退回 `entries.length`）、
M78（接线走错入口 → 诊断行走普通 `log`），三条都 RED；顺带把因实现改写而失效的 M33/M39 锚点跟到新实现。

## 二、必改 ②：命名与结构审计（不改语义）

判据：名字要能回答「这是什么」，且同一概念只用一个词。审计结果与整改：

| 旧名 | 新名 | 为什么 |
|---|---|---|
| `selfMon?: boolean`（引擎与领域层的行标记） | `isDiagnostic?: boolean` | 缩写且与公开数据值 `kind: 'selfmon'` 混淆；`is` 前缀是布尔判定的通行写法 |
| `deferredSelfMon` / `deferSelfMonRows` / `selfMonDue` | `deferredDiagnosticRow` / `deferDiagnosticRows` / `diagnosticDue` | 同上，跟着改到可读 |
| `createWriteRig` / `WriteRigInput` / `WriteRig` | `createWriteStage` / `WriteStageInput` / `WriteStage` | 「rig」是行话（脚手架/装置），读者要猜；这四个模块本就是客户端流水线的**工序**，`Stage` 与既有 `createEngineIo`/`createRotation`/`createSwitchFile` 同一族 |
| `createSendRig` / `createForwardRig` / `createTraceRig` 及同名类型 | `createSendStage` / `createForwardStage` / `createTraceStage` | 同上，四个面一个口径 |
| 工厂参数 `rig` | `input` | 与 `createEngineIo(input)` / `createPipeline(input)` 统一 |
| `SendStageInput.log`（注入了却从未使用） | 删除 | 死接线：留着一个「看起来能用」的依赖，读者会以为发送面会记日志 |

**没有改**：公开导出名（`tests/public-surface.test.mjs` 的四入口名单快照照旧：32/23/17/4）、
事件清单数据值 `kind: 'selfmon'`（改它会破坏 0.3.0 用户写好的清单）、领域层与引擎的其余名字。

**约定写进文档**：README §9.1 增加「命名约定」六条（目录 / 文件 / 工厂 / 判定与类型 / 一个概念一个词 / 不许第二个真源）。

## 三、顺手修掉的一处数字失真

`log.forward.summary` 的第一条曾报 `windowMs: 1791969987768`（epoch 量级）——`lastSummaryAt` 的哨兵值 `0`
被当成计时起点。改为**实例建成那一刻**起算（`src/client.ts` 的 `logForwardState.lastSummaryAt = Date.now()`），
真实样例里现在是 `windowMs: 0`（同一毫秒内）与 `windowMs: 65`。

## 四、真实样例（README §3.1 的证据）

探针 `.local/probe-samples.mjs` 跑真 `dist`、真磁盘、真子进程路径，抓下五种形态的原始文件内容，
逐字节写进 README §3.1：①`createQuickLog` 两行；②宿主 + 客户端桥接（`info/warn/error` + `traceId/spanId/seq` 与开关文件）；
③轮转（4 批 × 3 行、`maxSize: 300` → `.1/.2/.3` 封存件 + `log.rotate.seal` + `audit.json`）；
④保留字冲突（主行 `fields._shadow` + `log.trace.shadow` 行）；⑤诊断行（客户端队列里的汇总行 + 它落盘后的原样一行）。
样例里能直接读出：落盘恒五键、`log.` 前缀是库自己写的、`audit.json` 不是日志行。

## 五、门禁（0.3.1）

| 项 | 结果 |
|---|---|
| `tsc -p tsconfig.json` | exit 0 |
| `node build.mjs` | 44 JS + 44 `.d.ts` |
| `npm test` | **181 / 181**（19 套；新增 1 例） |
| `pwsh scripts/mutation-check.ps1` | **75 / 75 RED**（新增 M76–M78） |
| `node scripts/pack-smoke.mjs` | 通过（tarball 装进全新工程写一行五键 `v=3`） |
| `node tests/soak.mjs 0 --fast` | A 段 20000/20000、`dropped` 0 |
| 公开面快照 | 四入口导出名不变（32/23/17/4） |

## 六、诚实边界

- 客户端 `dropped` 现在只数用户行，但**无法区分「哪几行被拒」**：宿主自报 `rejected` 只给条数，
  所以计数口径是「不再把库自己的行算进去」，而不是「精确到行」。
- 命名整改只动了**内部**名字；四个客户端 Stage 的 `.d.ts` 随包发出，但不在 `exports` 子路径里，
  消费方拿不到它们，故不算公共面。
- scratch 层（`.local/`）的探针与脚本不随包发布；可复跑的只有 `scripts/` 与 `tests/` 内的东西。
