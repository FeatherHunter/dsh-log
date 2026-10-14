# dsh-log（日志包）

把本仓日志系统装成的 npm 包：DSH 插件与独立跑的 Node 程序都能照着它集成使用。本包由三块合成——宿主落盘引擎（#559）、客户端转发引擎（#560）、事件清单格式与通用检查器（#561），是地图 #556 的产物。

全程用词：日志系统指日志功能本身（引擎、对外接口、检查器、文档）；日志包指装着日志系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。其余高频词一次讲清：

| 词 | 含义 |
|---|---|
| 实例 | 一次建库（宿主的 `createHostLog`、Node 的 `createNodeHostLog`/`createQuickLog`、客户端的 `createClientLog`）得到的对象；队列、丢弃数、开关状态各自独立 |
| 丢弃数 `dropped` | `getDroppedCount()` 的累计值。**只数用户行**——宿主侧与客户端侧同一口径，引擎/客户端自己写的诊断行（如 `log.forward.summary`）被拒收或被裁掉都不计入 |
| 诊断行 | 引擎自己写的 `log.persist.fail`（warn 级）、`log.rotate.*`、`log.retain.*`（info 级）；不进告警面、不计 `dropped` |
| 常驻（resident） | 开关关着也落盘的事件 = 包内固定 43 个 DSH 事件名 ∪ 清单里 `kind: 'resident'` 的名字 |
| 封存 | 当日文件超过 `maxSize` 时原子改名成 `YYYY-MM-DD.N.log` 并另开新文件；改不了名就降级并留 `log.rotate.degraded` |
| 闸门 / 目录冲突 | 同一**日志目录**同一时刻只许一个活跃写者；冲突时那批行不写共享文件、计入丢弃数，之后 `log()` 抛中文错，对方交还后自愈 |
| quick | `dsh-log/node` 的 `createQuickLog`：文件服务与计时器由包提供，3 行可用 |
| `ready` / `synced()` | 「读一次刷一次」的回执 / 「刷完当期队列才 resolve」；两者都只保**调用那一刻之前**入队的行 |
| `traceChain` | 按 `traceId` 整链取行的独立通道，不受 `limit ≤ 100` 截断 |
| `v` | 行格式版本，0.3.0 恒为 `3`；`v != 3` 的旧行查询跳过并计入 `skipped` |

## 目录

- **上手**：先跑起来（30 秒）· 0. 我该读哪儿 · 0.1 常见任务配方 · 0.2 故障排查
- **接口**：1. 安装 · 2. 入口 · 2.1 独立 Node 程序 · 2.2 公开面速查 · 3. 三步接入（宿主）· 3.1 真实输出 · 3.2 怎么看日志 · 4. 配置默认值 · 5. 电话名与客户端 · 5.3 追踪链路
- **语义**：6. 失败语义 · 6.1 轮转与保留 · 7. 事件清单与检查器 · 8. 已知事项
- **维护**：9. build 与门禁 · 9.1 源码分层 · 10. 版本策略 · 11. 安全与许可 · 12. 0.3.0 迁移 7 步

## 先跑起来（quick 默认入口，30 秒）

独立 Node 程序（4 行）：

```js
import { createQuickLog } from 'dsh-log/node'
const log = await createQuickLog('/你自己决定的/日志目录')
log.store.log('warn', 'your.step.fail', { step: 'fetch' })
await log.ready   // 读一次刷一次：把此刻为止的行刷到底，再给你回执 { ok, pending, lastPersistFail }
```

> 同一**日志目录**（以及同一个开关文件）同一时刻只许一个活跃写者（0.3.0 口径）：实例的日志目录是 `<cacheDir>/logs-<pluginId>`（`pluginId` 为 `wf` 时为 `logs`，`quick` 缺省为 `logs-quick`）。
>
> - **同步入口**（`dsh-log/node`，目录同步可知）：同一日志目录的第二个活跃实例**建库当场抛**中文错；上一个实例 `release()` 之后才能接管。入口把目录解析成真实路径（`realpath`），符号链接/junction 指向同一个真实目录时同样撞键抛错。
> - **宿主入口**（`dsh-log/host`，目录要异步问宿主）：建库不抛，冲突在**写盘那一刻**判——拿不到写盘租约时最多等 200 毫秒，等不到就判冲突：那批行计入丢弃数、**不写共享文件**，之后 `log()` 抛中文错；判冲突后队列里残留的行也一律不写共享文件（同样按丢弃计），只有 `log.persist.fail` 这类自监控诊断行不丢、留着闸门解除后补写。冲突期间清空与导出降级为失败形状，不碰共享文件。开关文件同样在写盘那一刻判占用：共用同一个 `switchFileName` 的第二个实例不会覆盖前一个写下的开关。这条路径**不解析符号链接**（键取自宿主给的路径），链接与真实路径会被当成两个目录，别拿链接绕。
> - **冲突会自愈**：闸门只在「判定那一刻的持有者还在」时有效；对方写完交还或 `release()` 之后，本实例的下一行照常落盘，不必等自己 `release()`。
> - `release()` 同步幂等；释放那一刻若还有一批正在写盘，交还会延后到这批写完（同步路径下写盘在途时第二个实例仍当场抛）。
> - `await synced()` 会把闸门解除后攒下的诊断行也带出去；**闸门仍活**（对方还持有目录）时它合法滞留，此时 `getPendingCount()` 会如实大于 0，不会假报刷完。
> - 同一 `cacheDir` 下不同 `pluginId` 各写自己的目录与开关文件，可以并存。
> - **跨进程没有登记（风险提示，不是保证）**：登记表是模块副本级的，另一个进程看不见，包不做跨进程协调。实际后果取决于你的文件服务**有没有 `appendText`**（依赖表见 [INTEGRATION.md](INTEGRATION.md) 步骤 2）：
>   - **有追加能力**（`dsh-log/node` 的入口自带；宿主自己实现文件服务时包一层 `fs.appendFile` 即可）：两个进程**只会交错、不会互相覆写**。实测两进程同目录各写 8 行、每行都刷到底，16 行一行不少、无撕裂行；**大行也验过**：两进程各写 20 行、每行 64 KB，40 行一行不少、0 条半行——因为引擎会把批次按**行边界**切成不超过 4 KB 的块再逐块追加（一次大块 `O_APPEND` 写不保证原子，实测不切块时会出现 2 条读不出来的半行）。边界：单行自己超过 4 KB 时它整行写、不再切（切开必然半行），所以「一行几十 KB × 多进程同写」仍有理论风险，别这么用。
>   - **没有追加能力**（只有读改写的宿主）：后写者按自己读到的旧内容整份覆写，会吃掉对方刚写的行（实测两进程各写 5 行、间隔 30 毫秒，10 行只剩 9 行；双方 `exit 0`、不增 `dropped`）。
>   - 两种形态都补了**事后可观测**：我们记得自己上次写完这份文件的字节数，下次读回来对不上就落一条 `log.persist.fail(reason: 'foreign-write')` 诊断行（追加模式下在首触与「封存之前」各读一次，零额外 IO）。它只报告「有人动过」，不猜被吃了几行，所以 `dropped` 不会跟着涨。
>   - 自己实现文件服务时注意：声明了 `appendText` 就得**真写**。引擎不把「追加动作正常返回」当证据，而是**独立核对**：适配器给了 `sizeOf`（`dsh-log/node` 的入口给了）就每笔追加后用 stat 对一次长度；没给就每 8 笔追加或累计 256 KB 回读一次。核对发现少写了就**只补没落地的那一段**（退回读改写时会按行重建，绝不把已落地的字节再写一遍），并落一条 `log.persist.fail`：`append-not-effective`（一个字节都没落）、`append-partial`（落了一部分）、`append-failed`（`appendText` 自己抛错）。三种降级都不丢行、不重复、不留粘连半行。
>   - 正确做法仍然是一个日志目录只给一个写者：并发追加虽然不丢行，但行与行之间会交错，同一条链路的时间先后不再可信。

