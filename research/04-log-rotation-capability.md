# 结论

**整体判定：部分具备。**

三条判据里只有最弱的一条以退化形态存在，另两条完全不存在：

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 自动轮转（**按大小切分**） | **无** | 全包没有任何一处读取文件体积：`statSync`／`.size`／`byteLength` 在 `src/` 与 `dist/` 里零命中；配置面只有 7 个键，没有任何大小阈值（`src/config.ts:34-54`、`src/config.ts:57-65`）；实测单日写满 5,008,700 字节仍是同一个文件、没有计数后缀（探针 P2） |
| 2 | 自动轮转（**按时间切分**） | **部分**：只有「按自然天分桶」 | 分桶真实存在且按**刷盘时刻**决定文件名（`src/store.ts:394`、`src/config.ts:142-146`，实测跨午夜自动换文件）；但轮转的三个核心动作一个都没有：无轮转事件、无封存/改名、无压缩（探针 P3：旧文件字节/mtime/inode 三项逐一同前） |
| 3 | **旧文件清理 / 保留策略** | **无** | 全包唯一的删除路径是手动电话 `logClear`（`src/phones.ts:212-260` 与 `src/phones.ts:261-293`），没有任何定时或触发式清理（`setInterval` 在 `src/`＋`dist/` 零命中）；实测写满 40 个自然天后 40 个文件一个不少（探针 P1），空转 300 毫秒也不删（探针 P4） |

判据 2 的口径说明：票面写的是「按时间切分」，而「每个自然天一个文件」确实是按时间维度切分，故本票把它**计入**该子项，判「部分」；但它在轮转语义上是空壳（无封存、无事件、无压缩、无保留联动）。**若把「轮转」从严读作「必须有封存或切换动作」，则判据 2 也应为「无」，整体判定降为「无」**——两种读法的依据都在第 2 节写明。

本票只给结论与证据，不改代码、不提实现建议；方案选型属雾区，不在本票（`issues/04-untitled.md:14`）。凡引用均给 `路径:行号`；实测部分为只读探针，跑在系统临时目录（`D:\Temp\dsh-probe04-*`）与 `dist/` 产物上，未改动仓库任何文件。

本票不重复票 02 的文件能力判定（本地落盘、目录派生、按天文件、电话形状、零丢失），只判「这些机制是否构成轮转／清理／保留」。跨票引用一律标注「见票 02」。

---

# 判据与口径（出处，非本票自拟）

- 票面判据：`issues/04-untitled.md:12`——「判定日志轮转能力是否具备：自动轮转（按大小/时间切分）、旧文件清理、保留策略。已知 README 明说不自动轮转不自动清理，需用代码实锤。对标锚点：winston-daily-rotate-file（见 Decisions）。」输出为「有/部分/无 + 证据。只给结论不写代码；方案选型是雾区，不在本票。」（`issues/04-untitled.md:14`）
- 对标锚点的出处：`issues/10-ts.md:24`——「轮转照抄 winston-daily-rotate-file」；`issues/10-ts.md:26` 同口径（「轮转照搬 daily-rotate-file」）。本票只把它当**尺子**量差距，不据此选型。
- 未定项：`issues/01-untitled.md:54`——「升级建议须满足全量无抑制要求（Q1=A、Q2=B、门禁红灯=抑制已定；队列满语义与门禁红黄待 R2，**影响级别/格式/轮转票口径**）」（在 `## Not yet specified` 段）；`issues/01-untitled.md:15` 同（「队列满语义与门禁红黄（Q5/Q6）待 R2」，在 `## Notes` 段）。**行号说明（2026-10-10 02:10 复核更新）**：`issues/` 下的票面文件在本票取证期间**被并发追加**（每结一张子票就往父图 Decisions 加一段），故 `:15` 稳定、另一处会随追加漂移：2026-10-09 22:58 实读为 `:51`，2026-10-10 02:10 复读为 `:54`。**跨票引用一律以段名+原文为准，不要只写行号**；姊妹票 02/03 把该句记作 `:41`，与本次实读的各版本都不符。本票凡结论落在「触顶时丢行还是丢文件」这类取舍上，一律标「待 Q5」，不猜。
- **不属于本票**：日志系统升级建议清单的实现本身（`issues/01-untitled.md:61`，`## Out of scope` 段：「自动上报/轮转/清理的实现本身（超出自查）」）。

---

# 1. 自动轮转（按大小切分）：无

## 1.1 配置面没有任何大小旋钮

生效配置的键只有 7 个：`pluginId`、`prefix`、`logDirName`、`switchFileName`、`fileNamePolicy`、`maxQueue`、`eventList`（`src/config.ts:57-65`；探针 P5 实测生效配置键集合与之一致，一字不差）。入参面同样 7 个键（`src/config.ts:34-54`），其中带数字语义的只有 `maxQueue`（内存队列条数，非磁盘体积，`src/config.ts:47-48`、`src/config.ts:103-106`）。

`resolveHostLogConfig` 里所有校验点也只在 `fileNamePolicy` 与 `maxQueue` 两处（`src/config.ts:99-106`）——没有第三个数字型阈值。

## 1.2 代码里没有任何一处测量文件体积（负证据，本票头号发现）

可复跑检索（工作区 `D:\dsh-plugin\dsh-log`，均为只读）：

| 检索 | 命中 |
|---|---|
| `git grep -n -E '\bstatSync\b\|\bstat\(\|\.size\b\|byteLength\|fileSize' -- src dist` | **0 命中（退出码 1）** |
| `git grep -n -E 'rotate\|rotation\|retention\|maxfiles\|maxsize\|maxage\|sizelimit\|maxbytes\|compress\|gzip\|archive' -i -- . ':(exclude)node_modules'` | **0 命中（退出码 1）** |
| `git grep -n -E 'rename\|appendFile\|createWriteStream' -- src dist` | **0 命中（退出码 1）**——连「改名封存」和「追加写入」的原语都没有 |
| `git grep -n -E 'setInterval\|cron' -- src dist tests` | **0 命中（退出码 1）**——没有任何定时器可用于定时轮转 |
| `git grep -n -E '%DATE%\|audit\|suffix\|序号' -- src dist` | **0 命中（退出码 1）**——没有占位符/账本/计数后缀那套机制 |
| `git grep -n -e "maxFiles" -e "maxSize" -e "maxAge" -e "zippedArchive" -e "datePattern" HEAD` | 仅 2 处，且都在**无关的第三方类型声明**里：`node_modules/typescript/lib/lib.dom.d.ts:16749` 与 `node_modules/typescript/lib/lib.webworker.d.ts:4403`（DOM 的 `setResourceTimingBufferSize(maxSize: number)`）。本包自己的代码与文档**一处没有** |
| `git log --oneline --all -S"rotate" -- src dist README.md INTEGRATION.md` | **空**——不是「以前有、后来删了」，而是从头到尾没出现过 |

