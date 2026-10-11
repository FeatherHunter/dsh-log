# 结论

**整体判定：部分隔离。**

五层里**三层靠「默认派生 + 调用方纪律」隔离**（电话名前缀、落盘目录、开关文件），**两层现状不隔离**（客户端本地存储键 `dsws.debug`、全局函数 `dswsLogHash`/`dswsLogTrunc`）。「互相不知对方存在」只在「各插件标识互不相同、且谁都不写覆盖字段」这一条路径上成立；一旦任意第三方（同前缀、显式同名目录/开关文件、或两个插件共处同一进程与同一 origin），冲突可复现，且**大多静默**——唯一会报错的地方是电话名注册（`src/host.ts:75-77`），而它是否生效还取决于宿主是否共用一张注册表。

「能不能隔离」：**能**，但两层（存储键、全局函数）目前连命名空间入口都没有，前两层（目录、开关文件）缺的是唯一性校验，电话名一层已有强制口子。本票只判可行性方向，不给方案、不写修复代码。

本报告只给结论与证据；凡引用均给 `路径:行号`；实测为只读探针（引 `dist/*.js` 产物，运行在系统临时目录，未改动仓库任何文件）。

## 逐层判定

| 层 | 判定 | 一句话依据 | 默认派生（标识互不相同） | 任意第三方（同前缀/显式同名） |
|---|---|---|---|---|
| 1 电话名（prefix） | **部分隔离**（五层里唯一有硬门禁的一层） | 前缀默认回退标识，拼成 `前缀.动作`（`src/config.ts:86`、`:126-139`）；注册撞名抛错、不覆盖（`src/host.ts:75-77`） | 隔离：`alpha.*` 与 `beta.*` 五名全不同（实测） | 共用注册表 → 第二次注册抛错（硬失败、非静默）；各用各的表（`README.md:71` 示例即 `new Map()`）→ 静默同名、无任何提示（实测） |
| 2 落盘目录（logDirName） | **部分隔离**（靠约定，无校验） | 默认 `wf`→`logs`、其他→`logs-<标识>`（`src/config.ts:87-92`），但显式覆盖值**原样直用、零校验** | 隔离：`logs-alpha` / `logs-beta`（实测）；两插件导出/清空互不可见（实测对照） | 显式同名 → 共写一个目录：A 导出读到 B 的行、A 清空把 B 的行一起删（`removed=1`，实测）；`'../escaped'` 之类值也被接受（实测） |
| 3 开关文件（switchFileName） | **部分隔离**（靠约定，无校验） | 默认派生同规则（`src/config.ts:93-98`），开关文件落在 `<cacheDir>` 根下（`src/store.ts:426`、`:447`） | 隔离：`log-switch-alpha.json` / `log-switch-beta.json`；A 开开关后 B 仍读到 `false`（实测） | 显式同名 → B 建库即读到 A 写的 `enabled:true`（B 自己从未设置过，实测）；盘上最后写者说了算，重建实例读回它（实测） |
| 4 客户端本地存储键 | **不隔离** | 键是模块常量字面 `dsws.debug`（`src/client.ts:121`），**前缀/标识不参与键名**，源码注释自认「存储键沿现状不参数化」（`src/client.ts:87`） | **不隔离**：两个前缀不同的客户端共用一个键（实测） | A 开 → 后建的 B 读到 `true` 且 `log('debug', 非名单事件)` 真的入队；B 关或 B 对账（`src/client.ts:539`）把 A 的持久值抹成 `false`（实测） |
| 5 全局函数 | **不隔离** | 只认挂在 `globalThis` 上的 `dswsLogHash`/`dswsLogTrunc`（`src/client.ts:385-388`），包内无命名空间参数 | **不隔离**：一份全局实现同时服务所有实例（实测 A、B 同为 `AAAA0000`） | 换掉全局实现后**已建实例**的输出一起变（实测 `BBBB1111`）——调用时实时读全局，谁挂谁生效、后挂盖先挂 |

## 1. 电话名（prefix）

- **派生**：`prefix` 不传就回退 `pluginId`（`src/config.ts:86`）；5 个电话名 = `前缀 + '.' + 动作名`（`src/config.ts:126-139`，`PHONE_ACTIONS` 五个动名词在 `src/config.ts:26`）。前缀走与标识同一套字符约束 `^[a-z0-9-]{1,32}$`（`src/config.ts:71-80`），不许含点——点留作分隔符，所以前缀之间不可能靠「点」撞出歧义。
- **撞名处理**：注册时 `registry.has(name)` 为真就 `throw new Error('[dsh-log] 电话名已被注册，不覆盖旧的：' + name)`（`src/host.ts:75-77`），旧的 handler 原样留在表里（实测确认）。
- **注册表是调用方传进来的**（`src/host.ts:56-59`、`:63`），包内没有默认表。因此同前缀的后果分两支（都实测过）：
  - 宿主全插件**共用一张表**（`INTEGRATION.md:222` 把撞名解释为「这个前缀已被别的插件用掉」，隐含这一支）→ 第二个插件在注册时**抛错**，属启动期硬失败：不是静默串台，但也谈不上共存。
  - 每个插件**各用一张表**（`README.md:71` 的接入示例就是 `registerHostLogPhones(new Map(), hostLog)`）→ 同前缀**不报错、完全无感**：两个插件的电话名一字不差，宿主侧无法从名字区分它们。
- **默认前缀 `wf` 的遗留影响**：`pluginId === 'wf'` 走旧字面 `logs` / `log-switch.json` / `wf.*`（`src/config.ts:90-98`）。任何第三方插件只要声明 `pluginId: 'wf'` 就与当前插件**默认全撞**（目录、开关文件、电话名三样，实测 `WF1`/`WF2`）。默认派生对「互不相同的标识」是单射，但「同一个标识只能被一个插件声明」这件事包内没有任何注册表守着。
- **「互相不知对方存在」**：名字是宿主路由用的键，两个插件同前缀时宿主侧**必然**混淆（同名 = 同一入口）；这一层做不到「互不知」——除非注册表拦下（第一支）。

