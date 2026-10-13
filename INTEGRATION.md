# 日志包集成教程（从安装到首条落盘）

对应版本：与本包根 `package.json` 同版本（本教程随包一起发布；升级后以新版教程为准，旧版教程只对应当时的包）。

接口形状、配置默认值、失败语义查 `README.md` 第 4 到 7 节；本文只讲按什么顺序做什么、每步做完的判据是什么。

先按自己的形态选一条路走，**不要两条都走**：

**路线 A｜DSH 插件作者**：你的代码跑在 DSH 宿主里（插件宿主侧与客户端侧两个半区）。走下面的步骤 0、1、2、3、4 一路到底。

**路线 B｜独立 Node 程序作者**：你的程序不是 DSH 插件、自己独立跑（例如一个技能自己的命令行）。走下面的步骤 0、1、**2B**，跳过 2 与 3，再看步骤 4 里的落点说明。你没有宿主文件服务、没有电话、也没有客户端要转发，用不上那两节。

全程用词：日志系统指日志功能本身，日志包指装着日志系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。

## 先跑起来（默认 quick 入口，30 秒）

独立 Node 程序（4 行，走步骤 2B 的同一条路）：

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
> - 同一 `cacheDir` 下不同 `pluginId` 各写自己的目录与开关文件，可以并存。
> - **跨进程没有登记（风险提示，不是保证）**：登记表是模块副本级的，另一个进程看不见。实测两个真进程同目录各写各的都能成功、两边的行都在；危险窗口是**并发读改写**——两个进程同时刷盘时，后写者按自己读到的旧内容整份覆写，可能吃掉对方刚写的行。不要这样用。

DSH 插件宿主侧（3 行，走步骤 2 的同一条路）：

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'
const hostLog = createHostLog(deps, { pluginId: 'wf', prefix: 'wf' })
registerHostLogPhones(new Map(), hostLog)
```

两条规矩（0.3.0）：保落盘认 `store.synced()`（已落地）——刷完当期队列、等到在途写盘真的收尾才 resolve，杀进程前调此即不丢；`store.flush()` 只管安排刷盘，调了不等于写完；查日志先判无权（查询电话名 = 前缀加 `.logQuery`，六参：`timeRange`、`pluginId`、`level`、`keyword`、`traceId`、`page`；宿主入口注册 5 个写侧动作加这个只读查询，共 6 个）：

```js
const res = await phones.handleLogQuery({ pluginId: 'wf' })
if (res.denied) return '无权：只查自己插件的日志'
```

宿主侧 `await store.synced()` 等落盘；Node 短命程序注册退出钩 `store.beforeExit()`（重复调用只注册一次）。选路规则不变：先按自己的形态选一条路走，**不要两条都走**。

## 步骤 0. 确认环境

Node 22 或更高：

```sh
node --version
```

**做完的判据**：输出的版本号是 22 或更高。

## 步骤 1. 安装

```sh
npm install dsh-log
```

上面这条命令直接可用：包已发布到 npm 官方源（最新版本用 `npm view dsh-log version` 自查）。若你要接的是本仓库里改过、还没发出去的那份，才改用本地路径或工作区引用代替（例如 `npm install ../dsh-log`）。

本地路径那条命令要在你自己插件的目录里执行，不是在日志包目录里。

**做完的判据**：

- 路线 A：能引用到已构建产物（`dist/host.js` 与 `dist/client.js`），并且从 `hostLog.phoneNames` 里读得到 5 个动作电话名（`logBatch`、`logExport`、`logClear`、`logGetSwitch`、`logSetSwitch` 各一个）；注册时还会多注册第 6 个**只读查询**电话 `<prefix>.logQuery`（名字由 `buildLogQueryPhoneName` 单源派生，不进 `phoneNames` 那份冻结映射）。
- 路线 B：能引用到 `dist/node.js` 即算装好，读不到电话名是正常的（见步骤 2B）。

## 步骤 2B. 独立 Node 程序的接线（只有这一节，一次调用就够）

独立程序不需要传文件服务、不需要注册电话、也没有客户端要转发，所以只有一步：

```js
import { createNodeHostLog } from 'dsh-log/node'

const log = await createNodeHostLog(
  { cacheDir: '/你自己决定的/日志目录' },
  { pluginId: 'my-standalone-program', prefix: 'my-standalone-program' }
)

