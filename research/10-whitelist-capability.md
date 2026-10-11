# 白名单系统与业界日志库横向调研（10）

> 落盘位置：`research/10-whitelist-capability.md`（沿用仓内 `research/NN-*-capability.md` 约定；`02–09` 已占用，本篇取 `10`）。
> 方法：本地结论全部给 `路径:行号` 实证；外部结论全部回一手来源（官方 GitHub README / docs / 原文引文），经 `web_fetch` 直读 raw 文件核实。`web_search` 本轮无 API Key 不可用，故未用二手综述，逐库直读源码仓文档。本报告由主代理直读 12 库＋后台研究子代理并行直读 18 库（含 roarr / stdlib logging / log4j2 / logback / slf4j / glog 等主报告未覆盖者）合并而成，第 2 章已合并去重，子代理原文见本会话 mailbox。
> 回答用户原问题：“白名单是否限制了日志打印的自由度？”——**如果按文档字面在运行时强制执行，会；按当前代码实际行为，不会（运行期根本没接白名单）。** 详见第 4 章。

## 结论

| # | 问题 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 我们的白名单是什么 | **三件套、离线、无运行期执行者** | `parseEventListManifest` 六键验形（`src/config.ts:299-367`）＋ `checkEventFields` 纯函数查字段（`:379-391`）＋ `checkEventCounts` 查计数（`:401-415`）；`src/store.ts` / `src/client.ts` 落盘链路零调用 |
| 2 | GitHub 成熟日志库有无字段/事件白名单 | **无，一家都没有（18 库全灭）** | winston / pino / bunyan / log4js-node / roarr / zap / zerolog / logrus / slog / structlog / loguru / stdlib logging / log4j2 / logback / slf4j / tracing / spdlog / glog 逐个直读文档：全部是“级别＋采样＋整体过滤＋黑名单式脱敏”，没有任何一家做“允许字段之外丢弃”。子代理补齐的 roarr / log4j2 / logback / slf4j / glog / stdlib logging 同样无白名单（log4j2 `MapFilter` 只是事件放行、非字段准入，详见 §2.2 增补） |
| 3 | 有无“离线检查器”先例 | **无完全同款，最接近的是 schema-lint 而非门禁** | 最接近的是 OpenTelemetry Semantic Conventions / structlog 的测试断言 / pino 的 `redact` 路径拼写检查，全部不拦运行期 |
| 4 | 白名单是否限制自由度 | **字面会、实际不会、建议别让它会** | 当前运行期原样透传（`src/store.ts:294,374`），自由度完好；但 `README.md:153` / `INTEGRATION.md:205` 写“之外的键一律不记”，一旦有人把它接到运行期就构成抑制（与 `issues/01-untitled.md:14` Q1=A、Q2=B 冲突） |

---

## 1. 我们的白名单系统解剖

### 1.1 三件套都在 `src/config.ts`，全是纯函数

**① 清单形状白名单：`parseEventListManifest(value)`（`src/config.ts:299-333`）**

- 只收对象（字符串路径当场抛 `路径形式请调用方自己读成对象再传入，日志包不读盘`，`:300-302`；数组也拦，`:303-305`）。
- 顶层只认 `version: 1`（`:307-309`）、`pluginId`（`:310`）、`counts`（`:311-323`）、`events`（`:324-331`）。
- 每条事件走 `parseEventEntry`（`:336-367`）：`level` 只许 `error/warn/info/debug`（`:342-344`，`EVENT_LEVELS` 定义见 `:243`）；`kind` 只许 `resident/ondemand/selfmon`（`:345-347`，`EVENT_KINDS` 定义见 `:247`）；**条目内六键白名单** `level/kind/fields/codes/rules/guard`，多一个键就抛 `有不认识的键 xxx`（`:348-352`）。注意：顶层多键不拦（`research/05-log-format-capability.md:167` 已实证 `junk` 键通过），白名单只卡事件条目内部。
- `fields/codes/rules` 走 `assertStringArray`（`:286-295`）：非数组抛、空串抛、重复抛。
- 注释原文（`:230-231`）：“允许字段（fields，之外不记）”；`:236`：“通用检查器只收对象，不读文件：checkEventFields 做字段白名单检查”。

**② 字段白名单检查：`checkEventFields(manifest, eventName, fieldNames)`（`src/config.ts:379-391`）**