DSH 插件宿主侧（接线 3 步，运行依赖由宿主提供）：

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'
const registry = new Map()                                  // 这张表要留着：宿主调用通道按名字取它
const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },      // 五个运行依赖由宿主传入，最小形状见 INTEGRATION.md 步骤 2
  { pluginId: 'my-plugin', prefix: 'my-plugin' }             // 双必填：缺任一建库即抛中文错
)
registerHostLogPhones(registry, hostLog)                     // 注册 5 个写侧动作 + 1 个只读查询电话
```

> `getCacheDir`（无入参、回日志根目录）**必须给**：它是日志根目录的唯一来源，少了它每一行都无处落盘——
> 所以 `createHostLog` 建库当场抛中文错，而不是让你运行半天才发现 `dropped` 在涨。
> 其余四个依赖可省（`fs` 的读写方法要正常落盘也必须有，缺了写盘时抛「文件服务不可写」）。
> 只想在自己的 Node 程序里写日志，用上面的 `dsh-log/node` 入口即可，不必手配这五个依赖。

两条规矩（0.3.0）：保落盘认 `store.synced()`（已落地）——刷完当期队列、等到在途写盘真的收尾才 resolve，杀进程前调此即不丢；`store.flush()` 只管安排刷盘，调了不等于写完；查日志先判无权（查询电话名 = 前缀加 `.logQuery`，六参：`timeRange`、`pluginId`、`level`、`keyword`、`traceId`、`page`；宿主入口注册 5 个写侧动作加这个只读查询，共 6 个）：

```js
const res = await hostLog.store.handleLogQuery({ pluginId: 'wf' })
if (res.denied) console.warn('无权：只查自己插件的日志')   // denied 时 entries 为空，但源行没被删
else console.log(`本插件 ${res.entries.length} 行，下一页游标 ${res.nextCursor}`)
```

分页与游标（第六参 `page`，回包字段：`ok` / `entries` / `denied` / `expired` / `nextCursor` / `skipped`）：

- `page.limit` 每页上限 100；把 `nextCursor` **原样**传回下一页（格式与语义都不承诺稳定，别自己拼）。
- 游标记的是「上一页最后一行在文件里的位置」。**翻页途中新追加的行**不会让已返回的行重复、也不会漏读，所以只追加的消费方一路 `append` 即可。
- 回包里 `expired: true` 表示**当天的文件集合变了**（封存、清理、跨天）——这一页已经从最新一行重新开始，请把本次查询已累积的结果**清掉重新翻**：宁可重读，不漏读。
- `traceId` 查询走 `traceChain` 通道：整链一次给全，不受 `limit` 截断；跨桶伪造的 `traceId` 读被拒（`denied`），源行不会被删。
- `skipped` 是「v != 3 的旧格式行」计数：老版本写的行不参与查询，但仍在文件里、导出看得见。

宿主侧 `await store.synced()` 等落盘；Node 短命程序注册退出钩 `store.beforeExit()`（重复调用只注册一次），或直接 `await log.ready`（Node 入口的 ready：读一次刷一次，回执 `{ ok, pending, lastPersistFail }`，`ok` 为真才是真落定）。

## 0. 我该读哪儿

| 你的情况 | 从哪儿开始 |
|---|---|
| 写 DSH 插件，要给插件接日志 | 包内 `INTEGRATION.md` 路线 A：步骤 0 到 4 一路到底 |
| 写独立 Node 程序（不是插件），要往本地写日志 | 包内 `INTEGRATION.md` 路线 B：步骤 0、1、2B，再看步骤 4 的落点说明 |
| 已经装好，要查接口形状（电话、配置、回参） | 本文第 4 到 7 节 |
| 改了本包要发版 | 本文第 9 节；发布记录与向导在包根的 `notes-publish-drill.md`（不随包发布） |

## 0.1 常见任务配方（照抄即可）

每条都只用公开入口，并且在本仓发布前用真 tarball 实跑过一遍（开发期探针，不随包发布）；片段里出现的 `log` 是配方 ① 里那个实例，`hostLog` 是本文「宿主侧接线」那段建出来的实例。

**① 让我这次排查的详细日志落到文件**——开关是持久的，命令行工具下次运行仍生效：

```js
const log = await createNodeHostLog({ cacheDir }, { pluginId: 'my-cli', prefix: 'my-cli' })
await log.store.handleLogSetSwitch({ enabled: true })   // 写 <cacheDir>/log-switch-my-cli.json
log.store.log('info', 'my.detail', { step: 1 })          // 回执 'queued'；开关关着时回 'skipped'（是拦下，不是丢）
const st = await log.store.handleLogGetSwitch({})        // { ok: true, enabled: true }
await log.store.handleLogSetSwitch({ enabled: false })   // 排查完记得关
```

**② 让某类 `info` 不靠开关也落盘**（常驻事件）——清单里标 `kind: 'resident'`：

```js
const eventList = { version: 1, pluginId: 'my-cli', events: {
  'my.started': { level: 'info', kind: 'resident', fields: ['argv'] },   // 开关关着也落
  'my.detail':  { level: 'info', kind: 'ondemand', fields: ['step'] }    // 只在开关打开时落
} }
const log = await createNodeHostLog({ cacheDir }, { pluginId: 'my-cli', prefix: 'my-cli', eventList })
```

**③ 命令行工具退出前保证落盘**（`process.exit` 会带走队列里没写下去的行，`error` 也保不住）：

```js
const report = await log.ready          // 读一次刷一次
if (!report.ok) console.error('没落全', report.pending, report.lastPersistFail)
// 或者：进程自然退出前注册一次退出钩（重复调用只注册一次）
log.store.beforeExit()
```

**④ 追一条链路**（`child` 显式继承，不用 `async_hooks`）：

```js
const child = clientLog.child({ requestId: 'r-1' })   // 继承 traceId、刷新 spanId、seq 从 0 起
child.log('info', 'step.one', {})
clientLog.why()                                        // 三件套来源：新建/继承/透传 + shadowWarns
const chain = await hostLog.store.handleLogQuery({ traceId: clientLog.why().traceId })
chain.traceChain                                       // true：整链按 (seq, ts) 排，不受 limit 截断
```

**⑤ 多插件并存：查自己 / 查别家**——查询只回自己的桶，跨桶要宿主显式授权：

```js
// 1) 查自己：实例的 store 直接查（同一个 store 也能查别人，但只会回 denied）
const mine = await hostLog.store.handleLogQuery({ pluginId: 'my-plugin' })      // denied: false、entries 是本插件的行
const others = await hostLog.store.handleLogQuery({ pluginId: 'other-plugin' }) // denied: true、entries 空、一行不读

