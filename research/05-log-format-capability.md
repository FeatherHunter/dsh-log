# 结论

**整体判定：部分具备。**

三块判据：第一块**具备**（附三处缺口），第二块**部分具备**（格式齐备、语义零落地），第三块**具备**（附两处缺口）：

| # | 判据 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | JSON 行（`event`/`level`/`fields`） | **有**（附三处缺口） | 落盘行只有一个形状：`JSON.stringify({ts, level, event, fields})`（`src/store.ts:374`），一行一条、`\n` 分隔、末尾一个换行、无 BOM/无前后缀/无人类可读头（实测探针 1：12 行全部 `["ts","level","event","fields"]`）；`fields` 运行期**原样透传**，不裁剪、不白名单过滤、不脱敏、不校验（`src/store.ts:294`，实测探针 4 里明文密钥与清单外字段全部落盘）。缺口：①客户端 `ts` 被宿主重打、`truncated` 标记不落盘（第 1.4 节）；②`BigInt`/循环引用值整行丢且只计数（第 1.5 节）；③行里无请求级追踪标识，归票 09（第 1.7 节） |
| 2 | 事件清单格式（`level`/`kind`/`fields`/`codes`/`rules`/`guard`） | **部分**（格式层有、语义层无） | 六键白名单、`level` 四值、`kind` 三值、`fields` 必填、`codes`/`rules` 可选数组、`guard` 可选字符串**全部真验形**，坏形状当场抛中文错（`src/config.ts:299-367`，第 2.1 节矩阵 31 组）；空模板合法（`tests/eventList.test.mjs:55-61` 实跑通过）。但**清单在运行期只被读一次（建库验形），随后既不拦字段、也不驱动行为**：清单自报 `kind: resident` 的 info 事件在开关关闭时照样被拦，而不在清单里但在硬编码 43 条名单里的 `host.start` 照落（实测探针 6）；`codes`/`rules`/`guard` 在运行期**零消费**，明文密钥原样落盘、规则名一个都没出现（实测探针 4）；包内真实的脱敏只覆盖自监控失败行那一窄面（只记 `errorHash`，第 5 节） |
| 3 | 通用检查器 | **有**（附两处缺口） | 三个纯函数签名/返回形状稳定（`src/config.ts:299`、`:379-391`、`:401-414`），经宿主入口导出（`src/host.ts:23`，实测 `dsh-log/host` 可达、`client`/`node` 不可达）；`src/config.ts` **零 import**、`dist/config.js` 同样零 import ⇒ 包不读盘（字符串路径当场抛错）；单测实跑 **14/14 通过、退出码 0**。缺口：①包内**没有任何运行期/门禁调用方**（除建库验形与单测）；②`checkEventFields` 的第三参不是数组时静默判绿（实测 `ok: true`） |

本票只给结论与证据，不改代码、不提实现建议。凡引用均给 `路径:行号`；实测部分为只读探针（跑在系统临时目录 `D:\Temp\...`，未改动仓库任何文件）。**未定项**：队列满语义 Q5、门禁红黄 Q6 均待 R2，本票不裁；凡结论依赖它们处逐处标「待 Q5」/「待 Q6」。

---

# 判据与口径（出处，非本票自拟）

- 票面判据（逐字）：`issues/05-untitled.md:7-9`——「判定日志格式能力是否具备：JSON 行（event/level/fields）、事件清单格式（level/kind/fields/codes/rules/guard）、通用检查器。口径：脱敏（记名不记文）=合规；字段白名单运行时不丢字段但门禁红灯=抑制（Q1 已定）。输出：有/部分/无 + 证据（src/config.ts 事件清单一节、event-list.template.json、tests）。只给结论不写代码。」
- 父图既定前提：`issues/01-untitled.md:14`——「全量要求（2026-10-09 用户立；Q1=A：最核心信息走脱敏、记规则名不记原文；**Q2=B：开关保留、只管详细度、落盘零丢弃**；门禁红灯=抑制）：日志须应有尽有，不得立'某某场景不要打印'式抑制规则。」
- **未定项**：`issues/01-untitled.md:15`「队列满语义与门禁红黄（Q5/Q6）待 R2」、`issues/01-untitled.md:41`「升级建议须满足全量无抑制要求（Q1=A、Q2=B、门禁红灯=抑制已定；队列满语义与门禁红黄待 R2，**影响级别/格式/轮转票口径**）」。本票凡结论落在"丢行语义"处标「待 Q5」，落在"门禁红灯之后怎样"处标「待 Q6」，**不猜**。
- 姊妹票（引用，不重复其结论）：票 02 文件能力 `research/02-log-file-capability.md`（本票引用其落点/导出/丢弃四路）、票 03 级别能力 `research/03-log-level-capability.md`（本票引用其级别四字面、越界级别不设防、常驻 43 条硬编码名单三条实锤）。

---

# 1. JSON 行格式（event/level/fields）：有

## 1.1 A1 落盘行怎么构造：一个形状、一行一条、无前后缀

- 队列里的行对象形状定版四处键：`src/store.ts:87-92`「`interface QueuedRow { ts: number; level: string; event: string; fields: Record<string, unknown> }`」。
- 入队时定值：`src/store.ts:290-295`——`ts: Date.now()`（第 291 行，**入队时刻**）、`level: level`（第 292 行，原样存，无枚举校验）、`event: String(event || '')`（第 293 行，非字符串事件名被转成字符串、假值塌成空串）、`fields: fields && typeof fields === 'object' ? fields : {}`（第 294 行，见 1.2）。
- 落盘时定型：`src/store.ts:371-374`——`lines.push(JSON.stringify({ ts: batch[i].ts, level: batch[i].level, event: batch[i].event, fields: batch[i].fields }))`。**键集合与顺序就是这四处键**，没有第二个形状分支。
- 行分隔与文件末尾：`src/store.ts:382`「`const text = lines.join('\n') + '\n'`」——`\n` 分隔、末尾恰好一个换行；文件内容 = 全文读改写追加（`src/store.ts:396-403`「文件服务无追加原语，任何追加都是全文读改写」）。
- **没有前缀、没有人类可读头、没有 BOM、没有分隔线**：所谓"启动头"本身也是一条普通 JSON 行——`src/store.ts:466`「`log('info', 'host.start', { pid, startedAt, dir })`」；且本包**不会自动写它**：`writeStartupHeader` 只定义并挂在 store 上（`src/store.ts:461-471`、`:543`），全 `src/` 无任何内部调用点（检索 `writeStartupHeader` 只命中定义与导出；`dist/store.js:380/451` 同）。
- 测试守着的形状：`tests/node.test.mjs:144-160`「一行一条 JSON：落盘内容带时间戳、级别、事件名与字段对象」——断言 `typeof last.ts === 'number'`、`last.level === 'warn'`、`last.event === 'skill.step.fail'`、`last.fields` 深等于 `{ step: 'parse' }`（本仓实跑通过）。
- **实测（探针 1）**：写 14 条（含多值边界）后文件 `2026-10-09.log`，字符数 201314／UTF-8 字节 201334、**12 行**、`trailingNewline: true`、`startsWithBOM: false`、空行数 1（即末尾那一个换行）；12 行的键集合去重后只有一种：`["ts","level","event","fields"]`；`ts` 全为 `number`、`level` 全为 `string`。
- `dist` 与 `src` 一致（逐项比对）：`dist/store.js:296`（同一句 `JSON.stringify({ts, level, event, fields})`）、`dist/store.js:304`（`lines.join("\n") + "\n"`）、`dist/store.js:210-224`（`log` 行构造，含 `fields: fields && typeof fields === "object" ? fields : {}`）。`dist/*.js` 六个文件均构建于 2026-10-07 03:47:24，晚于 `src/*.ts` 最后一次修改 2026-10-04 00:09:46（`store.ts`）。

## 1.2 A2 `fields` 运行期不裁剪：原样透传（附形状兜底与两处"非白名单"的丢键）

- 唯一处理在 `src/store.ts:294`：「`fields: fields && typeof fields === 'object' ? fields : {}`」——**不复制、不裁剪、不按任何白名单过滤、不脱敏、不校验字段名**，对象引用直接进队列；落盘时整对象交给 `JSON.stringify`（`:374`）。
- 全链路**没有任何一处消费清单的字段白名单**：全 `src/` 检索 `eventList` 共 30 处，全部集中在（a）配置键声明与解析（`src/config.ts:53`、`:64`、`:107-122`）、（b）客户端同口径解析（`src/client.ts:96`、`:102`、`:110-115`）、（c）清单格式自身的注释与报错文案（`src/config.ts:209`、`:287-362`）、（d）`src/store.ts:110` 的一句注释。落盘路径（`log`/`writeBatch`）里一次都没出现。
- **实测（探针 4）**：给宿主配上合法清单（`probe.declared` 只允许字段 `['allowed']`），运行期写 `{ allowed, forbidden, token: 'ghp_plainTextSecret_1234567890' }` 与一个**清单里根本没有的事件名** `probe.undeclared`，落盘行是：
  - `probe.declared` 的 `fields` 为 `{"allowed":"in-whitelist","forbidden":"NOT-in-whitelist","token":"ghp_plainTextSecret_1234567890"}`（三个键全落）；
  - `probe.undeclared` 也照落（事件名不经清单校验）；
  - 把宿主自己写下的这行再喂回 `checkEventFields`，判 **`ok:false, unknownFields:['forbidden','token']`**——即"检查器的判决"与"运行期实际落盘"当场相反。
- 降级行为（`typeof` 兜底，**不去猜形状**，实测探针 1 逐条）：