在 `src/` 上按票面建议的词表做正则检索 `rotate|rotation|轮转|retention|保留|maxFiles|maxSize|maxAge|sizeLimit|LOG_MAX|LOG_KEEP|maxBytes|compress|gzip|\.gz|archive|cleanup|清理`，**全部命中只有 5 行，且没有一行是机制代码**：

- `src/store.ts:476`、`src/phones.ts:5`、`src/host.ts:9`：命中的是「原样**保留**」（说的是失败语义的兼容例外，与保留策略无关）；
- `src/client.ts:368`：「包内**保留**一份」散列小函数；
- `src/config.ts:141`：「只分桶，不自动**清理**」——**这是全仓对轮转/清理的唯一表态，而且是「不做」的表态**。

## 1.3 导出面里也没有（与确实存在的上限类常量对照）

实测 `dist/config.js` 共 23 个导出、`dist/store.js` 共 6 个导出，按 `rotate|rotation|retention|maxFiles|maxSize|maxAge|maxBytes|sizeLimit|LOG_MAX|LOG_KEEP|compress|gzip|archive` 过滤**均为空**（探针 P5）：

```
dist/config.js 导出（23）：CLIENT_BATCH_INTERVAL_MS, CLIENT_BATCH_MAX, CLIENT_PACKET_BYTES,
  CLIENT_QUEUE_MAX, DEFAULT_MAX_QUEUE, EVENT_KINDS, EVENT_LEVELS, LEGACY_LOG_DIR_NAME,
  LEGACY_SWITCH_FILE_NAME, LOG_DEBOUNCE_MS, PHONE_ACTIONS, assertPluginId, buildPhoneName,
  buildPhoneNames, checkEventCounts, checkEventFields, formatDailyFileName,
  formatFourSegmentFileName, logFileNamePattern, matchExportFileName, parseEventListManifest,
  resolveHostLogConfig, resolveLogFileName
dist/store.js 导出（6）：LOG_DEBOUNCE_MS, LOG_DIR_NAME, LOG_SWITCH_FILE, createLogStore,
  formatDailyFileName, formatLogFileName
```

对照：**确实存在的上限/窗口类常量都老老实实导出着**——`DEFAULT_MAX_QUEUE`（`src/config.ts:12`，队列 1000 条）、`LOG_DEBOUNCE_MS`（`src/config.ts:9`，防抖 1000 毫秒）、`CLIENT_QUEUE_MAX`（`src/config.ts:19`，客户端队列 100 条）。即：本包**有把「上限」做成命名常量的习惯**，而轮转/保留这一类常量一个都不存在——这不是「藏起来了」，是根本没有。

## 1.4 唯一写盘路径不按体积分支

`writeBatch`（`src/store.ts:368-411`）里没有对文件当前长度的任何判断：取目录（`:385`）→ 拼目录名（`:391`）→ 解析文件名（`:394`）→ 读旧文（`:396-402`）→ **把旧文与新文拼起来整份写回**（`:403`）。写多少完全由「队列里攒了多少行」决定，与文件已有大小无关。

## 1.5 实测（探针 P2）

同一天（`2026-10-09`）分 10 轮刷盘，每轮 10 行、每行约 50 KB：

| 观测 | 结果 |
|---|---|
| 日志目录里的文件 | **1 个**：`2026-10-09.log` |
| 单文件字节 | **5,008,700** |
| 有没有 `.1`／`.2` 计数后缀文件 | **没有**（空数组） |
| 每次 `writeText` 收到的全文长度（10 轮） | 500870 → 1001740 → 1502610 → 2003480 → 2504350 → 3005220 → 3506090 → 4006960 → 4507830 → **5008700** |

最后一行顺带把「按大小切分」的反面钉死：**每一轮刷盘都把整天已写内容整份重读重写一遍**，写入量随文件大小线性增长、总写入量随天数二次增长。这条同时说明「没有大小上限」不只是「不会切分」，而是**单文件体积无界、单次刷盘的内存与写入成本也无界**（机制出处 `src/store.ts:367`，代码注释自认「文件服务无追加原语，任何追加都是全文读改写，按天分文件把单次覆写体积封顶在一天之内」——封顶封的是「一天」，而一天有多大没有任何约束）。

**判据 1 判定：无。**

---

# 2. 自动轮转（按时间切分）：部分（仅「按自然天分桶」）

票面要求把两件事分开看：(a)「按日历天分桶、在刷盘时决定桶」；(b)「有轮转定时器／到点触发切换，并把旧文件改名或封存」。

## 2.1 (a) 存在，而且桶是按「刷盘那一刻」的时钟选的

- 默认策略就是按天：`src/config.ts:99`「`const fileNamePolicy = input.fileNamePolicy === undefined ? 'daily' : input.fileNamePolicy`」；非法值当场抛错（`src/config.ts:100-102`）；可选只有 `daily` 与 `four-segment`（`src/config.ts:31`）。
- 文件名形状 `YYYY-MM-DD.log`（本地时区年月日）：`src/config.ts:142-146`，其中 `src/config.ts:145`「`return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.log'`」。
- **关键机制**：文件名不是建库时定死的，也不是按行的时间戳定的，而是**每次刷盘当场问一次现在几点**——`src/store.ts:394`「`const fileName = resolveLogFileName(config, new Date(), currentPid(), currentStartedAt())`」（构建产物对应 `dist/store.js:316`，逐字同义）。函数 `resolveLogFileName` 见 `src/config.ts:168-178`。
- 因此长驻进程跨过午夜后，**下一条被刷盘的行会静默写进新一天的文件**，没有任何通知、没有关闭动作、旧文件不被碰一下。行自身的 `ts` 仍是入队时刻（`src/store.ts:291`「`ts: Date.now(),`」）。
- 读码补充（未单独实测）：一次 `writeBatch` 只解析一次文件名（`src/store.ts:394` 在批处理体内、不在逐行循环里），故**一批不会跨两个文件**；跨午夜的一批会整个落进新一天的文件、带着午夜前的时间戳。