log.store.log('warn', 'my.step.fail', { step: 'fetch', reason: 'timeout' })
const report = await log.ready   // 读一次刷一次；report.ok 为真才代表前面每一行都已落盘
```

三件事要对上：

1. **`cacheDir` 由你决定，入口不猜**。它不读任何环境变量、也没有默认路径；你要把日志放在自己的数据目录旁边，就把那个目录传进来。目录不存在时入口自己建。
2. **`pluginId` 与 `prefix` 双必填**（缺任一即抛中文错，0.2.x 的「prefix 回退到 pluginId」已删），规则与插件侧一样：小写英文字母、数字、中横线，1 到 32 个字符。`pluginId` 决定落点：日志写在 `<cacheDir>/logs-<标识>/` 下按天一个文件，调试开关写在 `<cacheDir>/log-switch-<标识>.json`；`prefix` 决定电话名前缀（独立程序不注册电话，传成同一个标识最省心）。
3. **`await log.ready` 不能省**。落盘是防抖加异步写的：程序自然跑完不会丢（Node 会等那个定时器），但结尾调了 `process.exit()`、抛错退出或被强杀，队列里还没写下去的那批就丢了（`warn` 与 `info` 一样会丢）。`log.ready` 是只读属性、**读一次刷一次**：取它那一刻把此刻为止入队的行刷到底，再回执 `{ ok, pending, lastPersistFail }`——`ok` 为真才算前面每一行都在文件里；写盘失败时 `ok` 为假、`pending` 是还压着的行数、`lastPersistFail` 给出最近一次失败的 `op`/`reason`/`dirHash`，磁盘恢复后再读一次就补落盘。同进程里也可以改用 `await log.store.synced()`（刷完当期队列才 resolve），或先 `log.store.beforeExit()` 注册退出钩（重复调用只注册一次）。

**做完的判据**：跑一遍上面这段，`<cacheDir>/logs-<标识>/` 下出现当天日期的 `.log` 文件，文件里能看到那一行 JSON（只有用户的行，没有内部路标行）。想验证第 3 条：把 `await log.ready` 删掉，并在写完日志后加一行 `process.exit(0)`，那一行就不再落盘。

与插件侧的差别，一眼看清：

| 事情 | 插件（路线 A） | 独立程序（路线 B） |
|---|---|---|
| 文件服务 | 传宿主的文件服务 | 入口内置 Node 标准库实现 |
| 计时器、平台、默认目录 | 传宿主的 | 入口内置 |
| 电话名与注册 | 要（客户端经电话转发） | 不用，`phoneNames` 只是派生结果，看看即可 |
| 5 个电话（导出、清空、开关） | 界面调 | 直接用 `log.store` 上的同名方法 |
| 开关 | 宿主持有、客户端对账（宿主进程里一直持有；**磁盘上那份值的读取发生在第一次 `logGetSwitch` 电话**，也就是客户端 `reconcileLogSwitch()` 那一刻——宿主单独用、又没有客户端对账时，磁盘里的开关不会被自动读回） | 入口建库时自动读回上次的值 |

## 步骤 2. 宿主侧接线（三步接入）

在宿主启动处写：

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'

const registry = new Map()   // 自己的电话注册表，要留着：步骤 3 的客户端桥接按名字从它取处理函数
const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', prefix: 'my-plugin' }
)
registerHostLogPhones(registry, hostLog)
```

三件事要对上：

1. `pluginId` 与 `prefix` 双必填（缺任一即抛中文错），都换成自己插件的标识（小写英文字母、数字、中横线，1 到 32 个字符，大写直接报错）。
2. 五个运行依赖由你传入现成的对象：文件服务 `fs`、计时器 `timer`、取缓存目录函数 `getCacheDir`、取平台函数 `getPlatform`、默认工作目录 `DEFAULT_CWD`。**宿主里已经有 fs 端口就用它；没有的话不必自己写六个方法**——`dsh-log/node` 导出的 `createNodeFileService()` 与 `createNodeTimer()` 可以直接当 `fs` 与 `timer` 传进来（就是 `dsh-log/node` 入口自己用的那一对，实测宿主接线 11 行跑通）：

   ```js
   import { createNodeFileService, createNodeTimer } from 'dsh-log/node'
   const hostLog = createHostLog(
     { fs: createNodeFileService(), timer: createNodeTimer(), getCacheDir: async () => cacheDir },
     { pluginId: 'my-plugin', prefix: 'my-plugin' }
   )
   ```
