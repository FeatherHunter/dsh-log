# 0.3.0 实现期验证记录（自查咬出的缺陷与门禁）

> 这份记录只写「怎么验的、验出了什么」——设计意图见 `research/14-architecture-plan.md`，
> 早期对抗审查的缺陷表见 `research/12-0.3.0-adversarial-review.md`。
> 时间跨度：2026-10-13 ~ 2026-10-14。所有数字都是本机实测。

## 一、门禁（每次改动后都跑）

| 门禁 | 命令 | 当前结果 |
| --- | --- | --- |
| 类型 | `node node_modules/typescript/bin/tsc -p tsconfig.json` | exit 0（`.bin/tsc` 垫片坏，必须直调） |
| 全量测试 | `npm test`（pretest 先 `node build.mjs`） | **180/180，19 套，exit 0** |
| 变异表 | `pwsh -NoProfile -File scripts/mutation-check.ps1`（随仓提交；调单条用 `-Only M63`） | **72 条，基线先全绿、逐条 RED、0 SKIP/0 GREEN**（见第五节） |
| 长跑自检 | `node tests/soak.mjs 0 --fast` / `node tests/soak.mjs 6` | 快速模式通过；全量见第四节 |
| 构建可复现 | `rm -rf dist && node build.mjs` | 产物与删除前逐字节一致 |
| 发行面 | `npm pack --dry-run` | 93 文件、44 JS + 44 个 `.d.ts`、121.0 kB（体积以当次输出为准） |

门禁的设计原则：**每条新断言都要配一条「故意改坏」的变异**，否则断言只是装饰。
变异表本身也有诚实性要求——基线不绿就整表作废；跑完必须回显「替换是否真的生效」（有两条变异因为锚点没匹配到而静默 SKIP 过，见第五节）。

## 二、自查咬出的真缺陷（按严重度）

### 1. 假 rename 适配器 → 整篇文件被覆写、12500 行静默消失（最严重）
- **怎么咬出来的**：`tests/soak.mjs` 首跑 A 段（内存风暴 20k 行 error + 反复写失败）报
  `落盘 7500/20000（dropped=0、pending=0）`——丢了 12500 行，**丢弃计数还是 0**。
- **定位**：探针 `.local/probe-storm.mjs` 用同形内存 fs 跑 20k 行 → 20000/20000 全落。
  差别只有一个：soak 的假 fs 当时写着 `rename() { return undefined }`（注释还说是「与缺 rename 同形」，
  其实是「声明了却什么都不做」）。
- **机制**：封存时 `rename` 被调用 → 不抛错、文件没搬走 → 库以为旧文已搬走，把内存里的
  `existing` 清空 → 下一次写盘只写新行、整篇覆盖 → 此前所有行消失，且计数面无任何异常。
- **修复**（`src/engine/rotation.ts`）：封存后**回查目录**——目标名不在目录里就当这次封存没发生，
  返回 `{ ok: false, reason: 'rename-not-effective' }`，降级为继续追加。
- **回归线**：`tests/rotation.test.mjs` 的 B1d（假适配器下 50 行一行不丢、无封存件、`dropped` 0、
  `reason === 'rename-not-effective'`）；B1b 断言 `reason === 'no-rename'`。
- **教训**：能力协商不能只看「方法在不在」，还要看「它做完之后世界变了没有」。

### 1b. 能力检查顺序反了 → 一行变两份（独立审查 N1）
- **怎么咬出来的**：2026-10-14 独立审查者 9506a4a0 按「`src/platform/ports.ts` 能力全可选、
  INTEGRATION.md 明文允许省略 `listDir`」这一条接入形态造适配器：**给了 rename、没给 listDir**。
- **机制**：旧实现先 rename（文件被真搬走）再回查——回查列不出目录 → 报「没封成」→
  调用方保留 `existing` 把旧文整篇写回当日文件 → **每一行在磁盘上出现两份**（当日文件 + 封存件），
  而 `dropped` 仍是 0、`ready` 仍报 ok。审查者的最小复现：60 个唯一事件在磁盘上变 121 行。