**实测（探针 P3，同一个 store 实例、同一个进程）：**

| 时刻（模拟） | 目录内容 |
|---|---|
| `2026-10-09T23:59:00+08:00` 写一行并刷盘后 | `2026-10-09.log`，81 字节 |
| `2026-10-10T00:01:00+08:00` 再写一行并刷盘后 | `2026-10-09.log`（81 字节）+ `2026-10-10.log`（80 字节） |
| 旧文件字节 / mtimeMs / inode 是否变化 | `true` / `true` / `true`（三项**逐一同前**，即旧文件没被改名、没被追加、没被封存、没被压缩） |
| 旧文件内容 | 仍是那一行完整 JSON |

## 2.2 (a) 算不算「按时间切分」：本票的口径

**算。** 理由三条，都可查：

1. 票面判据的字面就是「按时间切分」，而按自然天分桶是**实打实的时间维度切分**：切分点由日历决定，不由体积或条数决定。
2. 它是**真的在跑**，不是写在文档里的口号：默认值就是它（`src/config.ts:99`），每次刷盘都重新求值（`src/store.ts:394`），实测跨天确实换文件（探针 P3）。
3. 它和基准（winston-daily-rotate-file）在**触发时机**上是同构的：基准也不是靠定时器切天，而是在每次写入时比较当前格式化日期是否变了（见第 4 节）。所以「写入时才切」本身不构成它不算时间切分的理由。

**但它是空壳**：切分点之后该有的动作，本轮一个都没有（下节）。

## 2.3 (a) 明确**不**提供什么（逐条列出，均有证据）

| # | 缺的东西 | 证据 |
|---|---|---|
| 1 | **无大小上限**——桶内可以无限长 | 判据 1 全部证据；实测单日 5,008,700 字节仍是同一文件 |
| 2 | **无轮转事件**——调用方无从得知文件换了，也挂不上钩子 | 实测 store 实例上没有事件接口：`on`/`once`/`emit`/`addListener` 四个键的值都是 `undefined`（探针 P5）；`dist/node.js` 入口创建对象只有 `store`/`phoneNames`/`ready` 三个键；全包检索 `rotate` 零命中 |
| 3 | **无封存/改名**——旧文件保持原状、原地不动 | 探针 P3 的字节/mtime/inode 三项逐一同前；`rename` 在 `src/`＋`dist/` 零命中 |
| 4 | **无压缩**——没有 gzip，也没有任何归档动作 | `compress\|gzip\|archive` 全仓零命中（排除 node_modules）；`zip` 只在一处出现，且是「传了也不生效」：`src/phones.ts:115`「多余字段现状忽略（例如多传 `format:'zip'` 也不改变行为），保零变化。」（同处 `src/phones.ts:116` 是 `void` 掉该字段的实现） |
| 5 | **无保留联动**——换文件不影响任何清理判断 | 判据 3：删除路径只有手动电话 |

另外两条相关的「没有」：**没有当前文件句柄**（本包不持有流，每次刷盘现拼路径、全文读改写，`src/store.ts:395-403`），所以也不存在「封存」这种动作的载体；**没有账本**（`audit` 检索零命中），所以也无从记录「轮转过哪些文件」。

## 2.4 (b) 轮转定时器／到点重命名或封存：无

- `setInterval`、`cron` 在 `src/`＋`dist/`＋`tests/` **零命中**（见第 8.4 节可复跑检索表第 4 行）。
- 包内唯一的定时类是防抖刷盘：`scheduleFlush`（`src/store.ts:300-315`）→ `flushNow`（`src/store.ts:330-366`）；除它以外没有任何被 `later()` 排期的任务。即：**定时器只干「把队列写下去」，不干「换文件」**。
- 没有「到点」这个概念：跨天是被动的——只有当**下一条日志被刷盘**时才会发现「哦，该换文件了」（`src/store.ts:394`）。一个午夜后一直没写日志的进程，连新文件都不会产生。

## 2.5 判「部分」的两种读法

- **本票口径（能力是否具备）**：切分这件事存在→判据 2 记「部分」。整体「部分具备」。
- **从严口径（轮转是否是一个动作）**：切分没有伴随任何轮转动作（无封存、无事件、无改名、无压缩），所以「按时间轮转」不成立→判据 2 记「无」。此时三条判据里两条「无」、一条（按天文件）已由票 02 判为「文件能力」，整体应记 **无**。
- 两种读法的分歧只在判据 2 的一句话，事实与证据完全相同；本票正文一律按前一种口径表述，并在引用本结论时说明当前用的是哪种读法。

**判据 2 判定：部分具备**——存在的是三条判据里最弱的一条，且只到「分桶」为止（无上限、无事件、无封存、无压缩、无保留联动）。

---

# 3. 旧文件清理 / 保留策略：无

## 3.1 自动清理：无

- 全包唯一会删文件的地方是 `deleteOneFile`（`src/phones.ts:261-293`），它只被 `handleLogClear` 调用（`src/phones.ts:223`、`:242`、`:246`）；`handleLogClear` 只被两处触及：`src/phones.ts:307-312` 的导出面与 `src/store.ts:522-524` 的同名转发，再经 `src/host.ts:68` 注册成电话。**没有任何内部调用点，更没有任何定时调用点。**
- 值得单记一笔：`unlink` 虽然被声明进文件服务最小形状（`src/store.ts:45`、`src/store.ts:63`），但**落盘引擎自己一次都没调用过它**——`src/store.ts` 里 `unlink` 只出现在这两行类型声明里（检索命令 `git grep -n unlink -- src` 的全部命中见证据清单）。删除能力对引擎是「有接口、不使用」。
- 实测（探针 P1）：模拟 40 个自然天、每天写一行并刷盘 → 日志目录里 **40 个文件**，`2026-09-01.log` … `2026-10-10.log` 全部存在（最早那天仍在），没有任何非 `.log` 后缀产物（无 `.gz`、无 `.1`）。
- 实测（探针 P4）：写完 5 个旧文件后**不调用任何电话**、空转 300 毫秒并把挂起的定时器都放掉 → 文件数 `5 -> 5`，一个没少。
- 交叉复核：Lead 的独立探针 `.local/selfcheck-04-rotation.mjs` 的 P7（写两个相隔 38 天的文件、空转 300 毫秒）同样回 `未自动删除旧文件 = true`，与本票探针同向。

## 3.2 手动 `logClear` 是不是「保留策略」：不是