// 2) 需要跨插件时由宿主自己聚合：第二参是「来源」数组（每项 { pluginId, query }），
//    第三参是显式授权名单——没在名单里的来源进 denied，零行。
const sources = [
  { pluginId: 'my-plugin', query: (args) => hostLog.store.handleLogQuery(args) },
  { pluginId: 'other-plugin', query: (args) => otherStore.handleLogQuery(args) }
]
const agg = aggregateLogQuery('my-plugin', sources, ['other-plugin'], { pluginId: 'other-plugin' })
// agg.denied 里列出的就是被拒的来源；agg.entries 只含被授权来源的行
```

**⑥ 把某天的日志导出成文件**（回包 8 键，`text` 是原文）：

```js
const res = await hostLog.store.handleLogExport({ date: '2026-10-14' })   // `hostLog.store` 就是本文里的 `log.store`
await writeFile('today.log', res.text)   // res.bytes 是**字符串长度**，不是真实字节数
```

**⑦ 清历史但绝不碰今天**：

```js
await hostLog.store.handleLogClear({ date: '2026-10-01' })   // 只删那天
await hostLog.store.handleLogClear({ date: today })          // removed: 0，不碰文件
await hostLog.store.handleLogClear({ date: 'all' })          // 删所有匹配的 .log；今天可写文件、开关文件、audit.json 永不删
```

**⑧ 调轮转与保留**（默认一天一个文件、超 5MB 封存、留 14 天）：

```js
createNodeHostLog({ cacheDir }, { pluginId: 'my-cli', prefix: 'my-cli', maxSize: 1024 * 1024, maxDays: 7 })
// 也可以建好之后问状态：maxSize 是字节阈值、maxDays 是按天保留（含当天），配置非法值建库即抛
```

**⑨ 消费日志行**（落盘恒五键，自监控行按事件名前缀 `log.` 过滤）：

```js
for (const line of text.split('\n').filter(Boolean)) {
  const row = JSON.parse(line)
  if (row.v !== 3 || row.event.startsWith('log.')) continue   // 旧格式行 / 引擎自己的诊断行
  console.log(row.ts, row.level, row.event, row.fields)
}
```

**⑩ 客户端接不通宿主时**（不抛错，给机器码 + 有界重试）：

```js
const res = await clientLog.setLogSwitch(true)   // 失败时 res.ok === false，原因在 res.error（机器码，不是中文文案）
// res.error 取值：host-unavailable（没接宿主）/ host-rejected（宿主回 ok 为假）/
//   switch-timeout（看门狗 5000ms 超时）/ stale（被后一次设置顶掉）/
//   throw-unknown-endpoint / throw-connection / throw（宿主调用抛错，按错误文案归三类）
// reconcileLogSwitch 只回 { ok, enabled }，不带 error 码——要机器码就调 setLogSwitch
await clientLog.reconcileLogSwitch()             // 启动对账：以宿主那边持久化的开关为准
clientLog.getDroppedCount()                      // 传输失败先入重试位（首发 1 次 + 最多 3 次重试，退避 500ms×次数），到顶才按「被拒条数」如实计数；这个数含引擎自己那行 log.forward.summary
```

**⑪ 高频写入怎么选参数**：写盘是异步的（约 1000 毫秒防抖，`error`/`warn` 走直通不等防抖）；宿主队列默认 1000 行，满了按级别丢（普通行丢新并响一次 `onDrop`，`error`/`warn` 挤最旧普通行、挤不下就越过配额硬塞）；单文件超过 `maxSize` 封存，所以「一天的量」决定单次覆写体积。写量想从 O(全文) 降到 O(新增)，给文件服务加 `appendText`（`dsh-log/node` 自带）。要确认某一刻之前的行都在文件里，就 `await store.synced()`。

```js
log.store.setOnDrop((count, reason) => console.warn('[dsh-log] 丢弃', count, reason))  // reason: 'queue-full' | 'write-fail'
```

## 0.2 故障排查（现象 → 判据 → 处理）

| 现象 | 先看什么 | 处理 |
|---|---|---|
| 文件里没有我写的行 | `log()` 的回执：`'skipped'` 是开关拦下（不是丢）、`'queued'` 才进队列 | 打开开关（配方 ①），或把事件标成 `resident`（配方 ②） |
| `getDroppedCount()` 在涨 | `setOnDrop((count, reason) => …)` 收到的 reason 与 `getLastPersistFail()` | 调大 `maxQueue`；写失败看 `reason`（`write-fail` 恢复后会补落盘） |
| 队列压着不落 | `getPendingCount()`、`getLastPersistFail()`（`op`/`reason`/`dirHash`，不含真实路径） | 磁盘满/只读 → `no-dir`/`write-fail`；磁盘恢复后 `await synced()` 即补落盘 |
| `ready.ok` 为假 | `pending` 与 `lastPersistFail` | 同上；`ok` 为真只代表那一刻之前入队的行都落定了 |
| 刚写的行查不到 | 查询默认只看**近 24 小时**；且只看得见**已落盘**的行 | 先 `await synced()`；要查更早的窗口就传 `timeRange` |
| 查不到历史行 | `skipped` 计数（`v != 3` 的旧行）与封存/清理 | `v != 3` 的行查询跳过但仍在文件里、导出可见；封存件照常参与查询 |
| 查询回 `expired: true` | 当天的文件集合变了（封存、清理、跨天） | 清掉本次已累积结果，从第一页重新翻（宁可重读，不漏读） |
| 查询结果为空但明明写了行 | `level` 写错字（如 `'nonsense'`）会**静默回空集、不报错**；`keyword` 只匹配**事件名 + `fields` 的 JSON 文本**（不是整行、不搜别的字段） | `level` 用四级别名之一（支持逗号分隔多值）；先 `await synced()` 再查；`v != 3` 的旧行计入 `skipped` 而不出现在 `entries` 里 |
| 查别家日志回 `denied` | 跨桶读被拒是设计 | 由宿主用 `aggregateLogQuery` 显式授权（配方 ⑤）；被拒不等于源行被删 |
| 建库抛「已有活跃写者」 | 同一日志目录已有活跃实例 | 前一个实例 `release()`，或换目录；宿主入口是写盘那一刻判、会自愈；跨进程不设防（见本文开头「先跑起来」末条） |
| 开关开了 `info` 还是不落 | 宿主入口的磁盘开关在**第一次 `logGetSwitch` 电话**时才读；`dsh-log/node` 建库即读 | 按 `INTEGRATION.md` 路线 A/B 的对照表确认读取时机 |
| 文件超了 `maxSize` 没封存 | 适配器缺 `rename`/`listDir`：看 `log.rotate.degraded` 的 `reason` | 给文件服务补能力（或接受降级：继续追加、一行不丢） |
| 两个进程写同一目录 | 有没有 `appendText`：有则只交错不覆写，没有则可能吃掉对方刚写的行 | 一个日志目录只给一个写者；两种形态都会留 `foreign-write` 诊断（见本文开头「先跑起来」末条） |

## 1. 安装

```sh
npm install dsh-log
```

要求 Node 22 或更高（`package.json` 的 `engines`）。版本以包内 `package.json` 为准（官方源最新发布版见第 9 节末）——0.3.x 是断裂版本：不兼容 0.2.x，插件按本仓迁移 7 步重开发（第 12 节）。

包自带类型声明（`dist/*.d.ts`，`exports` 每个子路径都带 `types` 条件）：纯 TS 工程装上就能编译，**不需要** `@types/node`——本包公共面里不出现任何 Node 专有类型（Node 能力由 `dsh-log/node` 在实现里用，不进签名）。

## 2. 入口，按运行位置选用

- `dsh-log`：根入口，**与运行环境无关**的那一半。配置解析（`resolveHostLogConfig`/`resolveClientLogConfig`）、事件清单检查器（`parseEventListManifest`/`checkEventFields`/`lintEventFields`/`computeEventCounts`）、文件名解析（`parseLogFileName`/`listLogFiles`/`logFilesOfDate`）、行格式常量（`LOG_FORMAT_VERSION`）都在这里。宿主与客户端两半都能用，也不拖 Node 进来。
- `dsh-log/host`：DSH 插件宿主侧用。建日志库、拼电话名、注册电话名、事件清单检查器。
- `dsh-log/client`：DSH 插件客户端侧用。建日志器、电话名拼法、批量转发口径数字。
- `dsh-log/node`：**不是插件的独立 Node 程序用**（例如一个技能自己的命令行）。一句话建好落盘日志，不必自己拼文件服务与计时器。

四个入口在同一个包里，装一次全都有。

`dsh-log/node` 与前两个的区别：它不碰电话层、也没有客户端转发，只有「把日志落到本地文件」以及它背后的级别规则、目录派生与失败计数。它**不决定日志写到哪**——目录由调用方传入，入口自己不读任何环境变量、也不带默认路径。

**本包不做什么**（要在调用方自己那层做）：不自动上报日志，只做本地落盘加手动导出；不压缩、不外传归档——0.3.0 的「轮转」只在本地按 `maxSize` 改名封存、按 `maxDays` 删旧件（见第 6.1 节），不打包、不上传，也不删当天的文件。

## 2.1 独立 Node 程序怎么接（`dsh-log/node`）

```js
import { createNodeHostLog } from 'dsh-log/node'

const log = await createNodeHostLog(
  { cacheDir: '/你自己决定的/日志目录' },
  { pluginId: 'your-program', prefix: 'your-program' }
)

log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
const report = await log.ready   // 读一次刷一次；report.ok 为真才代表前面每一行都已落盘
```

建库配置双必填：`pluginId` 与 `prefix` 都要显式传，缺任一即抛中文错（0.2.x 的「prefix 缺省回退到 pluginId」已删）。两者用同一套字符约束（小写英文字母、数字、中横线，1 到 32 个字符）。

落点由 `cacheDir` 与 `pluginId` 一起决定：日志写在 `<cacheDir>/logs-your-program/2026-09-11.log`，调试开关写在 `<cacheDir>/log-switch-your-program.json`。目录不存在时入口自己建。

三条要知道的事：

1. **`await log.ready` 不能省**。落盘是先入内存队列、再由约 1000 毫秒的防抖窗口异步写下去的：程序顺着事件循环自然跑完，Node 会等这个定时器，日志自己会落；但结尾调了 `process.exit()`、抛错退出或被强杀的程序，队列里还没写下去的那批就随进程消失（**`error` 与 `warn`、`info` 一样会丢**——「直通」只是不等那 1000 毫秒防抖，写盘仍是异步的；实测 `log('error', …)` 紧跟 `process.exit(0)` 是 0 行落盘。只有 `await log.ready` / `await log.store.synced()` 才能保）。命令行工具通常在结尾显式退出，所以这条按必须处理。`log.ready` 是**读一次刷一次**的只读属性：取它的那一刻，把此刻为止入队的行刷到底，再回执 `{ ok, pending, lastPersistFail }`——`ok` 为真表示队列与重试位都空了、前面每一行都在文件里；写盘失败时 `ok` 为假、`pending` 是还压着的行数、`lastPersistFail` 是最近一次失败的定位元（`op`/`reason`/`dirHash`，不含真实路径）。磁盘恢复后再读一次就会补落盘。同一件事也可以改用 `await log.store.synced()`（刷完当期队列才 resolve，口径见第 12 节步骤 4），或先 `log.store.beforeExit()` 注册退出钩（重复调用只注册一次）。入口**不往用户文件里写任何内部路标行**（0.3.0 修正：从前那行 debug 级 `log.flush.marker` 在开关关着时根本不落盘，等于没判据）。
2. **开关每次新建时会被读回来**。独立程序每次调用都是新进程，所以入口建库时会把上次留下的开关读回来，打开的详细日志在下次调用仍然生效；写入用 `log.store.handleLogSetSwitch({ enabled: true })`。
3. **级别规则与插件侧完全一致**：错误与告警恒落盘；`info` 只在开关打开时落盘，**除非这个事件名在常驻集合里**——常驻集合 = 包内固定 43 个 DSH 事件名 ∪ 调用方清单（`eventList`）里标了 `kind: 'resident'` 的事件名；`debug` 同样只在开关打开时落盘。

## 2.2 公开面速查（四个入口的导出名）

这份名单由 `tests/public-surface.test.mjs` **逐字钉住**（数量：根 35 / 宿主 23 / 客户端 17 / Node 4）；要改公开面就得同时改那份测试与本节。跨入口同名的必须是同一个引用（同源转出口，不许各自实现）。

- **根 `dsh-log`（35）**：常量 `LOG_FORMAT_VERSION`、`EVENT_LEVELS`、`EVENT_KINDS`、`LOG_DEBOUNCE_MS`、`DEFAULT_MAX_QUEUE`/`DEFAULT_MAX_SIZE`/`DEFAULT_MAX_DAYS`、`CLIENT_BATCH_MAX`/`CLIENT_BATCH_INTERVAL_MS`/`CLIENT_PACKET_BYTES`/`CLIENT_QUEUE_MAX`、`LEGACY_LOG_DIR_NAME`/`LEGACY_SWITCH_FILE_NAME`；配置 `assertPluginId`、`resolveHostLogConfig`、`resolveClientLogConfig`、`PHONE_ACTIONS`；电话名 `buildPhoneName`、`buildPhoneNames`、`buildLogQueryPhoneName`、`LOG_QUERY_ACTION_SUFFIX`；文件名 `parseLogFileName`、`listLogFiles`、`logFilesOfDate`、`matchExportFileName`、`formatDailyFileName`、`formatFourSegmentFileName`、`resolveLogFileName`；清单 `parseEventListManifest`、`checkEventFields`、`lintEventFields`、`computeEventCounts`；读侧 `parseLogLine`、`formatRow`、`formatRows`（把落盘的一行变回人话，见第 3.2 节）。
- **宿主 `dsh-log/host`（23）**：建库 `createLogStore`、`createHostLog`；注册 `registerHostLogPhones`、`HOST_LOG_PHONE_ACTIONS`、`LOG_DIR_NAME`、`LOG_SWITCH_FILE`、`formatLogFileName`；跨插件聚合 `aggregateLogQuery`；其余（`LOG_FORMAT_VERSION`、`LOG_DEBOUNCE_MS`、`LOG_QUERY_ACTION_SUFFIX`、`buildPhoneName(s)`、`buildLogQueryPhoneName`、`resolveHostLogConfig`、`parseLogFileName`、`listLogFiles`、`logFilesOfDate`、`formatDailyFileName`、`parseEventListManifest`、`checkEventFields`、`lintEventFields`、`computeEventCounts`）是与根入口**同源**的转出口。
- **客户端 `dsh-log/client`（17）**：建日志器 `createClientLog`；批量口径 `CLIENT_BATCH`、`LOG_BATCH_MAX`、`LOG_PACKET_BYTES`、`LOG_QUEUE_MAX`、`LOG_FLUSH_MS`、`LOG_WATCHDOG_MS`、`LOG_LEVELS`、`LOG_REV`、`LOG_DEBUG_KEY`、`debugStorageKey`；电话名 `buildClientPhoneNames`、`buildPhoneName(s)`、`buildLogQueryPhoneName`、`LOG_QUERY_ACTION_SUFFIX`、`resolveClientLogConfig`（其中电话名与配置部分与根入口同源）。
- **Node `dsh-log/node`（4）**：`createQuickLog(cacheDir, pluginId?)`（最省事：文件服务、计时器都不用给——但 `cacheDir` **仍必填**，本入口不猜日志写到哪）、`createNodeHostLog({ cacheDir , fs? , timer? , joinPath? }, config)`（同样自带文件服务与计时器，只是配置要按宿主那套显式给 `pluginId`/`prefix`）、`createNodeFileService`、`createNodeTimer`（后两个可以当宿主入口的 `fs`/`timer` 用）。

## 3. 三步接入（宿主侧）

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'

// 五个运行依赖全部由调用方传入，包内不自己抓：
// fs 文件服务、timer 计时器、getCacheDir 取缓存目录函数、
// getPlatform 取平台函数、DEFAULT_CWD 默认工作目录。
// 每个依赖的最小形状与可省略项见 INTEGRATION.md 步骤 2 的形状表。
const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', prefix: 'my-plugin' }
)
registerHostLogPhones(new Map(), hostLog)
```

1. 装包。
2. 调用建日志库工厂并传插件标识与前缀（`pluginId` 与 `prefix` 双必填，缺任一即抛中文错；其余全有默认）。
3. 前缀传 `wf` 时零配置即跑：5 个动作电话名、目录名、开关文件名、按天文件名与本仓现状一字不差（`wf` 是保留命名空间，只给首个官方插件用）；注册时另加第 6 个只读查询电话 `wf.logQuery`。

第二个插件把 `pluginId` 与 `prefix` 都换成自己的标识即可：电话名自动加前缀隔离，目录与开关文件名按 `pluginId` 默认派生为不同名字，不得共用同一目录。

一次建库调用得到一个独立实例：内存队列、累计丢弃数、开关状态各自独立，互不串。

## 3.1 真实输出长什么样（2026-10-14 实跑抓取，原样贴出）

> 下面每一行都是从磁盘文件里原样读出来的，没有手写改写；`ts` 是毫秒时间戳，落盘就是「一行一条 JSON」。

**① 最省事的入口**（`createQuickLog`，见「先跑起来」）：`<cacheDir>/logs-quick/2026-10-14.log`

```json
{"v":3,"ts":1791970144215,"level":"warn","event":"your.step.fail","fields":{"step":"fetch","reason":"timeout"}}
{"v":3,"ts":1791970144215,"level":"error","event":"db.conn.fail","fields":{"host":"db-1","retries":3}}
```

`await log.ready` 的回执：`{"ok":true,"pending":0,"lastPersistFail":null}`

**② 宿主 + 客户端桥接（带追踪三件套）**：`<cacheDir>/logs-my-plugin/2026-10-14.log`

```json
{"v":3,"ts":1791970144228,"level":"info","event":"my.app.started","fields":{"port":8080,"traceId":"80670256ab1237b7","spanId":"f81528dc","seq":0}}
{"v":3,"ts":1791970144228,"level":"warn","event":"my.step.slow","fields":{"step":"fetch","ms":1200,"traceId":"80670256ab1237b7","spanId":"f81528dc","seq":1}}
{"v":3,"ts":1791970144228,"level":"error","event":"my.step.fail","fields":{"step":"fetch","status":500,"traceId":"80670256ab1237b7","spanId":"f81528dc","seq":2}}
```

- 落盘恒为**五键**（`v`/`ts`/`level`/`event`/`fields`）；`traceId`（16 位十六进制）、`spanId`（8 位）、`seq` 都住在 `fields` 里，不额外加顶层键。
- 同一条链：`traceId` 不变、`spanId` 每层刷新、`seq` 在本实例内单调（子实例从 0 起）。
- 开关文件 `<cacheDir>/log-switch-my-plugin.json` 内容是 `{"enabled":true}`。**宿主入口的开关住在宿主侧文件里**：客户端的 `log('info', …)` 想落盘，得宿主那份开关是开的（客户端 `setLogSwitch(true)` 会走电话改到宿主文件，也可以宿主自己 `store.setSwitch(true)`）。

**③ 轮转与审计**（`maxSize: 300`、4 批 × 3 行）：`logs-rot/` 里出现

```
2026-10-14.log      418 字节   ← 当前可写文件（同时只有这一个在写）
2026-10-14.1.log    261 字节   ← 封存件，序号越大越新
2026-10-14.2.log    418 字节
2026-10-14.3.log    418 字节
audit.json          354 字节   ← 逐次记账（不是日志行，读侧不当日志）
```

封存件里带着「这次封存」的那一行（原样）：

```json
{"v":3,"ts":1791970144244,"level":"info","event":"log.rotate.seal","fields":{"file":"2026-10-14.log","sealed":"2026-10-14.1.log","bytes":261,"maxSize":300}}
```

`audit.json` 一行一条记录（原样）：

```json
{"ts":1791970144243,"op":"rotate.seal","file":"2026-10-14.log","sealed":"2026-10-14.1.log","bytes":261,"maxSize":300}
```

**④ 保留字冲突**（调用方自己传了 `traceId`/`spanId`/`seq`）：`logs-shadow/2026-10-14.log`

```json
{"v":3,"ts":1791970144262,"level":"warn","event":"log.trace.shadow","fields":{"event":"my.shadow.demo","shadowed":["traceId","spanId","seq"]}}
{"v":3,"ts":1791970144262,"level":"warn","event":"my.shadow.demo","fields":{"note":"保留字归库","_shadow":{"traceId":"caller-supplied","spanId":"caller-span","seq":99},"traceId":"0e04dcae752f5864","spanId":"0cdcc3c4","seq":0}}
```

**永不整行拒收**：调用方自己的值被搬进 `fields._shadow` 保底、主行照落，另附一行 `log.trace.shadow` 说明搬了什么。

**⑤ 库自己写的诊断行**：宿主长坏时，客户端把「丢了多少」汇总成一行再试着送出去。它在客户端队列里的原样（`isDiagnostic` 是**内存标记**，不落盘）：

```json
{"v":3,"ts":1791970144267,"level":"warn","event":"log.forward.summary","fields":{"droppedDelta":1,"totalDropped":1,"reason":"send-fail","windowMs":0,"traceId":"278ba4e81c43a3a9","spanId":"9e0ba37c","seq":1},"isDiagnostic":true}
```

它被宿主收下后真会落盘（宿主先拒后通时抓到的原样一行）：

```json
{"v":3,"ts":1791970144347,"level":"warn","event":"log.forward.summary","fields":{"droppedDelta":1,"totalDropped":1,"reason":"host-reject","windowMs":65,"accepted":0,"skipped":0,"rejected":1,"traceId":"4d245b6ad8cb33a7","spanId":"d57acfc3","seq":1}}
```

- **丢弃计数只数用户行**：上面这行是库自己写的，它被拒收不会让 `getDroppedCount()` 上涨（宿主侧与客户端侧同一口径）。
- `reason` 取值：`send-fail`（没有宿主 / 发送抛错）、`host-reject`（宿主明确拒收）、`packet-trim`（超包或队列积压被裁）。

**读法速查**

| 看到什么 | 含义 |
|---|---|
| `log.rotate.*` / `log.retain.*`（info） | 轮转与保留的自监控，不进告警面、不计 `dropped` |
| `log.persist.fail`（warn） | 落盘/追加/别人动过文件，`reason` 区分是哪一种 |
| `log.forward.summary`（warn） | 客户端这一段的丢弃汇总 |
| `log.trace.shadow`（warn） | 保留字冲突；主行里 `fields._shadow` 是调用方原本的值 |
| `fields._shadow` | 被搬走的保留字（库不丢你的数据，只是不让它占库自己的键） |
| `v` | 行格式版本，0.3.0 恒为 `3`；读侧遇到 `v != 3` 跳过并计入 `skipped` |

## 3.2 怎么看日志（读侧工具）

**人话怎么写**：`event` 用稳定代码名（可 grep、可计数、可聚合），人话放进 `fields.message`。运行期不对字段做任何裁剪（白名单只在离线检查器里，见第 7 节）：

```ts
log.error('net.unreachable', { message: '网络异常：连接 api.example.com 超时 3s', host: 'api.example.com', attempt: 2 })
```

落盘仍是五键一行：

```json
{"v":3,"ts":1791971707831,"level":"error","event":"net.unreachable","fields":{"message":"网络异常：连接 api.example.com 超时 3s","host":"api.example.com","attempt":2}}
```

为什么人话不进存储格式：机器读的那份是唯一真源，人话在**读**的那一刻算——它随读者变（时区、语言、要不要看字段），写死进文件等于把一种读者的偏好固化给所有人，还要为它多付字节。清单里没登记的字段只会让离线检查器**黄灯**（`lintEventFields` 的 `severity: 'warn'`），运行期照落不误。

**库这边渲染**（`parseLogLine` / `formatRow` / `formatRows` 从根入口导出，纯函数、零 IO，浏览器与 Node 都能用）：

```ts
import { formatRow, parseLogLine, formatRows } from 'dsh-log'

const rows = content.split('\n').map(parseLogLine).filter(Boolean)      // 坏行与半行自动是 null
for (const row of rows) console.log(formatRow(row))                    // 2026-10-14 17:55:07 ERROR net.unreachable  网络异常：…  (host=api.example.com, attempt=2)
console.log(formatRows(rows, { color: true, withFields: false }).join('\n'))  // 只要人话、级别上色
```

`formatRow` 选项：`timeStyle`（`'local'` 默认 / `'iso'`）、`messageField`（默认 `message`）、`withFields: false`（只要人话）、`color: true`（级别上色，默认关）、`eventWidth`（事件名对齐宽度，默认 22）、`maxValueChars`（单个字段值上限，默认 200，超出截断加 `…`）。

**终端这边看**（`dsh-log tail`，装包即带的命令；**只读**——不写、不改、不删任何文件，也不写缓存与状态）：

```bash
npx dsh-log tail ./logs-my-plugin                   # 看最后 200 行（人话）
npx dsh-log tail ./logs-my-plugin -f                # 跟着看：先给最后 20 行，然后等新行
npx dsh-log tail ./logs --since 1h --level error    # 近一小时的所有 error
npx dsh-log tail ./logs --trace 80670256ab1237b7    # 按 traceId 追一次请求的整条链
npx dsh-log tail ./logs --json | jq 'select(.level=="error") | .event'
```

目录给插件的日志目录（里面是 `YYYY-MM-DD.log`）或日志根目录（里面是 `logs-<pluginId>/`）都认；封存件按写入先后排在可写文件之前；半行与解析不了的行一律跳过。子命令 `tail` **可写也可省**——`dsh-log <目录...>` 与 `dsh-log tail <目录...>` 完全等价；只有第一个位置参数上的 `tail` 会被当成子命令（目录名恰好叫 `tail` 时写 `./tail`）。

**把日志交出去**（`dsh-log export`，同一件工具的第二个子命令；同样只读，要留档请用 shell 重定向）：

```bash
npx dsh-log export ./logs-my-plugin > ticket.txt    # 摘要 + 原始行：贴工单、当附件都够
npx dsh-log export ./logs-my-plugin --json | jq .rows   # 只要摘要对象（给脚本用；要行用 tail --json）
```

输出两段：**目录摘要**（目录、文件清单与字节数、行数、时间范围、级别与事件分布、启动头、开关状态、哪些格子读不出来）+ **原始行**（原样，一个字节都不改）。摘要里的 `unknown` 是**如实**：没记过就说没记过——它绝不会拿「跑这条命令那个进程」的 cwd / 版本 / 平台来顶替（把读者的环境写成写者的事实，比留空更糟）。`export` 的语义是原样交出整个目录，所以 `--level`/`--since`/`--trace`/`-n`/`-f` 传给它**会当场报错**，不静默忽略。

**目录怎么自己说清「谁写的」**：Node 入口（`dsh-log/node`）建库时自动写一行 `host.start`（常驻事件，开关关着也落）：

```json
{"v":3,"ts":1791980000000,"level":"info","event":"host.start","fields":{"pid":41232,"startedAt":"2026-10-15T03:00:00.000Z","dir":"D:\\cache","pluginVersion":"1.2.3","os":"win32"}}
```

`pluginVersion` 由建库配置传入（见第 4 节）、`os` 由平台对象报出，拿不到就不写这个键。宿主入口（`dsh-log/host`）是同步建库，要自述行就显式调一次 `await store.writeStartupHeader()`。

## 4. 配置默认值派生（#558 冻结）

必填两项：插件标识 `pluginId` 与电话名前缀 `prefix`，都要显式传入，缺任一即抛中文错（0.2.x 的「prefix 缺省回退到 pluginId」已删）。两者同一套字符约束：只能用小写英文字母、数字、中横线，长度 1 到 32。收到大写直接报错，不做静默转小写；收到含点或文件不安全字符（斜杠、反斜杠、冒号、星号、问号、引号、尖括号、竖线、空格）的值同样报错，因为点留作前缀与动作名之间的分隔符，拼进目录名与文件名后必须仍是合法名字。

| 配置键 | 默认 | 说明 |
|---|---|---|
| `pluginId` | 必填，无默认 | 插件标识；目录名与开关文件名按它派生 |
| `prefix` | 必填，无默认（不再回退到 `pluginId`） | 电话名前缀；新电话名 = 前缀 + 点 + 动作名 |
| `pluginVersion` | `''`（不写这个键） | 可选的环境自述：写进启动头 `host.start` 行，最长 64 字符、不校验写法（各家版本号写法不同，本包不替调用方定标准）。不传就是没记——摘要里如实写 `unknown`，绝不拿读者的版本顶替 |
| `logDirName` | 派生 | 标识为 `wf` 时为 `logs`，其他标识时为 `logs-标识`；允许显式覆盖 |
| `switchFileName` | 派生 | 标识为 `wf` 时为 `log-switch.json`，其他标识时为 `log-switch-标识.json`；允许显式覆盖 |
| `fileNamePolicy` | `daily` | 按天（年月日点 log，如 `2026-09-06.log`）；四段式只作可选项 |
| `maxQueue` | `1000` | 宿主内存队列上限，满时按级别丢弃、只计数不抛错 |
| `maxSize` | `5242880`（5MB） | 单个当日日志文件的封存阈值（字节，按 UTF-8 计）；超了就把当日文件封存成 `<日期>.N.log` 再开新文件 |
| `maxDays` | `14` | 保留天数：早于「今天往前 `maxDays - 1` 天」的封存件会被清掉（当日文件永不清） |
| `eventList` | `null` | 事件清单注入点位（对象形式，见第 7 节；不传为 `null`，主路径零变化）。清单里标了 `kind: 'resident'` 的事件，在开关关着时也照样落盘（字符串路径形式本包不读盘，那时只有包内固定 43 个常驻名放行） |

四段式文件名的四段定死为日期点插件标识点进程号点启动时间：插件名取配置里的插件标识，进程号取不到时回退 0，启动时间取宿主建日志库那一刻（以启动头写入的 `pid` 与 `startedAt` 为准，里面的冒号与斜杠转写为中横线后才拼入）。清空与导出里按文件名匹配的正则随策略分支：`daily` 走按天正则，四段式走对应的四段正则。

## 5. 电话名、前缀隔离与客户端接入

### 5.1 五个电话

新电话名 = 前缀 + 点 + 动作名。前缀传 `wf` 时 5 个字面与现状一字不差（`wf` 是保留命名空间，只给首个官方插件）：

| 电话名（默认前缀下） | 方向 | 入参 | 回参 |
|---|---|---|---|
| `wf.logBatch` | 客户端调宿主，批量上报 | 日志条目数组（`entries`）加客户端累计丢弃数（`droppedCount`） | 是否成功（`ok`）加接收条数（`accepted`）加宿主侧累计丢弃数（`dropped`） |
| `wf.logExport` | 客户端调宿主，导出 | 可选日期（`date`），多余字段忽略 | 是否成功加文件名加长度（`bytes`，日志原文的字符串长度，不是真实字节数）加回退标记（`fallback`）加当天日志原文（`text`）加系统信息摘要（`summary`）加目录与路径（`dir`/`path`） |
| `wf.logClear` | 客户端调宿主，清空 | 日期或全部（`date` 为某天或 `all`） | 是否成功加删掉几个文件（`removed`） |
| `wf.logGetSwitch` | 客户端调宿主，读开关 | 空对象 `{}` | 是否成功加是否开启（`ok` 与 `enabled`） |
| `wf.logSetSwitch` | 客户端调宿主，写开关 | 是否开启（`enabled`；0.3.0 起没有采样率这个参数） | 是否成功加实际生效的是否开启（`ok` 与 `enabled`） |

前缀只隔离电话名，不隔离磁盘上的文件，磁盘隔离靠上面的目录名与开关文件名默认派生。宿主注册电话名时，若该名字已被注册，则报错、不覆盖旧的。第二个插件必须显式传自己的 `prefix`（前缀不再回退，缺即抛中文错）；`wf` 是保留命名空间，新插件传自己的标识才自然隔离。

写侧 5 个动作之外还有一个只读查询电话 `前缀.logQuery`（由 `buildLogQueryPhoneName` 派生，六参见第 7 节前的查询说明）：宿主入口 `registerHostLogPhones` 一共注册 6 个（上面 5 个写侧 + 这个只读查询），撞名同样抛、不覆盖旧的；`hostLog.phoneNames` 那份冻结映射仍只有 5 个写侧动作名。

导出回包有三种形状，**按 `ok` 与 `fallback` 判断，别按键数分支**：正常成功回 8 键（含原文 `text`、摘要 `summary`、目录与路径 `dir`/`path`）；**该日没有文件**时仍回 8 键、`ok: true` 且 `fallback: true`（`text` 可能是空串）；**导出过程内部抛错**时回 4 键（`ok: false`、`fileName`、`bytes`、`fallback`），拿不到日志根目录时回 8 键但 `ok: false`。

### 5.2 客户端两种消费方式（二选一）

两种方式行为一致，选一种即可，推荐直接 import。

方式一，直接 import（推荐）：调用方写 `import { createClientLog } from 'dsh-log/client'`，把四个依赖与插件配置传进来，当场得到日志器，打包工具正常解析 import。

```js
import { createClientLog } from 'dsh-log/client'

const clientLog = createClientLog(
  { host, timer, storage, broadcastLogSwitch },
  { pluginId: 'wf', prefix: 'wf' }
)
clientLog.log('info', 'my.event', { step: 'started' })   // info 需开关打开；想让某类 info 恒落盘就把事件标成 kind: 'resident'（第 7 节）
```

客户端配置同样双必填：`pluginId` 与 `prefix` 都要显式传，缺任一即抛中文错；两端（宿主与客户端）传同一对值，拼出的电话名自然对上。

四个依赖全部由调用方传入（全可选，缺了走退化路，不抛错）：宿主调用器 `host`（只用 `call` 一个方法，桥接写法见 INTEGRATION.md 步骤 3 的三行示例）、计时器 `timer`（只用 `timeout` 一个方法，没有就回退全局函数）、存储 `storage`（只用读写两个方法，没有就每次用默认；旧闭包名 `localStorage` 仍认，两个都传以 `storage` 为准，新接入只传 `storage`）、开关广播 `broadcastLogSwitch`（一个无参函数，没有就不广播，不报错）。另有一个可选依赖 `hashFn`（`(字符串) => 字符串`），用来替换包内默认的 8 位十六进制散列，见第 8 节。

方式二，文本拼接（只给把客户端拼进插件主文件闭包一起运行的插件用）：构建时取客户端入口编译后的声明体，去行首 `export` 后拼进插件主文件闭包，调用时把闭包里现成的四个名字原样传给工厂。文本拼接消费方式只走客户端入口的声明体文本。本仓当前插件本次不切拼接源（默认 `wf` 下行为零变化），拼接形态留给第二个插件验证。

客户端批量转发口径（#558 冻结，复用 `CLIENT_BATCH` 常量，不另写一遍）：每批最多 50 条、每 1000 毫秒发一次、单包约 128KB 或队列 100 条先到先截，裁掉的记入丢弃数。开关看门狗超时 5000 毫秒，只记一行告警，不改返回值。本地开关存在本地存储里，键名是 `dsws.debug.<pluginId>`（0.2.x 的单键 `dsws.debug` 已作废），形状是 `{ enabled, rev }`（0.3.0 删掉了从没生效过的 `sampleRate`；旧值里多带的键一律忽略、照旧读得回来），默认关闭。建日志器时同步读本地做界面秒显，随后启动对账再向宿主看齐（以宿主为准）。

日志器的调用面（`createClientLog` 的返回对象）里，接入要用的是下面两类；对象上还有队列、开关状态等内部字段，调用处可以直接读，改开关请走第二类里的两个方法：

- 与宿主同名同参同语义的四个：是否允许记（`isEnabled`）、记一行（`log`，**回执也是同口径**的 `'queued' | 'skipped' | 'dropped'`：`skipped` 是被开关挡下、不是丢；`dropped` 是满队列丢新、计入丢弃数）、立刻转发或刷盘（`flush`，客户端侧只管转发，不管落盘；调转发后约 1 秒可见、不调约 2 秒、错误与告警直通，见 INTEGRATION.md 步骤 4）、读累计丢弃数（`getDroppedCount`）。
- 客户端独有的两个开关动作（写开关界面时要用，最容易漏）：`setLogSwitch(是否开启)` 写开关（宿主生效才更新本地与内存；失败原因只给机器码），`reconcileLogSwitch()` 启动时向宿主对账（以宿主为准）。用法见 INTEGRATION.md 步骤 4 与步骤 6。

### 5.3 追踪链路（#24）

三件套 `traceId`/`spanId`/`seq` 只住 `fields` 里，落盘行仍是五键 `{v,ts,level,event,fields}`——不给行加键，老解析器不会因为多一列而崩。

- **自动建链**：没传 `traceId` 时 SDK 自己建（16 位十六进制）。`error`/`warn`/`info`/`debug` **一律建链**（0.3.0 删掉了只影响建链、不拦行的采样率——要抑制 `debug` 请用开关，别用「半建链」）。
- **显式继承**：`log.child(ctx)` 继承父链的 `traceId`、刷新 `spanId`、子实例 `seq` 从 0 重起。不用 `async_hooks`（DSH 双端都跑不动它）——**漏传 `child` 就是新链**，不做隐式合并。
- **可解释**：`log.why()` 回报三件套的来源（新建/继承/透传）与影子计数（`shadowWarns`）。
- **保留字冲突永不整行拒收**：`fields` 里误带 `traceId`/`spanId`/`seq` 时，`error`/`warn` 照落盘，冲突的值搬进 `fields._shadow`，另落一行 `log.trace.shadow`（warn 级）并计入 `shadowWarns`。可靠性优先于正确性。
- **查询联动**：`logQuery` 的 `traceId` 是一等参；整链查询走独立 `traceChain` 通道，**超 100 行也不断链**（不受 `limit ≤ 100` 截断）。跨桶伪造 `traceId` 的读会被拒（`denied`），但源行不会被删。

**宿主侧也有链上下文**（`store.trace()`，0.3.3 起）：宿主写日志不必自己造三件套——

```ts
const task = log.store.trace()                        // 建一个链上下文：traceId 自动生成
task.log('info', 'task.start', { message: '开始处理' })
const step = task.child()                             // 子上下文：traceId 不变、spanId 换新、seq 从 0 起
step.log('warn', 'task.step.slow', { message: '这一步慢了' })
task.log('error', 'task.fail', { message: '失败' })   // 父上下文 seq 接着走
task.shadowWarns                                      // 调用方自带的保留字被搬进 fields._shadow 的次数
```

规则：**谁声明链路谁拥有保留字**——经 `trace()` 写的行，调用方传的 `traceId`/`spanId`/`seq` 会被搬进 `fields._shadow`（主行用上下文的那份）；被开关挡下的行**不占号**（与客户端同口径，`dropped` 与写失败照样占号）。不经上下文的 `store.log()` 一律**原样透传**（0.3.0 起的行为一字不变，有回归线钉着）。

## 6. 失败语义（#558 冻结）

失败只计数不抛错：队列满、转发失败都只加到累计丢弃数里；写盘失败**先不丢行**——整批进重试位，有界自动重试（退避定时器，到顶后等下一次 `log()`/`flushNow()`/`synced()` 再试），只有**还压在内存里的行**（重试位 + 队列）超过上限（`maxQueue × 10`）才丢最旧的**普通行**并响一次 `onDrop('write-fail')`，`error/warn` 留到最后。所有电话失败都回是否成功为假的结构，不抛异常。三处例外原样保留，不扩大：

- 唯独记录电话（`logBatch`）的最外层例外（入参本身爆炸、一行都没进）回**失败**加接收 0 条（`ok` 为假、`accepted` 为 0）——0.2.x 曾回 `ok` 为真，0.3.0 起如实报失败。
- 导出电话多余字段忽略（多传的字段不改变行为）。
- **目录冲突（#19 隔离）**：同一个日志目录已有别的活跃写者时，`log()` 抛中文错——这是唯一会抛的运行时路径（同步入口连建库都抛）。冲突期间清空与导出降级为失败形状（`ok` 为假、不删不读共享文件）：宁可失败，也不并发覆写同一份日志。

`logBatch` 的回包说实话（#19 审查必改 R1）：`accepted` 只数**真进了队列**的条数，本批有一行没进就回 `ok` 为假（调用方由此可算被拒条数＝`entries.length - accepted`）；`dropped` 仍是宿主侧**累计**丢弃数，不是本批的。累计数只数用户行：`log.persist.fail`、`log.rotate.*` 这类内部诊断行不计入（它们自己落盘失败也不计）。注意 `ok` 为真只代表**已进落盘路径**，不代表已落盘——写盘失败时行进重试位（有界重试，磁盘恢复后补落盘），那一刻仍是 `ok` 为真加 `dropped` 不变；要确认真的落盘请 `await store.synced()`。

开关读写失败保持旧值，不回退为开启。客户端写开关失败原因只给机器码（`host-unavailable`、`host-rejected`、`switch-timeout`、`stale`，宿主调用抛错时按文案归为 `throw-unknown-endpoint` / `throw-connection` / `throw` 三类），面向用户的文案由界面经多语言系统转换。

`log.persist.fail` 的 `reason` 取值（都是内部自监控行，`level` 为 `warn`，不计入 `dropped`）：`write-fail`（写盘重试后仍失败，行在重试位）、`dir-conflict`（目录或开关文件被别的活跃写者占着）、`no-dir`（取不到日志目录）、`foreign-write`（**跨进程可观测**：下次读回来发现这份文件的长度与我们自己上次写完的对不上——说明有别的写者动过它，见第 1 节末条）、`append-not-effective`（自己实现的 `fs` 声明了 `appendText` 却一个字节都没写：独立核对发现长度没涨，那批行改用读改写补上）、`append-partial`（`appendText` 只写了一部分——含「写完才抛错」的情况：核对发现少了多少就只补那一段，绝不整篇重写）、`append-failed`（`appendText` 直接抛错，同样退回读改写）。这三个都在把追加能力判死之后才记，一个实例最多各记一次；`foreign-write` 只报告「有人动过」，不猜被吃了几行，所以丢弃数不会跟着涨。

## 6.1 轮转与保留（#21）

一天一个可写文件：`<cacheDir>/logs-<pluginId>/YYYY-MM-DD.log`。写盘是「读旧文 + 拼新行 + 全文覆写」（文件服务没有追加原语），所以按天分文件把单次覆写体积封顶在一天之内；再超就在写之前封存。

- **封存**：写这批之前，若「**当日文件已有内容 > 0**」且「已有内容 + 这批要写的字节数 > `maxSize`」，先把当日文件**原子改名**成 `YYYY-MM-DD.N.log`（`N` 从 1 起取当前没占用的最小序号），再新建当日文件写这批；封存成功记 `audit.json` 一条 `rotate.seal`，并落一行 info 自监控 `log.rotate.seal`（带 `file`/`sealed`）。**一批自身就超阈值时不封存**（没有旧文可封，封了也白搭），改成落一行 `log.rotate.oversize`（见下一条）——实测 `maxSize: 300` 时一次性入队 12 行（约 1.3KB）只会写在当日文件里，不会产生封存件。
- **不能安全封存时就降级**：绝不拿「复制 + 截断」冒充原子改名，也绝不在一行会变两份的路径上动手。落一行 info 自监控 `log.rotate.degraded`，`reason` 如实写是哪一种：
  - `no-listdir`——适配器没提供 `listDir`（列不出目录就无法在改名后验证，所以**根本不改名**）。这是能力协商的第一道闸：rename 是不可逆副作用，验不了就别做；
  - `no-rename`——适配器没提供 `rename`；
  - `rename-threw`——rename 抛错；
  - `rename-not-effective`——rename 没抛错，但回查目录时目标名不在、且**源文件还在清单里**（空实现、返回 undefined、忘了 await 自己的异步改名、「复制到别处但没删源」都算）。
  四种情况都继续追加、一行不丢。两条判据的理由：**先看能不能验证再动手**——否则文件被真搬走却报「没封成」，调用方会把旧文整篇写回当日文件，每一行在磁盘上出现两份（而 `dropped` 仍是 0）；**改名后一定要回查目录**——rename 只代表「调用方说它成功了」，不代表文件真搬走了，照单全收会让下一次写盘把整篇覆盖成新行，此前所有行静默消失（2026-10-14 的 20k 行风暴实测丢了 12500 行而 `dropped` 仍是 0）。反过来，若回查时目录里**多出了一个原本没有的文件、同时源文件已经不在清单里**，就说明它搬到了别的名字上——这也算搬走（清空内存里的旧文，绝不重写一遍造成重复），`log.rotate.seal` 行里 `sealed` 记实际出现的新名字。**两个条件缺一不可**：只多出新文件而源文件还在，那是「复制到别处但没删源」（跨卷搬运用 copy+unlink、unlink 失败或漏写就长这样），不算搬走——否则会把整篇覆写掉（第二轮复核实测丢 10/40 行、`dropped` 仍是 0）。
- **保留按天**：每次写盘前顺手清过期——日期早于「今天往前 `maxDays - 1` 天」的 `.log` 删掉；当日可写文件、开关文件、`audit.json` 永不删。清理记 `audit.json` 一条 `retain.evict`（带 `removed` 列表与 `keptDays`），并落一行 info 自监控 `log.retain.evict`。
- **单批自己就超阈值**：这批的字节数本身就大于 `maxSize` 时无法封存（没有旧文可封），照常写入并落一行 info 自监控 `log.rotate.oversize`（带 `file`/`bytes`/`maxSize`）——不静默。
- **审计**：日志目录里的 `audit.json` 逐条记账（`rotate.seal`、`retain.evict`），一行一条 JSON。
- **自监控不进告警面**：`log.rotate.*` 与 `log.retain.*` 都是 **info** 级，不占 `warn`/`error` 的队列配额与告警面，也不计入累计丢弃数（`dropped` 只数用户行）。
- **清空**：`logClear` 点名某天删**那天的全部文件**——可写的 `YYYY-MM-DD.log` 与封存件 `YYYY-MM-DD.N.log` 一起删（一天是一个单位；四段式策略下删那一天的全部文件）；点**今天**直接回 `removed: 0`、不碰任何文件；`date: 'all'` 删日志目录里所有匹配文件名的 `.log`（往日可写件与往日封存件都删），但**今天的可写文件与封存件**、开关文件、`audit.json` 永不删。实测三条：往日「可写 + 封存」两份 → 点名该日 `removed: 2`；点今天 `removed: 0`；`all` 只删往日那两份、当天三份文件原样。

## 7. 对象清单、模板与检查器（#561）

每条事件四样东西：事件名、级别（`error`、`warn`、`info`、`debug`）、允许字段（fields，清单内登记、自查用；运行期原样透传、不裁剪）、脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，命中只记规则名不记原文）。`kind` 三类：`resident` 常驻（**开关关着也落盘**的轻量轨迹）、`ondemand` 按需（只在调试开关打开时记）、`selfmon` 自监控（日志管道自己的故障行）；三类条数由实现自算（`computeEventCounts`），清单里不再手填 `counts`（0.3.0 已删：解析时忽略，缺失也不抛）。`guard` 可选，一句话写清采样或节流，无特殊守卫不写。

空模板见包内的 `event-list.template.json`（模板里的 `pluginId` 换成自己插件的标识；模板已按 0.3.0 删掉 `counts`——老清单里若还留着那一行，解析时忽略，删不删都行。只含一条事件的最小填好例子见 INTEGRATION.md 步骤 5）。调用方把清单拼成对象传给 `eventList`：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-plugin.json', 'utf8'))

const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', prefix: 'my-plugin', eventList: myEventList }
)
```

路径形式请调用方自己读成对象再传入，日志包不读盘（字符串直接传给 `eventList` 只存不解析，检查器收到字符串会报错并提示先读成对象；这种情况写侧也读不到 `resident` 声明，只有包内固定 43 个常驻名照旧放行）。对象形式的清单当场验形状，错了直接报错（含中文说明），不静默修补；数组形式同样被拦下（只收对象，数组多半是把事件表直接当成了清单）。

想让自己的 `info` 事件在开关关着时也落盘，就在清单里把它的 `kind` 写成 `resident`——写侧放行集合是「包内固定 43 个常驻名 ∪ 清单里 `kind: 'resident'` 的事件名」，宿主引擎与客户端共用同一份（`src/core/resident.ts`）。不写清单、或不标 `resident` 的 `info` 事件默认仍被开关拦掉（返回 `'skipped'`，不计入丢弃数）。

检查器经宿主入口导出，都是纯函数，不新增日志事件：

```js
import { parseEventListManifest, lintEventFields, computeEventCounts } from 'dsh-log/host'

const manifest = parseEventListManifest(myEventList)
lintEventFields(manifest, 'gh.exec', ['argv0', 'cwdHash'])
computeEventCounts(manifest)
```

`parseEventListManifest` 验形状；`lintEventFields` 做字段白名单检查，只有黄/红两档（未知字段键 warn、未知事件名 error，红不拦上线）；`computeEventCounts` 按 `kind` 自算三类条数（清单里的 `counts` 不再手填，唯一真源就是它）。0.3.0 起 `checkEventCounts` 已删（拿自算值和自算值核对是同义反复，检查不出东西），`checkEventFields` 保留。

门禁走快照确认制（#18 Q6），只有黄/红两档：黄 warn——清单新增字段但快照未更新（跑 `node tests/update-snapshots.mjs` 转绿，不拦排障）；红 error——未知事件名、envelope 非法（落盘行五键 `{v,ts,level,event,fields}` 中 `v` 不为 3 或形状不对）、事件总数突变（与 `tests/event-snapshots/_baseline.json` 比 ±超 5 且 `tests/event-snapshots/CHANGELOG.md` 无说明；红的是“无 changelog”不是字段本身）。每事件批准字段集 check-in 在 `tests/event-snapshots/`（初始从 `tests/eventList.test.mjs` 的 `makeSample` 事件生成），`tests/snapshot.test.mjs` 守两档口径，跑法见第 9 节。本仓的事件对照表就是这套快照（条数会随票增删，别在文档里抄一个数字）；宿主 monorepo 里的 `research/489-appendix.md` 不在本包、也不在本仓，不是这里的门禁依据。

## 8. 已知事项（0.3.0 收口的两条）

1. **散列与截断不再走全局**：`dswsLogHash` 与 `dswsLogTrunc` 两个全局裸函数已删，包内不再读全局对象。导出失败行（`log.export.fail` 的 `errorHash`）默认用包内 8 位十六进制散列；要用自己的散列（例如与旧模块一字相同），经 `createClientLog` 的可选依赖 `hashFn`（`(字符串) => 字符串`）注入，注入失败时回退包内散列。截断固定为错误消息前 120 字切片，不再有注入位。
2. **存储键仍认一个旧名**：正式键是 `storage`；旧闭包名 `localStorage` 仍被接受（迁移期兼容），两个都传以 `storage` 为准。新接入只传 `storage`。

## 9. 发布前 build 与门禁跑法

发布前按顺序两步（演练只跑 dry-run，不真发）。本节命令都在包根（本仓根目录）执行：

```sh
node build.mjs
npm publish --dry-run
```

`node build.mjs` 先跑 `tsc --noEmit` 类型检查，把 `src` 下 52 个可转译 TS（含子目录，按目录结构一对一转译；不含 `node-ambient.d.ts` 这类声明文件）写进 `dist`（转译优先用 esbuild，没装 esbuild 时自动回退 TypeScript 自带转译器；可执行入口的 shebang 会被补回**第一行**，否则 `npx dsh-log` 装出来不能执行），最后再用 `tsconfig.build.json` 产出与 `src` 同形的 `dist/**/*.d.ts`——**声明由 tsc 出，不由转译器猜**（缺一个声明，构建就报错退出）。发布白名单（`files`）打进 109 个文件：`dist` 下 52 个 JS + 52 个 `.d.ts`、`event-list.template.json`、`INTEGRATION.md`、`README.md`、`LICENSE`、`package.json`（`npm publish --dry-run` 可自查：文件数与体积以**当次**输出为准——它们随打包时刻变化，本文件不抄具体值）。加新文件进包时同步改 `files` 并重跑 dry-run 确认文件数；改了 `src` 必须重跑 build——本仓当前把 `dist` 一并提交，只改 `src` 不生成产物会留下过期实现。

门禁跑法（改包后全跑，退出码全 0 才算过）：

```sh
npm test                              # = node --test "tests/*.test.mjs"：宿主、客户端、事件清单、Node 入口、全栈隔离、轮转与保留、常驻级别（清单声明放行）、运行时行为（T7）、快照门禁、查询分页（#20）、追踪链路（#24）、端到端真机链路、接缝不变式（#25）、硬杀耐久（#23）、追加写、读侧渲染、读侧命令行、读侧导出（目录摘要）、目录自述（启动头）、宿主链上下文（store.trace）、发行面（#27）、消费方类型编译（#27）、公开面快照、架构门禁（分层与环）——共二十四个测试文件、node 自报 24 套
node --test tests/snapshot.test.mjs   # 单跑快照确认制门禁
node tests/update-snapshots.mjs       # 清单新增字段后：先把黄转绿再提交（这是更新快照，不是判绿）
node scripts/pack-smoke.mjs           # 打包冒烟：真打包 + 真装进全新工程 + 真写一行（发行面一层）
```

CI 已把上面这些固化成**两条作业**（`.github/workflows/ci.yml`）：`test` 是测试矩阵，在 **ubuntu 与 windows 各跑 Node 22 / 24**（含类型检查、`npm test`、快速长跑、打包冒烟——**打包冒烟是这一步里的一步，不是独立作业**）；`mutation` 只在 windows 上跑（脚本是 PowerShell），**基线不绿即整表作废，出现一条不是 RED 的变异就 exit 1**；没有 lockfile，所以用 `npm install` 而不是 `npm ci`。

快照门禁只有黄/红两档（#18 Q6）：黄 warn——清单新增字段但快照未更新（`tests/snapshot.test.mjs` 只警告不判红，跑 `node tests/update-snapshots.mjs` 一键更新即转绿，不阻排障）；红 error——未知事件名、envelope 非法（落盘行五键 `{v,ts,level,event,fields}` 中 `v` 不为 3 或形状不对）、事件总数突变（与 `tests/event-snapshots/_baseline.json` 比 ±超 5 且 `tests/event-snapshots/CHANGELOG.md` 无说明；红的是“无 changelog”不是字段本身，补说明后跑更新命令即转绿）。事件条数就记在 `tests/event-snapshots/` 这套快照里，别在文档里抄数字。

`npm test` 的用例清单来自 `package.json` 的 `test` 脚本（上面那二十四个文件、共 **217 例**；`pretest` 会先跑 `node build.mjs`，所以测试一定在最新产物上跑）。类型检查：`npm run typecheck`（脚本内已直调 `node node_modules/typescript/bin/tsc`，绕开仓库里那个指向失效路径的 `.bin/tsc` 垫片）。发行面那两套（`release-surface`、`consumer-types`）会把包按 junction 装进临时工程、用真 tsc 编译一次，所以「类型能不能被消费者用上」是门禁里跑出来的结论，不是文档里的承诺。

### 9.1 源码分层（贡献者视角）

`src` 按「依赖只许向右」分成五层（`tests/arch.test.mjs` 的 `layerOf()` 就是这五档，违反即红，不是文档约定）：

```
入口层    index.ts（根入口）· node.ts（Node 入口）· host.ts（宿主入口）· cli.ts（命令行入口，带 shebang）
   ↓