- **修复**：**列不出目录就根本不动手**（新增 `reason: 'no-listdir'`）；另外回查不到目标名时，
  再看「目录里有没有多出一个原本没有的文件」——多出来了就是搬到了别的名字上，也算搬走
  （清空 `existing`，绝不重写旧文造成重复）。判据只认「看得见的新文件」：列不出目录宁可当成没搬走
  （代价只是文件长过阈值），绝不赌它搬走了——赌错就是整篇被覆写。
- **回归线**：B1e（有 rename 无 listDir：不封存、50 行一行不丢、一行不变两份、`reason === 'no-listdir'`）；
  B1f（rename 搬到 `.9.log`：算搬走、旧文不重写、一行不变两份）。变异 M58/M59 分别咬住这两条。
- **教训**：**不可逆副作用之前先确认「做完之后验不验得了」**；顺序错了，验证再严也救不回来。

### 1b2. 修 N1 时又开了一个口子：只看「多出新文件」不够，还要看「源文件走没走」（第二轮复核 N2）
- **怎么咬出来的**：第二轮只读复核者 a3d10536 造了「`rename` = 复制到别的名字、**不删源**」的适配器
  ——跨卷搬运用 copy+unlink、unlink 那步失败或漏写就长这样，是最常见的 rename 降级实现。
- **机制**：N1 的修法里那句「目录里多出一个原本没有的文件就算搬走」被这个形态骗过：
  目标名不在、但确实多出了文件 → 判「已搬走」→ 清空 `existing` → 下一轮把整篇覆写成新行 →
  **旧行静默消失、`dropped` 仍是 0**。复核者实测 4 轮 × 10 事件：`writtenUnique=40, distinctOnDisk=30, LOST=10`，
  同一份文件里还同时出现「已封存」与 `rename-not-effective` 两种自相矛盾的记录。
- **修复**：判据加第二个必要条件——**源文件必须已从清单里消失**：
  `if (appeared.length > 0 && !srcStillThere)`。只多出新文件而源还在 ⇒ 不算搬走，降级继续追加
  （宁可文件长过阈值，也绝不赌它搬走了）。顺带把 `sealed` 记的名字改成「优先挑同基名的新文件」，
  一次多出多个文件时不再记错名字。
- **回归线**：B1g（复制异名不删源：50 行一行不丢、`reason === 'rename-not-effective'`）；
  变异 M60（去掉 `!srcStillThere` 守卫 → B1g RED）。
- **教训**：「多了一个新文件」是**间接证据**，不能单独作为「旧文已搬走」的依据；直接证据是「源文件不在了」。

### 1c. `sealSeq` 本地序号是冗余（独立审查的覆盖缺口，保留但写清理由）
- 删掉 `sealSeq.set(...)` 那一行，全量 166 例仍全绿：封存前先列目录、封存后回查目录，
  序号从清单里就数得到，本地计数在当前可达路径上是**行为惰性**的。
- 不删的理由写进 `src/core/retention.ts` 的注释：它是为「将来有人引入带缓存/最终一致的 `listDir`、
  或回查被削弱」留的命——那时序号会重复，而 `fs.rename` 是替换语义，同名封存件会被静默覆盖。

### 2. `ready` 是急切 Promise → 报「已落定」时行还在队列里
- `ready` 原为建库时创建一次的 Promise：建库后写入的行不在它的刷盘范围里，`await log.ready` 会立刻返回
  `ok:true`。改为 **getter**（`get ready() { return settle() }`），每次读都把此刻为止的队列刷到底再回报
  `{ ok, pending, lastPersistFail }`；写盘失败时 `ok:false` 且带上失败定位元。同时删掉
  `log.flush.marker` 这类写进用户文件的路标行（debug 级、默认被开关挡下，等于写了个没人看得见的内部状态）。