`logClear` 的真实能力（票 02 §4 已列形状，这里只看它是不是保留策略）：

| 事实 | 出处 |
|---|---|
| 入参只有 `date`：某一天，或字面 `'all'` | `src/phones.ts:213`「`const want = args && args.date ? String(args.date) : ''`」；`src/phones.ts:218`「`if (want === 'all') {`」；日期格式不合法直接回失败（`src/phones.ts:227-234`） |
| 回参只有 `{ ok, removed }` | `src/phones.ts:216`、`:225`、`:233`、`:244`、`:247` |
| 全删＝遍历目录把匹配当策略正则的文件逐个删掉 | `src/phones.ts:220-225`（daily 正则 `/^\d{4}-\d{2}-\d{2}\.log$/`，`src/config.ts:186`） |
| 它是**界面动作**，由用户在设置页触发 | `README.md:107`（电话表「客户端调宿主，清空」）、`INTEGRATION.md:212`「清空：在设置页放清空入口，调 `logClear`…」 |

**判它不是保留策略的四条理由：**

1. **没有「留多少」这个旋钮**。保留策略的本体是一条规则（留 N 个／留 N 天／总量不超过 M），本包不存在任何此类参数（判据 1 第 1.1 节的 7 键配置面）。
2. **不自动、不定时**。没有任何定时器会碰它（第 3.1 节的检索）；不写调用代码就永远不执行。
3. **粒度只有「某一天」和「全删」两种**，没有「保留最近 N 天」的表达能力——最接近的用法是调用方自己按天循环调 `logClear`，那是调用方在实现保留策略，不是本包提供保留策略。
4. **`'all'` 是全删**，没有下限保护、没有窗口概念。

它精确的身份是：**唯一的一条「手动清理手段」**，而票面第三条判据问的是「旧文件清理 / 保留策略」作为一个**能力**。手动清空可以提供「人能清理」这一半，但提供不了「系统自己按规则清理」这一半；本判据要判的是后者，故判 **无**。

（`logClear` 的一个计数口径问题：对一个**已不存在**的日期调用会回 `{"ok":true,"removed":1}`——因为 Node 文件服务把 `unlink` 的 `ENOENT` 吞成成功（`src/node.ts:79-86`）。探针 P4 实测。这是票 02 §4/Lead 复核已记录过的同一现象，本票只作交叉引用，不重复判定。）

## 3.3 三个子能力逐个交代（票面要求「哪几项缺失」）

| 子能力 | 有无 | 说明 |
|---|---|---|
| 自动轮转·按大小 | **缺** | 第 1 节 |
| 自动轮转·按时间 | **仅退化形态**（按天分桶），轮转动作全缺 | 第 2 节 |
| 旧文件自动清理 | **缺** | 第 3.1 节 |
| 保留策略（窗口/上限） | **缺** | 第 3.2 节 |
| 手动清理手段 | **有** | `logClear`（`date`／`'all'`），但它不是保留策略 |

**判据 3 判定：无。**

---

# 4. 对标：winston-daily-rotate-file（一级来源）

以下全部取自一级来源，逐条给 URL；未使用任何二手博客。注意两点版本事实：winston-daily-rotate-file 最新版为 **5.0.0**（`https://registry.npmjs.org/winston-daily-rotate-file/latest`：`"version":"5.0.0"`），它依赖 `file-stream-rotator: "^0.6.1"`；该系列自 2.0.0 起把轮转实现**外包给 file-stream-rotator**，所以「轮转与清理到底怎么做」要同时看两层：
- winston 层 README：<https://github.com/winstonjs/winston-daily-rotate-file#options>（原始文本 <https://raw.githubusercontent.com/winstonjs/winston-daily-rotate-file/master/README.md>）
- winston 层源码：<https://github.com/winstonjs/winston-daily-rotate-file/blob/master/daily-rotate-file.js>
- 实际执行轮转的库（winston 5.0.0 依赖的 `^0.6.1` 版本）：<https://github.com/rogerc/file-stream-rotator/blob/v0.6.1/FileStreamRotator.js>，README：<https://github.com/rogerc/file-stream-rotator#options>

| 能力 | 基准具体提供什么 | 默认值 | 出处 |
|---|---|---|---|
| **按大小切分** | `maxSize`：「Maximum size of the file after which it will rotate. This can be a number of bytes, or units of kb, mb, and gb」，数字会被折算成 `\"k\"` 串后交给 file-stream-rotator 的 `size` | `null`（不按大小切） | README `maxSize` 条；`daily-rotate-file.js` 的 `getMaxSize()` |
| **按时间切分** | 两条路：`datePattern`（moment 格式，切换发生在**写入时**比较格式化日期是否变化），与 `frequency`（`'#m'`／`'#h'`，README 原文「This is useful if you want to have timed rotations, as opposed to rotations that happen at specific moments in time」） | `datePattern` 默认 `'YYYY-MM-DD'`；`frequency` 默认 `null`（此时源码把 `frequency` 传成 `'custom'`，即纯按 `datePattern`） | README `frequency`／`datePattern` 条；`daily-rotate-file.js` 传给 `getStream` 的 `frequency`／`date_format` |
| **保留窗口（数量或天数）** | `maxFiles`：「Maximum number of logs to keep. If not set, no logs will be removed. This can be a number of files or number of days. If using days, add 'd' as the suffix. It uses auditFile to keep track of the log files in a json format. **It won't delete any file not contained in it.**」 | `null`（**不删任何东西**） | README `maxFiles` 条；`daily-rotate-file.js` 把 `maxFiles` 原样传给 `max_logs` |
| **压缩（归档）** | `zippedArchive`：rotate 事件里把旧文件 gzip 成 `<old>.gz`（存在则跳过），成功后 `unlinkSync` 原文件并发 `archive` 事件；`logRemoved` 分支也会连带删掉对应 `.gz` | `false` | README `zippedArchive` 条；`daily-rotate-file.js` 的 `if (options.zippedArchive)` 两段 |
| **切分后的命名/封存** | 名字带 `%DATE%` 占位符时，占位符换成 `datePattern` 的格式化结果（**追加式日期名**，与 dsh-log 的 `YYYY-MM-DD.log` 同族）；按大小切时，file-stream-rotator 「adds a count (1,2,3,4,...) at the end of the filename」，给了 `extension` 时计数插在扩展名之前；切换时旧流 `end()`（winston 传 `end_stream: true`），并新建写入流 | `filename` README 写默认 `'winston.log.%DATE%'`（**源码回退字面是 `"winston.log"`**，见下「存疑」） | README `filename`／`extension` 条；file-stream-rotator README「When it rotates a file based on size…」段；v0.6.1 源码 `newLogfile += "." + fileCount + options.extension` 与 `rotateStream.end()`／`destroy()` 分支 |
| **轮转可观测（事件）** | `new`（新文件创建）、`rotate`（`oldFilename, newFilename`）、`archive`（zip 文件名）、`logRemoved`（被删文件名）、`error`（5.0.0 起低层文件系统错误也发事件） | — | README「This transport emits the following custom events」段；`daily-rotate-file.js` 里的 `this.logStream.on("new"/"rotate"/"logRemoved")` 与 `this.emit("archive", …)` |
| **记账文件** | `auditFile`：「a file name is generated that includes a hash computed from the options object」；保留镜头靠它记账（只删账本里的文件） | `<dirname>/.<optionsHash>-audit.json` | README `auditFile` 条；`daily-rotate-file.js` 的 `audit_file: options.auditFile ? … : path.join(this.dirname, "." + hash(options) + "-audit.json")` |
| 其它可选项（仅列出，供比对） | `utc`（默认 `false`）、`createSymlink`／`symlinkName`（默认 `false`／`'current.log'`）、`options`（默认 `{ flags: 'a' }`，即**追加写**）、`auditHashType`（默认 `'sha256'`）、`level` | — | README Options 段 |