3. 注册表传你自己的电话注册表（例子用 `new Map()` 示意）；注册成功的 5 个动作电话名可从 `hostLog.phoneNames` 读到，形如 `my-plugin.logBatch` 等，另外注册表里还会多一个只读查询电话 `my-plugin.logQuery`（撞名同样抛，不覆盖旧的）。

五个运行依赖的最小形状（类型上五个键都可省略，省略后走退化路；要正常落盘，文件服务的读写方法与取缓存目录函数必须给）：

| 依赖 | 最小形状 | 可省略吗 |
|---|---|---|
| 文件服务 `fs` | `resolve(路径字符串)` 回目标对象；`readText(目标)` 回文件原文；`writeText(目标, 原文)` 写文件；`mkdir(目录)` 建目录；`unlink(目标)` 删文件；`listDir(目录目标)` 回条目数组（字符串数组，或含 `name` 的对象数组） | `resolve`、`mkdir`、`unlink`、`listDir` 可省略（建不上目录也不报错；删文件缺了改写空串回退；列目录缺了按空目录处理）。`readText`、`writeText` 落盘必填，缺了报文件服务不可读或不可写。注意列目录必须返回真实条目：永远返回空数组会导致清空电话删掉 0 个文件，这是传入的仿真不对，不是包的问题 |
| 计时器 `timer` | `timeout(回调, 毫秒数)` 安排一次回调 | 可省略，无则回退运行环境自带的全局定时函数 |
| 取缓存目录函数 `getCacheDir` | 无入参，回目录字符串（同步返回或异步返回都可） | 落盘必填。返回空表示取不到目录：写盘记丢弃，导出走默认工作目录回退 |
| 取平台函数 `getPlatform` | 无入参，回平台结构 `{ os, path, fs }`：`os` 是系统名字符串，`path.join` 拼路径，`fs` 是与文件服务同形的备用文件服务 | 可省略，无则路径拼接用包内默认的斜杠拼接，文件走传入的 `fs` |
| 默认工作目录 `DEFAULT_CWD` | 字符串，例如 `'/work'` | 可省略，无则取空串，只在取不到缓存目录时影响导出回退路径的长短 |

`pluginId` 与 `prefix` 双必填（缺任一即抛中文错），其余走默认：目录名派生为 `logs-my-plugin`，开关文件名派生为 `log-switch-my-plugin.json`，文件名按天。第二个插件不得与第一个共用同一目录，走默认派生自然分开；`wf` 是保留命名空间（只给首个官方插件），新插件用 `wf` 也不会被拒，但传自己的标识才会自然隔离。

**做完的判据**：`hostLog.phoneNames` 打印出 5 个带自己前缀的电话名，注册过程没有报错。若是注册时报"电话名已被注册，不覆盖旧的"，见常见坑第 4 条。

## 步骤 3. 客户端侧接线（两种消费二选一）

推荐直接 import：

```js
import { createClientLog } from 'dsh-log/client'

const clientLog = createClientLog(
  { host, timer, storage, broadcastLogSwitch },
  { pluginId: 'my-plugin', prefix: 'my-plugin' }
)
```

四个依赖全可选，有现成的就传，缺了走退化路、不抛错：宿主调用器 `host`、计时器 `timer`、存储 `storage`（只传 `storage`，旧名 `localStorage` 是迁移期兼容，两个都传以 `storage` 为准）、开关广播 `broadcastLogSwitch`（没有就不传，不报错）。另有一个可选依赖 `hashFn`（`(字符串) => 字符串`），用来替换包内默认散列，细节见 `README.md` 第 8 节。前后缀保持与宿主侧同一对 `pluginId` 与 `prefix`：客户端配置双必填，缺任一即抛中文错，两端拼出的电话名自然对上。

宿主调用器这样桥接到步骤 2 注册的那 5 个电话（用同一张注册表）：

```js
const registry = new Map()
registerHostLogPhones(registry, hostLog)
const host = { call: (name, args) => registry.get(name)(args) }
```

上面三行里前两行与步骤 2 是同一张表，第三行的 `call` 把调用直接转给表里的处理函数。真机上把 `call` 换成自己宿主的实际调用通道即可，电话名与入参形状不变。