### 3. 常驻事件放行是包内硬编码，清单里 `kind: 'resident'` 无运行期效果
- 两端各写一份 43 条 DSH 名单，消费者在清单里声明 `kind: 'resident'` 不起作用（info 被开关挡下、
  回执还是 `skipped`）。收敛为 `src/core/resident.ts` 单源：`BUILTIN_RESIDENT_EVENTS` +
  `declaredResidentEvents(manifest)` + `residentEventSet(manifest)`，宿主与客户端各接线一次。

### 4. 宿主回 `{ ok:false }` 却不报 rejected 时客户端静默丢账
- `src/client/send.ts` 里 `dropped += Math.min(rejected, entries.length)`，rejected 缺失时为 0 →
  整批丢、计数不动。改为：`rejected` 有限且 >0 才采信，否则按 `entries.length - accepted` 兜底
  （仍不合法就整批计）。回归线在 `tests/client.test.mjs`（三档：无 rejected / accepted=1 / rejected=1）。

### 4b. 四维审查（独立审查者 1fd38375，2026-10-14）：三条文档不实 + 跨进程可观测
四维判定：质量过硬=中偏强、功能正常=强、集成简单=中偏强、README 专业=中偏强；4 条编号必改（3 条文档 + 1 条可观测）。
- **必改 1（README 头部的「error 永不丢」在 abrupt exit 下不成立）**：实测 `log('error', …)` 紧跟
  `process.exit(0)` 是 0 行落盘（「直通」只是不等 1000 毫秒防抖，写盘仍是异步的）。README 那句括号
  只点了 `warn`/`info`，读者会得出「error 不丢」。已改成「**`error` 与 `warn`、`info` 一样会丢**；
  只有 `await log.ready` / `await store.synced()` 才能保」，并写明实测现象。
- **必改 2（跨进程那句过于乐观）**：「两个真进程同目录各写各的都能成功、两边的行都在」被真并发证伪——
  两进程各写 5 行、间隔 30 毫秒，10 行只剩 9 行，双方 exit 0、不增 dropped、不落诊断行。README 已改为
  「不同时刷盘时都在；真并发会静默吃行」。
- **必改 3（INTEGRATION 路线 A 不提现成的 fs/timer 工厂）**：插件作者照抄要自己实现六个方法。步骤 2 已补
  `createNodeFileService()` / `createNodeTimer()` 可直接当 `fs` / `timer` 用，并给 5 行示例。
- **必改 4（跨进程丢行缺可观测量）→ 已实现「事后可观测」**（`src/engine/pipeline.ts`）：记住自己上次
  写完这份文件的字节数，下次读回来对不上（且这次读成功、文件名没变）就 `notePersistFail('writeBatch',
  'foreign-write', logDir)`，由既有的自监控通道落一行 `log.persist.fail`。零额外 IO（这次读本来就要做）；
  **只事后发现，挡不住读改写窗口内的并发覆写，也不猜被吃了几行**（所以不谎报 dropped）。回归线
  `tests/runtime-t7.test.mjs` 两例（外部追加 → 恰一条 `foreign-write` 且对方的行不被覆写；自己连写三批 →
  零假诊断），变异 **M61** 咬住。README 第 1 节末条与第 6 节的 reason 取值表已同步。
- **真机验证**（`.local/probe-xproc-detect.mjs`，两个真子进程、同一 `cacheDir` 同一 `pluginId`、各写 8 行、
  每行都 `await log.ready` 逼出重叠窗口）：期望 16 用户行，**实落 9 行、8 行被吃（并发覆写照旧挡不住）**，
  但盘上同时出现 **4 条 `log.persist.fail(reason: 'foreign-write')`** —— 丢行不再是静默的（改造前这一场景
  是 0 诊断、0 计数）。这条探针是 opt-in 的（真跨进程，不进 `npm test`）。

### 4c. appendText 能力：把「读改写」这条丢行路彻底绕开（用户 m07604 授权）

同一目录多实例的丢行，根因是每次刷盘都「读整份 → 拼 → 整份覆写」，两个写者的读改写窗口一重叠就吃行。
旧实现只有一个 `writeText`，所以躲不开；`rename` 早就论证过「能力协商」这条路，这里照同一模式补一个：