## 2. 落盘目录（logDirName）

- **默认派生**：`wf` → `logs`，其他标识 → `logs-<标识>`（`src/config.ts:87-92`；`LEGACY_LOG_DIR_NAME = 'logs'` 在 `src/config.ts:22`）。写盘路径 = `<cacheDir>/<logDirName>/<文件名>`（`src/store.ts:391-395`）。
- **显式覆盖零校验**：`input.logDirName !== undefined ? input.logDirName : …`（`src/config.ts:87-89`）——覆盖值不经过 `assertPluginId`，也不做任何路径安全检查。实测把 `logDirName` 设成 `'logs-alpha'`（= alpha 的默认值）建库成功、无报错；设成 `'../escaped'` 也被原样接受。这一条把「默认派生」与「任意第三方」两个轴的差距拉满：**默认名字撞不上，不等于这一层有隔离保证。**
- **共写后果**（实测）：alpha 与 gamma 共用 `logs-alpha` 后——alpha 的 `logExport` 读到的原文里**含 gamma 的行**（导出电话读的是自己 `logDirName` 下的当天文件，不会去别处）；alpha 的 `logClear({date:'all'})` 回 `{"ok":true,"removed":1}` 并把共用文件删掉，**gamma 的行一并消失**。也就是说：目录一层被穿透后，**导出（读）与清空（删）两个电话会直接跨插件生效**。
- **与票 02 的叠加**：同意目录即同意文件，且落盘是「读—拼—写」全文覆写、无锁、无原子替换（`src/store.ts:367`、`:396-403`）。票 02 已实测多进程共写同目录 6 轮里 4 轮整批丢行；本票补的是**同进程两个实例**的可见性与删除越界。
- **「互相不知对方存在」**：默认派生下成立——电话层只在 `logDir` 内 `listDir`（`src/phones.ts:60-81`、`:73-74`），包内不存在「列父目录」的路径，A 看不到 B 的目录/文件。但这是**默认派生给的**，不是校验给的。

## 3. 开关文件（switchFileName）

- **默认派生**：`wf` → `log-switch.json`，其他 → `log-switch-<标识>.json`（`src/config.ts:93-98`；`LEGACY_SWITCH_FILE_NAME` 在 `src/config.ts:23`）。
- **落点**：`<cacheDir>/<switchFileName>`（`src/store.ts:426` 读、`:447` 写）——**就在缓存目录根下**，与各插件的 `logs-*` 目录同级（实测 `L3.6`），不再套一层插件目录。
- **开关状态的作用域是实例**：`switchEnabled`/`switchSampleRate`/`switchLoaded` 都在 `createLogStore` 内部（`src/store.ts:119-121`），读回有 `switchLoaded` 一次性守卫（`src/store.ts:420-422`）；`setSwitch` 改内存后立刻落盘（`src/store.ts:454-459`）。所以**同进程两实例的内存态互不影响**（实测 `L3.4`），这与 `README.md:80`「开关状态各自独立，互不串」相符。
- **跨插件的串线在盘上**：显式同名时，B 建库即可读到 A 写的开关（实测 `L3.3`：gamma 从来没设置过开关，建库读回 `{"ok":true,"enabled":true,"sampleRate":1}`）。Node 入口在 `createNodeHostLog` 里显式 `loadSwitch()` 读回（`src/node.ts:157-165`），所以这个「读回」在独立程序里是必然发生的；插件侧由宿主在同一进程持有内存态（`src/node.ts:159` 注释），要等重建实例才暴露。
- **最后写者说了算**：gamma 把开关关掉后，alpha 的内存态仍是 `true`（各实例独立），但**重建的 alpha 读回 `false`**（实测 `L3.4`/`L3.5`）——盘上文件名相同即状态相同，没有版本号/归属字段能分辨「这是谁的开关」。
- **不隔离的后果量级**：开关是「详细日志总闸」，被串开意味着另一个插件的 info/debug 也进队列、也落盘（信息量放大）；被串关意味着调试期白跑。它不碰 error/warn（`src/store.ts:263-267` 的放行顺序），所以不是数据丢失，是**详细度控制权被别的插件拿走**。

## 4. 客户端本地存储键（`dsws.debug` 单键疑点）——**断定：不隔离**

- **键是硬编码字面**：`export const LOG_DEBUG_KEY = 'dsws.debug'`（`src/client.ts:121`），读在 `src/client.ts:213`、写在 `src/client.ts:231-238`，形状 `{enabled, sampleRate, rev}`（`src/client.ts:233-237`）。配置面注释写死「存储键沿现状**不参数化**」（`src/client.ts:87`），`ClientLogConfigInput` 只收 `pluginId`/`prefix`/`eventList`（`src/client.ts:90-97`）、`ClientLogDeps` 只收 `host`/`timer`/`storage`/`localStorage`/`broadcastLogSwitch`（`src/client.ts:78-85`）——**没有任何键名前缀/命名空间入口**。
- **键的所有权在调用方**：`storage` 由插件注入（`src/client.ts:202`）。若两个插件都注入 `window.localStorage`，就是同一个键；只有插件各自注入作用域隔离的存储才会分开——包内不做这个决定。
- **实测（两个前缀不同的客户端，同一 storage 桩）**：
  - `prefix` 隔离了电话名（`alpha.logBatch` vs `beta.logBatch`），但键只有一个：`["dsws.debug"]`。
  - A `setLogSwitch(true,1)` 成功后，**后建的 B** 读到 `{"enabled":true,"sampleRate":1,"rev":1}`，`B.isEnabled('debug','x.y')` 为真，`B.log('debug','x.y')` 真的入队（队列从 0 变 1）。
  - B `setLogSwitch(false,1)` 后，`A.readLocalDebugSwitch()` 变 `false`——**A 的持久值被 B 覆盖**。
  - B `reconcileLogSwitch()`（宿主说关）同样把共享键写成 `false`（`src/client.ts:537-539`）——**启动对账也会覆盖另一个插件的本地态**。
  - A 的内存 `logSwitch` 是活引用（`src/client.ts:246`），不会随存储变（实测 `L4.7`）；但界面「秒显」靠的就是建实例时这一次同步读（`src/client.ts:208-226`、`:245-246`），所以**后开界面的那个插件会显示别人的开关状态**。