只有把客户端拼进插件主文件闭包一起运行的插件，才用文本拼接：构建时取客户端入口编译后的声明体，去行首 `export` 后拼进闭包，调用时把闭包里现成的四个名字原样传给工厂。文本拼接消费方式只走客户端入口的声明体文本。

**做完的判据**：客户端与宿主用的是同一个 `pluginId`，两端拼出的电话名一致；下一节写第一条日志就是这条的实测。

## 步骤 4. 写第一条日志并看它落盘

```js
// 开关默认关闭，错误与告警始终记，信息与调试只在开关打开时记。
// 调试阶段先打开开关（面向用户的开关界面见步骤 6）。
await clientLog.setLogSwitch(true)
clientLog.log('info', 'my-plugin.hello', { step: 'started' })
clientLog.flush()
```

`setLogSwitch` 只有一个参数（是否开启）。0.3.0 删掉了从没生效过的采样率参数：旧版第二个参数会被忽略，写开关电话只发 `enabled`。

宿主是唯一的落盘者：客户端只进队列就返回，转发走电话，落盘走宿主刷盘链路。

落盘之后文件会长成什么样（#21 轮转与保留，宿主侧自动做，插件不用管）：一天一个可写文件 `<cacheDir>/logs-<pluginId>/YYYY-MM-DD.log`；单文件超过 `maxSize`（默认 5MB）就把当日文件原子改名成 `YYYY-MM-DD.N.log` 再开新文件，改名成功记 `audit.json` 一条 `rotate.seal`；宿主给的 fs 没有 `rename` 就不封存、继续追加，并落一行 info 级 `log.rotate.degraded`（一行都不丢）。早于「今天往前 `maxDays - 1` 天」（默认 14）的 `.log` 会在每次写盘前清掉，记账 `retain.evict`。`log.rotate.*` 与 `log.retain.*` 都是 info 级自监控行，不占 `warn`/`error` 的告警面，也不计入累计丢弃数。`logClear` 点名某天只删那天的 `YYYY-MM-DD.log`，点今天与 `date: 'all'` 都不碰当天可写文件、开关文件与 `audit.json`。

**做完的判据**：在缓存目录下的 `logs-my-plugin` 目录里找到当天的 `年月日.log` 文件，里面有 `my-plugin.hello` 这一条。

落盘行里除了你给的 `fields`，还会有 SDK 自动注入的追踪三件套 `traceId`/`spanId`/`seq`（#24）：`traceId` 16 位十六进制，`spanId` 8 位，`seq` 是本实例内的单调序号（四个级别一律建链；0.3.0 删掉了只影响建链、不拦行的采样率）。想把自己这条和后续步骤串成一条链，就用 `log.child({ step: 'fetch' })` 取子日志器——它继承 `traceId`、刷新 `spanId`、`seq` 从 0 重起；**漏传 `child` 就是新链**（不用 `async_hooks`，不做隐式合并）。`fields` 里误带这三个保留字不会丢行：冲突的值搬进 `fields._shadow`，另落一行 `log.trace.shadow`，`log.why().shadowWarns` 能看到次数。查整条链用 `logQuery` 的 `traceId` 参（`traceChain` 通道，超 100 行不断链）。

等多久：调了 `flush` 只剩宿主侧约 1000 毫秒防抖刷盘，约 1 秒后去看文件；不调 `flush` 则客户端约 1000 毫秒转发加上宿主约 1000 毫秒刷盘，约 2 秒后再看。错误与告警两级直通，不用等满防抖。脚本里用轮询等文件出现（例如每 200 毫秒看一次、最多等 6 秒），不要写死睡固定秒数，心急看不到文件会误以为没接通。

记日志前先判断开关（高频调用处必须写，日志器体内的判断只是兜底）：

```js
if (clientLog.isEnabled('info')) {
  clientLog.log('info', 'my-plugin.step', { step: 'done', latencyMs: 12 })
}
```

累计丢弃数随时可读：`clientLog.getDroppedCount()`（宿主侧是 `store.getDroppedCount()`）。失败只计数不抛错，队列满与转发失败都只加到这个数里；宿主写盘失败**先不丢行**——整批进重试位、有界自动重试，只有还压在内存里的行（重试位 + 队列）超过上限（`maxQueue × 10`）才丢最旧的普通行并响一次 `onDrop('write-fail')`，`error/warn` 留到最后，写盘一恢复 `synced()` 就补落盘。