**保留窗口的两档语义（v0.6.1 源码，逐行可查）：**

- 数量档：`max_logs` 是纯数字时 `keep.days = false`，删旧时 `var filesToKeep = audit.files.splice(-audit.keep.amount)`，即**保留账本里最后 N 条**，其余逐条 `removeFile`（删前还要校验 `hash` 对得上）并发 `logRemoved`。
- 天数档：`max_logs` 末尾是 `'d'` 时 `keep.days = true`，删旧时 `var oldestDate = moment().subtract(audit.keep.amount,"days").valueOf()`，只保留 `date > oldestDate` 的记录，其余删掉并发 `logRemoved`。
- 未设 `max_logs` 时 `setAuditLog` 直接返回 `null`（**不建账本，也不删**）——与 winston README 的「If not set, no logs will be removed」一致。

**差距一句话版**：基准把「切分（大小/时间/频率）＋封存（关旧流、发事件）＋压缩（gzip 归档）＋保留（账本记账、按数量或天数删旧）」做成了一条**在一个 transport 里闭环的链路**；dsh-log 只有「按天换文件名」这一环，另外三环（大小、封存/事件、压缩/保留）**一环都没有**——第 1、2、3 节的检索与实测就是这三环为空的证据。

**升级建议指针（一句话，不展开）**：票面明确「方案选型是雾区，不在本票」，故此处只留指针——轮转实现本身属 `issues/01-untitled.md:61`（`## Out of scope` 段）明说的「超出自查」范围，选型与排期由后续升级建议票承接；本票只交付「现状 = 部分具备」这一实锤。

---

# 5. 与文档的出入

**先给结论：这一轴上文档与代码没有一处「说的和做的不一样」。** 本票逐条比对了 README 与 INTEGRATION.md 中所有涉及轮转/清理/文件切分的表述，**矛盾数 0**；有 4 条属「文档没写明」——文档说的是「不做」，但没量化「不做」的后果，这 4 条是本票新增的实锤。

| # | 文档说的 | 代码/实测 | 引用与性质 |
|---|---|---|---|
| U1 | 「**本包不做什么**…不自动轮转，也不自动清理旧文件」 | **成立，且比字面更严重**：不但不轮转不清理，单文件体积与单次刷盘的写入量都无界（10 轮刷盘写入量 500870→5008700），文档未量化这一点 | `README.md:34` vs `src/store.ts:367`、`:403`；探针 P2。性质：**未写明**（非矛盾） |
| U2 | 「每个自然天一个文件……只分桶，不自动清理」 | **成立**；但未写明「桶由**刷盘时刻**的时钟决定」这一机制，读者容易以为桶按行的时间戳或按建库时刻定 | `src/config.ts:141` vs `src/store.ts:394`、`src/store.ts:291`；探针 P3。性质：**未写明** |
| U3 | 「日志写在 `<cacheDir>/logs-<标识>/` 下**按天一个文件**」（`INTEGRATION.md:59`）、落点示例 `<cacheDir>/logs-your-program/2026-09-11.log`（`README.md:50`） | **成立**；但未写明跨午夜时**没有轮转事件、没有封存、旧文件一动不动**，长驻进程只会「悄悄多出一个文件」。调用方若想感知换文件，包内没有任何钩子 | `INTEGRATION.md:59`、`README.md:50` vs 实测（store 实例无 `on`/`emit`）、`src/store.ts:394`。性质：**未写明** |
| U4 | 清空被写成界面动作：「在设置页放清空入口，调 `logClear`（`date` 传某天或 `all`），回参的 `removed` 告诉用户删掉几个文件」 | **成立**；但文档从未说明「这就是本包清理能力的全部、不存在任何自动清理或保留上限」，也未把 `logClear` 与「保留策略」做区分 | `INTEGRATION.md:212`、`README.md:107` vs `src/phones.ts:212-260`、判据 3 的检索。性质：**未写明** |
| U5 | README 电话表把导出/清空/开关写成 5 个电话之一，且「多余字段忽略」 | **相符**，但有个可误读点：多传 `format:'zip'` 被**静默忽略**（不报警、不报错、不压缩） | `README.md:106`、`README.md:147` vs `src/phones.ts:115-116`。性质：**相符**（文档确有「多余字段忽略」，只是没说 zip 这种听起来该生效的字段也不生效） |

**同时核对相符、不算出入的断言**（逐条比对过）：

- 「不自动轮转，也不自动清理旧文件」（`README.md:34`）与代码表态「只分桶，不自动清理」（`src/config.ts:141`）**完全一致**，且被 40 天实测（探针 P1）与空转实测（探针 P4）坐实。
- 落点形状 `<cacheDir>/logs-<标识>/<当天>.log`（`README.md:50`、`INTEGRATION.md:59`）与实现一致（`src/config.ts:87-92`、`src/config.ts:142-146`；探针 P1 得到 `logs-demo/2026-09-01.log`）。
- 配置默认值表（`README.md:86-93`）7 键与生效配置 7 键一致，**且该表里本来就没有轮转/保留项**——探针 P5 实测生效配置键集合 = `{eventList, fileNamePolicy, logDirName, maxQueue, pluginId, prefix, switchFileName}`，与文档表逐项对齐。文档的「没有」与代码的「没有」是对上的。
- 冻结的 5 个电话名里没有轮转/保留相关电话（`src/config.ts:26`、`README.md:101`），即**接口面也没有为轮转留位**。
- `INTEGRATION.md:219`「多进程同时写同一个目录会写坏」与本票机制一致（同一目录同一天文件无写者隔离）；该现象本身见票 02 的 Lead 复核 M3 实测，本票只作交叉引用。