| 传入 `fields` | 落盘行里的 `fields` | 依据 |
|---|---|---|
| `undefined`（省略第三参） | `{}` | `src/store.ts:294` 假值分支；实测行 73 字符 |
| `null` | `{}` | 同上（实测） |
| 字符串 `'not-an-object'` | `{}` | `typeof !== 'object'` 分支（实测） |
| 数字 `7` | `{}` | 同上（实测） |
| 数组 `['x','y']` | `["x","y"]`（**仍是数组，不是对象**） | `typeof [] === 'object'` ⇒ 原样透传（实测） |

  ⇒ 准确说法是「**不做形状校验，只做 `typeof object` 兜底**」；形状兜底漏掉了数组这一档，行里可以出现非对象的 `fields`，而没有任何一处会报错。
- 字段值层面的两处"丢键"都不来自白名单，而来自 `JSON.stringify` 语义（实测探针 1）：值为 `undefined` 的键被静默丢掉（`{ keep: 'yes', gone: undefined }` → 行里只剩 `{"keep":"yes"}`）；值为函数的键同理（`fn` 键未出现）。其余：`Date` → ISO 字符串、`RegExp` → `{}`、`Map` → `{}`、`NaN`/`Infinity` → `null`。

## 1.3 A3 `level` 在行里的取值来源与形状（引用票 03，不重做）

- 行里的 `level` 就是调用方传入的字符串原样（`src/store.ts:292`「`level: level`」），函数签名是 `log(level: string, …)`（`src/store.ts:284`），运行期不校验四值枚举。
- **越界级别原样落盘**已由票 03 实测实锤（`research/03-log-level-capability.md` §1.1 探针 D：开关打开后写 `trace`/`FATAL`，落盘级别序列 `["trace","FATAL","error"]`、丢弃数 0），**本票不重做**，只引用。
- 本票补充的形状事实（探针 1，均为合法一级场景）：`level` 在文件里恒为 JSON 字符串（`"level":"warn"`），四级字面在三个入口各有一份定版枚举（票 03 §1 已列：`src/config.ts:243`、`src/store.ts:33`、`src/client.ts:133`）。

## 1.4 A4 客户端 → 宿主链路：同一行形状，三处差异

链路两端：

- 客户端入队：`src/client.ts:298-303`（同一形状 `{ts, level, event, fields}`，`event` 同样 `String(event || '')`、`fields` 同样 `typeof object` 兜底）。
- 转发载荷：`src/client.ts:468`「`const args = { entries: entries, droppedCount: logDroppedState.count }`」，走 `src/client.ts:479`「`host.call(phoneNames.logBatch, args)`」。
- 宿主实收与重建：`src/store.ts:482-491`（`entries` 逐条）→ `src/store.ts:486`「`log(item.level, item.event, item.fields)`」→ 回到 `src/store.ts:290-295` 重新造行。
- `dist` 对应：`dist/client.js:150-155`（行构造）、`dist/client.js:304`（`{ entries, droppedCount }`）、`dist/store.js:210-224`。

**实测（探针 2，桩宿主实收载荷 + 真宿主落盘）：**

| 观察项 | 结果 |
|---|---|
| 转发电话名与载荷键 | 一次 `wf.logBatch`，载荷键恰为 `["entries","droppedCount"]` |
| 客户端条目形状 | 9 条全部 `["ts","level","event","fields"]`（无多余键） |
| 事件名 | 客户端已规范化：`''`→`""`、`undefined`→`""`、`123`→`"123"`（`src/client.ts:301`），宿主再规范化一次（`String(event||'')`），故事件名不丢但**假值会塌成空串**（文件里出现两条 `"event":""`） |
| 字段 | 落盘 `fields` 与客户端条目 `fields` 逐字节相同（对象经引用穿过电话层，无复制/无裁剪） |
| `ts` | **宿主重打**：客户端 `1791556955089` → 文件 `1791556955150`（差 61 毫秒）⇒ 落盘时间是宿主入队时刻，不是客户端记日志时刻 |
| 宿主重放门禁 | 客户端实发 9 条、宿主回 `{ok:true, accepted:9, dropped:0}`，但**文件只有 8 行**：`probe.client.info`（info 级、非常驻、宿主开关关闭）被宿主自己那一层 `isEnabled` 拦掉（`src/store.ts:285`、`:263-267`）。即转发链路上行会**被宿主的级别/开关二次裁决**（与票 02「`accepted` 不等于落盘」同向，本票只记格式侧后果：**同一形状，但条数可能变**） |
| `truncated` 标记 | 客户端超包裁剪时会在包尾那一条打 `truncated: true`（`src/client.ts:459-467`），**宿主重建时不带这个键**：实测裁剪批次（3 条 100KB 字段 → 只发 2 条，其中一条 `truncated:true`）落盘后文件键集合仍只有四处键、正则 `/"truncated"/` 不命中 |

⇒ **判定：链路保持同一行形状（四处键、同名同义），但有三处差异：`ts` 被宿主重打、包尾截断标记不落盘、宿主会用自己那一份级别/开关再裁一次行。**

## 1.5 A5 边界与健壮性（实测）

**换行/引号/中文/超长值：仍是一行合法 JSON。**

- 实测（探针 1）字段值含 `\n`、`\r\n`、双引号、制表符、反斜杠、空格、emoji、中文（「中文：脱敏与规则名」）、嵌套对象/数组——落盘行 284 字符，**物理行只有一条**（`\n` 被转义成 `\n` 两个字符），`JSON.parse` 成功。原样摘录一行的骨架：
  `{"ts":…,"level":"warn","event":"probe.tricky","fields":{"nl":"line1\nline2","crlf":"a\r\nb","quote":"he said \"hi\"","cn":"中文：脱敏与规则名","backslash":"C:\\tmp\\x","emoji":"😀",…}}`
- 危险键名不被过滤：`JSON.parse('{"__proto__":"p","constructor":"c","toString":"t"}')` 作 `fields`，落盘为 `{"__proto__":"p","constructor":"c","toString":"t"}`（实测）。
- **超长值不截断**：单个字段值 200000 字符原样落盘，该行 200077 字符（探针 1）；整个文件 201314 字符。包内**没有任何单行/单字段长度上限**（`JSON.stringify` 之前不做截断）。

**不可序列化的值：整行丢、只计数、不抛错、`ready` 照常 resolved。**

| 值 | 结果（探针 1） | 代码依据 |
|---|---|---|
| `BigInt`（`{ big: 10n }`） | 该行**整行不落盘**，`dropped` +1；同批其它行照落（`probe.after-bigint` 在文件里） | `src/store.ts:372-379`：`JSON.stringify` 抛错被 catch，`dropped += 1`，`continue` 语义（不进 `lines`） |
| 循环引用（`o.self = o`） | 同上，丢该行 +1；后继行照落 | 同上 |
| 全批都不可序列化 | **一个文件都不产生、日志目录都不建**：`cacheDir` 空、`logs-p05allbad` 目录不存在、`dropped` 0→2、`ready` **resolved**、调用方无异常（探针 7） | `src/store.ts:381`「`if (lines.length === 0) return true`」——整批为空时按"写成功"返回，**不写盘、不记 `log.persist.fail`** |
| 自监控行 | 序列化失败**不产生任何 `log.persist.fail` 行**（探针 1 文件 12 条事件里没有它；`notePersistFail` 只在 `:388`「no-dir」与 `:408`「write-fail」两处被调用，序列化失败那条路不调） | `src/store.ts:376-379` vs `:386-390`、`:405-410` |
| `log.ready` | 两种情况都 **resolved**，且不反映丢行（探针 1：`dropped` 0→2 而 `readyState="resolved"`） | `src/node.ts:172-192`：六轮 `flushNow` 后无条件结束 |

**附带一条与 `ready` 有关的形状事实**：`ready` 用一条 `debug` 级基准行 `log.flush.marker` 当路标（`src/node.ts:173`、`:176`），而该事件名不在常驻名单、开关默认关闭 ⇒ 基准行**根本没进队列**（`src/node.ts:176` 的 `log()` 不抛错，`flushed=true` 被无条件置真），于是 `markerLanded` 六轮全假、`ready` 在约 6×10 毫秒后无条件 resolve——**探针 1 实测 `markerPresent: false`、`readyState: "resolved"`**。即：开关关闭时 `ready` 不构成任何"已落盘"的验证（与票 02 记的"写盘失败时 ready 仍 resolved"是同一族缺口，此处补的是"开关关闭时它连路标都没写"）。

> 「丢整行只计数」是否可接受属丢弃语义，本票只报现状——**待 Q5**（`issues/01-untitled.md:15`、`:41`；Q5 字面是"队列满语义"，序列化失败不在队列满那条路上，是否一并纳入由用户裁）。

## 1.6 A6 导出/清空电话返回的对象与落盘行（只记事实）

- 导出成功回 8 键 `ok/fileName/bytes/fallback/text/summary/dir/path`（`src/phones.ts:188-197`）；失败回 4 键 `ok/fileName/bytes/fallback`（`src/phones.ts:208`）；`bytes` 是字符串长度不是真实字节数（`src/phones.ts:191`「`bytes: String(text || '').length`」）；`fallback` 在成功路径也硬编码 `true`（`src/phones.ts:192`）。
- **`text` 就是盘上文件原文**：实测（探针 6）`exp.text === 文件全文字节`（严格相等）、把 `text` 按行 `JSON.parse` 与把文件按行 `JSON.parse` 结果逐条相同 ⇒ **导出返回的"行"与落盘行格式完全一致**（同一批 JSON 行），导出不重新构造、不补字段。
- **`summary` 不是日志行**：是个 5 键普通对象 `pluginVersion/os/cwd/logSwitch/header`（`src/phones.ts:158-164`；探针 6 实测键序同），其中 `header` 是 `{pid, startedAt, dir}` 或 `null`（本包不自动写启动头，见 1.1 ⇒ 实测 `header: null`），`logSwitch` 是 `{enabled, sampleRate}`（实测 `{enabled:false, sampleRate:1}`）。它**不落盘、也不在日志文件里出现**。
- 清空返回 `{ok, removed}`：不传日期 → `{ok:false, removed:0}`（`src/phones.ts:227-234`，实测）；导出不存在的日期 → `{ok:true, bytes:0, …8 键}`（实测）；`'all'` → `{ok:true, removed:1}` 且目录清空（实测）。这些与票 02 §4/§5.1 的记录一致，本票只记"返回对象 ≠ 日志行"这一形状结论。