## 步骤 5. 接入对象清单（可选，但推荐）

1. 把包内的 `event-list.template.json` 复制一份，`pluginId` 换成自己插件的标识，按实际事件填 `events`。三类条数不再手填（0.3.0 删了 `counts`：解析时忽略，缺失也不抛，唯一真源是 `computeEventCounts` 自算）。只含一条事件的最小例子：

```json
{
  "version": 1,
  "pluginId": "my-plugin",
  "events": {
    "my-plugin.hello": {
      "level": "info",
      "kind": "resident",
      "fields": ["step"]
    }
  }
}
```

上面这条是常驻信息事件：事件名 `my-plugin.hello`，级别 `info`，归类 `resident`，允许字段只有 `step`。**`kind: 'resident'` 是运行期真生效的**（0.3.0 起）：写侧放行集合 = 包内固定 43 个 DSH 常驻名 ∪ 清单里标了 `resident` 的事件名，所以 `my-plugin.hello` 这类 `info` 在调试开关关着时也照样落盘；没标 `resident` 的 `info` 仍只在开关打开时记（返回 `'skipped'`，不计入丢弃数）。下面第 3 步检查器示例用的正是这条，上下两环对上了。

2. 自己读成对象再传给 `eventList`（日志包不读盘；`prefix` 与 `pluginId` 双必填，别忘了）：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-plugin.json', 'utf8'))
const hostLog = createHostLog(deps, { pluginId: 'my-plugin', prefix: 'my-plugin', eventList: myEventList })
```

3. 发布前用检查器自查（字段白名单两档 + 计数自算）：

```js
import { parseEventListManifest, lintEventFields, computeEventCounts } from 'dsh-log/host'