- **影响面**：只放大/收敛「按需 info/debug」——error/warn 与常驻名单不受开关管（`src/client.ts:279-288`，实测 `P3.1`）。
- **「互相不知对方存在」**：**做不到**。共用键意味着 A 能读到 B 写的开关值（`readLocalDebugSwitch` 是公开方法，`src/client.ts:190`），B 也能改掉 A 的值；这是双向可观测、可写的共享面。

## 5. 全局函数（`dswsLogHash` / `dswsLogTrunc`）

- **挂载点与语义**：`logExportFail` 在包内没有共享闭包可用时，只认 `globalThis` 上的同名函数（`src/client.ts:383-398`：`:385` 取全局、`:386` 判两个都是函数、`:387-388` 取用），否则回退包内 `hash8`（`:397`）。README §8.1 把它写成「四个注入依赖之外的第 5 个隐式依赖」（`README.md:184`）。
- **不隔离，且是调用时实时读**：实测挂一份 `globalThis.dswsLogHash = () => 'AAAA0000'` 后，前缀不同的 A、B 两个实例记出的 `errorHash` **都是 `AAAA0000`**（只有一份实现服务所有人）；**不重建实例**直接换实现，A 的下一行就变成 `BBBB1111`（`src/client.ts:385` 在每次调用时求值，不是在建实例时捕获）；撤掉全局后回落包内散列（实测 `0002b61f`）。
- **结果**：两个插件都想要「自己那份一字相同的散列」时，全局只有一个位置——**谁挂谁生效、后挂盖先挂**，且会影响所有同进程插件（包括没挂的那个）。这与 README §8.1 的收敛计划措辞（「把它们挂到全局对象同名位置即可」）在多插件语境下不成立，见 I3。
- **边界**：`dsh-log/node` 产物里不含这两个名字（实测 `L5.4`），这条只影响客户端侧导出失败行；进程/渲染进程不共享时（若宿主把插件客户端隔离在不同上下文），该耦合自然消失——那属宿主实况，见「未验证」。
- **「互相不知对方存在」**：**做不到**（同进程内）。A 挂的函数会决定 B 的输出形状，B 也改得动 A 的。

## 层外：五层之外的跨插件共享面

五层之外**没有发现别的跨插件共享可变状态**，检索方式与结论：

- **模块级可变单例**：`src/*.ts` 里 `let` 全部落在工厂内部——`store.ts` 的 `queue`/`dropped`/`switchEnabled`/`flushTimer` 等（`src/store.ts:115-138`，工厂从 `src/store.ts:102` 开始）、`src/store.ts:96` 的 `h` 是 `hashText` 的局部量；`client.ts` 的状态全在 `createClientLog` 闭包内（`src/client.ts:198-255`），配置面只有常量（`src/client.ts:120-133`）。全仓没有模块级 `new Map()/Set()/[]` 容器（grep 实测：`^const X = new Map(...)` 一类零命中）。**实例计数也确实独立**：同 `cacheDir` 下 `maxQueue=1` 两实例，A 丢 1 条时 B 丢 0 条（实测 `X1a`/`X1b`）；两客户端队列 3 vs 0（实测 `X2`）。
- **跨插件唯一串线渠道 = 文件 + 两个全局面**：`<cacheDir>` 下的目录名/开关文件名（默认派生分开、显式覆盖可撞），以及 `globalThis`（`dswsLogHash`/`dswsLogTrunc`，`src/client.ts:385-388`）。存储键严格说是第三样，但它落在「客户端本地存储」这个文件之外的共享面上（第 4 层）。
- **宿主注册表**不在包内（`src/host.ts:56-63` 由调用方传入），是否共用属宿主实况，见「未验证」。

## 最小复现思路（逐层）

| 层 | 最小复现步骤 | 期望观察 | 实际观察 |
|---|---|---|---|
| 1 电话名 | ① 两个 `createHostLog` 用同一 `pluginId`；② 把两个 hostLog 都 `registerHostLogPhones` 进**同一张** `Map`；③ 换成**两张** `Map` 重跑 | 同前缀应被识别为冲突 | 同一张表：第二次注册抛 `[dsh-log] 电话名已被注册，不覆盖旧的：alpha.logBatch`，旧 handler 未覆盖（实测）；两张表：**无报错**，两插件的 5 个电话名一字不差（实测） |
| 2 落盘目录 | ① A 用默认 `pluginId:'alpha'`；② B 用 `pluginId:'gamma'` + `logDirName:'logs-alpha'`；③ 各写一条 error、各 `flushNow()`；④ A `handleLogExport({})`；⑤ A `handleLogClear({date:'all'})` | 目录名是隔离边界 | A 导出**命中 gamma 的行**；A 清空回 `{"ok":true,"removed":1}`，共用文件消失、gamma 的行一并没了（实测）。另一发：`logDirName:'../escaped'` 建库成功、无校验（实测） |
| 3 开关文件 | ① A 默认建库并 `handleLogSetSwitch({enabled:true})`；② B 用 `switchFileName:'log-switch-alpha.json'` 建库；③ 读 `handleLogGetSwitch()`；④ B 关掉开关后，重建 A 再读 | 开关跟随自己的文件 | B 建库即读到 `enabled:true`（自己从未设置过）；B 关掉后，A 同进程内存态仍 `true`（实例独立），**重建的 A 读到 `false`**（实测） |
| 4 存储键 | ① 同一 storage 桩；② 建 A（`pluginId:'alpha'`）；③ `await A.setLogSwitch(true,1)`；④ 建 B（`pluginId:'beta'`）读 `B.logSwitch`、`B.log('debug','x.y')`；⑤ `await B.setLogSwitch(false,1)` 后读 `A.readLocalDebugSwitch()` | 键名应含插件标识 | 键只有一个 `dsws.debug`：B 读到 `enabled:true`、队列入 1 条；B 关掉后 A 的持久值变 `false`（实测）。把 ⑤ 换成 `B.reconcileLogSwitch()`（宿主说关）同样覆盖（实测） |
| 5 全局函数 | ① 挂 `globalThis.dswsLogHash = () => 'AAAA0000'` 与 `dswsLogTrunc = s => String(s)`；② 建两个前缀不同的客户端各调一次 `logExportFail('export','boom',new Error('x'))`；③ 直接换实现为 `'BBBB1111'`，**不重建实例**再记一行 | 每个实例用自己那份散列 | 两实例第一次都是 `AAAA0000`；换实现后原实例输出 `BBBB1111`；撤掉全局回落包内 `0002b61f`（实测） |