## 1.7 A7 行里没有的东西（只记事实，归票 09）

- 落盘行的顶层键只有 `ts/level/event/fields`（1.1），没有任何 `traceId`/`requestId`/`spanId`：全仓检索 `traceId|requestId|trace_id|request_id|spanId` **只命中 `issues/` 下的地图与票 09 文字**，`src/`、`dist/`、`tests/`、README/INTEGRATION 一处都没有；探针 2 对落盘行与 `fields` 做 `/trace|request|span/i` 过滤，命中为空数组。
- 归属：`issues/09-untitled.md:7`（追踪标识=每条日志带的 trace/requestId 字段），**本票不裁**（票 09 另判）。

## 1.8 本块判「有」的口径与三处缺口

- 判「有」的依据：**票面点名的三样（`event`/`level`/`fields`）在落盘行里齐备、由构造保证、有测试守着、实测复现**；且 Q1 的两句口径在这一层都成立——「字段白名单运行时不丢字段」（运行期确实不丢，1.2）与「脱敏（记名不记文）=合规」（行格式不排斥记名，未做任何原文抹除）。
- 三处缺口如实列出，供升级建议票取用：①宿主重打 `ts` 与丢掉 `truncated` 标记（1.4）；②不可序列化值整行丢、只计数、无自监控行、`ready` 不反映（1.5，**待 Q5**）；③行内无请求级追踪标识（1.7，归票 09）。
- 若把判据读作「行格式必须自带追踪标识/版本号/截断标记」，本块应降为**部分**；本票按票面「JSON 行（event/level/fields）」三样 judge 为**有**，缺口不隐去。

---

# 2. 事件清单格式（level/kind/fields/codes/rules/guard）：部分

**判「部分」的口径**：作为**格式**（形状、枚举、白名单、中文报错、空模板）它真实存在且真验形；作为**语义**（字段白名单当闸门、`kind` 驱动归类行为、`codes`/`rules` 做脱敏、`guard` 做守卫）**在包内一条都没实现**——清单在运行期只被读一次（建库验形），验完就把**原始对象**存下、再无人读。

## 2.1 B1 完整形状与验形严格度（31 组实测矩阵）

形状定义：`src/config.ts:271-280`（`LogEventList`：`version`/`pluginId`/`counts`/`events`）、`:250-263`（条目六键 `level`/`kind`/`fields`/`codes?`/`rules?`/`guard?`）、`:265-269`（`LogEventCounts` 三类数字）。验形实现：`parseEventListManifest`（`src/config.ts:299-333`）+ `parseEventEntry`（`:336-367`）+ `assertStringArray`（`:286-295`）。`dist` 对应：`dist/config.js:106-172`（逐句同构）。

**实测矩阵（探针 3；下表第一列即当时的输入，第二列是实测结果，报错文案逐字摘录）：**

| 输入 | 实测 |
|---|---|
| 包内空模板 | 通过；解析结果 `{version:1, pluginId:'your-plugin-id', counts:{resident:0,ondemand:0,selfmon:0}, events:{}}` |
| `version: 2` / `version: '1'` / `version` 缺失 | 全抛：`…version 现在只认 1（收到 2 / "1" / undefined）`（`src/config.ts:307-309`） |
| `counts` 缺 `selfmon` / `0.5` / `-1` / `NaN` | 全抛：`…counts.selfmon 必须是非负整数`（`:317-321`，`Math.floor(n)!==n`、`isFinite`、`n<0` 三查） |
| `counts` 是数组 | 抛：`…counts 必须是含三类计数的对象`（`:312-314`） |
| `counts` 多一个 `extra: 9` | **通过**，多余键被忽略（只按 `EVENT_KINDS` 三键取值，`:317-323`） |
| `events` 是数组 | 抛：`…events 必须是事件名到条目的对象`（`:325-327`） |
| `events: {}` + `counts` 全零 | 通过，`checkEventCounts` 回 `{ok:true, problems:[]}` |
| 事件名为空串 | 抛：`…事件名不能为空`（`:337`） |
| 条目 `level: 'fatal'` | 抛：`…事件 gh.exec 的 level 只许 error、warn、info、debug`（`:342-344`） |
| 条目 `kind: 'always'` | 抛：`…事件 gh.exec 的 kind 只许 resident、ondemand、selfmon`（`:345-347`） |
| 条目多一个键 `fileds` | 抛：`…事件 gh.exec 有不认识的键 fileds`（`:348-352`，六键白名单） |
| `fields` 缺失 | 抛：`…事件 gh.exec 的 fields 必须是字符串数组`（**必填**，`:356`） |
| `fields: []`（空数组） | **通过**（只查"是数组 + 每项非空字符串 + 不重复"，**不要求非空**） |
| `fields: ['a','a']` | 抛：`…事件 gh.exec 的 fields 里字段名重复：a`（`:291`） |
| `fields: ['a','']` | 抛：`…fields 里有空字段名`（`:290`） |
| `fields: ['a', 7]` | 抛：`…fields 里有空字段名`（文案对非字符串也用"空字段名"这句，`:290`） |
| `fields: ['字段 一','a b']` | **通过**（字段名**无字符集/格式约束**，只要非空字符串；点号、空格、中文都收） |
| `fields: 'argv0'`（非数组） | 抛：`…fields 必须是字符串数组`（`:287`） |
| `codes: ['H_CWD']` / `codes: []` | 通过（`codes` 可选，`:358`） |
| `codes: 'H_CWD'`（非数组） | 抛：`…codes 必须是字符串数组` |
| `rules: ['不 是正则 名','R_X']` | **通过**（`rules` 只查字符串数组，**不查是否像正则名**，`:359`） |
| `guard: '按事件，有穿透才记'` / `guard: ''` | 通过（`:360-364`；**空串也合法**，与"无特殊守卫不写"的约定不符但格式不拦） |
| `guard: 1` | 抛：`…guard 必须是字符串`（`:361-363`） |
| 顶层多一个键 `junk` | **通过**（顶层**无**白名单）；`parseEventListManifest` 的返回值会剥掉它，但**建库配置里留的是原始对象**（见 2.2，实测 `configKeepsJunk` 含 `junk`） |

⇒ 严格度小结：**枚举与条目键键位严**（写错当场抛，中文文案齐全，`tests/eventList.test.mjs:98-108`、`:128-136` 守住），**顶层键位松、字段名格式松、空数组松**。

## 2.2 B2 `pluginId` 从哪来、返回对象是否规范化/复制

- `pluginId` **由清单自报**：`src/config.ts:310`「`const pluginId = assertPluginId(input['pluginId'], '事件清单 pluginId')`」——用与建库配置同一个字符约束（`:71-80`）。**不与配置里的 `pluginId` 做任何一致性核对**：实测（探针 3）清单写 `pluginId:'other-plugin'`、配置写 `pluginId:'wf'`，建库照样成功，`resolved.eventList.pluginId === 'other-plugin'`；清单里 `pluginId:'WF'`（大写）才抛错。
- **`parseEventListManifest` 返回的是新造的规范化对象，且不碰入参**：`src/config.ts:332`「`return { version: 1, pluginId: pluginId, counts: counts, events: events }`」——实测（探针 3）：`parsed !== input`、`parsed.events !== input.events`、条目与 `fields` 数组也都是新对象/新数组，`input`（JSON 序列化后）逐字节未变。
- **但建库配置存的是原始对象，不是这个规范化副本**：`src/config.ts:107-114`（验形后不接收返回值）、`:122`「`eventList: eventList`」；客户端同构（`src/client.ts:110-115`）。实测：`resolveHostLogConfig({pluginId:'wf', eventList: obj}).eventList === obj` 为 **true**。⇒ **规范化的唯一产物被丢弃，只有副作用（抛错）被使用**；顶层多余键因此跟着 `config.eventList` 一起留在运行期（实测 `["version","pluginId","counts","events","junk"]`）。
- 字符串（路径）形式原样存：`src/config.ts:107-108` 只对 `typeof === 'object'` 验形 ⇒ 实测 `resolveHostLogConfig({pluginId:'wf', eventList:'./x.json'}).eventList === './x.json'`（只存不解析，与 README:168 相符）。

## 2.3 B3 空模板

- 文件（`event-list.template.json`，6 行）：`{"version":1,"pluginId":"your-plugin-id","counts":{"resident":0,"ondemand":0,"selfmon":0},"events":{}}`。
- 解析结果（实测探针 3）：`{version:1, pluginId:'your-plugin-id', counts:{resident:0,ondemand:0,selfmon:0}, events:{}}`，`checkEventCounts` → `{ok:true, problems:[]}`。
- 「空模板合法」的依据：`tests/eventList.test.mjs:55-61`（读包内模板 → 验形 → 断言 `version===1`、`Object.keys(events)` 为空、计数全零一致），本仓实跑通过；`pluginId` 用 `assertPluginId` 过 `^[a-z0-9-]{1,32}$`（`your-plugin-id` 合法）。
- 该模板随包发布：`package.json:20-26` 的 `files` 含 `event-list.template.json`（README:196 记 11 个文件，6 个 `dist` JS + 模板 + INTEGRATION + README + LICENSE + package.json = 11，逐项相符）。

## 2.4 B4 字符串路径形式、数组形式被拦下的行为