---

# 6. 待 Q5（本票不裁）

- 轮转/保留一旦要落地，绕不开「触顶时怎么办」：文件到量后是丢旧行、丢新行、还是拒绝写——这与队列满时丢不丢错误/告警是同一根问题。`issues/01-untitled.md:15` 与 `:54`（2026-10-10 02:10 复读；该处会随父图追加漂移，以段名+原文为准）都明说「队列满语义与门禁红黄待 R2，**影响级别/格式/轮转票口径**」。**本票凡涉及取舍一律不裁，标「待 Q5」。**
- 本票与技术选型无关的现状结论不受 Q5 影响：**没有大小切分、没有轮转事件、没有封存、没有压缩、没有自动清理、没有保留上限**——这些是「有／没有」的事实判定，与 Q5 的语义选择正交。

---

# 7. 未独立核验 / 存疑项

- **测试跑的是 `dist/`，不是 `src/`；构建在本仓跑不起来。** 与票 02、票 03 同款缺口：`tests/node.test.mjs:18` 动态 import `dist/node.js`；本仓 `node_modules` 只有 `typescript`，`build.mjs:16` 需要 esbuild，`node build.mjs` 在本 checkout 直接 `ERR_MODULE_NOT_FOUND`（票 02/03 已实测记录）。本票的实测数字同样全部来自 `dist/` 产物。可做的佐证是逐项比对产物与源码的机制一致：`dist/store.js:316`（刷盘时求文件名，对应 `src/store.ts:394`）、`dist/store.js:74`（计时器回退）、`dist/config.js:71`（`resolveLogFileName`）、`dist/config.js:220`（导出面）等，抽查均一致；**未做到字节级重生成比对**。
- **`dist` 与 `src` 的构建时间未在本票重新核对**（票 02 记为 `dist/*.js` 生成于 2026-10-07、晚于 `src` 最后修改 2026-10-04）。本票未复核该时间戳，直接沿用票 02 的结论并在此声明。
- **基准库未安装、未运行。** winston-daily-rotate-file（5.0.0）与它依赖的 file-stream-rotator（^0.6.1）本票只读了**一手 README 与源码**，没有在本机 `npm install` 跑一遍去观测真实行为。故第 4 节的「默认值」是**源码字面**的默认值，不是运行期观测值。
- **基准内部有两处文档/源码不一致，本票无法用运行期消解，只如实记录：**
  1. winston 层 README 写 `filename` 默认 `'winston.log.%DATE%'`，而 `daily-rotate-file.js` 在没有 `filename` 时的回退字面是 `"winston.log"`（且 `dirname` 缺省时会去 `path.dirname(options.filename)`）。本票按**源码**记录，并标注该差异属基准自身文档与源码的出入。
  2. file-stream-rotator 的 **master README** 写 `max_logs`「The default is 10 files」，而 **v0.6.1 源码**的文档注释写「If not set, it won't remove past logs」，`setAuditLog` 也在 `max_logs` 为空时直接返回 `null`。因为 winston 5.0.0 依赖的是 `^0.6.1`（不含 1.0.0），本票**以 v0.6.1 为准**：「不设 `maxFiles` 则不删」，与 winston 层 README 的「If not set, no logs will be removed」自洽。这一条是「本票未运行基准」的直接后果，列为存疑。
- **「手动清空算不算保留策略」是口径判断，不是事实判断。** 本票按「保留策略＝自动的、有上限的规则」判为「不算」（第 3.2 节四条理由）；若有人把「存在一种把旧文件去掉的手段」就叫保留策略，则本项应改记为「部分（仅手动）」。事实与证据不随口径变化。
- **一次 `writeBatch` 只解析一次文件名**（跨午夜的一批不会分裂到两个文件）是**读码所得**（`src/store.ts:394` 在批处理体内），本票未单独构造「一批跨越午夜」的实测。
- **未核验：真实宿主内的 `getCacheDir` 落点与多进程并发**。本票探针走 `dsh-log/node` 入口（`cacheDir` 由探针给）；宿主侧 `getCacheDir` 实现在宿主、不在本仓；多进程共写同一目录的实测在票 02 的 Lead 复核里（M3），本票未重做。
- **未核验：`four-segment` 策略下的「跨天」行为。** 该策略文件名含日期，故跨天同样会换文件，但它不是默认（`src/config.ts:99`），本票只按默认 `daily` 判。四段式的形状与清空/导出分支见票 02 §3。
- **不属于本票**：文件落盘/目录/按天文件形状/零丢失（票 02）、级别（票 03）、格式（票 05）、聚合（票 06）、链路追踪（票 07）、隔离（票 08）、追踪标识（票 09）。
- **引用 `issues/` 行号不可靠（2026-10-10 02:10 复核补记）**：父图与各子票在本轮多票并行取证期间被反复追加，同一句原文的行号已实测漂移两次（Q5 那句：`:41` → `:51` → `:54`）。本报告凡引用 `issues/` 一律给出**段名 + 原文**，行号只作辅助；复核时请以段名与原文为准。另经 deck 工具升级后复测（临时票 29/30 写路径实测，验完已删）：读路径不再重渲染、`progress` 补丁不再重复标题块（两处已修）；但 `patch` 传 `body` 仍会**抹掉 H1、幂等锚与 `parentKey` 注释**，且正文无 H1 时标题会被取成首个标题行——故改正文请勿传 `body`，改用 `comment` 或直接编辑文件。

---

# 8. 证据清单