const manifest = parseEventListManifest(myEventList)
lintEventFields(manifest, 'my-plugin.hello', ['step'])
computeEventCounts(manifest)
```

每条事件四样东西：事件名、级别、允许字段（fields，清单内登记、自查用；运行期原样透传、不裁剪）、脱敏引用（只记规则名不记原文）。`lintEventFields` 只有黄/红两档（#18 Q6）：黄 warn——未知字段键（清单新增字段但快照未更新，跑 `node tests/update-snapshots.mjs` 一键更新即转绿，不阻排障）；红 error——未知事件名、envelope 非法（落盘行五键 `{v,ts,level,event,fields}` 中 `v` 不为 3 或形状不对）；红只报不拦上线。快照确认制下再叠一层：事件总数与 `tests/event-snapshots/_baseline.json` 比突变超 ±5 且 `tests/event-snapshots/CHANGELOG.md` 无说明才红（红的是“无 changelog”，不是字段本身）。细节见 `README.md` 第 7 节。0.3.0 起 `checkEventCounts` 已删（自算值与自算值核对＝同义反复），`checkEventFields` 保留；数条数用 `computeEventCounts`。

**做完的判据**：`parseEventListManifest` 验形状（非法即抛，返回的是补齐后的清单，`counts` 已由它自算）、`lintEventFields` 返回结构里的 `ok` 为真、`computeEventCounts` 的三类条数与 `events` 里各 `kind` 的个数逐项一致；再跑 `node --test tests/snapshot.test.mjs` 全绿（黄只警告不判红，红只认未知事件名、envelope 非法、无 changelog 的总数突变）；改了字段先跑 `node tests/update-snapshots.mjs` 更新 `tests/event-snapshots/` 再验。

## 步骤 6. 界面建议（导出、清空、开关）

- 导出：在状态栏菜单与设置页各放一个导出入口，都调 `logExport`（入参可选日期，不传导出当天）。成功把回参的 `text` 存成文件给用户；失败分支记一行 `log.export.fail`（走 `logExportFail`，成功路径不调用）；失败原因只给机器码，面向用户的文案由界面经多语言系统转换，日志包内不写面向用户的中文字符串。
- 清空：在设置页放清空入口，调 `logClear`（`date` 传某天或 `all`），回参的 `removed` 告诉用户删掉几个文件。
- 开关：在设置页放调试开关（一个「是否开启」），调 `setLogSwitch(是否开启)` / 启动时调 `reconcileLogSwitch` 向宿主对账（以宿主为准）。开关写失败保持旧值（失败原因只给机器码：`host-unavailable`、`host-rejected`、`switch-timeout`、`stale` 等），由调用处提示用户，不回退为开启。

**做完的判据**：三个运行入口（`dsh-log/host`、`dsh-log/client`、`dsh-log/node`）在界面上各走通一次，根入口 `dsh-log`（环境无关公共面）能被消费者工程编译一次（`npm test` 里的 `consumer-types` 那套就是干这个的）——导出能把 `text` 存成文件；清空能报出删掉几个文件；开关改完刷新一次，读到的仍是改后的值。

## 常见坑

1. 多进程同时写同一个目录会写坏：一个插件只建一个日志库实例，目录不要两个实例共用；第二个插件走默认派生自然分到不同目录。
2. Windows 文件名里不能有冒号：四段式文件名的启动时间已把冒号与斜杠转写为中横线，目录派生与标识字符约束也排除了文件不安全字符，不要自己拼带冒号的文件名。
3. 目录漂移（缓存目录变化导致找不到旧日志）：取缓存目录走传入的 `getCacheDir`，不要在包外自己缓存一份目录路径；目录里只记散列不记原文路径。
4. 电话名撞名（注册时报"电话名已被注册，不覆盖旧的"）：这个前缀已被别的插件用掉，换一个没被用过的前缀（`prefix` 显式传入），不要复用默认前缀 `wf`（`wf` 只给当前插件用）。
5. 标识大小写：收到大写直接报错，不做静默转小写，全小写重传即可。

回参形状相关的坑（`bytes` 是日志原文的字符串长度不是真实字节数）写在 `README.md` 第 5.1 节，查回参时一起看。

## 自查清单（按本文档能否走通）

- [ ] `npm install dsh-log` 成功，Node 22 或更高。
- [ ] 宿主侧三步接入跑通，`hostLog.phoneNames` 里 5 个动作电话名都带自己的前缀（注册表里另有第 6 个 `<prefix>.logQuery`）。
- [ ] 客户端二选一接通，高频调用处写了外层 `isEnabled` 判断。
- [ ] 首条日志落盘：在派生目录里找到当天文件并看到该条。
- [ ] `getDroppedCount` 可读；失败场景（断开宿主）只计数不抛错。
- [ ] 清单接入（如做）：模板已复制改名，检查器三函数全过，计数逐项一致。
- [ ] 发布前跑过 `README.md` 第 9 节的门禁（包内单测与 14 个日志门禁全绿），事件条数与 `research/489-appendix.md` 第 1 章一致，dry-run 文件数与 `README.md` 第 9 节的 11 个对上。

## 0.3.0 迁移 7 步（从 research/11-migration-checklist-draft.md 搬入）

> 0.3.0 为全新版本，不兼容 0.2.x：无 shim、无双读、无回退。旧 `logs/*.log` 手动导出一次，新目录从空开始。

1. **建库双必填**：补 `pluginId`＋`prefix`（各 1 行）。`wf` 只留旧版，新插件传自己 id，不传直接抛，不再回退。
2. **删手拼目录**：目录／开关／存储键改自动派生（`logs-<id>`、`log-switch-<id>.json`、`dsws.debug.<id>`），删手拼代码 3 处；旧开关作废，需重开一次。
3. **切 quick 入口**：首屏换 `quick` 默认入口（依赖预设，3 行可用）；老三入口按新签名重接。
4. **`flush/ready` → `synced()`**：全局替换；`ready()` 只表示 sink 已开＋队列就绪，保落盘只认 `synced()`；Node 短命程序注册 `beforeExit` 钩。
5. **清单删 `counts`**：删 1 块手填计数（实现自算）；`checkEventFields` 换 `lintEventFields`（未知字段 warn、未知事件 error，红不拦上线）。
6. **解析加 `v===3` 断言**：追踪改从 `fields.traceId/spanId/seq` 取；跨边界原样透传，禁重写 `traceId`；调用方显式处理查询 `denied`（`if(res.denied)` 样板）。
7. **旧日志手动导出一次**：`v!=3` 旧行跳过＋计数不抛错，error 旧行仍可查；新目录从空开始。

走不完就别升级——0.2.x 目录和包继续可用，但不再跟新规格（只修 CVE）。