- 字符串：`src/config.ts:300-302` 先拦「路径形式」并给专门文案——实测 `parseEventListManifest('event-list.json')` → `[dsh-log] 事件清单 eventList 非法：路径形式请调用方自己读成对象再传入，日志包不读盘`；`tests/eventList.test.mjs:110-112` 守这条。
- 数组：`src/config.ts:303-305` 与 `null`/`undefined`/数字同一句文案——实测 `[]`、`null`、`undefined`、`42` 全抛 `…只收对象形式（空模板见包内的 event-list.template.json）`；进建库配置同样被拦（`resolveHostLogConfig({pluginId:'wf', eventList: []})` 抛，`tests/eventList.test.mjs:134-136` 守）。
- 缺省：`eventList` 不传 → `null`，主路径零变化（`src/config.ts:107`；`tests/eventList.test.mjs:114-119` 实测断言；README:93 配置表同口径）。

## 2.5 B5 「fields 之外的键一律不记」与 `codes`/`rules`：是**声明**，不是运行期行为

**规范原文三处**：

- `src/config.ts:230-231`「每条事件四样东西：事件名（events 的键）、级别（level）、允许字段（fields，**之外不记**）、脱敏引用（codes 是截断或散列代号、rules 是具名正则名，都是引用名，**命中只记规则名不记原文**）」；`:255` 字段注释「该事件能记的全部字段键，之外的键一律不记」。
- `README.md:153`（§7 首段）「允许字段（之外的键一律不记）、脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，**命中只记规则名不记原文**）」。
- `INTEGRATION.md:205`「允许字段（之外的键一律不记）、脱敏引用（只记规则名不记原文）」。

**它是声明而非行为——三层证据：**

1. **全仓没有任何脱敏实现**：`src/` 检索 `scrub|redact|REDACT|mask|desensit|脱敏|sanitiz` 只有 **4 处命中，全是 `src/config.ts` 的注释与字段说明**（`:231`、`:257`、`:259`、`:278`），没有一行代码。`codes`/`rules`/`guard` 在 `src/` 的检索命中 16 处，去掉 2 处与清单无关的常驻事件名 `naming.guard`（`src/store.ts:251`、`src/client.ts:268`）后，其余 14 处只有三类：注释（`:224-225`/`:231`/`:234`）、类型可选键（`:258`/`:260`/`:262`）、验形（`:349`/`:358`/`:359`/`:360-364`）——**没有任何一处读它们的值来做事**，`writeBatch` 里也没有（`src/store.ts:368-380` 只 `JSON.stringify` 四个键）。
2. **实测：明文原样落盘、规则名一个都不出现**（探针 4）：清单给 `probe.declared` 配了 `codes:['H_CWD']`、`rules:['R_TOKEN_BEARER']`，运行期写 `{token:'ghp_plainTextSecret_1234567890'}` ⇒ 文件里 `plaintextSecretLanded: true`（正则命中明文）、`ruleNameLanded: false`（`H_CWD`/`R_TOKEN_BEARER` 一个都没出现）。
3. **"之外不记"当前唯一的执行者是检查器，而检查器没有运行期调用方**（见 3.1）：实测把宿主自己写的行喂回 `checkEventFields` 才判红（`unknownFields:['forbidden','token']`），而盘上那行已经在文件里了。

⇒ 结论：**「fields 之外的键一律不记」与「命中只记规则名不记原文」在本包里都只是格式约定（写在清单与文档里的规范），没有任何运行期实现**。按票面口径「脱敏（记名不记文）=合规」，格式**能表达**记名不记文（`codes`/`rules` 位置齐备且验形）；但**能力本身不在包里**——是否由消费插件自己做脱敏，本仓无从核验（见「未独立核验」）。**待 Q6**：若将来把字段白名单接到运行期做拦截（"红灯就丢这条/这个字段"），按地图「门禁红灯=抑制」口径即构成抑制规则，是否允许由用户裁。

## 2.6 B6 清单与「43 条常驻事件名硬编码名单」的关系：清单在包内是没人读的表

- 运行期真正决定"常驻信息开关关着也落盘/也转发"的是**手写事件名名单**：`src/store.ts:246-259`（43 名）、`src/client.ts:263-276`（同表），消费点只有 `src/store.ts:265` 与 `src/client.ts:282`（票 03 §2 已实锤两份名单逐字相同、与父仓附录 §1.4 集合相同；本票引用不重做）。
- 清单在运行期的全部足迹：建库时验形（`src/config.ts:113`、`src/client.ts:113`）→ 存进 `config.eventList`（`src/config.ts:122`、`src/client.ts:115`）→ **此后无人读**（全 `src/` 检索 `eventList` 30 处，见 1.2 的分类；`src/store.ts` 里只有 `:110` 一句注释）。
- **实测（探针 6，最锋利的一条）**：清单自报 `probe.claimed.resident` 为 `kind:'resident'`、`level:'info'`，清单自报计数一致（`checkEventCounts` 通过），开关关闭时：
  - `isEnabled('info','probe.claimed.resident')` → **false**（清单说它是常驻，运行期不认）；
  - `isEnabled('info','host.start')` → **true**（`host.start` 在硬编码 43 条名单里，`:253`）；
  - 落盘结果：文件里**只有** `host.start`，`probe.claimed.resident` **没落**。
  ⇒ **`kind` 不驱动任何行为；清单与硬编码名单之间没有程序化绑定**（两者的关系是"人工同步"，`src/store.ts:239-245` 与 `src/client.ts:257-262` 的注释自陈，票 03 已核实 43 条与附录 §1.4 集合相同）。
- 附带事实：清单验形**确实**拦得住坏清单进运行期（`tests/eventList.test.mjs:128-132`：`kind='always'` 在建库配置这一步当场抛），所以准确说法不是"清单没人读"，而是「**只被读一次（当门槛），不被读第二次（当依据）**」。

## 2.7 本块判「部分」的口径

- **格式层：有**——六键白名单、四值/三值枚举、必填校验、重复/空名校验、中文报错、空模板合法、路径与数组拦下、坏清单进不了运行期（2.1–2.4，全部实测）。
- **语义层：无**——`fields` 不是运行期闸门（1.2、2.5）、`kind` 不驱动行为（2.6）、`codes`/`rules` 无脱敏实现（2.5）、`guard` 只存不用（2.1：连空串都收，且无任何采样/节流代码；与票 03 §3.4「`sampleRate` 全包惰性」同向）。
- 因此按票面「事件清单格式（level/kind/fields/codes/rules/guard）」整体记 **部分**。若把判据窄读为"格式定义与验形是否具备"，本块可记**有**；本票按"格式+其语义效力"读，并在上文把两种读法都写明。

---

# 3. 通用检查器：有

## 3.1 C1 三个纯函数：签名、语义、返回形状、调用点

| 函数 | 签名（`src/config.ts`） | 语义 | 返回形状 | 实测 |
|---|---|---|---|---|
| `parseEventListManifest` | `(value: unknown): LogEventList`（`:299`） | 把入参验成可用清单，错了直接抛、不静默修补（`:297-298`） | 新造的 `LogEventList`（`:271-280`） | 形参个数 1（探针 5）；不碰入参（2.2） |
| `checkEventFields` | `(manifest: LogEventList, eventName: string, fieldNames: string[]): EventFieldCheck`（`:379-383`） | 字段白名单检查：未知事件名、未知字段键都算不通过，并把名单带回 | `{ok, unknownEvent, unknownFields}`（`:369-375`） | 通过/未知字段/未知事件三档实测同文档（探针 3）；**第三参不是数组时静默判绿**（`(Array.isArray(fieldNames) ? fieldNames : [])`，`:387-389`）：对**已存在**的事件传字符串 `'argv0'` → 实测 `{ok:true, unknownEvent:false, unknownFields:[]}`（假绿）；对**不存在**的事件传 `null` → 实测 `{ok:false, unknownEvent:true, unknownFields:[]}`（事件名先判，掩盖了第三参问题） |
| `checkEventCounts` | `(manifest: LogEventList): EventCountCheck`（`:401-404`） | 按 `kind` 数实际条数与自报 `counts` 逐项核对（`:399-400`） | `{ok, problems: string[]}`，每条问题是完整一句中文（`:393-397`、`:409-411`） | 实测对不上时 `problems[0] = '[dsh-log] 事件清单计数对不上：resident 类实际 1 条，清单自报 0 条'` |

**实际调用点（grep 全仓，除验形与单测外有无运行期调用方）**：`parseEventListManifest|checkEventFields|checkEventCounts` 在本仓共命中 `src/`（定义 3 处 + 建库验形 2 处 + 出口转出 1 处）、`dist/`（同构转出）、`tests/eventList.test.mjs`（单测 20 余处）、`README.md:173-177`、`INTEGRATION.md:198-202`。**运行期调用方：零**——`checkEventFields`/`checkEventCounts` 在 `src/` 里除定义与出口外没有任何调用；唯一对 `parseEventListManifest` 的运行期调用是建库验形（`src/config.ts:113`、`src/client.ts:113`）。

## 3.2 C2 导出面

- 宿主入口转出三个检查器：`src/host.ts:23`「`export { parseEventListManifest, checkEventFields, checkEventCounts } from './config.js'`」（`dist/host.js:46-47`、`:52`）；类型也转出（`src/host.ts:24-32`）。
- **实测（探针 5，走包自引用 `dsh-log/host|client|node` ⇒ 过 `package.json:15-19` 的 exports 映射）**：

| 入口 | 检查器是否可达 | 实测导出名 |
|---|---|---|
| `dsh-log/host` | **是**（三个都是 `function`） | 14 个：`LOG_DEBOUNCE_MS`、`LOG_DIR_NAME`、`LOG_SWITCH_FILE`、`buildPhoneName`、`buildPhoneNames`、`checkEventCounts`、`checkEventFields`、`createHostLog`、`createLogStore`、`formatDailyFileName`、`formatLogFileName`、`parseEventListManifest`、`registerHostLogPhones`、`resolveHostLogConfig` |
| `dsh-log/client` | **否**（三个 `undefined`） | 14 个，无检查器（`src/client.ts:32` 只为验形 import，`:37-38` 只转出电话名拼法） |
| `dsh-log/node` | **否**（三个 `undefined`） | 3 个：`createNodeFileService`、`createNodeHostLog`、`createNodeTimer` |

