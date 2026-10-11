<!-- DSH-IDEMPOTENCY-KEY: deck-plan-dsh-log-selfcheck-md-20261009-child-rot -->
<!-- parentKey: 01 -->
# 自查：日志轮转是否具备

## Question

判定日志轮转能力是否具备：自动轮转（按大小/时间切分）、旧文件清理、保留策略。已知 README 明说不自动轮转不自动清理，需用代码实锤。对标锚点：winston-daily-rotate-file（见 Decisions）。

输出：有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。

## 进度

- 2026-10-09 22:40 开工：口径取自票面 + 父图（Q5 待 R2，不猜）；研究 agent 独立取证，Lead 并行只读实测。
- Lead 只读实测（`.local/selfcheck-04-rotation.mjs`，跑 dist/ + 系统临时目录，未改仓库文件）：跨三自然天写 → 3 个按天文件全留存；同日写 30 行约 20KB → 单文件 602590 字节无切分；午夜跨天 → 新开次日文件、旧文件留存；相隔 38 天的两个文件等待 300ms 无任何自动删除；`logClear` 某天 `removed=1`、`'all'` `removed=2`。
- 负面证据（全仓检索，逐条复跑）：`rotate|rotation|retention|maxfiles|maxsize|maxage|sizelimit|maxbytes|compress|gzip|archive` 零命中；`statSync|\.size|byteLength|fileSize` 零命中；`rename|appendFile|createWriteStream` 零命中；`setInterval|cron` 零命中；`git log --all -S"rotate"` 空（不是删掉的老功能）。
- 基线：`node --test tests/node.test.mjs tests/eventList.test.mjs` → 23/23 通过、0 失败。
- 收口（2026-10-09 23:05）：研究 agent 产出 `research/04-log-rotation-capability.md`（354 行，81 处引用逐条自核 0 处不符）；Lead 独立复核其头号实测（15 天留存、单日 3MB 单文件、导出面 23/6、事件接口全 undefined、配置 7 键）全部同向；结论已写进 `## Answer`，本票结。
- 已知问题（非本票产物，需另行处理）：deck 后端曾把本票正文重渲染出重复标题块与重复 `## Comments`/`## Answer` 段（已在本票内整理掉；同一现象是否影响其他票未核）；父图 `issues/01-untitled.md` 的 Q5 原文行号已从 `:41` 漂到 `:51`（并发写入所致），引用时以段名+原文为准。

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:research, wayfinder:task

## Comments

## Answer

**整体判定：部分具备。** 三条判据里只有最弱的一条以退化形态存在，另两条完全不存在。证据全在 `research/04-log-rotation-capability.md`（354 行，81 处 `path:line` 引用）。

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 自动轮转（**按大小切分**） | **无** | 全包没有一处测量文件体积（`statSync`／`.size`／`byteLength`／`fileSize` 在 `src/`+`dist/` 零命中）；配置面只有 7 键、无任何大小阈值（`src/config.ts:34-54`、`:57-65`）；实测同一天写满 **5,008,700 字节仍是同一个文件**、无计数后缀（Lead 缩放复核：6 轮 ×10 行 ×50KB → 单文件 3,004,920 字节） |
| 2 | 自动轮转（**按时间切分**） | **部分**（仅「按自然天分桶」） | 分桶真实存在且按**刷盘时刻**决定文件名（`src/store.ts:394`、`src/config.ts:142-146`）；但轮转的三个核心动作全缺：无轮转事件（store 实例 `on`/`once`/`emit`/`addListener` 全 `undefined`）、无封存/改名（`rename` 零命中；跨午夜后旧文件字节/mtime/inode 三项逐一同前）、无压缩（`gzip|compress|archive` 零命中） |
| 3 | **旧文件清理 / 保留策略** | **无** | 全包唯一删除路径是手动电话 `logClear`（`src/phones.ts:212-260`、`:261-293`），无任何内部或定时调用点（`setInterval`／`cron` 零命中）；实测 40 个自然天 → 40 个文件一个不少（Lead 复核 15 天 → 15 个），空转 300ms 一个不删 |

**口径说明（判据 2 的两种读法，事实相同）**：票面写「按时间切分」，而「每个自然天一个文件」确实是按时间维度切分，故计入该子项判「部分」；但它在轮转语义上是空壳（无封存、无事件、无压缩、无保留联动）。**若把「轮转」从严读作「必须有封存或切换动作」，判据 2 也应记「无」，整体降为「无」。**

**手动 `logClear` 不是保留策略**：没有「留多少」旋钮、不自动不定时、粒度只有「某一天」与「全删」两种、`'all'` 无下限保护。它的精确身份是**唯一的一条手动清理手段**（实测某天 `removed=1`、`'all'` `removed=2`）。

**对标差距（一手来源：winston-daily-rotate-file 5.0.0）**：基准把「切分（`maxSize` 大小／`datePattern`+`frequency` 时间频率）＋封存（关旧流、发 `rotate` 事件）＋压缩（`zippedArchive` gzip 归档）＋保留（`maxFiles` 数量或天数、靠 `auditFile` 记账、只删账本内文件）」做成闭环链路；dsh-log 只有「按天换文件名」这一环，**另外三环一环都没有**。另：基准有 `new`/`rotate`/`archive`/`logRemoved`/`error` 五个事件，本包无任何轮转事件。

**与文档的出入：矛盾数 0。** README 说「不做」，代码确实不做，实测坐实（`README.md:34`、`src/config.ts:141`）。新增 4 条「文档未写明」：U1 单文件体积与单次刷盘写入量都无界（10 轮刷盘全文长度 500870→5008700）；U2 桶由**刷盘时刻**的时钟决定，易被误读为按行时间戳或建库时刻；U3 跨午夜无事件、无封存、旧文件一动不动；U4 文档从没说清 `logClear` 就是清理能力的全部、且它不是保留策略。另 1 条相符但可误读：`format:'zip'` 被静默忽略（`src/phones.ts:115-116`）。

**待 Q5（本票不裁）**：轮转/保留落地绕不开「触顶时丢旧行、丢新行还是拒绝写」，与队列满语义同根；`issues/01-untitled.md` 的 Q5 原文位于 `:15` 与 `:54`（范围说明在 `## Not yet specified` 段，该段起于 `:49`；行号随并发写入漂移，引用以段名+原文为准），明说「影响级别/格式/轮转票口径」。本票现状结论与 Q5 正交，不受其影响。

**未独立核验 / 存疑**：`dist≡src` 无字节级重生成比对（同票 02/03 缺口，本仓无 esbuild）；**基准库未安装未运行**，默认值均取自源码字面；基准内部两处文档/源码不一致（`filename` 默认值、`max_logs` 不设时「默认 10 个」vs v0.6.1「不删」，按 v0.6.1 记）；「一批跨午夜不分裂」为读码非实测；真实宿主 `getCacheDir` 与多进程并发沿用票 02。

**测试守护**：**没有任何测试断言过轮转、文件切分或清理效果**（`tests/*.test.mjs` 检索 `轮转|清理|清空|removed|logClear|delete|unlink` 仅命中电话名映射与清空失败记行）；本仓可跑基线 `node --test tests/node.test.mjs tests/eventList.test.mjs` → **23/23 通过、0 失败**；`tests/host.test.mjs`、`tests/client.test.mjs` 在本仓跑不起来（老 monorepo 路径遗留，见票 02/03）。