面与引擎  store.ts · phones.ts · client.ts          ← 组合根：只做装配与接线
          engine/  pipeline（行流水线：准入/队列/刷盘/重试）· dir-lease（目录租约）·
                   io（IO 端口）· rotation（封存/保留/审计）· switch-file（开关文件）
          host/    query（只读查询电话）· files（导出/清空）· aggregate（查时授权聚合）· context · types
          client/  write（主写路径）· send（取批/裁剪/重试位）· switch-ops · switch-cache ·
                   trace（追踪三件套）· forward（丢弃汇总）· transport · types
          cli/     args（命令行参数解析）· tail（按写序读、渲染、跟读）· export（交日志：摘要 + 原始行）
   ↓
配置面    config.ts（门面，只 re-export）+ config/  validate · constants · phones · log-names · resolve · event-list
   ↓
平台层    platform/  ports（端口形状）· fs-node · timer-node · read-node（只读文件能力）· later
   ↓
领域层    core/  file-name（文件名解析单源）· level（级别语义单源）· row · retention · admission · trace ·
                 startup-header（启动头形状单源）· log-digest（目录摘要：累加器 + 人话形态）·
                 ids · outcome · read-row（把一行变回人话：纯函数、零 IO）
          ← 零 IO、零上层：换平台、纯函数单测、以及「哪些级别永不丢」这类判定都靠这一层