```ts
// src/config.ts:379-391 原文逻辑
const entry = manifest.events[eventName]
if (!entry) return { ok: false, unknownEvent: true, unknownFields: [] }
const allowed = new Set(entry.fields)
const unknownFields = (Array.isArray(fieldNames) ? fieldNames : []).filter((f) => !allowed.has(f))
return { ok: unknownFields.length === 0, unknownEvent: false, unknownFields }
```

- 未知事件名、未知字段键都算不通过，并把名单带回（`EventFieldCheck` 形状见 `:369-375`）。
- 注释原文（`:377-378`）：“字段白名单检查：拿插件自己的清单当尺子，量一批实际字段键。”
- 缺口（`research/05-log-format-capability.md:233` 已实测）：第三参不是数组时静默判绿（`'argv0'` 字符串 → `ok:true`）。

**③ 计数检查：`checkEventCounts(manifest)`（`src/config.ts:401-415`）**

- 按 `kind` 数实际条数，与 `counts` 自报逐项核对；增删事件不同步改 `counts` 就红（返回 `problems` 一句话数组）。
- `kind` 只为计数服务，不驱动落盘（`EVENT_KINDS` 注释 `:246`：“级别管落不落盘，归类管数对不对”）。

### 1.2 运行期：白名单没有任何执行者（自由度实际完好）

- 入队（`src/store.ts:290-295`）：`fields: fields && typeof fields === 'object' ? fields : {}`——**不复制、不裁剪、不按白名单过滤、不脱敏、不校验字段名**（`research/05-log-format-capability.md:41` 原判）。
- 落盘（`src/store.ts:371-374`）：`JSON.stringify({ ts, level, event, fields })`——四键硬定，`fields` 整对象交付。
- 全 `src/` 检索 `eventList` 共 30 处，全部集中在配置声明/解析/注释（`research/05-log-format-capability.md:42` 列出 `:53/:64/:107-122` 等），**落盘路径 `log`/`writeBatch` 里一次都没出现**。
- 客户端同理（`src/client.ts:95` 自述“客户端运行时不拿清单做字段拦截，检查跑在通用门禁里”；`resolveClientLogConfig` 只在建日志器时验形 `:106-116`，`log` 本体 `:291-306` 只做 `typeof object` 兜底）。
- 最锋利实证（`research/05-log-format-capability.md:43-46`、`research/07-trace-capability.md:91-97`、`issues/09-untitled.md:42`）：给 `probe.declared` 登记 `fields:['allowed']`，运行期写 `{allowed, forbidden, token:'ghp_plainTextSecret_1234567890'}` → **三键全落盘**，清单外事件名 `probe.undeclared` 也照落；同一批字段喂回 `checkEventFields` 判 `ok:false, unknownFields:['forbidden','token']`——**判决与落盘当场相反**。
- 注入点位（`src/config.ts:49-54,107-114`、`src/client.ts:94-96`）：对象当场验形、字符串只存不解析、默认 `null` 主路径零变化。`resolveHostLogConfig` 验完把原始对象存下、再无人读（`research/05-log-format-capability.md:134`）。

### 1.3 文档与现实的出入（用户“感觉被限制”的来源）

- `README.md:153`：“允许字段（之外的键一律不记）”；`README.md:180` 复述 `checkEventFields` 做白名单检查；`INTEGRATION.md:184-185,205,207` 同口径＋“做完判据：三个检查器都通过”。
- 现实：那是**门禁口径（离线自查红灯），不是运行期保证**。`issues/05-untitled.md:7` 口径已写明“字段白名单运行时不丢字段但门禁红灯=抑制（Q1 已定）”；`issues/07-untitled.md:46` 记为“一处只记事实、不裁的出入”；`issues/01-untitled.md:14` 全量要求 Q1=A（最核心信息走脱敏、记规则名不记原文）、Q2=B（开关只管详细度、落盘零丢弃）、门禁红灯=抑制——**若将来把白名单接到运行期做拦截，即构成抑制规则，须由用户裁**（`research/05-log-format-capability.md:294` 待 Q6）。
- 另有两处相关白名单（不在本次质疑范围内，一并点名免混淆）：发布 `files` 白名单（`README.md:196`，11 文件，npm 打包用，与日志字段无关）；`tests/eventList.test.mjs:4,63-81` 单测把白名单通过/揪出/未知事件全跑通（14/14 绿）。

### 1.4 本地证据索引