- `src/platform/ports.ts`：`LogFileService` / `LogPlatformFs` 各加可选
  `appendText?: (target, text) => Promise<unknown>`；`src/platform/fs-node.ts` 用 `appendFile` 实现；
  `src/node-ambient.d.ts` 补 `appendFile`。（可选 + 缺失回退 = 能力协商，不是硬依赖。）
- `src/engine/io.ts`：`canAppend()` / `appendTarget()`；`src/engine/pipeline.ts`：首触读一次定尺寸，
  之后每批只追加，并**在封存前强制读一次确认**（免得把别人的行当成自己的旧尺寸吞掉）。
- 写量对比（`.local/probe-append.mjs`，480 行、真磁盘）：改造前 `writeText` 24 次、**累计写 423660 字节**；
  改造后 `writeText` **0 次**、`appendText` 12 次、**累计写 65240 字节**（约 1/6.5，写量 O(全文)→O(新增)）。
- 跨进程真机（`.local/probe-xproc-append.mjs`，两进程各 8 行、row 与 batch 两种模式）：
  **16/16 全落、0 被吃、0 撕裂行、0 条 `foreign-write`**（对照 4b 那次的 9/16）。
- 回归线 `tests/append-write.test.mjs` 八例（真被用上 / 无能力的适配器照旧 / 追加路下轮转照旧 /
  封存前确认不被绕掉 / 尺寸是累加的 / **撒谎的适配器** / **抛错的适配器** / **按行边界切块**），
  变异 M62（无视能力）、M63（不累加尺寸）、M64（封存前不确认）、M65（不验证追加是否落地）、
  M66（判定无效却不退回读改写）、M67（判死后仍继续追加）、M68（大块一次性追加）。

**信任检查（2026-10-14 对抗审查补的一个真缺口）**：第一版追加路是
`await appendTarget(target, appended)` 之后就把字节数记进账——**信适配器一句「我写好了」**。
这和当初假 `rename` 吞掉 12500 行是同一类错：适配器可以声明了能力却什么都不做/写去别处/只写一半。
现在每份文件的**第一次**追加会独立读回来核对（长度不小于期望；用 `>=` 而不是 `==`，免得把并发写者
误判成撒谎）：核对不过 → `appendUnusable = true` + `append-not-effective` 诊断 + 抛错；
`appendText` 自己抛错 → `append-failed` 诊断 + 同样判死。两条路都由 `doOnce` 的既有重试**退回读改写**
把那批行补写进去，所以代价是「丢一次优化」，不是「丢一行」。验证是按**文件名**记的（换天换文件会重新验一次），
判死是按**实例**记的（一次失败此后一直走读改写，重启后重新验）。验证时读不回来就不下结论
（「验不了」≠「失败」），继续按自己记的尺寸走，至少不丢行。

**大块追加会撕裂（同一轮对抗审查实测出来的第二个真缺陷）**：`appendText` 走 `O_APPEND` 写，而**大块写不保证原子**。
探针 `.local/probe-append-big.mjs`（两个真子进程、同目录同 `pluginId`、各写 20 行、每行 pad 到 64 KB）：
40 行里 **2 行读不出来**（半行 JSON）；把行缩到 4 KB（60×2 行）则 0 条坏行。
修法：`src/engine/io.ts` 新增 `APPEND_ATOMIC_MAX = 4096` 与 `splitForAppend(text)`——按**行边界**把批次切成
≤4 KB 的块、一块一次追加，块与块之间只会在行与行之间交错，不会把某一行撕成两半；单行自己超过 4 KB 时整行写
（切开必然半行，这是文档写明的边界）。修后同一探针：**40 行全落、0 条坏行**。
回归线 ⑧（结构断言：单次追加 ≤4096、除最后一块外都以换行收尾、单行超限时整块写）+ 变异 **M68**。

### 5. 无效变异与假覆盖（方法学）