## 「能不能做到互相不知对方存在」

| 层 | 默认派生（标识互不相同） | 任意第三方 | 能不能隔离 |
|---|---|---|---|
| 1 电话名 | 成立 | 共用注册表→报错（不共存）；各自表→同名混淆 | **能**（已有强制口子：注册报错；缺的是「各表也要拦」或「标识唯一性」） |
| 2 落盘目录 | 成立（A 看不到 B 的文件） | 同名即互相可读可删 | **能**（缺唯一性校验；覆盖值零校验是唯一缺口） |
| 3 开关文件 | 成立 | 同名即状态互串、最后写者说了算 | **能**（同上；另需归属信息才能分辨「谁的开关」） |
| 4 存储键 | **不成立**（前置条件就是「同 origin 同存储」） | 双向可读可写 | **能，但前置条件最重**：键名目前完全不含标识/前缀（`src/client.ts:87` 注释自认不参数化），要隔离必须先有「键名带上归属」这件事本身 |
| 5 全局函数 | **不成立** | 一份实现服务所有人，调用时实时读 | **能，但前置条件最重**：全局位只有一个，要隔离得先改「函数从哪来」（依赖注入或按标识取名），不是加个后缀就行 |

## 与 README / INTEGRATION 的出入（隔离口径）

| # | 文档说的 | 实际/实测 | 引用 |
|---|---|---|---|
| I1 | §4 只写 `logDirName`/`switchFileName`「允许显式覆盖」；§5 说磁盘隔离靠目录名与开关文件名默认派生 | 覆盖值**完全不过校验**（`src/config.ts:87-98` 原样直用，`'../escaped'` 也被接受，实测），可与另一插件的**默认**名字重合而静默共写；「不得共用同一目录」在 `INTEGRATION.md:104`、`:219`、`:222` 三处都只是调用方纪律，包内零强制 | `README.md:89-90`、`README.md:111`、`src/config.ts:87-98`、`INTEGRATION.md:219` |
| I2 | §5.2 只写「本地开关存在本地存储里，键名是 `dsws.debug`」；§8.2 只写存储双键迁移 | 没说这个键**全插件共用一个**；源码注释反而写明「存储键沿现状不参数化」（`src/client.ts:87`）。两个插件同 origin 时，一个开/关会改另一个的本地态与界面秒显（实测） | `README.md:135`、`README.md:185`、`src/client.ts:87`、`src/client.ts:121` |
| I3 | §8.1 把全局散列/截断写成「第 5 个隐式依赖」，并说「希望输出一字相同就挂到全局对象同名位置」 | 没说挂上之后**同进程所有插件一起用**（实测：一份实现服务两个实例；不重建实例换实现，输出一起变）。多插件下「谁挂谁生效、后挂盖先挂」 | `README.md:184`、`src/client.ts:385-398` |
| I4 | 撞名语义两处预设不一致：§3 接入示例每次 `new Map()`（各插件一张表） | `INTEGRATION.md:222` 把「电话名已被注册」解释成「这个前缀已被别的插件用掉」——隐含**全宿主共用一张表**。共用则同前缀是启动期硬失败，各用各的则同前缀完全无感；仓内无法证实真实宿主用哪种 | `README.md:71` vs `INTEGRATION.md:222`、`src/host.ts:56-63` |

同时核对**相符、不算出入**的断言：`README.md:80`「一次建库调用得到一个独立实例：内存队列、累计丢弃数、开关状态各自独立，互不串」——实例级状态确实独立（实测 `X1`/`X2`/`L3.4`）；它的问题只是容易被读成「插件之间已隔离」，而开关**文件**与本地**键**在实例之外。`src/config.ts:133` 注释「前缀只隔离电话名，磁盘隔离靠目录与开关文件名的默认派生」与 `README.md:111` 口径一致，实测相符（默认派生确实分开）。

## 补充实测：三条结构性缺陷 + 两条口径补强（后台取证 agent 首报，Lead 已独立复跑）