## 8.1 读过的文件与行范围

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（**全文通读**；重点 26-31、40-79、102-165、239-267、268-298、300-366、367-411、412-415、460-474、477-497、533-550） |
| `src/config.ts` | 1-415（**全文通读**；重点 8-19、21-31、34-65、82-124、126-139、141-205） |
| `src/phones.ts` | 1-315（**全文通读**；重点 109-116、211-260、261-293、294-306、307-312） |
| `src/node.ts` | 1-195（**全文通读**；重点 20-26、60-96、98-103、111-127、136-194） |
| `src/host.ts` | 1-81（**全文通读**；重点 33-41、49-53、63-80） |
| `README.md` | 1-228（**全文通读**；重点 32-34、36-56、82-95、99-113、142-149、180、187-220） |
| `INTEGRATION.md` | 50-69、205-235（精读）＋ 全文正则检索（`轮转\|清理\|清空\|保留\|旧文件\|按天\|daily\|磁盘\|增长\|容量` 命中 7 处，逐处看过） |
| `package.json` | 1-39（全文，确认无运行期依赖、`files` 白名单、`test` 脚本） |
| `tests/node.test.mjs` | 1-60（精读）＋ 全文正则检索（`daily\|\.log\|formatDaily\|resolveLogFileName\|fileNamePolicy` 与 `轮转\|清理\|清空\|removed\|unlink`） |
| `tests/host.test.mjs` | 98-182（精读「串行不丢行」「命名规则」两例）＋ 全文正则检索同上；`:118-177`、`:179-219`、`:261-292` 由票 02/03 已记录，本票按检索确认其中**没有**轮转/清理断言 |
| `tests/client.test.mjs` | 全文正则检索（`轮转\|清理\|清空\|logClear\|removed\|delete\|unlink` 命中 `:64`、`:290-291`，均与轮转无关）；未逐行通读 |
| `tests/eventList.test.mjs` | 未逐行读，仅实跑（与本票判据无关，票 03 已通读） |
| `issues/01-untitled.md`、`issues/04-untitled.md`、`issues/10-ts.md`、`issues/02-untitled.md` | 相关行（口径与对标出处，实读于 2026-10-09 22:58：`01:6/14/15/34/49/51/58`——`:15` 在 `## Notes`（稳定），`:51` 在 `## Not yet specified`、`:58` 在 `## Out of scope`；`04:1-37`，Question 在 `:12`／`:14`；`10:24/26`；`02:72`）。**注**：`issues/` 下的票面文件正被 Lead 与各子票并发追加（每结一张票就往 `01` 的 Decisions 加一段），顶部 `## Notes` 段行号稳定、下半部分行号会漂移，故此处同时给出段名与原文 |
| `research/02-log-file-capability.md`、`research/03-log-level-capability.md` | 全文（体例对齐与跨票引用） |
| `dist/{config,store,node,phones,host}.js` | 只读产物，用于枚举导出面与实测（`dist/store.js:316` 与 `src/store.ts:394` 逐字同义） |
| `.local/selfcheck-04-rotation.mjs` | 全文（Lead 的独立探针，本票**只读并复跑**，未修改） |

## 8.2 测试（实跑，本仓）

| 命令 | 结果 |
|---|---|
| `node --test tests/node.test.mjs` | **9/9 通过**，`fail 0`，退出码 0（含「三件事齐备」「落点只由 cacheDir 决定」「目录由标识派生」「一行一条 JSON」「写盘失败只计数」五类） |
| `node --test tests/eventList.test.mjs` | **14/14 通过**，`fail 0`，退出码 0 |
| `tests/host.test.mjs`、`tests/client.test.mjs` | **本仓跑不起来**（引用父仓旧路径，票 02/03 已定位：`tests/host.test.mjs:15`、`tests/client.test.mjs:19`），本票未重跑 |

**覆盖轮转/清理的测试：一条都没有。** 对 `tests/*.test.mjs` 全文检索 `轮转\|清理\|清空\|removed\|logClear\|delete\|unlink`，命中仅：`tests/host.test.mjs:123`（电话名映射表里的 `logClear` 字面）、`:284-285`（清空**失败**时记一行 `host.call.fail`，与文件是否真被删无关）、`tests/client.test.mjs:64`（同款电话名映射）、`tests/node.test.mjs:175`、`tests/client.test.mjs:290-291`（与本票无关）。即：**没有任何测试断言过轮转、文件切分或清理效果**；票 02 记录的「按日期清空 removed=1」也来自探针而非测试。

## 8.3 本票只读探针

脚本：`D:\Temp\probe-rotation-04.mjs`（**系统临时目录，未写仓库任何文件**），跑 `dist/` 产物，日期用 patch `globalThis.Date` 的无参构造与 `Date.now()` 模拟，落盘走**真实 `dsh-log/node` 入口**（`createNodeHostLog`），根目录 `D:\Temp\dsh-probe04-*` 用后即删。

| 探针 | 做法 | 关键结果 |
|---|---|---|
| P0 接口面 | 枚举入口与 store 实例的键、查事件接口 | 入口键 `["store","phoneNames","ready"]`；store 键 16 个，无轮转相关；`on`/`once`/`emit`/`addListener` **全为 `undefined`** |
| P1 跨 40 天 | 模拟 40 个连续自然天，每天写一行并刷盘 | 日志目录 **40 个文件**：`2026-09-01.log` … `2026-10-10.log`；非 `.log` 后缀产物 **0 个**；最早那天**仍在** |
| P2 单日 5MB | 同一天分 10 轮刷盘、每轮 10 行 × 约 50 KB | 仍是**同一个文件**（`2026-10-09.log`，5,008,700 字节）；无 `.1`/`.2` 计数后缀；每轮 `writeText` 收到的全文长度 **500870 → 5008700**（线性增长，即每轮整份重写） |
| P3 跨午夜 | 同一实例 23:59 写一行刷盘，00:01 再写一行刷盘 | 前 `2026-10-09.log`(81B)、后 `2026-10-09.log`(81B)+`2026-10-10.log`(80B)；旧文件**字节/mtime/inode 三项逐一同前**；旧文件内容仍是那行 JSON |
| P4 清理只能手动 | 建 5 个旧文件，不调电话空转 300 毫秒；再分别清某天与清 `all` | 空转后 `5 -> 5`（一个不删）；`logClear({date:'2026-06-03'})` → `{"ok":true,"removed":1}`；`logClear({date:'all'})` → `{"ok":true,"removed":4}` 后目录空；对已不存在的日期 → `{"ok":true,"removed":1}` |
| P5 导出面与配置面 | 枚举 `dist/config.js`（23 导出）、`dist/store.js`（6 导出）、生效配置键 | 按轮转/保留词表过滤 **0 命中**；对照常量 `DEFAULT_MAX_QUEUE`／`LOG_DEBOUNCE_MS`／`CLIENT_QUEUE_MAX` **存在**；生效配置键 = `{eventList, fileNamePolicy, logDirName, maxQueue, pluginId, prefix, switchFileName}` |