- **M45 无效**：把 `exports.types` 指向不存在的文件 → 测试仍绿，因为 TS 会退回同目录的 `node.d.ts`。
  改成掏空声明本体（TS2305）才 RED。
- **M20 无效**：把 `flushNow` 在途分支改成返回已 resolve 的 promise → 咬不住，因为 `synced()` 自己用
  `flushInFlight !== null` 守循环，不依赖返回值。换成承重的 `while` 条件变异才 RED。
- **M63 指错了用例（比假绿更隐蔽）**：模式写成 `追加路下轮转仍然对`，命中的是 ③（一批就超阈值，
  尺寸记不累加也照样封存），于是表里报 GREEN；而真正为它写的 ⑤（多批**小**追加）手工单跑是 RED。
  教训：变异报 GREEN 时先区分「断言没咬住」和「pattern 指错了用例」——给脚本加 `-Only <子串>`
  并**非 RED 时打印原始输出**（本次就是靠原始输出看到只跑了 ③ 才定位）。
- **M24 SKIP**：`node --test --test-name-pattern` 收的是**正则**，用例名里的 `()` 会被当空分组 →
  模式永远匹配不上、node 仍退 0 → 整张表把「根本没跑」误报成 GREEN。修法：`[regex]::Escape()` +
  只认输出里的 `✔/✖` 行。
- **`synced()` 的 `retryBuffer.length === 0` 子句**：变异后仍绿，探针证明两种实现在所有可达时序下逐项相同
  ——它是**防御性冗余**（写失败必然留下一行诊断行让队列非空），不是覆盖缺口。已在源码注释写明保留理由。

## 三、结构性验证（重构期）

- 重构纪律：**只搬代码、不改语义**，每搬一步跑全量测试 + 变异表；唯一的有意改写逐处记在计划里
  （如 `isEnabled` 的 `switchEnabled` → `getSwitchEnabled()`，脚本显式断言那处改到了）。
- `tests/arch.test.mjs`（架构门禁）把分层写进测试：core ← platform ← config ← 面与引擎 ← 入口；
  `engine/ client/ host/` 三个面互不 import、也不反向引用组合根；配置面无环；`node:` 只许出现在
  `platform/fs-node.ts`、`platform/timer-node.ts`、`node.ts`。依赖解析走 **TypeScript AST**，
  不用正则（正则看不见多行 `import ... from`，审查实测有 17% 的边被漏掉）。
- `tests/public-surface.test.mjs` 逐字钉死四个入口的运行时导出名（根 32 / host 23 / client 17 / node 4），
  重构搬文件时靠它防止公共面悄悄变化。

## 四、长跑自检（`tests/soak.mjs`，opt-in）

- **A 段 内存风暴**：20k 行 error 穿过反复写失败 → 落盘 20000/20000、写盘 40 次、`dropped` 0、`pending` 0。
- **B 段 真磁盘**：真临时目录 + 真轮转（小 `maxSize`）+ 查询 + 跨 pluginId 隔离。
  2026-10-14 全量 6 分钟实跑（391.8 秒）：460 轮、18400 条 error + 18400 条 warn **全部落盘**、
  459 个封存件与 459 条 audit 一一对应、查询到的用户行 36800 == 磁盘用户行 36800、`dropped` 0、
  另一个 `pluginId` 的目录里没有混进本实例的行 → 打印「长跑自检通过」。
- **追加路改造后的复跑**（2026-10-14，同一天晚些时候、走 `appendText` + 持续核对 + 按行重建兜底的实现）：
  6 分钟实跑 389.7 秒 —— A 段同上（20000/20000、40 次写盘、`dropped` 0）；B 段 471 轮、
  18840 条 error + 18840 条 warn 全落盘、470 个封存件对 470 条 audit、查询用户行 37680 == 磁盘 37680、
  `dropped` 0、另一个 `pluginId` 目录 19075 行未混入。
- 用法：`node tests/soak.mjs 0 --fast`（秒级）/ `node tests/soak.mjs 6`（6 分钟）。
  它**不进** `npm test` 的 glob（`tests/*.test.mjs`），属于显式触发的地基检查。