后台取证 agent 另用 6 支探针（脚本与原始输出留在 `D:\Temp\dsh-log-08\`）跑出三条本报告主体未覆盖的结构性事实；Lead 用 `.local/selfcheck-08-isolation4.mjs` 逐条独立复跑，结论一致：

1. **电话名注册是非原子的**：`src/host.ts:72-79` 是「循环内先判后 `set`、撞名即抛」。实测预占 `qa.logClear` 后再注册：抛 `[dsh-log] 电话名已被注册，不覆盖旧的：qa.logClear`，但表里**已经多出 `qa.logBatch` 与 `qa.logExport`**（5 个电话里 2 个半注册在位，`logClear` 及其后 3 个动作缺失）。即撞名时不只是「第二个插件起不来」，而是**留下半个可用的注册面**——宿主侧看到的是「这个插件有 2 个电话可用」，其余 3 个静默缺失。
2. **同进程两个 store 共写同一目录也会丢行**（把票 02 的「多进程」加深到同进程）：两个实例用同一 `logDirName`，各写一条 error 后 `Promise.all([flushNow(), flushNow()])`，5 轮实测**每轮只活下来 1 行**（理想每轮 2 行，5 轮共丢 5 行）。机制与票 02 同源：`src/store.ts:367`（文件服务无追加原语）、`:396-403`（读—拼—写全文覆写、无锁）。
3. **顶层 `<cacheDir>` 是扁平命名空间，跨层还会互踩**：用**别人的开关文件名**当自己的 `logDirName`（例如 `logDirName: 'log-switch-alpha.json'`）时，先到者无损、后来者自己写盘失败（只计数进 `dropped`）。即「日志目录名 / 开关文件名 / 日志文件名」共用同一个扁平命名空间，冲突形态不止「同名对同名」。（本条为后台 agent 首报；其根因与第 2 层同一条——覆盖值零校验、包内不做占用检查。）

两条口径补强：

4. **不传配置 = 落 `wf`**：宿主侧 `src/store.ts:111-113` 在 `configInput === undefined` 时用 `{ pluginId: 'wf' }`，客户端侧 `src/client.ts:108` 同样默认 `'wf'`。实测宿主 store 不传配置 → `pluginId=wf`、`logDirName=logs`、`switchFileName=log-switch.json`、`prefix=wf`。**忘传配置的第三方插件与当前插件四样全撞且不会报错**（配置面只有 `pluginId` 非法才抛，没有「必须显式传标识」的强校验）。
5. **开关读回是一次性的，且客户端单键能掐掉别的插件的按需日志**：`loadSwitch` 首行 `if (switchLoaded) return`（`src/store.ts:421-422`），同一实例第二次调用**不会重读盘**——盘上被别人改了也看不到，只有新实例才读得回来。客户端侧最锋利的端到端形态：B 自己的宿主开关开着，A 把共享键关掉后，**B 的新客户端对非常驻 info 返回 false，该行在选行层静默消失且丢弃数不涨**（`src/client.ts:279-288`）——error 与常驻名单照走。

## 未验证与遗留

- **真实宿主是否共用一张电话注册表**：`registerHostLogPhones` 的表由调用方传入（`src/host.ts:56-63`），包内无默认表。在 `D:\dsh-plugin` 全域检索 `registerHostLogPhones` 的**消费方**，只命中本包自己的历史 checkout（`dsh-deck-*-before/packages/dsh-log`），**没找到宿主侧集成代码**；系统提示里的 DSH 安装目录 `D:\DeepseekHarness\resources\app.asar\dsh` 在本机不存在。故 I4 的两支无法在本仓收敛，第 1 层的判定保留两支。
- **真实宿主里两个插件是否同 `cacheDir`、同 origin/同 `window.localStorage`、同 `globalThis`**：三样都在宿主侧。若插件客户端被隔离在不同上下文/作用域存储，第 4、5 层的「不隔离」要按宿主实况打折；若共用，则如实测。`getCacheDir` 的实现同样在宿主侧（票 02 已记为未验证），本仓无法证实两个插件拿到的是同一个目录。
- **`dist`（2026-10-07 构建）与 `src`（最后改 2026-10-04）未做字节级重生成比对**：本仓跑不了 `build.mjs`（`import esbuild` 而 `node_modules` 只有 `typescript`，与票 02 的 D2 同源）。已做的佐证是逐项比对产物与源码机制一致（`dist/client.js:31` `LOG_DEBUG_KEY = "dsws.debug"`、`dist/client.js:51/69` 读写同一键、`dist/config.js:25` 开关名派生），故全部实测数字仍以 `dist` 产物为准。
- **未覆盖的实测**：三进程及以上混写；`four-segment` 策略下的共写（文件名含进程号，天然分开，未测冲突）；`logClear` 按具体日期删到别人文件的边界；导出与他人写入并发时读到半截文件；开关电话的两条（`logGetSwitch`/`logSetSwitch`）在共用开关文件下的完整时序。
- **本票不给修复方案**，也不裁定「隔离应该做到哪一档」——那属地图 01 的「Not yet specified」：隔离若实锤冲突，其修复方案待隔离票结论后成票（`issues/01-untitled.md:43`）。
- **不属于本票**：文件能力（票 02）、级别（票 03）、轮转（票 04）、格式（票 05）、聚合（票 06）、链路追踪（票 07）、追踪标识（票 09）。

## 证据清单

**读过的文件与行范围（全文或关键段）**

| 文件 | 行范围 |
|---|---|
| `src/host.ts` | 1-81（全） |
| `src/config.ts` | 60-140（重点：字符约束、默认派生、电话名拼法）；另 `:22-26`、`:39-44` 常量与配置面 |
| `src/client.ts` | 58-100（依赖面与配置面）、100-260（键、读写、实例状态）、276-310（isEnabled/log）、375-405（全局散列）、527-551（对账）、595-653（写开关） |
| `src/store.ts` | 88-140（工厂与实例状态）、380-460（落盘路径、读改写、开关读写）、516-553（电话接线） |
| `src/phones.ts` | 60-81（`listDir` 作用域）、295-306（两条开关电话） |
| `src/node.ts` | 126-195（入口：cacheDir 必填、建目录、建库时 `loadSwitch`、`ready`） |
| `README.md` | 1-228（全；重点 §2.1、§3、§4、§5、§8） |
| `INTEGRATION.md` | 隔离相关行：104、219、222 |
| `tests/host.test.mjs` | 118-157（命名规则与重复注册；该套在本仓跑不起来，`:15` 引用宿主 monorepo 旧路径） |
| `tests/client.test.mjs` | 59-99（默认/自定前缀、`LOG_DEBUG_KEY`）、296-310（自定义前缀隔离；该套在本仓跑不起来，`:19` 同上） |
| `issues/01-untitled.md`、`issues/02-untitled.md` | 口径与先行实锤（`issues/01-untitled.md:12`、`:14`；`issues/02-untitled.md:65`） |
| `dist/{client,config}.js` | 只读产物，用于实测与作业面比对 |

**现有测试对这一层的覆盖（重要缺口）**

两个入口的单测都只覆盖「**一个**插件 + 自定前缀 = 名字跟着前缀走」（`tests/host.test.mjs:118-148` 的命名规则与重复注册、`tests/client.test.mjs:298-310` 的「自定义前缀隔离」），**没有一条用例是「两个插件同时建库/同时建客户端」的对照**：无共写目录、无共用开关文件、无共用存储键、无全局函数。而且这两套在本仓都跑不起来（引用宿主 monorepo 旧路径 `D:\src\...`，`tests/host.test.mjs:15`、`tests/client.test.mjs:19`），即这一层的既有断言目前是**不可执行**的状态。

**只读实测（三支探针，`node` 引 `dist/*.js`，运行在系统临时目录，未写任何仓库文件）**

| 探针 | 覆盖 | 关键结果 |
|---|---|---|
| `.local/selfcheck-08-isolation.mjs` | 五层主探针 | L1：默认前缀隔离；同前缀共用表抛错且不覆盖；各自表静默同名。L2：默认目录隔离；显式同名无校验；共写时 alpha 导出命中 gamma 的行；alpha 清空 `removed=1`。L3：默认开关名隔离；同名时 gamma 建库读到 `enabled:true`；重建 alpha 读到 `false`。L4：单键 `dsws.debug` 双向覆盖。L5：一份全局实现服务两实例，换实现影响已建实例，撤掉回落 `0002b61f`；`node` 产物不含全局名 |
| `.local/selfcheck-08-isolation2.mjs` | 实例计数独立性 + `wf` 别名 | `maxQueue=1` 同 cacheDir 两实例：A.dropped=1 / B.dropped=0，再各自 1；`pluginId:'wf'` 两个插件 → `logs`/`log-switch.json`/`wf.*` 全同，共用注册表第二次注册抛错 |
| `.local/selfcheck-08-isolation3.mjs` | 共写清空后果 + 对账覆盖 + 影响面 | 清空后共用目录变空（`removed=1`）；B 对账把共享键抹成 `false`（A 的持久值随之变化）；共享键只影响按需 info/debug，error 与常驻名单不受它管 |
| `.local/selfcheck-08-isolation4.mjs` | 复核后台取证 agent 的三条新发现 | 注册半原子：抛错后表里留下 `qa.logBatch`/`qa.logExport`；同进程两实例共写同目录 5 轮**每轮只活 1 行**；不传配置 → `wf`/`logs`/`log-switch.json` |
| `D:\Temp\dsh-log-08\probe-{1..6}-*.mjs` + `out-probe-*.txt` | 后台取证 agent 的原始探针与输出 | 五层逐层 + 端到端；本报告「补充实测」一节的三条首报出自这里，Lead 已独立复跑 |

**本报告未覆盖的引用方式说明**：不引用 `research/489-appendix.md`（宿主 monorepo 的文件，本仓不存在，同票 02 的 D2）；不引用 `tests/verify-log-*.js`（本仓不存在）。

## 对标：electron-log 多实例隔离（一手来源核验）

**来源与版本**：源码为 GitHub `megahertz/electron-log` 默认分支 `master`（tree `32be627dcb9279dc1d5b17cd5c67cf3b4e7409f9`，2026-10-09 读取）；后台对标 agent 另做了版本核验——npm `dist-tags.latest` = **`electron-log@5.4.4`**（[registry 元数据](https://registry.npmjs.org/electron-log/latest)，发布 2026-05-14），master 与 5.4.4 tarball 的 **19 个 `src/**` 文件 SHA256 全部一致**，故下文 `src/**` 的路径/行号对 5.4.4 有效；`docs/**` 不在 npm 包内（tarball `fileCount=40`），其行号只对 master HEAD 有效。一手来源：[`README.md`](https://raw.githubusercontent.com/megahertz/electron-log/master/README.md)、[`docs/transports/file.md`](https://raw.githubusercontent.com/megahertz/electron-log/master/docs/transports/file.md)、[`docs/initialize.md`](https://raw.githubusercontent.com/megahertz/electron-log/master/docs/initialize.md)、[`src/core/Logger.js`](https://raw.githubusercontent.com/megahertz/electron-log/master/src/core/Logger.js)、[`src/core/scope.js`](https://raw.githubusercontent.com/megahertz/electron-log/master/src/core/scope.js)、[`src/node/transports/file/index.js`](https://raw.githubusercontent.com/megahertz/electron-log/master/src/node/transports/file/index.js)、[`src/node/transports/file/FileRegistry.js`](https://raw.githubusercontent.com/megahertz/electron-log/master/src/node/transports/file/FileRegistry.js)。

**一句话结论**：electron-log 的多实例隔离是**「实例级配置隔离」**，不是**「命名空间隔离」**。同进程可以建任意多个各带独立 `transports`/`levels`/`hooks` 的 `Logger`；但跨实例的**身份键只有一个裸字符串 `logId`**（静态注册表的 key，重名静默覆盖），`scope` 只是行文本标签，**默认落盘路径完全不由实例派生**（只由进程类型 + 应用名决定）。它能做到「各自改路径就不互相踩」，做不到「第三方共用同一日志系统而互相不知对方存在」。

| # | 问题点 | electron-log 的做法（源码/文档） | 对本包哪一层可比 |
|---|---|---|---|
| 1 | 实例模型 | `class Logger { static instances = {} }`，构造末尾 `Logger.instances[logId] = this`（`src/core/Logger.js`）→ **同名 `logId` 静默覆盖（last-wins）**；`log.create({ logId })` 就是 `new Logger({...})`（字符串参数等价 `{ logId }`）；`Logger.getInstance({ logId })` 回落到 `instances.default`。`levels`/`hooks`/`scope`/`variables`（浅拷贝）与 `transports` 都是实例级 | 对应本包「一次建库一个实例」；本包无全局实例表，这一条 electron-log 多、本包少（本包 `src/host.ts:56-63` 的注册表由调用方传入，没有默认全局表） |
| 2 | 实例身份键与路由 | 身份键只有一个字符串 `logId`，**不参与任何派生**；main 侧 IPC 处理器按 logId 取实例（`src/main/index.js`），跨进程/跨库路由全靠它；重名无任何唯一性校验或告警 | **直接可比本包的「电话名」**：`logId` 与 `prefix` 同为字符串身份键，差别是 `prefix` 参与电话名/目录/开关文件名派生，而 `logId` 只当 key 用且重名不报错 |
| 3 | 实例间共享引用 | `create()` 把父实例的 `dependencies`、`errorHandler`、`initializeFn`、`isDev`、`transportFactories` **按引用传下去**（只有 `variables` 浅拷贝）；每个新实例构造时都执行 `errorHandler?.setOptions({ ...dependencies, logFn: this.error })` ⇒ **最后建的实例接管共享 errorHandler 的落点**。**注意：`create()` 不传 `eventLogger`**（`src/core/Logger.js` 的 `create()` 选项里没有该字段），故 `log.create({logId})` 得到的实例 `eventLogger === undefined`；默认实例的 `eventLogger` 才在创建时被 `setOptions({ logger: this })` 绑定一次 | 对应本包第 5 层「全局函数」：本包是 `globalThis.dswsLogHash/dswsLogTrunc` 后挂者影响所有人，electron-log 是 `errorHandler` 后建者接管——**同为进程级共享面**；`hooks = []` 才是真实例级 |
| 4 | 落盘隔离（默认） | 文件 transport 顶部原文 `// Shared between multiple file transport instances` + `const globalRegistry = new FileRegistry()`，工厂默认 `{ registry = globalRegistry }`，而内置装配从不传 registry ⇒ 所有实例共用一张文件表。文件名默认 `getDefaultFileName(processType)` → `main.log`/`renderer.log`/`worker.log`；默认路径 `path.join(vars.libraryDefaultDir, vars.fileName)`，`libraryDefaultDir` 由进程类型 + 应用名决定 ⇒ **不配就是同一个文件**；README 原文：`Be aware that you need to configure each instance (e.g. log file path) separately.` | 对应本包第 2 层「落盘目录」：**两边默认都不是「每个插件一个文件」**——本包按标识派生**默认就分开了**，electron-log 默认**不分开**，必须显式配 |
| 5 | 同路径共写的行为 | `FileRegistry.provide({ filePath })` 先 `path.resolve`，命中 `this.store[filePath]` 就**返回同一个 `File`**，且**忽略后来者的 `writeOptions`/`writeAsync`** ⇒ **先建者的 `sync`/`writeOptions` 对所有人生效**。默认 `sync: true` ⇒ 同步 append（`flag:'a'`），同进程内不交织；`sync:false` 时串行队列是「每个 `File` 一份」，故同路径两实例共享同一队列 | 对应本包第 2 层「共写后果」：electron-log 同路径是**一个写者串行追加**（不丢行、但两插件内容混在一个文件里，`readAllLogs()` 也会读到别人的行）；本包是**读—拼—写全文覆写、无锁**（票 02 实测整批丢行）。两边都不隔离，失败形态不同 |
| 6 | 轮转的实例边界 | 配置是实例级（`maxSize`/`archiveLogFn` 在各自 transport 上），但**效果是文件级**：`needLogRotation = transport.maxSize > 0 && file.size > transport.maxSize`，`file.size` 含**所有实例**写入的字节；触发时 `transport.archiveLogFn(file)` 直接 `renameSync` 共享文件 ⇒ **A 实例的轮转会把 B 实例正在写的日志改名/截断**（默认 `maxSize` 1MB） | 对应本包「同 `logDirName`」情形：本包目前**没有轮转**（票 04 判定中），一旦加轮转，这一格会与 electron-log 同形——轮转是文件级而非实例级 |
| 7 | `scope` 是不是隔离 | `scope(label)` 只返回一组转发函数，调用 `logger.logData(d, { level, scope: label })`，**不建实例、不碰路径、不碰 IPC 通道名**；只在格式化时替换 `{scope}`。副作用：`scope.maxLabelLength` 被首用撑大后影响该实例全部输出的填充宽度 | 对应本包第 1 层「前缀」：本包前缀参与电话名/目录/开关文件名派生，比 electron-log 的 scope 强一档；**不要把 scope 类比成 `prefix`**，要类比应对 `logId` |
| 8 | 同进程多实例的串行保证 | 有，但只对「同一个 `File` 对象」成立（见第 5 行）；**跨进程无任何锁** | 可比：本包同目录并发写的串行保证得自己给 |
| 9 | 全局（跨实例共享）清单 | ①`Logger.instances` 静态注册表；②**硬编码 IPC 通道名** `'__ELECTRON_LOG__'` 与 `'__ELECTRON_LOG_IPC__'`（每进程一个通道，实例身份只在 payload 里）；③`globalRegistry`；④模块级 `externalApi` 单例（经 `dependencies` 被所有实例共享）；⑤`initialize` 的模块级标志位（`log.initialize()` 第二次调用直接警告并 return）、固定 preload id `'electron-log-preload'`；⑥renderer 固定全局名 `window.__electronLog`（preload 里那句 `// Sometimes this files can be included twice` 的 try/catch 正是为重复注入准备的） | **直接可比本包第 5 层**：本包 `dswsLogHash`/`dswsLogTrunc` 与这些同形（进程内单例、同名即同一份）；差别是 electron-log 的共享态基本留在自己的模块作用域里，除 `window.__electronLog` 外不占宿主公共名字——**本包占的是宿主全局命名空间上的名字，冲突面天然更大** |
| 10 | 开关文件 / 本地存储键 | **完全没有**任何持久化开关机制：级别就是实例上的 `transports.*.level`（默认 `'silly'`），关掉写 `= false`，**进程重启即回默认**。全仓扫描无 `localStorage`/`sessionStorage`/`electron-store`/`configPath`；`src/**`（排除 `__specs__`）的磁盘写入只有日志文件与可选的兜底 preload 脚本，磁盘读取只有 app 的 `package.json` 与日志文件；唯一环境开关是 `process.env.FORCE_STYLES`（构建 console transport 时读一次）。npm 元数据显示运行时**零依赖** | 本包第 3、4 层（开关文件、`dsws.debug`）在 electron-log 里**无对应物**——electron-log 也不存在「两个插件争一个开关键」，它压根不存跨进程开关 |
| 11 | 两个独立副本共存 | 同一份模块被去重时：两库共享全部上述全局（同一默认 logger、同一 `Logger.instances`、同一 `globalRegistry`、同一 `errorHandler`、同一个 `ipcMain.on('__ELECTRON_LOG__')`）。各自打包副本时：各有一份模块级状态，但在同一 OS 资源上相撞——默认同路径 `main.log`（两个 `File` 对象、各自 1MB 轮转）、同一通道被注册两次、固定 preload id 注册两次、`window.__electronLog` 互相覆盖 | 可比本包「两个第三方插件共用同一日志系统」的情形：electron-log 的答案是**没有隔离机制，只有冲突面** |

**electron-log 做不到的**（一手来源可证）：

1. **不配置就隔离**：默认所有 main 实例写同一个 `main.log`（路径只由进程类型 + 应用名决定），且按绝对路径复用同一个 `File`。官方只给一句约定：`Be aware that you need to configure each instance (e.g. log file path) separately.`
2. **同名不冲突**：`logId` 是静态注册表的 key，重名直接覆盖，且影响 IPC 路由；无唯一性校验或告警。
3. **作用域即命名空间**：`scope` 只改行文本，不参与路径、不参与 IPC 通道名（通道名硬编码）。
4. **配置独立 = 效果独立**：`maxSize`/`archiveLogFn` 是实例属性，但轮转判据用**共享文件**的字节数，一个实例触发轮转会把别的实例正在写的文件 `renameSync` 掉；同路径下后到者的 `sync`/`writeOptions` 还被忽略。
5. **全局钩子各归各的**：`errorHandler` 被 `create()` 按引用继承并被每个新实例重绑 `logFn`，`startCatching` 挂的是**进程级**监听且幂等 ⇒ 后建实例接管全局错误落点；`initialize()` 也是模块级一次性。**持久化开关这一层则根本不存在。**

**对本包的启示**（对标结论，不含修复代码）：

1. **本包在「默认派生」这一层比 electron-log 强**：electron-log 默认全撞同一个 `main.log`，本包按标识默认派生 `logs-<标识>` / `log-switch-<标识>.json`（`src/config.ts:87-98`，实测）。但两边的「分开」都**不是强制**——electron-log 靠每实例配，本包靠调用方不写覆盖字段且标识互不相同。
2. **「参数化 ≠ 强制唯一」**：electron-log 把「配置」实例化了，没把「身份」参数化（`logId` 只是个裸 key，重名 last-wins）。本包把 `prefix` 派生到电话名/目录/开关文件名，比它强一档，且 host 侧对重名直接报错；但本包同样缺「标识唯一性」这一环（见正文第 1 层）。
3. **electron-log 有本包缺的一件东西：同一路径的单写者收敛**（`FileRegistry` 按绝对路径去重后共用一个 `File`，后来的 `writeOptions`/`sync` 一律忽略）。本包同目录共写是读改写无锁（票 02 实测整批丢行）——这是本包在「隔离」这一格上最值得对标的点。
4. **轮转是文件级、不是实例级**：electron-log 的 `maxSize` 轮转会把别的实例正在写的文件改名。本包目前无轮转（票 04），**将来加轮转时这一格会复现**——轮转的判据若取「文件大小」，就天然是跨插件共享量。
5. **「多实例」不等于「隔离」**：electron-log 连 `errorHandler` 都共享。若把「互相不知对方存在」当硬指标，两边都达不到；本包多出来的一层是可强制的注册表（电话名前缀 + `registerHostLogPhones` 撞名报错），electron-log 没有对应机制。

## 复核与产出说明

**仓库内事实**（第 1–5 层、层外发现、最小复现、文档出入、证据清单、「补充实测」一节的复跑）：由 Lead 逐行核对源码 + 四支只读探针实测（引 `dist/*.js` 产物，运行在系统临时目录，未改仓库任何文件），66 处 `路径:行号` 已逐条打印原文自检。

**外部对标**（electron-log 一节）：由后台对标 agent 独立取证（基准 `electron-log@5.4.4`，附源码行号；master 与 npm tarball 的 19 个 `src/**` 文件 SHA256 一致），Lead 复核了其中载荷最重的三条——`create()` 不传 `eventLogger`、`FileRegistry` 命中已有路径后忽略后来者的 `writeOptions`、轮转判据取**共享** `file.size`——三条均在 Lead 自取的一手源码中逐字对上；**并据此更正了本报告初稿的一处错误**（初稿把 `eventLogger` 写成与 `errorHandler` 一样被 `create()` 共享，实为不传递）。

**后台取证 agent 的交付与合并**：该 agent 也产出了完整报告并写入同一路径，但本稿于 2026-10-09 23:09 重建时以其为基线覆盖，其正文未能保留（仅 6 支探针脚本与原始输出留在 `D:\Temp\dsh-log-08\`）。其**三条本稿未覆盖的新发现**（注册非原子、同进程共写同目录也丢行、扁平 `cacheDir` 命名空间跨层互踩）已收入「补充实测」一节，逐条由 Lead 用 `.local/selfcheck-08-isolation4.mjs` 独立复跑确认；其判定用词「部分具备（隔离能力）」与本稿「部分隔离」是同一判断的两种读法。

本票未改任何代码、未改 `README.md`/`INTEGRATION.md`（与文档的出入只记录、不修改）。只读探针脚本留在 `.local/selfcheck-08-isolation*.mjs`。