- 与文档相符：README:170「检查器经宿主入口导出，都是纯函数，不新增日志事件」；`tests/eventList.test.mjs:138-143` 断言 `dsh-log/host` 可达（本仓实跑通过）。

## 3.3 C3 不读盘

- **代码级依据（比"实测没读"更硬）**：`src/config.ts` **一条 import 都没有**（`^import` 命中 0、`require(` 0、`readFile|readFileSync|readdir|openSync` 0、`fs` 字面 0——探针 5 统计），`dist/config.js` 同样 `^import` 命中 0（文件末尾只有 `export {...}`，`dist/config.js:197-221`）⇒ 该模块**在语法上不可能读盘**。
- 行为级：字符串路径形式当场抛错且不尝试读（`src/config.ts:300-302`，实测 3.1）；`parseEventListManifest` 只读入参对象的属性（`Object.keys` / 下标），`checkEventFields` 只读 `manifest.events[name].fields`，`checkEventCounts` 只读 `events[*].kind` 与 `counts[*]`（`src/config.ts:384-405`）——全部是纯内存计算，无定时器、无电话、无 Promise（`src/config.ts:236-238` 自陈同口径）。
- 文档相符：README:168「日志包不读盘」、INTEGRATION.md:186。

## 3.4 C4 单测实跑与对账（自己跑的两条命令）

环境：Windows、`node v24.19.0`、`npm 10.9.2`、工作目录 `D:\dsh-plugin\dsh-log`；测试跑的是 `dist/` 产物（`tests/eventList.test.mjs:14-17` 动态 import `dist/config.js`、`dist/host.js`）。

| 命令 | 实测结果 | 退出码 |
|---|---|---|
| `node --test tests/eventList.test.mjs` | **14 个用例全通过、suites 1、fail 0**（含空模板合法、白名单通过/揪出、未知事件、计数通过/对不上、级别写错、多出键、路径拦下、默认 `eventList=null`、对象进配置可用、坏对象当场抛、数组拦下、宿主入口可达） | **0** |
| `npm test`（`package.json:34` 的四套） | **25 个顶层用例：23 通过、2 套失败**（`tests/client.test.mjs`、`tests/host.test.mjs` 起不来，`ERR_MODULE_NOT_FOUND: file:///D:/src/host/logStore.js`，非断言失败） | **1** |

- **与票 02 记录对账**：票 02（`research/02-log-file-capability.md` §D2 与「附：Lead 独立复核」C）记「23 过 / 2 套失败」，本票实跑**逐字一致**；失败原因是老 monorepo 路径（`tests/host.test.mjs:15` import `ROOT/src/host/logStore.js`、`tests/client.test.mjs:19` 读 `ROOT/src/client/kernel/log.js`，`ROOT = PKG_DIR/../..`），两处都不在本仓。
- **清单套件是否全绿**：**全绿（14/14）**，且它是四套里唯一与格式判据直接相关的一套；另两套起不来的测试里**确实有**格式相关断言（`tests/host.test.mjs` 断言落盘行与旧实现逐行同形、`tests/node.test.mjs:144-160` 断言行形状——后者可跑且通过）。

## 3.5 C5 README §7/§9 点名的东西在本仓是否存在

- `research/489-appendix.md`：`Test-Path` **False**；本仓 `research/` 下只有姊妹票产出（`02-log-file-capability.md`、`03-log-level-capability.md`）。附录实体在**父仓 checkout**（`D:\dsh-plugin\dsh-main-check\research\489-appendix.md`，票 03 用过）。
- `tests/verify-log-*.js`：**14 个全不存在**；本仓 `tests/` 只有 4 个 `*.test.mjs`（`client/eventList/host/node`）。README:202-215 逐条列出这 14 条门禁命令，`INTEGRATION.md:235` 也按"14 个日志门禁全绿"作发布判据。
- 归入「与文档的出入」（见下 D3）。**说明**：这两条与本票判据强相关——它们正是"事件对照表"与"格式门禁"的**指定出处**，而两者都不在本仓 ⇒ 清单格式的**对照内容与门禁都没有落地载体**，包里只有格式与检查器（`README.md:180`、`src/config.ts:239-240` 自陈）。

## 3.6 本块判「有」的口径与两处缺口

- 判「有」的依据：三个纯函数**存在、可用、返回形状稳定、有 14/14 全绿的测试守着、经 `dsh-log/host` 可达、语法上不读盘**。
- 缺口①：**没有运行期/门禁调用方**——检查器是"给调用方发布前自查用"的（README:195-207 步骤 5、INTEGRATION.md:195-203），包内不接线。**待 Q6**：检查器红灯（`ok:false`/`problems` 非空）之后该发生什么，本仓**没有任何代码**（既不抑制也不打印、不改返回值），是否允许"红灯=抑制"由用户裁（`issues/01-untitled.md:14`「门禁红灯=抑制」、`:15`/`:41` Q6 待 R2）。
- 缺口②：`checkEventFields` 第三参非数组时静默判绿（3.1），调用方若误传字符串/`undefined` 会拿到假通过。
- 若把判据读作"检查器必须已接进门禁并有运行期效力"，本块应降为**部分**；本票按"通用检查器本身是否具备"judge 为**有**。

---

# 4. 运行期是否按格式做事：不做（清单/白名单在运行期无任何执行者）

第 1–3 节按三块判据分述；本节把「格式定义好了，运行期照不照它做」单独收口（本票第二块判「部分」的正面依据）。

- **清单在运行期的全部足迹就是"被读一次"**：`src/config.ts:107-114` 只做验形（对象当场 `parseEventListManifest`、字符串存、默认 `null` 透过），`src/client.ts:110-114` 同构；随后存进配置（`src/config.ts:122`、`src/client.ts:115`）。`src/store.ts` 里与清单相关的只有一句注释（`src/store.ts:110`），**落盘引擎一行都没读它**。
- **字段不裁剪**：入队只做 `typeof object` 兜底（`src/store.ts:294`「`fields: fields && typeof fields === 'object' ? fields : {}`」），落盘只做四键 `JSON.stringify`（`src/store.ts:374`）——白名单不是闸门。实测（探针 4）：清单给 `probe.declared` 登记了 `fields:['allowed']`，运行期写 `{allowed, forbidden, token:'ghp_plainTextSecret_1234567890'}` ⇒ **三键全落盘**，明文密钥落盘（`plaintextSecretLanded: true`）。
- **`kind` 不驱动行为**：真正决定"常驻信息开关关着也落盘"的是手写 43 条事件名名单（`src/store.ts:246-259`、`src/client.ts:263-276`），消费点只有 `src/store.ts:265`、`src/client.ts:282`。实测（探针 6）：清单自报 `kind:'resident'` 的 info 事件 `isEnabled` 为 **false**、不落盘，而不在清单里、只在硬编码名单里的 `host.start` 照落（`src/store.ts:253`）。
- **`codes`/`rules`/`guard` 在运行期零消费**：全 `src/` 检索只命中注释、类型可选键与验形（`src/config.ts:258`/`:260`/`:262`/`:349`/`:358`/`:359`/`:360-364`），无一处读值做事；`writeBatch` 只 `JSON.stringify` 四个键（`src/store.ts:371-374`）。
- **唯一的"执行者"是检查器，而检查器没有调用方**：`checkEventFields`/`checkEventCounts` 在 `src/` 里除定义无任何调用，只有 `src/host.ts:23` 的转出与 `tests/eventList.test.mjs` 的调用（第 3.1 节）；实测把宿主自己写出的行喂回检查器才判红（`unknownFields:['forbidden','token']`，探针 4）——**盘上那行早就在文件里了**。
- 仓内也**没有任何 CI 配置**（无 `.github/`、无 `*.yml`），清单格式的门禁在包内只有 `tests/eventList.test.mjs`（14/14 绿，第 3.4 节）与文档要求的发布前自查（`INTEGRATION.md:195`）。
- **待 Q6**：若哪天把白名单接到运行期做拦截（红灯就丢这条/这个字段），按地图「门禁红灯=抑制」口径即构成抑制规则——本票只报"当前不执行"，是否允许这样做由用户裁（`issues/01-untitled.md:14`、`:15`）。

---

# 5. 脱敏实现面：只有一个窄面（自监控失败行），业务字段面为零

第 2.5 节从"清单的 `codes`/`rules` 有没有消费方"入题；本节把**包里真实存在的散列/截断实现**单独盘一遍，避免把"清单语义无消费方"误读成"包里没有任何脱敏代码"。

**真实存在的实现（两处同一套身子）：**

- `src/client.ts:368-377`「散列小函数（**纯散列不记原文**；旧模块自带，包内保留一份）」——djb2 变体，回 8 位十六进制：`src/client.ts:369-374`；`src/phones.ts:37-45` 是逐字同一实现。
- **写点共 6 处，全部只记 `errorHash`，从不记原文**：
  | 写点 | 事件名 | 散列输入 | 引用 |
  |---|---|---|---|
  | 导出失败 | `log.export.fail` | 全局 `dswsLogHash`+`dswsLogTrunc` 可用时 `hash(trunc(raw,120,'error'))`，否则包内 `hash8(raw)` | `src/client.ts:383-402`（`:392`、`:397`） |
  | 开关写失败 | `host.call.fail` | `hash8(String(hint).slice(0,120))` | `src/client.ts:557-563`（`:562`） |
  | 导出拿不到目录 | `host.call.fail` | `hash8('no-dir')` | `src/phones.ts:121` |
  | 导出抛错 | `host.call.fail` | `hash8(错误 message)` | `src/phones.ts:200-204`（`:203`） |
  | 清空日期非法 | `host.call.fail` | `hash8('bad-date')` | `src/phones.ts:229` |
  | 清空抛错 | `host.call.fail` | `hash8(错误 message)` | `src/phones.ts:250-254`（`:253`） |