## 四之二、追加路第二轮对抗审查（2026-10-14，审查者 No-Go → 已修）

审查者对**当前**（已加「首触回读验证」的）实现重跑撒谎适配器矩阵，判 No-Go，两条都要修：

- **#1（静默丢数据）验证只做「每份文件第一次」**。适配器「第一次写对、之后不写」时，之后永久走信任分支：
  探针 `probe-a3.mjs` 实测 60 行只落 5 行、`dropped=0`、`pending=0`、`lastPersistFail=null`。
  修法：核对要么走 `sizeOf`（stat，每笔追加都核对，O(1)），要么每 8 笔 / 每 256 KB 回读一次；
  并且把「还没核对过的追加文本」攒在 `unverifiedAppends` 里——核对发现缺口时找得回那几批文本，
  才能把窗口内消失的行补回来（只记一个记账数字是补不回来的）。
- **#2（破坏性路径）验证失败后的补救把已落地的字节再写一遍**。`half`（只写一半）实测 20 行落成 31 行、
  10 行重复，并留下一条永远 `JSON.parse` 不了的粘连行；`wrote-then-throw` 也有重复。
  修法：核对出「相对基线落了多少字节」后**只补没落地的那一段**；退回读改写的兜底**按行重建**
  （保留文件里能解析且不属于本批的行，再把本批原文按序补回），这样块与块之间的空洞也不会变成重复行。

修完用**审查者自己的探针**复跑（`probe-a3.mjs` 五种撒谎形态 + `probe-a4.mjs` 逐行体检）：

| 形态 | 修前 | 修后 |
| --- | --- | --- |
| `noop`（一直不写） | 20/20 | 20/20、torn 0、dup 0 |
| `noop-after-first`（后程不写） | **60 行只落 5 行** | **60/60、torn 0、dup 0** |
| `elsewhere`（写到别处） | 20/20 | 20/20 |
| `half`（只写一半） | **20 行落成 31 行、10 重复 + 1 条粘连行** | **20/20、torn 0、dup 0** |
| `wrote-then-throw`（写完再抛） | 20 行 + 10 重复 | 20/20、dup 0 |

回归线：`tests/append-write.test.mjs` 的 ⑨⑩⑪⑫（后程撒谎、只写一半、写完再抛、无 stat 时的核对窗口），
对应变异 M72–M75（全 RED）。文档同步：README 第 1 节末条与 `log.persist.fail` 的 `reason` 取值
（新增 `append-partial`）。

**锚点维护与跑表本身的加固（2026-10-14）**：追加路重写后，M63/M65/M66/M67/M68/M72 六条变异的锚点
全部按新实现改指（旧实现行已不存在，表里一度报 SKIP；以及 M72 原锚点指向「无 stat 才走」的回读分支，
而用例的适配器有 `sizeOf`，等于没注入——改成「只在首触用 stat 核对」才咬得住）。三处跑表加固：
①单条超时 **180 秒**，超时记 `TIMEOUT` 并按「不通过」处理（实测有一条变异让用例挂死，旧脚本会一直挂
到 CI 作业上限）；②基线不再用 glob 实参（`Join-Path` 出来的是反斜杠路径，Node 22 + Windows 下与
Node 24 行为不同——CI 的变异作业就是这么一直红的），改成显式列举测试文件；③基线或闸门不通过时把
原始输出写进 `$GITHUB_STEP_SUMMARY`（GitHub 作业日志要鉴权才下得下来，summary 不用）。

### 4d. README 手册化（`c77ea6e`）与第二轮对抗审查（`6dbcc96`）

用户先问「README 能不能以使用手册视角让别人充分知道每一种用法」，补了目录、11 条任务配方、故障排查表、
公开面速查（四入口 32/23/17/4 逐字）；随后用户要求「从第一性原理出发，对抗式审查 README」，
独立审查者 `a846f773` 给出 **No-Go（窄口径，只卡 5 条）**，逐条已在 `6dbcc96` 修正：