**交叉复核（Lead 的独立探针，只读复跑）**：`.local/selfcheck-04-rotation.mjs` 走「注入文件服务 + `createLogStore`」的另一条路径，P1（跨 3 天 3 个文件）、P2（30 行 × 20 KB → 单文件 602590 字节）、P3（同日 12 次刷盘仍 1 文件）、P4（午夜换文件）、P6（清某天 removed=1；清 all removed=1／2）、P7（相隔 38 天的两个文件空转 300 毫秒后仍在）**逐条与本票同向**。
一处需说明的订正：本票**首次**复跑该探针时，`logClear({date:'all'})` 曾回 `removed:0`，而同一探针随后复跑回 `removed:1`／`2`。差异出在**探针桩**而非包行为——首次复跑时该脚本正处于编辑中间态（`resolve` 已返回目标对象、`listDir` 仍按字符串取值，`readdir` 拿到目标对象后抛错被吞成空目录），补齐目标对象解盒后即与「清某天」一致。包内的 `listDir` 走 `src/phones.ts:73` 的 `resolveTarget` 再交给文件服务（`src/phones.ts:59-81`），本票探针 P4 走真实 Node 文件服务，`'all'` 回 `removed:4` 与目录清空一致。

## 8.4 可复跑检索（本票负证据的原文命令与结果）

工作区 `D:\dsh-plugin\dsh-log`，全部只读：

| 命令 | 结果 |
|---|---|
| `git grep -n -i -E 'rotate\|rotation\|retention\|maxfiles\|maxsize\|maxage\|sizelimit\|maxbytes\|compress\|gzip\|archive' -- . ':(exclude)node_modules'` | **零命中**（退出码 1） |
| `git grep -n -E '轮转\|清理\|保留策略\|旧文件\|过期' -- . ':(exclude)node_modules' ':(exclude)research'` | **3 处**：`README.md:34`（不自动轮转/清理）、`src/config.ts:141`（只分桶，不自动清理）、`build.mjs:6`（「过期」，说的是 dist 过期，与本票无关） |
| `git grep -n -i -E 'zip\|压缩' -- . ':(exclude)node_modules' ':(exclude)package-lock.json'` | **1 处**：`src/phones.ts:115`（`format:'zip'` 被忽略） |
| `git grep -n -E 'setInterval\|setTimeout\|cron' -- src dist tests` | 仅 `setTimeout`（防抖与看门狗），**`setInterval`／`cron` 零命中** |
| `git grep -n -E '\bstatSync\b\|\bstat\(\|\.size\b\|byteLength\|fs\.stat\|getFileSize\|fileSize' -- src dist` | **零命中**（退出码 1） |
| `git grep -n -E 'rename\|appendFile\|createWriteStream\|open\(.*a' -- src dist` | **零命中**（退出码 1） |
| `git grep -n -E '%DATE%\|audit\|suffix\|计数器\|序号' -- src dist` | **零命中**（退出码 1） |
| `git grep -n -e "maxFiles" -e "maxSize" -e "maxAge" -e "zippedArchive" -e "datePattern" HEAD` | **仅 2 处**，都在 `node_modules/typescript/lib/lib.dom.d.ts:16749`、`lib.webworker.d.ts:4403`（DOM 的 `setResourceTimingBufferSize`），本包自有文件零命中 |
| `git grep -n -E 'handleLogClear\|deleteOneFile\|logClear' -- src dist` | 删除路径闭包：`src/phones.ts:212/223/229/242/246/251/261/309` ← `src/store.ts:522-524/547` ← `src/host.ts:68/72`；**无任何内部或定时调用点** |
| `git grep -n -E 'unlink' -- src` | `src/store.ts:45`、`src/store.ts:63`（仅类型声明，引擎**不调用**）、`src/phones.ts:266-276`（手动清空）、`src/node.ts:20/79/81`（Node 文件服务实现）、`src/node-ambient.d.ts:15`（声明） |
| `git grep -n -E 'flushNow\|scheduleFlush' -- src` | 全部与**刷盘**有关（`src/store.ts:132/296/297/300/310/314/326/330/363/538`、`src/node.ts:155/183`）；**没有任何一处被用来换文件或清理** |
| `git log --oneline --all -S"rotate" -- src dist README.md INTEGRATION.md` | **空**——轮转从未在本仓历史里出现过 |
| `git rev-list --count HEAD` | 4（历史很短，进一步支持「不是删掉的老功能」） |
| `node -e "import('file:///D:/dsh-plugin/dsh-log/dist/config.js').then(m=>console.log(Object.keys(m).sort().join('\n')))"`（同法枚举 `store.js`） | 23 / 6 个导出，见第 1.3 节清单 |

## 8.5 基准侧来源（URL）

- <https://github.com/winstonjs/winston-daily-rotate-file#options>（README；原始文本 <https://raw.githubusercontent.com/winstonjs/winston-daily-rotate-file/master/README.md>）
- <https://github.com/winstonjs/winston-daily-rotate-file/blob/master/daily-rotate-file.js>（`maxSize` 折算、`zippedArchive` 两段、事件转发、`audit_file` 默认值）
- <https://registry.npmjs.org/winston-daily-rotate-file/latest>（版本 5.0.0；`dependencies.file-stream-rotator = "^0.6.1"`）
- <https://github.com/rogerc/file-stream-rotator/blob/v0.6.1/FileStreamRotator.js>（`max_logs` 数量档 `splice(-amount)`、天数档 `moment().subtract(amount,'days')`、大小档计数后缀 `newLogfile += "." + fileCount + options.extension`、维护 `rotate`/`logRemoved` 事件、`setAuditLog` 在未设 `max_logs` 时返回 `null`）
- <https://github.com/rogerc/file-stream-rotator#options>（`size`／`max_logs`／`extension` 的说明与「计数加在文件名末尾」的例子）

**报告位置说明（仓库约定）**：姊妹票已按票号在 `research/<NN>-<slug>.md` 建好系列约定（`research/02-log-file-capability.md`、`research/03-log-level-capability.md`），本报告沿用，落在 `research/04-log-rotation-capability.md`。本报告与全部探针均未改动任何源码、测试、README、`issues/` 下的文件；探针脚本只写在系统临时目录 `D:\Temp\`，`dist/` 为只读使用。