- 两个事件名都在常驻名单里（`src/store.ts:250`、`src/client.ts:267`），且都是 `warn` 级 ⇒ 恒落盘、开关关着也能看到（票 03 口径）。
- 形态上这**正是** Q1 口径的「记名不记文」：记的是 `errorHash` 与 `reason`/`method`/`kind` 这类代码名，原文（错误 message、路径）不落盘。

**业务事件面：零。** 普通事件的 `fields` 没有任何脱敏、截断、白名单：入队 `src/store.ts:294`、落盘 `src/store.ts:374` 都只做原样搬运；实测（探针 4）`token:'ghp_plainTextSecret_1234567890'` 原样落盘。

**与清单的关系：无关。** `codes`/`rules` 在 `src/` 只出现在注释、类型与验形（`src/config.ts:349`/`:358`/`:359`/`:360-364`），**没有一处读它们来挑散列/截断函数**；上面 6 个写点是硬编码调用 `hash8`/全局散列，与清单里写没写 `codes`/`rules` 无关。实测（探针 4）：清单配了 `codes:['H_CWD']`、`rules:['R_TOKEN_BEARER']`，落盘行里 `ruleNameLanded: false`（规则名一个都没出现）。

⇒ 按 Q1 口径「脱敏（记名不记文）=合规」：包内**在自监控失败行这一窄面上做到了**（6 个写点、只记 `errorHash`），**业务事件的字段面没有任何脱敏能力**；清单的 `codes`/`rules` 位置能表达这件事、却没有实现对接。消费方是否自己做了业务字段脱敏，本仓无从核验（见「未独立核验」）。**待 Q6**：把脱敏接到业务字段面是否算抑制，不属本票裁定。

---

# 6. 行健壮性（实测）：单行仍然是一行，坏值只坏那一行

本节把"行格式在各种脏值下还成不成立"单独收口（探针 1 与探针 7 原始输出见文末证据清单；Lead 侧 `selfcheck-05-format-lead1.mjs` L3 组独立复现同口径）。

| 输入 | 落盘结果 | 依据 |
|---|---|---|
| 值含 `\n`/`\r\n`/双引号/制表符/反斜杠/emoji/中文 | **仍是一行**：`JSON.stringify` 转义（文件里裸换行数 = 行数），该行 284 字符、`JSON.parse` 成功 | 探针 1 `probe.tricky`；`src/store.ts:374`、`:382` |
| 单字段值 200000 字符 / 1 MiB | **不截断**，仍是一行（该行 200077 字符；1 MiB 值文件 1050358 字节） | 探针 1 `probe.long`；Lead L3（`src/store.ts` 序列化前无任何长度上限） |
| `BigInt` 值 | **整行不落盘**，`dropped` +1，同批后继行照落（`probe.after-bigint` 在文件里） | 探针 1；`src/store.ts:372-379`（逐行 `try`/`catch` + `dropped += 1`） |
| 循环引用值 | 同上：丢该行 +1，后继行照落 | 探针 1；`src/store.ts:372-379` |
| **整批**全不可序列化 | 日志目录都不建、文件不产、`dropped` 0→2、`log.ready` **resolved**、调用方无异常 | 探针 7；`src/store.ts:381`「`if (lines.length === 0) return true`」 |
| 序列化失败 | **不产生任何自监控行**（文件 12 条里没有 `log.persist.fail`） | 探针 1；`src/store.ts:376-379` vs `:386-390`/`:405-410`（`notePersistFail` 只在 no-dir / write-fail 两处调用） |
| `undefined`/函数/符号值 | 该键被 JSON **静默丢弃**，行还在（`{"keep":"yes"}`） | 探针 1 `probe.undef-value`；Lead L3 同 |
| `NaN`/`Infinity` | 变 `null` | 探针 1 `probe.stringify-semantics` → `{"nan":null,"inf":null}` |
| `Date` | 变 ISO 串 `"2026-10-09T12:00:00.000Z"` | 探针 1 同 |
| `RegExp`/`Map` | 变 `{}`（自有可枚举属性为空） | 探针 1 同（`{"re":{},"map":{}}`） |
| `fields` 传数组 | **穿透**：行里 `fields` 就是数组（`["x","y"]`），不报错、不包装 | 探针 1 `probe.fields-array`；`src/store.ts:294` 只判 `typeof object` |
| `fields` 传 `null`/字符串/数字/缺省 | 一律变 `{}` | 探针 1（四个用例行字符数 73–77） |
| 危险键名 `__proto__`/`constructor`/`toString` | **不过滤**，原样落盘 | 探针 1 `probe.dangerous-keys` |

⇒ **判定：行格式在脏值下仍然成立**（可解析、一行一条、行列不被污染），代价是"坏值只坏那一行、且只计数不留痕"。其中"丢整行只计数、`ready` 不反映、无自监控行"属丢弃语义，**待 Q5**（`issues/01-untitled.md:15`、`:41`）。

---

# 与文档的出入（只列与本票判据相关的）

共 **3 条新增**（另有 2 条与票 02/03 同源，只引用不重复计）。

| # | 文档说的 | 代码/实测 | 引用 |
|---|---|---|---|
| **DF1** | 「允许字段（之外的键一律不记）」（§7 首段与 INTEGRATION 步骤 5 同口径） | **运行期不做任何拦截**：清单外字段、清单外事件名都照落（实测探针 4）。该句若读作"检查器会判红"成立（`checkEventFields` 确实判红），若读作"运行期不会记进去"**不成立**；文档未写明执行者是谁，而包里唯一执行者是**没有调用方**的检查器 | `README.md:153`、`INTEGRATION.md:205`、`src/config.ts:230-231`、`:255` vs `src/store.ts:294`、`:374`、实测 1.2/2.5 |
| **DF2** | 「脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，**命中只记规则名不记原文**）」 | **清单这一层零实现**：`codes`/`rules`/`guard` 只出现在注释、类型与验形里（`src/config.ts:224-225`、`:231`、`:257-262`、`:349`、`:358-364`），**没有一处读它们来挑散列/截断函数**；实测明文密钥原样落盘、规则名一个都没落（探针 4）。**更正（见第 5 节）**：包里并非"一行脱敏代码都没有"——`src/client.ts:369-374` 与 `src/phones.ts:37-45` 有同一套 `hash8`（注释自陈「纯散列不记原文」），挂在 6 个自监控失败写点上只记 `errorHash`（`src/client.ts:383-402`、`:557-563`，`src/phones.ts:121`/`:203`/`:229`/`:253`），但与清单声明的 `codes`/`rules` **无对接**。这是 §7 里"代码侧完全没有对应物"的一句 | `README.md:153`、`INTEGRATION.md:205`、`src/config.ts:230-231` vs `src/store.ts:368-380`、`src/config.ts` 检索（`scrub/redact/mask/脱敏` 4 命中皆注释） |
| **DF3** | 「本仓现行的事件对照表以 `research/489-appendix.md` 第 1 章与 `tests/verify-log-*.js` 为准」；§9 列出 14 条 `node tests/verify-log-*.js`；`INTEGRATION.md:235` 把它们当发布判据 | 两者在本仓**都不存在**：`research/489-appendix.md` → `Test-Path` False（附录在父仓 checkout）；`tests/verify-log-*.js` 14 个全无（`tests/` 只有 4 个 `*.test.mjs`）。另：`src/config.ts:239` 写「本仓现有 **55** 事件对照」，而父仓附录 §1 标题是「**九十二**事件对照表」（§1.4/§1.5/§1.6 三类标题 43+45+5），两者都不等于 55——**该数字疑为早期快照遗留，本票不做结论**（见「未独立核验、存疑项」）。本仓可跑的只有 `eventList.test.mjs`（14/14 绿） | `README.md:180`、`README.md:202-215`、`INTEGRATION.md:235`、`src/config.ts:239` vs `tests/` 目录实况、`D:\dsh-plugin\dsh-main-check\research\489-appendix.md:60/166/228/279` |
| 引用 | 票 02 D2 / 票 03 D2：宿主 monorepo 路径（`packages/dsh-log/...`）、`npm test` 两套起不来、README 版本号 `0.2.1` vs `package.json:3` 的 `0.2.2` | 本票实跑复现同两条（3.4 对账），**不重复列为本票出入** | `research/02-log-file-capability.md` §D1/D2、`research/03-log-level-capability.md` §D2/D3/D5 |

**同时核对相符、不算出入的断言（逐条比对过）**：

| 文档 | 实际 | 引用 |
|---|---|---|
| 落盘行含时间戳/级别/事件名/字段对象 | 四处键同序，实测 12/12 行同形状 | `tests/node.test.mjs:144-160`（实跑通过）、实测探针 1 |
| §7 的读盘与形式口径：「日志包不读盘」「路径形式请调用方自己读成对象再传入」「数组形式同样被拦下」「检查器经宿主入口导出」 | 全部相符（字符串只存不解析、验形处抛错、数组抛错；三个检查器经 `dsh-log/host` 可达且为纯函数；非数组入参静默判绿属实现细节，见 3.1） | `README.md:168`、`:170`、`:172-178` vs `src/config.ts:300-305`、`src/host.ts:23`，实测 2.4/3.2 |
| 配置表 `eventList` 默认 `null` 主路径零变化；空模板合法且随包发布 | 相符（`resolveHostLogConfig({pluginId:'wf'}).eventList === null`；模板解析通过、计数全零一致；`files` 含模板，11 个文件对账一致） | `README.md:93`、`:155`、`:196` vs `src/config.ts:107`、`package.json:20-26`、`tests/eventList.test.mjs:114-119` |
| 「`kind` 只为计数检查服务」三类解释；「三类实际条数须与清单自报的 `counts` 逐项核对」 | 相符（`checkEventCounts` 实测判红/判绿各一），且实测证明 `kind` **不驱动行为**（探针 6） | `README.md:153` vs `src/config.ts:232-233`、`:401-414` |
| INTEGRATION 步骤 5「只含一条事件的最小例子，#563 验证用同形走通，三个检查函数一次过」 | **实测三个检查器全过**：`checkEventFields` → `{ok:true,…}`、`checkEventCounts` → `{ok:true,problems:[]}`、进 `resolveHostLogConfig` 收下 | `INTEGRATION.md:167-182`、实测探针 3 |
| 导出成功 8 键/失败 4 键、`bytes` 是字符串长度、`fallback` 恒真 | 相符（实测 8/4 键、`text` 与文件字节严格相等；`fallback:true`） | `README.md:106`、`:113` vs `src/phones.ts:188-197`、`:191-192`、`:208` |