1. **客户端 `getDroppedCount()` 不是「只数用户行」**（README 术语表与配方 ⑩ 原口径与宿主同款）：
   客户端把 `log.forward.summary` 汇总行也送进发送路径，宿主拒收时那一行同样被计入丢弃数——
   实测 1 条用户行 + 持续失败 = `dropped: 2`。文档已如实分口径（宿主只数用户行；客户端含汇总行）。
   **代码侧没改**：要精确排除得给客户端队列行加 `selfMon` 标记并逐处过滤，属于行为改动，
   记为 **0.3.1 候选**（不影响数据，只影响诊断计数）。
2. **§6.1 封存条件漏了「当日文件已有内容 > 0」**：单批自身就超 `maxSize` 时永不封存，只落一条
   `log.rotate.oversize`（实测 `maxSize=300` + 12 行一批 → 只有 `2026-10-14.log`、无封存件、无 `audit.json`）。
3. **§2.2 说 `createQuickLog`「自动找目录」** 与 §2.3 的代码事实相反：`src/node.ts:91-93` 明确抛
   「建 Node 日志库必须给 `cacheDir`」——`cacheDir` 仍必填，省掉的是文件服务与计时器。
4. **重试次数少算一次**：`LOG_RETRY_MAX_ATTEMPTS = 3` + 退避 500ms×次数 ⇒ 首发 1 次 + 最多 3 次重试 = 4 次发送。
5. **CI 是两条作业不是三条**（`.github/workflows/ci.yml`:19 `test`、:43 `mutation`；打包冒烟是 `test` 里的一步）。

同轮自审还改掉三处：§12 第 4 条仍写 0.2.x 的 `log.ready()`（0.3.0 是**只读属性**，`log.ready()` 会抛
「log.ready is not a function」）；§6.1 清空口径（点名某天会连封存件一起删——实测 `removed: 2`）；示例里的
裸 `return`（README:72 / INTEGRATION:47）。审查者另有一批正向核对为真：导出回包 8 键与
`bytes === text.length`、查询回包 6 键与「limit 上限 100」、四入口导出名与 §2.2 逐字一致、写失败语义
（`ready` 回 `{ok:false,pending:3,lastPersistFail}` 且 `dropped` 仍 0，恢复后行全落盘）、轮转成功路径
（`maxSize=300`、10 批 → `.1..8` + `audit.json` 的 `rotate.seal`，一行不丢）、跨进程追加 16 行 0 撕裂。

## 五、诚实边界（没做到的）

- **跨进程零保护**：目录占用登记是模块副本级的（`src/engine/dir-lease.ts` 的 `dirHolders`/`dirWaiters`），
  同进程两份 dist 互不可见，跨进程更不设防；文档已写成风险提示（危险窗口是并发读改写，不是必然覆写）。
- **逐字搬运无 git 基线可比**：仓库历史停在 0.2.x 时代，重构期的中间态没有提交，所以「这一步只搬了代码」
  只能靠当时的测试 + 变异表背书，不能事后独立复核。
- **`dist/` 入库**：包发出的是 `dist`（44 JS + 44 `.d.ts`）+ 两份文档 + 事件清单模板 + LICENSE，不含 `src`、不含测试；`dist` 是入库产物（构建链有 `pretest` 保证不过期）。
- **未实测**：磁盘满 / 只读盘 / 真机 rename 失败（只有内存 fs 验过）、DSH 真实宿主链路、多实例长时间 soak。
- **0.3.0 已发布（2026-10-14）**：官方源 `dist-tags.latest` = 0.3.0、`gitHead` = `c77ea6e`、93 文件 / 134.0 kB、包内文档与仓库逐字一致、陌生工程装一次运行与类型冒烟都过；原始输出与四项核对见 `notes-publish-drill.md` 第〇节。先前这条写的是「本机 `npm whoami` 报 ENEEDAUTH、需要先登录」，已由维护者提供自动化 token 完成发布。