```

**命名约定（2026-10-15 定稿；改代码时照着写，门禁之外靠评审守）**：

- **目录**：一层一个关注点。`core/`＝领域（零 IO、纯判据）、`platform/`＝端口与适配器、`engine/`＝宿主落盘引擎、`client/`＝客户端发送面、`host/`＝电话面、`config/`＝配置面；各层的 `*.ts` 门面只 re-export，不放实现。
- **文件**：kebab-case 名词，说清「里面装什么」——`file-name.ts`（文件名解析单源）、`dir-lease.ts`（目录租约）、`switch-file.ts`（开关文件）、`log-names.ts`（日志文件名）、`event-list.ts`（清单与离线检查器）。不用缩写词，不出现 `utils`/`helpers`/`misc`。
- **工厂**：`create<物>(input: <物>Input): <物>` —— `createLogStore`、`createEngineIo`、`createRotation`、`createSwitchFile`、`createWriteStage`、`createSendStage`、`createForwardStage`、`createTraceStage`、`createSwitchCache`、`createSwitchOps`；测试直接测这个「物」，不测内部私有函数。
- **判定与类型**：布尔判定用 `is/has/can` 前缀（`isKnownLevel`、`isUrgentLevel`、`isDiagnostic`、`canAppend`、`canSize`）；类型用「名词 + 语义」（`LogRowV3`、`QueuedRow`、`LogOutcome`、`WriteOutcome`、`SealOutcome`）；常量全大写带单位（`DIR_LEASE_WAIT_MS`、`APPEND_ATOMIC_MAX`、`RETRY_BACKOFF_MS`）。
- **一个概念一个词**：宿主侧的「自监控行」与客户端的「诊断行」在代码里都叫 `isDiagnostic`；事件清单里那个**公开数据值**仍叫 `kind: 'selfmon'`（改它会破坏 0.3.0 用户已写好的清单文件），两者说的是同一件事。
- **不许有第二个真源**：文件名解析、级别语义（哪些级别永不丢）、腾位选行、保留字搬迁、常驻事件集合，各只有一份实现；`tests/arch.test.mjs` 的分层断言 + 上面的树是判据。

门禁规矩（逐条与 `tests/arch.test.mjs` 的断言一致）：`core/` 只引 core 内部；`platform/` 只引 `node:` 内置、core 与 platform 内部；配置面只引 core 与配置面内部**且内部无环**；面与引擎不许引入口层；`node:` 内置的**白名单只有四个文件**——`platform/fs-node.ts`、`platform/timer-node.ts`、`platform/read-node.ts`、`node.ts`（入口层的 `index.ts`、`host.ts`、`cli.ts` 与组合根都不许碰 `node:`，IO 一律走 platform 端口——读侧工具因此**从结构上就不具备写文件的能力**）；`engine/`、`client/`、`host/` 三个面**互不认识**、也不反向引用组合根（跨面组合只发生在组合根与入口——否则同一份语义会在两个面里各长一份）；全包零运行时依赖、不许 `require`。另一条守卫是 `tests/public-surface.test.mjs`——四个入口的导出名集合快照，搬代码时护着公开面不漂移（要改公开面就得同时改名单与文档）。

官方源最新是 **0.3.2**（2026-10-15 发布；此前公开发布过 0.3.1、0.3.0 与 0.2.x）。各版本的原始输出、四项发布后核对与已知边界都记在包根的 `notes-publish-drill.md`（不随包发布）。再发新版本时，除了上面两步，还要按第 10 节的版本策略定版本号、把实际发布输出记进那份记录，或用包目录下的发布向导脚本 `publish-wizard.sh` 走一遍完整流程（体检、登录、升版本、干跑、发布、发布后验证六段）。发布后有一件事向导不代做、但必须自己做：核对包内 `README.md` 与 `INTEGRATION.md` 跟仓库一致——发出去的是发布那一刻的文档，仓库里改的不会自动跟上。本仓当前没有 `.npmrc`，也**不要**往仓库里放 token：要么用只含自动化 token 的临时 npmrc（`npm publish --userconfig <临时文件>`），要么临时设 `NODE_AUTH_TOKEN`。另：本机 npm 的 packument 缓存可能滞后（`npm view`/`npm i` 仍看到旧版本）——核对源上状态请直连 registry HTTP 或换一个 `--cache` 目录。

## 10. 版本策略

语义化版本。破坏性变更有 5 类：电话改名、增删改入参回参形状、改配置写法、改事件清单字段形状、改文件名策略的默认形状。自首个公开发布起算，日志系统的公共接口连续 3 个版本无破坏性变更之前不议拆。

**0.3.1（2026-10-15 发布）**把三件事一起发了——计数口径修正、命名整改、读侧工具（用户先说过「先不发，留在仓库里」，随后要求落地读侧工具，于是合并成一个 0.3.1）。公共接口只增不改：

1. **客户端丢弃计数口径修正**：库自己写的诊断行（如 `log.forward.summary`）不再计入 `dropped`，与宿主侧同口径（修前 1 行用户日志可能被报成「丢 2 行」）。
2. **内部命名整改**：`selfMon` → `isDiagnostic`、客户端四个工厂 `create*Rig`/`*RigInput` → `create*Stage`/`*StageInput`；顺带修掉第一条汇总行 `windowMs` 报 epoch 量级的问题。公开导出名与清单数据值 `kind: 'selfmon'` 未动。
3. **读侧渲染**：根入口新增 `parseLogLine`／`formatRow`／`formatRows`（把落盘的一行变回人话；纯函数、零 IO，见第 3.2 节）。
4. **命令行工具**：装包即带 `dsh-log tail`（`bin` 指向 `dist/cli.js`；按写序读、默认渲染人话、`-f` 跟读、`--json` 回机器态；只读——不写、不改、不删）。
5. **文档**：新增「3.1 真实输出长什么样」与「3.2 怎么看日志」两节，事件清单示例补 `message` 示范。

升级方式：`npm i dsh-log@0.3.1`，现有代码不需要改；写日志时想给人看，就按第 3.2 节在 `fields.message` 里放一句人话。

**0.3.2（2026-10-15 发布）**：

1. **`dsh-log tail` 的子命令现在真被认**。帮助里一直写着 `dsh-log tail <目录...>`，0.3.1 的实现却把 `tail` 当成一个目录名——于是每次带子命令调用都会在 stderr 白吐一行 `dsh-log: 没找到日志目录：tail`（退出码仍是 0、日志照常输出，所以只有肉眼看得见）。修后 `dsh-log tail <目录...>` 与 `dsh-log <目录...>` **完全等价**、stderr 干净；只有第一个位置参数上的 `tail` 会被当成子命令（目录名恰好叫 `tail` 时写 `./tail`）。

升级方式：`npm i dsh-log@0.3.2`，现有代码不需要改。

**0.3.3（2026-10-15）**：把「上游插件提的两条需求」落成三件加法（公共接口只增不改，老代码不用动）：

1. **宿主侧链上下文 `store.trace()`**：宿主写日志不必自己造 `traceId/spanId/seq`——`trace()` 建链、`child()` 刷新 `spanId` 并重置 `seq`、保留字冲突搬进 `fields._shadow`（规则见 5.3）。不经上下文的 `store.log()` 一字不变。
2. **目录自述**：`dsh-log/node` 建库时自动写一行 `host.start`（`pid`/`startedAt`/`dir` + 可选的 `pluginVersion`/`os`）；建库配置新增可选项 `pluginVersion`；宿主导出摘要的 `pluginVersion` 不再恒为 `unknown`，而是认真记下来的值。
3. **`dsh-log export`**：交日志的第二个子命令——摘要 + 原始行，自包含；读不出来的格子如实写 `unknown`，**不拿读者环境顶替**（见 3.2）。顺带把「目录发现不要求 `logs-` 前缀」写成契约并补了两条回归线。

升级方式：`npm i dsh-log@0.3.3`；想让自己插件的日志目录自述版本，就在建库配置里加 `pluginVersion: '<你的版本>'`。

## 11. 安全声明与许可证

用包的人发现安全漏洞，请走本仓 GitHub Issues 报告（标题注明安全字样），紧急情况可直接联系维护人。MIT 许可证，版权人王辰浩，与仓库根 LICENSE 一致。

## 12. 0.3.0 迁移 7 步（从 research/11-migration-checklist-draft.md 搬入）

> 0.3.0 为全新版本，不兼容 0.2.x：无 shim、无双读、无回退。旧 `logs/*.log` 手动导出一次，新目录从空开始。

1. **建库双必填**：补 `pluginId`＋`prefix`（各 1 行）。`wf` 只留旧版，新插件传自己 id，不传直接抛，不再回退。
2. **删手拼目录**：目录／开关／存储键改自动派生（`logs-<id>`、`log-switch-<id>.json`、`dsws.debug.<id>`），删手拼代码 3 处；旧开关作废，需重开一次。
3. **切 quick 入口**：首屏换 `quick` 默认入口（依赖预设，3 行可用）；老三入口按新签名重接。
4. **0.2.x 的 `flush()` 与 `ready()` → `synced()` / `log.ready`**：0.2.x 的 `ready()` 只表示 sink 已开、不等落盘，0.3.0 已没有这个方法——Node 入口的 `log.ready` 现在是**只读属性**，老代码里 `await log.ready()` 会直接报 `log.ready is not a function`；新语义是「读一次刷一次」并回执 `{ok, pending, lastPersistFail}`（`ok` 为真才算落定）。老代码一律改成 `await store.synced()`，或短命程序在结尾 `await log.ready`；Node 短命程序还可注册 `beforeExit` 钩。
5. **清单删 `counts`**：删 1 块手填计数（实现自算）；`checkEventFields` 换 `lintEventFields`（未知字段 warn、未知事件 error，红不拦上线）。
6. **解析加 `v===3` 断言**：追踪改从 `fields.traceId/spanId/seq` 取；跨边界原样透传，禁重写 `traceId`；调用方显式处理查询 `denied`（`if(res.denied)` 样板）。
7. **旧日志手动导出一次**：`v!=3` 旧行跳过＋计数不抛错，error 旧行仍可查；新目录从空开始。

走不完就别升级——0.2.x 目录和包继续可用，但不再跟新规格（只修 CVE）。