---

# 取证批次与更正

本报告的正文事实由**一次取证批次**产出（本票研究 agent：通读 `src/` 六个文件 + `README.md`/`INTEGRATION.md` + `package.json` + 四套测试 + 模板；跑探针 1–7；实跑两套测试命令），并**与姊妹票 02/03 的记录做过对账**（3.4 的测试数字、1.6 的导出形状、2.6 的 43 条名单）。第二路独立批次是 Lead 的 `.local/selfcheck-05-format-lead1.mjs`（脚本与本稿不同，逐组读数见文末附录 B），因此凡"实测"均可在本机用 `.local/selfcheck-05-format1..7.mjs` 复跑（环境：Windows、`node v24.19.0`、跑 `dist/` 产物 + 系统临时目录，未改仓库任何文件）；**每条探针的命令与关键结果逐条列在文末「证据清单」，此处不重列**。

**六点更正/收紧（相对任务书的预期，就地写明）：**

1. **「`fields` 原样透传」需收紧为「不做形状校验，只做 `typeof object` 兜底」**：数组能穿过去，行里会出现非对象的 `fields`（实测），没有任何一处会报错。原样透传的结论本身成立。
2. **「清单是不是一张没人读的表」需收紧为「只被读一次」**：建库时验形**真的**会拦下坏清单（`tests/eventList.test.mjs:128-132` 实跑通过），此后才没人读；且建库存的是**原始对象**而不是验形后的规范化副本（2.2）。
3. 探针 6 第一次跑的清单计数夹具是我自己写错的（声明两条 resident 却自报 1 条），`checkEventCounts` 当场判红——**这恰好是计数门禁有效的旁证**；我改夹具后重跑，结论未变（探针 6 现记 `manifestCounts.ok: true`）。
4. **收口复核批次（2026-10-09 22:4x，工作目录 = 仓库根）**：把探针 1–7 **原样重跑一遍**，关键数字逐项一致（探针 1：12 行、201314 字符、键集合去重后仅 `["ts","level","event","fields"]`、`BigInt`/循环引用各丢 1 行、`ready` resolved；探针 7：目录不建、`dropped` +2）；两条测试命令重跑同数（`tests/eventList.test.mjs` **14/14**、退出码 0；`npm test` **25 用例 23 过、2 套起不来**，退出码 1）。**本批次唯一的结论变更见下条第 5 项。**
5. **DF2 已就地更正（重要）**：初稿写「**全仓零实现**……无一行脱敏代码」，复核时换检索式（`hash8|dswsLog|errorHash|trunc`）发现**包里确有脱敏实现**：`src/client.ts:369-374` 与 `src/phones.ts:37-45` 是同一套 `hash8`（djb2 变体、8 位十六进制，注释自陈「纯散列不记原文」），挂在 **6 个自监控失败写点**上只记 `errorHash`（`src/client.ts:392`/`:397`/`:562`，`src/phones.ts:121`/`:203`/`:229`/`:253`）。初稿的检索式（`scrub|redact|mask|脱敏|sanitiz`）**漏掉了函数名 `hash8`**，故原判「零实现」是检索式的锅。更正后的口径（已落第 5 节、并已回改 DF2 与结论表第 2 行）：**清单声明的 `codes`/`rules` 无消费方（不变）；"包里没有任何脱敏实现"（撤回）**。
6. **新增三节**：按票面建议骨架补 `# 4. 运行期是否按格式做事`、`# 5. 脱敏实现面`、`# 6. 行健壮性`（内容与第 1/2/3 节的对应小节同源，不构成新事实，只是把"运行期效力 / 脱敏实况 / 脏值实测"三问各自收口一次）。

---

# 未独立核验、存疑项

- **`dist/` ≢ `src/` 未做字节级重生成比对**（与票 02/03 同款缺口）：本仓跑不了 `build.mjs`（`build.mjs:16` import esbuild，本机 `node_modules` 只有 typescript）。本票做的是**逐项行级比对**：`dist/store.js:210-224`（`log` 行构造）、`:290-304`（`writeBatch` 的 `JSON.stringify` 与 `join("\n")+"\n"`）、`:296`/`:300`（单行丢与计数）、`dist/client.js:143-158`（客户端行构造）、`:304`（`{entries, droppedCount}`）、`dist/config.js:106-196`（三函数与验形，逐句同构）、`dist/phones.js:144-151`/`:163`（导出 8/4 键）、`dist/host.js:46-47/52`（检查器转出）——**均与 `src` 对应行一致**；`dist/*.js` 六个文件构建时间 2026-10-07 03:47:24，晚于 `src/*.ts` 最后一次修改 2026-10-04 00:09:46。结论只覆盖"格式与检查器这一层 dist ≡ src"，**全部实测数字仍以 `dist` 为准**。
- **真实宿主内的端到端未验**：客户端探针 2 用的是桩宿主（`{call}` 直连宿主的 `handleLogBatch`），不是真实 RPC 通道；"宿主重打 `ts`、`truncated` 不落盘"发生在宿主重建那一层，与通道实现无关，但"真实通道会不会再动形状"本仓无法核验（票 03 同缺口）。
- **清单的实际消费者不在本仓**：包内没有真实清单（默认 `eventList=null`，`src/config.ts:107`；`tests/eventList.test.mjs:114-119` 实测），各插件自己的 `event-list.*.json` 与"谁在调三个检查器"都在父仓/消费方，本票**无法核验**（因此 DF1/DF2 只判「包内有没有对接实现」，不判「消费方有没有自己做脱敏」——包内确有一套只覆盖自监控失败行的散列脱敏，第 5 节）。
- **`src/config.ts:239` 的「本仓现有 55 事件对照」存疑**：父仓附录 §1 标题为「九十二事件对照表」（`:60`），分类标题为「常驻 43 条」（`:166`）、「按需 45 条」（`:228`）、「自监控 5 条」（`:279`）；43+45+5=93，与 55、92 都不等。附录自带"3 条已退役行保留"与逐条新增批注（含 2026-10-09 #958 的 #97），**该注释疑为早期快照遗留**；本票不裁定，只记录两个数字不符。
- **父仓附录里的清单实体未核验**：本票没有去父仓找"事件清单文件"本身（`event-list.*.json`），因此「父仓的清单内容是否与 43 条名单同步」属票 03 已做的"代码名单 ↔ 附录 §1.4"一致性，本票不重复也不扩展。
- **未实测的边角**：①同一批次里**部分**行不可序列化时的 `accepted`/`dropped` 回包口径（本票只测了整批坏与混合批的落盘结果，回包口径见票 02「`accepted` 恒为入参长度」）；②`checkEventCounts` 对 `events` 里带 `__proto__` 这类键名的行为（未测；`Object.keys` 语义下应正常参与计数）；③多进程共写与并发（票 02 已实测会整批丢行，不属格式判据）；④`fields` 里放 `Symbol`/`Proxy`/`toJSON` 自定义对象时的行为（只测了 `Date`/`RegExp`/`Map` 三种内建）。
- **本票不裁**：Q5（队列满/丢弃语义，凡 1.5 的"丢整行只计数"处已标「待 Q5」）、Q6（门禁红黄，凡 2.5/3.6 的"红灯之后怎样"处已标「待 Q6」）、追踪标识（票 09）、轮转（票 04）、聚合（票 06）、链路追踪（票 07）、隔离（票 08）。

---

# 证据清单

**读过的文件与行范围**

| 文件 | 行范围 |
|---|---|
| `src/store.ts` | 1-553（全；重点 87-92、239-298、330-411、461-497） |
| `src/config.ts` | 1-415（全；重点 40-130 配置键与验形、207-415 事件清单一节） |
| `src/client.ts` | 1-683（重点 25-38、96-135、257-335、440-505） |
| `src/phones.ts` | 1-315（重点 109-210 导出、211-260 清空） |
| `src/host.ts` | 1-81（全） |
| `src/node.ts` | 1-195（全） |
| `dist/{config,store,client,host,phones}.js` | 逐项比对行：`config.js:36/106-196/197-221`、`store.js:180-224/290-333`、`client.js:140-161/304`、`host.js:40-55`、`phones.js:144-163/170-199/248-255` |
| `README.md` | 1-228（全；重点 §2.1 的 50-56、§4 的 86-95、§5.1 的 101-113、§7 的 151-180、§9 的 187-220） |
| `INTEGRATION.md` | 1-235（重点步骤 2B 的 40-62、步骤 4 的 137-163、步骤 5 的 165-207、常见坑 217-225、自查清单 227-235） |
| `event-list.template.json` | 1-6（全） |
| `tests/eventList.test.mjs` | 1-144（全，逐条对行号） |
| `tests/node.test.mjs` | 1-206（全，重点 119-160、182-205） |
| `tests/host.test.mjs` | 1-40（失败点 `:15`） |
| `tests/client.test.mjs` | 1-30 + `:47`（失败点 `:19`、`verify-log-client.js` 引用） |
| `package.json` | 1-39（全） |
| `issues/01-untitled.md`、`issues/05-untitled.md` | 全文（口径与票面） |
| `issues/02-untitled.md`、`issues/03-untitled.md`、`issues/09-untitled.md:7/13` | 已结票答案形状与票 09 口径（引用） |
| `research/02-log-file-capability.md`、`research/03-log-level-capability.md` | 全文（引用与对账） |
| `D:\dsh-plugin\dsh-main-check\research\489-appendix.md` | §1 标题 `:60`、§1.4 `:166`、§1.5 `:228`、§1.6 `:279`（**父仓一级口径，不在本仓**） |