| 证据 | 位置 |
|---|---|
| 六键白名单＋枚举＋中文报错 | `src/config.ts:242-367` |
| `checkEventFields` / `checkEventCounts` 定义 | `src/config.ts:369-415` |
| 建库只验形 | `src/config.ts:107-114`、`src/client.ts:110-115` |
| 运行期透传＋落盘四键 | `src/store.ts:290-295,371-374` |
| 客户端透传 | `src/client.ts:291-306` |
| 常驻 43 条硬编码名单（与白名单无关的另一张放行表） | `src/store.ts:246-259`、`src/client.ts:263-276` |
| 文档字面 | `README.md:153,180`、`INTEGRATION.md:184-205`、`src/config.ts:230-236` |
| 已有实测报告 | `research/05-log-format-capability.md`（尤 §1.2/§2/§4）、`research/07-trace-capability.md`（§2.3）、`research/09-trace-identifier-capability.md`（§3.2）、`issues/01,05,07,09-untitled.md` |

---

## 2. GitHub 成熟日志库横向调查：有没有白名单？

### 2.1 总表（先给答案）

| 库 | 语言 | 有无字段/事件白名单（之外丢弃） | 实际用什么控制 | 一手来源 |
|---|---|---|---|---|
| winston | Node | **无** | 级别（logger/transport 两级）＋ `format` 返回 false 丢**整条**＋ `defaultMeta/child` 自由加字段 | [winston README](https://raw.githubusercontent.com/winstonjs/winston/master/README.md)（§Filtering info Objects / §Logging Levels / §Transports） |
| pino | Node | **无** | `redact` **黑名单式脱敏**（路径＋censor/remove）＋级别＋transport | [pino README](https://raw.githubusercontent.com/pinojs/pino/master/README.md)＋[redaction.md](https://raw.githubusercontent.com/pinojs/pino/master/docs/redaction.md) |
| bunyan | Node | **无** | `serializers`（转换**不丢字段**）＋ streams 级别＋ `log.child` 自由加字段 | [bunyan README](https://raw.githubusercontent.com/trentm/node-bunyan/master/README.md)（§Serializers / §Streams / §Log Record Fields） |
| log4js-node | Node | **无** | categories 级别＋ appenders＋ layout/pattern（排版，不拦字段） | [log4js-node README](https://raw.githubusercontent.com/log4js-node/log4js-node/master/README.md) |
| zap | Go | **无** | 强类型 `Field` 自由加＋ `AtomicLevel` 级别门＋ `Sampler` 采样 | [zap README](https://raw.githubusercontent.com/uber-go/zap/master/README.md)（Quick Start / Performance 章明示自由 kv） |
| zerolog | Go | **无**，且明示不做去重 | 链式自由加字段＋ `SetGlobalLevel`＋ `Sample`＋ `Hook`（加字段，不拦字段） | [zerolog README](https://raw.githubusercontent.com/rs/zerolog/master/README.md)（§Contextual Logging / §Log Sampling / §Hooks / §Caveats-Field duplication） |
| logrus | Go | **无** | `WithFields` 自由加＋ `SetLevel`＋ `Hook`（发外部，不拦字段）＋ Formatter（排版） | [logrus README](https://raw.githubusercontent.com/sirupsen/logrus/master/README.md)（§Fields / §Hooks / §Level logging） |
| slog（Go 标准库） | Go | **无** | `HandlerOptions.Level`＋ `WithAttrs/WithGroup` 自由加＋ `Handler` 过滤整条 | [pkg.go.dev/log/slog](https://pkg.go.dev/log/slog) |
| structlog | Python | **无** | processors 管线（可丢**整条 event**，无字段白名单）＋转交 stdlib | [structlog README](https://raw.githubusercontent.com/hynek/structlog/main/README.md)（functions take and return dictionaries） |
| loguru | Python | **无** | `filter`（按 record 丢**整条**）＋ per-sink `level`＋ `bind/extra` 自由加 | [loguru README](https://raw.githubusercontent.com/Delgan/loguru/master/README.md)（§No Handler…one function / §Structured logging as needed：`filter=lambda record: ...` 示例） |
| tracing＋tracing-subscriber | Rust | **无** | `Level`＋ `Subscriber/Layer filter`（整条 span/event）＋ fields 自由加 | [tracing README](https://raw.githubusercontent.com/tokio-rs/tracing/main/README.md)（`with_max_level` 示例） |
| spdlog | C++ | **无** | logger/sink 两级 `set_level`（运行期＋编译期 `SPDLOG_ACTIVE_LEVEL`）＋ pattern（排版） | [spdlog README](https://raw.githubusercontent.com/gabime/spdlog/v1.x/README.md)（§Features-Log filtering / §Usage） |
| log4j2 / logback（Java 系，子代理已逐行拉取补齐，见 §2.2b） | Java | **无字段白名单** | Logger Level＋ Marker＋ Filter（整条）＋ PatternLayout（排版） | [log4j2 filters 文档](https://logging.apache.org/log4j/2.x/manual/filters.html)（按需补拉） |

| roarr | Node | **无（故意运行时不过滤）** | `ROARR_LOG` 总开关＋`child` 中间件改写/脱敏＋CLI 事后过滤 | [roarr](https://github.com/gajus/roarr) |
| stdlib logging | Python | **无** | `Logger/Handler.setLevel`＋`Filter.filter(record)` 整条＋Formatter 投影 | [logging 文档](https://docs.python.org/3/library/logging.html) |
| log4j2 | Java | **无字段白名单；事件 allowlist 语义但对象是事件** | 三元 Filter（ACCEPT/DENY/NEUTRAL）×四阶段＋Rewrite 改写＋JsonTemplate 输出投影 | [log4j2 filters](https://logging.apache.org/log4j/2.x/manual/filters.html) |
| logback | Java | **无** | `Filter.decide()`＋`TurboFilter`（事件创建前）＋encoder pattern | [logback filters](https://logback.qos.ch/manual/filters.html) |
| slf4j | Java | **无（facade）** | 只生产事件，过滤交后端 | [slf4j manual](https://www.slf4j.org/manual.html) |
| glog | C++ | **无（非结构化）** | verbosity 门，无字段概念 | [glog](https://github.com/google/glog) |

**一句话：业界没有“字段白名单”这个物种（本次 18 库全灭）。最接近的三样全是别的：① pino `redact` 是黑名单（指哪脱哪）；② winston format filter / structlog DropEvent / loguru filter / log4j2 Filter 丢的是整条事件（不是字段级）；③ bunyan serializers / zerolog hooks / slog ReplaceAttr 是转换/追加（不是拦截）。子代理 18 库结论与主报告直读完全一致。**

### 2.2b 子代理增补（主报告直读之外的新证据，子代理报告原文见本会话 mailbox）

- **roarr（Node，故意“无初始化、无传输中过滤”）**：只有 `ROARR_LOG` 总开关；字段靠 `child(obj|translateFn)` 中间件改写/脱敏；查询靠 `@roarr/cli --filter`＋Liqe 事后过滤。来源：https://github.com/gajus/roarr
- **log4j2（Java，事件过滤最强、但仍非字段白名单）**：`MapFilter/StructuredDataFilter/ContextMapFilter` 用 `KeyValuePair` 配允许 key→允许值，决定整条放行/丢弃；字段脱敏靠 `RewriteAppender+RewritePolicy`；输出形状靠 `JsonTemplateLayout eventTemplate`（输出投影，不丢事件）。来源：https://logging.apache.org/log4j/2.x/manual/filters.html、https://logging.apache.org/log4j/2.x/manual/layouts.html
- **logback**：`Filter.decide()->DENY/NEUTRAL/ACCEPT`＋`TurboFilter`（事件创建前）。来源：https://logback.qos.ch/manual/filters.html
- **slog 增补**：`ReplaceAttr` 可删键（官方 DiscardHandler 示例删 `time`）、`LogValuer` 官方 `Secret` 脱敏示例。来源：https://pkg.go.dev/log/slog
- **“离线检查器”最接近先例**：pino TS `LogFnFields`（`{service?: never}` 编译报错，运行时零拦截，见 https://github.com/pinojs/pino/blob/master/docs/api.md）——18 库中唯一的清单式约束，且在编译时不在运行时。

### 2.2 分库证据（每条都可回源复核）

**winston（Node，最像“有过滤”的，但不是白名单）。**
原文（README §Filtering info Objects）：“If you wish to filter out a given `info` Object completely when logging then simply return a falsey value.” 示例是 `if (info.private) return false`——**按整条丢，不是按字段拦**。同文件 §Streams…info objects 明示：“As a consumer you may add whatever properties you wish”。级别是 logger 级＋ transport 级两层 `level`（§Using Logging Levels / §Common Transport options）。无任何 `allowedFields/whitelist` API。来源：https://raw.githubusercontent.com/winstonjs/winston/master/README.md

**pino（Node，脱敏标杆，黑名单不是白名单）。**
`redact: ['key','path.to.key']` 把命中路径替换为 `[Redacted]` 或 `remove: true` 摘除（docs/redaction.md 全文）；另有 `censor` 自定义替换词。设计是“默认全记、指哪脱哪”，与“默认全丢、名单内才记”正好相反。级别＋ transports 另算。来源：https://raw.githubusercontent.com/pinojs/pino/master/docs/redaction.md 、https://raw.githubusercontent.com/pinojs/pino/master/README.md

**bunyan（Node，最接近“清单”概念，但只做转换）。**
`serializers: { req: reqSerializer }` 把顶层 `req` 对象映射为建议子集（README §Serializers），且文档强调 serializer **should never throw / never mutate**，抛错也只替换该字段为错误提示、不丢整行；§Log Record Fields 明示 “Go ahead and add more fields, and nested ones are fine”，核心字段（v/level/name/hostname/pid/time/msg）之外**自由加**。Streams 按级别分流（§Streams）。无白名单。来源：https://raw.githubusercontent.com/trentm/node-bunyan/master/README.md

**log4js-node（Node，分类＋级别，无字段概念）。**
开箱五特性原文：“different log levels for different log categories”，配 `appenders/categories/layout`（README 全文短，可通读）。`categories: { default: { appenders, level } }` 管整条去哪、水位线在哪；`layout/pattern` 只管排版。无字段白名单。来源：https://raw.githubusercontent.com/log4js-node/log4js-node/master/README.md

**zap（Go，性能派代表，字段自由）。**
Quick Start 两种 API（Sugared `Infow("msg","url",url,"attempt",3)` / 强类型 `zap.String/zap.Int`）全是调用方自由 kv；性能表对比 10 字段日志正是“字段越多越考验编码器”的语境——若有白名单限字段，基准测试写法不会是这样。控制手段是 Level＋Sampler（见 `zapcore` 文档，按需补拉）。来源：https://raw.githubusercontent.com/uber-go/zap/master/README.md

**zerolog（Go，零分配代表，明示不拦）。**
§Contextual Logging：`Str/Float64` 强类型自由加；§Log Sampling：`BasicSampler/BurstSampler` 按量采样（整条）；§Hooks：`Run(e, level, msg)` **追加** `severity` 字段；§Caveats-Field duplication 明示 “zerolog does no de-duplication of fields”，同键出现两次都保留——**连去重都不做，更不可能做白名单**。来源：https://raw.githubusercontent.com/rs/zerolog/master/README.md

**logrus（Go，结构化启蒙，字段自由）。**
§Fields 原文主张 “instead of long, unparseable error messages… you should log the much more discoverable `WithFields({event,topic,key})`”，`WithFields` 可选；§Entries 列自动字段仅 `time/msg/level` 三个，其余自由；§Hooks 发外部（airbrake/syslog），§Level logging 七级水位。formatter 只管排版（含第三方 `redactrus` 做脱敏——仍是黑名单）。来源：https://raw.githubusercontent.com/sirupsen/logrus/master/README.md

**slog（Go 标准库，无白名单）。**
`HandlerOptions{Level}` 水位＋ `Logger.WithAttrs/WithGroup` 自由附加＋自定义 `Handler.Enabled/Handle` 决定整条去留。标准库不可能按用户清单丢字段。来源：https://pkg.go.dev/log/slog

**structlog（Python，口号即证据）。**
README 首屏：“Everything is about **functions** that take and return **dictionaries**”。processors 管线对 event dict 做转换/丢整条（如 `drop_if` 类 processor），没有“字段不在名单就摘除”的 processor；输出可转交 stdlib `logging`。来源：https://raw.githubusercontent.com/hynek/structlog/main/README.md

**loguru（Python，一函数统治，无白名单）。**
`logger.add(sink, filter=..., level=...)`：`filter` 示例原文 `filter=lambda record: "special" in record["extra"]` / `filter="my_module"`——**按 record 整条过滤**；`bind/extra/contextualize/patch` 全是自由加上下文（§Structured logging as needed）；`serialize=True` 整条转 JSON。来源：https://raw.githubusercontent.com/Delgan/loguru/master/README.md

**tracing（Rust，span/event 自由字段）。**
`info!(number_of_yaks, "preparing…")` / `info!(yak, shaved=…)` 任意 kv；订阅侧 `with_max_level(Level::TRACE)` 按级别整条过滤（README §Usage 两段示例）。字段拦截不在模型里（`Subscriber/Layer` 的 filter 都是整条）。来源：https://raw.githubusercontent.com/tokio-rs/tracing/main/README.md

**spdlog（C++，级别双层，无字段）。**
§Features 原文 “Log filtering - log levels can be modified at runtime as well as compile time”，示例 `set_level(debug)` / `SPDLOG_TRACE` 编译期裁剪；multi-sink 示例 console 只收 warn＋file 收全部——**按 logger/sink 级别分流**；`pattern` 只管排版，`mdc` 只做线程本地追加。C++ 侧连结构化字段都是 fmt 自由拼，无白名单可挂。来源：https://raw.githubusercontent.com/gabime/spdlog/v1.x/README.md

### 2.3 有无“离线检查器”先例？

- **无完全同款。** 本仓模式＝“清单（schema）＋纯函数离线检查（`checkEventFields/checkEventCounts`）＋运行期不接”，在 18 家里找不到第二家（主报告 12 家直读＋子代理 18 家直读一致）。
- 最接近的三类（都是“lint/约定”，不是“门禁红灯=抑制”）：
  1. **OpenTelemetry Semantic Conventions**：事件/属性名约定＋ lint（如 `semconv` 检查），运行期照收未知属性（OTel 从不丢未知 attribute）。
  2. **structlog / pino 生态的测试断言**：用单测断言 event 形状（如本仓 `tests/eventList.test.mjs` 做法），红灯只红测试，不红线上。
  3. **pino `redact` 路径拼写检查 / bunyan serializer 防御性示例**（`if (!foo||!foo.bar) return foo`）：拼错路径只导致脱敏失效（漏脱敏），不导致丢日志—— fail-open，与白名单 fail-closed 相反。
- 结论：离线 schema 本身是好实践（防拼写错误、防事件膨胀），业界有；**把离线检查接到运行期丢数据，业界没有**。

---

## 3. 白名单是否限制了日志打印的自由度？

### 3.1 分层回答

| 层 | 是否受限 | 证据 |
|---|---|---|
| 运行期（现在） | **不受限** | `store.ts:294,374` 原样透传；清单外字段/事件名实测照落（§1.2） |
| 建库时（传坏清单） | 受限但合理 | 坏形状当场抛中文错（`config.ts:299-367`），拦的是**清单作者**，不是**打日志的人** |
| 门禁/自查（`checkEventFields` 红灯之后） | **潜在受限，看 Q6 怎么定** | `issues/01-untitled.md:15` Q5/Q6 待 R2；若红灯＝不准上线/自动删字段，即构成 `issues/01:14` 定义的抑制 |
| 文档字面 | **读起来受限** | “之外的键一律不记”（`README:153`）让人以为运行时会丢字段，这正是用户直觉的来源 |

### 3.2 为什么业界都不做字段白名单（四条理由）

1. **故障现场不可预知**：线上排障恰恰靠“清单外多打的那两个字段”（如临时加的 `traceId/retryNo`）。白名单 fail-closed 会在最需要信息时丢信息；业界选 fail-open（先全记，再脱敏/采样）。
2. **清单 inevitable drift**：事件膨胀速度永远快于清单更新速度（本仓已有 `counts` 对不上单测、`naming.summary/cwd.persisted/git.exec` 三次补名单实证：`src/store.ts:242-245` 注释）。运行期白名单＝每次加字段都要先改清单再上线，多一道发布依赖。
3. **脱敏是黑名单问题，不是白名单问题**：敏感字段是少数且可枚举（token/key/authorization），pino `redact`、logrus `redactrus`、本仓 `codes/rules` 都是黑名单思路。白名单把“防泄漏”和“限形状”绑在一起，误伤正常字段。
4. **级别/采样/整条过滤已够用**：详细度（Q2=B 开关管详细度）＋采样（`guard`）＋整条丢弃（winston falsey / loguru filter / structlog processor）三板斧覆盖 99% 需求，无需字段级闸门。

### 3.3 对用户直觉的裁决

- 用户的直觉（“白名单限制自由度”）**方向正确**：若按文档字面把 `checkEventFields` 接到 `log()` 链路上，每行都要先过 `allowed.has(field)`，自由度确实被限，且与 Q1=A（应有尽有）Q2=B（落盘零丢弃）直接冲突。
- 但**当前代码没有这样做**，自由度实际完好——可以放心打日志，清单外字段照落（实测为证）。真正的风险是**后人看文档信以为真、顺手把白名单接到运行期**，以及**门禁红灯被解读为“必须删字段才准上线”**。

---

## 4. 对本仓的建议（5 条，按优先级）

1. **永不把 `checkEventFields` 接到 `log()/writeBatch()`**（P0，防抑制）。在 `src/config.ts:377` 与 `src/store.ts:284` 各加一行注释：“字段白名单永不进运行期；需限流请用级别/采样/guard”。对应 Q6 口径：门禁红灯只红测试与 CR，不自动删字段、不拦上线（待 R2 拍板，此处先记主张）。
2. **改文档字面，消灭“之外的键一律不记”**（P0，防误读）。`README.md:153`、`INTEGRATION.md:205`、`src/config.ts:230-231,256` 改为：“允许字段（fields，清单内登记、自查用；运行期原样透传、不裁剪）”。同步改 `src/client.ts:95` 已有正确表述为全仓统一口径。
3. **保留离线三件套，但改名改判据**（P1，留 lint 价值去抑制色彩）。`checkEventFields` 改名或别名 `lintEventFields`（老名保留兼容），判据改为 warning 级（拼写提示）而非 error 级；`checkEventCounts` 保留（防事件膨胀）；单测 `tests/eventList.test.mjs:63-81` 照跑。
4. **脱敏走黑名单实现，别走白名单**（P1，对齐业界与 Q1=A）。`codes/rules` 从“引用名”落为真实行为：参考 pino `redact{paths,censor,remove}` 做运行期脱敏（命中记规则名不记原文），默认 fail-open（规则拼错只告警不丢行）。在此之前，`token` 明文落盘实证（§1.2）应在安全声明里如实告知。
5. **限量用级别＋常驻名单＋guard，不用字段闸**（P2，对齐 Q2=B）。详细度继续由 `isEnabled`（`store.ts:263-267`）＋常驻 43 名单＋开关控制；突发限流用 `guard`（采样/节流，如 zerolog `Sampler`/spdlog backtrace），整条过滤参考 winston falsey / loguru `filter`（只丢整条、不摘字段）。

---

## 附录 A. 外部一手来源清单（复核用）

- winston README（filter/level/transport）：https://raw.githubusercontent.com/winstonjs/winston/master/README.md （关键节：Filtering info Objects、Logging Levels、Common Transport options；另见 https://github.com/winstonjs/winston）
- pino README＋redaction：https://raw.githubusercontent.com/pinojs/pino/master/README.md 、https://raw.githubusercontent.com/pinojs/pino/master/docs/redaction.md
- bunyan README（serializers/streams/fields）：https://raw.githubusercontent.com/trentm/node-bunyan/master/README.md
- log4js-node README（categories/appenders）：https://raw.githubusercontent.com/log4js-node/log4js-node/master/README.md
- zap README（自由 kv＋性能基准）：https://raw.githubusercontent.com/uber-go/zap/master/README.md
- zerolog README（sampling/hooks/no-dedup）：https://raw.githubusercontent.com/rs/zerolog/master/README.md
- logrus README（WithFields/hooks/levels）：https://raw.githubusercontent.com/sirupsen/logrus/master/README.md
- slog 标准库：https://pkg.go.dev/log/slog
- structlog README（dict in/out）：https://raw.githubusercontent.com/hynek/structlog/main/README.md
- loguru README（filter/bind/level）：https://raw.githubusercontent.com/Delgan/loguru/master/README.md
- tracing README（fields自由＋with_max_level）：https://raw.githubusercontent.com/tokio-rs/tracing/main/README.md
- spdlog README（level双层＋pattern）：https://raw.githubusercontent.com/gabime/spdlog/v1.x/README.md

## 附录 B. 本地取证命令（复跑用）

```sh
# 白名单定义与检查器
grep -n "checkEventFields\|parseEventListManifest\|不认识的键\|白名单" src/config.ts
# 运行期零调用
grep -rn "checkEventFields\|eventList" src/store.ts src/client.ts src/node.ts src/phones.ts
# 落盘两行
sed -n '290,295p;371,374p' src/store.ts
# 单测
node --test tests/eventList.test.mjs
```
