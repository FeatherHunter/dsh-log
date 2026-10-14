# 读侧工具（A+B+C，2026-10-15，发 0.4.0）

起因：用户连续三问——「这些是打印出来的内容？」「为什么完全没有人类能看的信息？我打印『网络异常』会怎么体现？」「JSON 是不是更适合 AI？加人读的小工具开发量如何？」——要求按第一性原理回答并落地。

## 一、第一性原理：为什么「人话」不进存储格式

- 模型与人读的都是**渲染结果**，不是存储格式。落盘是唯一真源，渲染是纯函数：它随读者变（时区、语言、要不要看字段、要不要上色），写进文件等于把某一种读者的偏好固化给所有人。
- 实测（`.local/measure-formats.mjs`，两行日志）：JSON 行 407 字符 ≈ 112 token；logfmt 331 ≈ 93；人话渲染 294 ≈ 83。**体积差 1.35×，不是选型理由**。
- JSON 的真正价值：程序（以及 AI 之前的那层过滤器）能**无损地先筛掉 99% 无关行**——键名稳定、可聚合、可断言；人话的价值：一眼看懂。两者不冲突，各自在正确的层次上：**存储给机器，渲染给人**。
- 事件名是黑话（`net.unreachable`），语义靠字典——所以约定 `fields.message` 放人话；它是普通字段，写侧不拦任何字段，清单里登记了检查器就不黄。

## 二、A+B+C 各是什么

| | 交付 | 位置 | 代价 |
|---|---|---|---|
| A | 文档与清单示范：真实输出长什么样、怎么写人话、怎么看 | README §3.1/§3.2、INTEGRATION 步骤 4b/5 | 约 1 小时，不发版 |
| B | 读侧纯函数 `parseLogLine` / `formatRow` / `formatRows` | `src/core/read-row.ts` → 根入口导出 | 半天，加法 |
| C | 命令行 `dsh-log tail`（只读） | `src/cli.ts` + `src/cli/args.ts` + `src/cli/tail.ts` + `src/platform/read-node.ts` | 1–1.5 天 |

不做 D（控制台输出适配器）：它改运行时行为（往 stdout 写、可能与宿主抢 stdout），收益与风险不成比例。

## 三、C 的三个「不是」

- 不是控制台输出器：库照旧不往 stdout 写；`dsh-log tail` 是**显式运行的只读工具**。
- 不替代查询 API（`handleLogQuery`）：它读文件，不打电话，因此不需要宿主活着。
- 不写、不改、不删任何日志文件，也不写缓存与状态——这一点由结构保证：`cli.ts`/`cli/*` 不许 import `node:`，全部文件能力走 `src/platform/read-node.ts`，而那个模块**只有读**（`pathKind`/`statFile`/`readTextFile`/`listDirNames`/`sleep`/`packageVersionNear`），没有写 API。

## 四、实现要点与踩坑

- **写序**：封存是「改名 + 开新文件」，所以 `.1` 装当天最早的行、可写文件装最新行。`core/file-name.ts` 把私有的 `writeOrderRank` 导出为 `logFileWriteOrder`，CLI 与导出、保留共用同一份写序判据（不许第二个真源）。
- **半行**：写者可能正写到一半。`splitLogLines` 把「末尾无换行的碎片」单独交回、不显示；测试里刻意把半行放在独立文件（放在可写文件末尾会与随后追加的行粘成一行）。
- **跟读**：用 **ino 当文件身份**——封存是改名，ino 不变，同一内容不会被当新文件重印；新出现的文件从头显示。
- **shebang**：`src/cli.ts` 带 `#!/usr/bin/env node`，但源文件有 BOM，首版 `startsWith('#!')` 判假 → dist 里 shebang 落到第二行，`node dist/cli.js` 直接 `SyntaxError`。改为「先剥 BOM、再摘 shebang」，构建时把 shebang 拼回**第一行**；`tests/release-surface.test.mjs` 钉住这条。
- **零依赖约束**：`types:[]` 下 `process`/`URL`/`import.meta.url`/`node:url` 都没有声明，已在 `src/node-ambient.d.ts` 补最小形状（不进发布类型面）。
- **退出码**：用法错 1、没找到日志目录 1、未预期异常 2；正常 0。用 `process.exitCode` 而不是 `process.exit`，避免截断 stdout。
- **测试不许用 `process.cwd()` 定位 dist（重要教训）**：`format-row` 与 `cli-tail` 首版写 `join(process.cwd(), 'dist', ...)`，本地单跑没问题；但变异表是把整包拷到 `%TEMP%` 副本里跑的，而**子进程的 cwd 还是活仓库** → 测试读到没被变异的那份 dist，M79–M85 六条全部报「GREEN（断言没咬住）」。两处一起修：测试改按 `import.meta.url` 定位包根（与其余测试同一约定）；变异脚本给 `ProcessStartInfo.WorkingDirectory` 钉上临时副本路径。这条以后必查：**任何读产物的测试都不许依赖 cwd**。
- **M81 是「等效变异」的样本**：`outputOf` 与 `collectMatches` 各有一道「解析不了就跳过」的守卫（双保险），只改 `outputOf` 在 CLI 黑盒测试里不可观测 → 报 GREEN。锚点改到 `collectMatches`（真承重的那一处）才 RED。**修防线不是加防线：等效变异要改锚点，不能改断言**。

## 五、门禁与证据（本轮）

- `npm test` **197/197（21 套）**；新增 `tests/format-row.test.mjs`（8 例）与 `tests/cli-tail.test.mjs`（7 例，含真 spawn 的 `-f` 跟读与「跑完前后目录名字/大小/mtime 完全一致」的只读断言）。
- `tests/public-surface.test.mjs` 根名单 32 → **35**（`parseLogLine`/`formatRow`/`formatRows`）；`tests/release-surface.test.mjs` 新增 bin 断言（存在、首行是 shebang、落在 `dist/`）；`tests/arch.test.mjs` 的 `node:` 白名单加 `platform/read-node.ts`，哨兵加三个新文件。
- 变异：M79 `formatRow` 丢 `message`、M80 级别阈值失效、M81 半行也打印、M82 bin 无 shebang、M83 只认日志目录不认根目录、M84 `-f` 不跟读、M85 渲染时给未知级别上色/丢对齐。
- `node build.mjs`：49 个 TS → 49 JS + 49 `.d.ts`；发布白名单 103 个文件（`npm publish --dry-run` 自查）。

## 六、诚实边界

- CLI 只读**磁盘上已有的文件**，不理解内存队列——「写进去了但还在防抖窗口里」看不见（想确保落定先 `await log.ready`）。
- 大目录（几十万行）是顺序读全部匹配文件再取尾 N 行，没有索引；这是 0.4.0 的有意取舍（简单、只读、无状态）。真需要索引时再议。
- 人话渲染的 `message` 是**约定**不是机制：没写 `message` 就渲染事件名与字段，照样可读。
- `--since` 只认相对时长与 ISO；不解析本地化时间字符串。
- 本工具在 Windows / Linux 都跑过（CI 两条作业里含 `npm test`），但没在多 GB 日志目录上压测。