**覆盖格式判据的测试（`tests/*.test.mjs`）**

- `tests/eventList.test.mjs`（**本仓可跑，实测 14/14 通过、退出码 0**）：空模板合法 `:55-61`、白名单通过 `:63-67`、未知字段揪出 `:69-75`、未知事件 `:77-81`、计数通过 `:83-86`、计数对不上 `:88-96`、级别写错 `:98-102`、条目多键 `:104-108`、路径拦下 `:110-112`、默认 `eventList=null` `:114-119`、对象进配置可用 `:121-126`、坏对象当场抛 `:128-132`、数组拦下 `:134-136`、宿主入口可达 `:138-143`。
- `tests/node.test.mjs`（**可跑，实测 9/9 通过**）：一行一条 JSON 的行形状 `:144-160`、写盘失败只计数不抛错 `:182-205`、级别规则 `:119-142`。
- `tests/host.test.mjs`、`tests/client.test.mjs`（**本仓跑不起来**，`tests/host.test.mjs:15` 与 `tests/client.test.mjs:19` 引用不存在的 `ROOT/src/...` 旧实现）：若可跑，前者含落盘行与旧实现逐行同形等格式相关断言。

**本票只读探针（全部在 `.local/`，命名 `selfcheck-05-format<N>.mjs`，跑 `dist/` 产物 + 系统临时目录，未写任何仓库文件）**

| 探针 | 关键结果 |
|---|---|
| `selfcheck-05-format1.mjs` | 12 行、键集合唯一、末尾换行、无 BOM；转义后仍一行；超长值不截断；`undefined` 值丢键；数组 `fields` 原样；`BigInt`/循环引用各丢整行 +1、`ready` resolved |
| `selfcheck-05-format2.mjs` | 载荷 `{entries,droppedCount}`；`ts` 重打 61ms；`truncated` 不落盘；宿主按自己开关裁掉 1 条（9→8）；行与 `fields` 内无 trace/request/span |
| `selfcheck-05-format3.mjs` | 31 组验形矩阵（含 `fields:[]`、`rules` 任意字符串、`guard:''`、顶层多余键）；空模板；解析是副本、配置存原件；检查器返回形状；INTEGRATION 例子三检查器全过 |
| `selfcheck-05-format4.mjs` | 清单外字段/事件名全落盘；明文密钥落盘、规则名不落；检查器对自己的输出判红 |
| `selfcheck-05-format5.mjs` | 三入口导出面；`src/config.ts`、`dist/config.js` 零 import；形参个数 1/3/1；字符串路径抛错 |
| `selfcheck-05-format6.mjs` | 清单 `kind:resident` 不驱动行为（`isEnabled` false、不落盘），硬编码名单 `host.start` 照落；导出 `text` 与文件严格相等、`summary` 5 键 |
| `selfcheck-05-format7.mjs` | 整批不可序列化：目录不建、文件不产、`dropped` +2、`ready` resolved |

**本票用到的检索式（复核批次重跑过）**

| 检索式 | 命中 | 用途 |
|---|---|---|
| `scrub|redact|REDACT|mask|desensit|脱敏|sanitiz`（`src/`） | 4 处，全在 `src/config.ts` 的注释与字段说明（`:231`/`:257`/`:259`/`:278`），无代码 | 初稿据此判「零实现」——**该检索式漏掉了函数名 `hash8`** |
| `hash8|dswsLog|errorHash|trunc`（`src/*.ts`） | `client.ts:184`/`:369`（定义）/`:385-388`/`:392`/`:397`/`:562`/`:670`；`phones.ts:37`（定义）/`:121`/`:203`/`:229`/`:253` | 复核批次据此更正 DF2、成立第 5 节 |
| `'host\.call\.fail'|'log\.export\.fail'`（`src/*.ts`） | 名单/定义 `store.ts:250`、`client.ts:267`；写点 `client.ts:392`/`:397`/`:559`；`phones.ts:121`/`:200`/`:229`/`:250` | 确认 6 个写点全部只带 `errorHash`、不带原文 |

**复核批次的命令与原始输出摘要（2026-10-09 22:4x，工作目录 = 仓库根）**：`node .local/selfcheck-05-format1.mjs` … `7.mjs` 逐个重跑，**退出码全 0**，关键读数与本稿所引逐项一致（探针 1：`lineCount 12`、`keySets` 仅一种、`missing ["probe.bigint","probe.circular"]`、`readyState "resolved"`；探针 4：`plaintextSecretLanded true`、`ruleNameLanded false`；探针 6：`isEnabled(info, probe.claimed.resident) false` 而 `isEnabled(info, host.start) true`；探针 7：`logDirExists false`、`droppedAfter 2`）；`node --test tests/eventList.test.mjs` → `tests 14 / pass 14 / fail 0`；`npm test` → `tests 25 / pass 23 / fail 2`（失败为 `tests/client.test.mjs`、`tests/host.test.mjs` 两套起不来）。环境：Windows、`node v24.19.0`，跑 `dist/` 产物 + 系统临时目录。

**报告位置说明（仓库约定）**：本仓 `research/` 目录由姊妹票建立（`research/02-log-file-capability.md`、`research/03-log-level-capability.md`），本报告沿用同系列约定落在 `research/05-log-format-capability.md`；`research/489-appendix.md` 只作为**宿主 monorepo** 路径出现在文档与注释里，本仓不存在该文件（DF3）。本报告与全部探针均未改动任何源码、`dist/`、测试、README、INTEGRATION.md 或 `package.json`；`issues/` 下没有本票写入（票状态与答案由 Lead 经 deck 工具维护）。

---

# 附：Lead 独立复核与口径落地（2026-10-09）

## A. 口径落地（用户 2026-10-09 已确认三条，本稿按此收口）

1. **未定项处理**：按票 02（待 Q5）、票 03（待 Q5）先例——用 Q1 已定口径出结论，凡依赖 Q5/Q6 处逐处标「待 Q5」/「待 Q6」，**不阻塞、不裁策略**。
2. **「允许字段（fields，之外不记）」计入本票判定**：按 Q1「门禁红灯=抑制」，它是本包唯一被点名的那条抑制式设计（`src/config.ts:230`、`:255`、`README.md:153`、`INTEGRATION.md:205`），而它当前的唯一执行者是**没有调用方**的检查器（§3.1）——即"红灯要由调用方自己在门禁里跑，包内不接线"（仓内也**没有任何 CI**，见 B②）。故总判定落「**部分具备**」；该条"红灯之后怎样"的最终口径**待 R2 的 Q6**。
3. **行健壮性纳入实测与判定**（本稿 §1.5）。

## B. Lead 的第二路独立取证（与本稿探针分属不同脚本，结论逐条一致）

- 探针：`.local/selfcheck-05-format-lead1.mjs`（L1–L5 五组，`dist/` 产物 + 系统临时目录，跑完即删），原始输出与逐组读数另存 `.local/selfcheck-05-format-lead-notes.md`。
- 与本稿一致的复核项：落盘行四键/一行一 JSON/换行转义后仍一行/嵌套保真/`ts` 毫秒（§1.1）；清单外事件名、清单外字段、明文 `token` 全部照落，而检查器对同一行判红（§1.2、§2.5）；`BigInt` 与循环引用各丢整行、`dropped +1`、`ready` 仍 resolved（§1.5）；`undefined`/函数/符号值被 JSON 丢键、`NaN`/`Infinity`→`null`、`Date`→ISO、1 MiB 值仍一行（§1.2、§1.5）；客户端→宿主四键保真且 `ts` 被宿主重打（§1.4）；`tests/eventList.test.mjs` 14/14 全绿、`npm test` 25 用例 23 过 2 套起不来（§3.4）；宿主与客户端默认 `eventList=null`（§2.4）。
- Lead 侧补到的两条：① `dist` 侧同一批机制逐项命中（`dist/config.js:106/173/182`、`dist/store.js:148/195/296/300`、`dist/client.js:229-236`、`dist/phones.js:77/147/155-158/183/202-205`），与"格式与检查器这一层 `dist ≡ src`"互为佐证；② **仓内没有任何 CI 配置**（无 `.github/`、无任何 `*.yml`），故所谓"门禁"在包内只有 `tests/eventList.test.mjs` 与文档要求的发布前自查（`INTEGRATION.md:195`）——这直接支撑 §3.6「红灯之后没有任何代码（既不抑制也不打印）」这一缺口。

## C. 结论未变

**总判定：部分具备**——三块判据分别 有／部分／有（§1–§3）；缺口如实保留在 §1.8／§2.7／§3.6；合规面按 Q1 口径记一条抑制式设计，**待 Q6**；丢弃语义相关处**待 Q5**。

## D. 收口复核对本文的两处改动（2026-10-09 22:4x）

1. **新增三节**：`# 4. 运行期是否按格式做事`、`# 5. 脱敏实现面`、`# 6. 行健壮性`（按票面建议骨架给这三问各自一个落点）。
2. **DF2 更正**：初稿「全仓零实现/无一行脱敏代码」经 `hash8|dswsLog|errorHash` 检索推翻——包内有同一套 `hash8`（`src/client.ts:369-374`、`src/phones.ts:37-45`），挂在 6 个自监控失败写点上只记 `errorHash`（`src/client.ts:392`/`:397`/`:562`、`src/phones.ts:121`/`:203`/`:229`/`:253`）。**清单 `codes`/`rules` 无消费方这一条不变**，撤回的只是「包里没有任何脱敏实现」。三块判定（有／部分／有）与总判定（部分具备）**均未变**。
