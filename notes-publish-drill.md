# 日志系统发布记录（dsh-log）

这份文件记的是「发出去的是什么」：每发一版，把原始输出与关键数字留在下面，供下一个人复现和核对。文中的字节数、文件数都描述**当时发出去的那一份**，不是当前工作区。0.2.0 是首次公开发布，随 Node 程序入口一起上线；此前只有本地演练（见第四节）。

## 〇.1 dsh-log 0.3.1（2026-10-15；已就绪、待发布）

**改了什么**（细节见 `research/16-release-0.3.1.md` 与 `research/17-read-side-toolkit.md`）。口径说明：这一版曾按「先不发、留在仓库里」搁置，之后又落了读侧工具，用户明确 **全部改动都算 0.3.1**（所以不再拆成 0.4.0）：

1. **客户端丢弃计数口径修正**：库自己写的诊断行（`log.forward.summary` 等）不再计入 `dropped`，与宿主侧同口径；修前「1 行用户日志 + 宿主长坏」会报成丢 2 行。
2. **内部命名整改**：`selfMon` → `isDiagnostic`；客户端四个工厂 `create*Rig`/`*RigInput` → `create*Stage`/`*StageInput`（参数 `rig` → `input`）；删掉一处从未使用的注入（`SendStageInput.log`）。公开导出名与事件清单数据值 `kind: 'selfmon'` 未动。
3. 顺带修掉第一条汇总行 `windowMs` 报 epoch 量级（`lastSummaryAt` 从实例建成那一刻起算）。
4. **读侧渲染**（本版新增）：根入口新增 `parseLogLine` / `formatRow` / `formatRows`（把落盘的一行变回人话；纯函数、零 IO，浏览器也能用）。
5. **命令行工具**（本版新增）：装包即带 `dsh-log tail`（`bin` → `dist/cli.js`；按写序读、默认渲染人话、`-f` 跟读、`--level/--since/--trace/--limit`、`--json` 回机器态；**只读**——不写、不改、不删，也不写缓存）。
6. 文档：README 新增「3.1 真实输出长什么样」与「3.2 怎么看日志」，INTEGRATION 新增步骤 4b，事件清单示例补 `message` 字段约定。

**发布前门禁（本机实跑）**：

| 项 | 结果 |
|---|---|
| `tsc -p tsconfig.json` | exit 0 |
| `node build.mjs` | 49 JS + 49 `.d.ts`（含 `dist/cli.js`，shebang 在第一行） |
| `npm test` | 197 / 197（21 套；新增读侧渲染与读侧命令行两套） |
| `scripts/mutation-check.ps1` | 82 / 82 RED（新增 M79–M85 咬住读侧；含两条「假绿」教训的修复） |
| `node scripts/pack-smoke.mjs` | 通过 |
| `npm pack --dry-run` | 103 个文件（`files` 白名单） |
| 公开面快照（`tests/public-surface.test.mjs`） | 35 / 23 / 17 / 4（根入口 +3＝读侧三个函数） |

**发布后要核对的四项**（与 0.3.0 同款）：①官方源 `dsh-log@0.3.1` 的 `gitHead` 等于本仓发布时的 HEAD；②tarball 内四份文档 SHA256 与仓库逐字一致；③全新工程装一次，运行冒烟（写一行五键 `v=3`）与类型冒烟（`strict` + `types: []`，不装 `@types/node`）都过，且 `npx dsh-log --version` 能跑；④本节的原始输出补上。

## 〇、已发布：dsh-log 0.3.0（破坏性版本，只发一次）

**状态（2026-10-14）：已发布到官方源，`dist-tags.latest` = 0.3.0。** 发布者 `feather_wch`（维护者本人），用的是**自动化 token**（`//registry.npmjs.org/:_authToken`，无需浏览器授权/动态码）——上一节 0.2.1 那次后台直跑报 `EOTP`，就是因为当时用的是需要二次验证的凭据。发布命令：

```bash
npm publish --userconfig <只含该 token 的临时 npmrc>
```

token 只写进 `%TEMP%` 下的临时 npmrc，不进仓库、不写进 `.npmrc`（仓库现在没有 `.npmrc`，也不该有）。

发布那一刻的门禁（发之前逐条跑过，全绿）：

| 项 | 结果 |
| --- | --- |
| 类型 | `node node_modules/typescript/bin/tsc -p tsconfig.json` exit 0 |
| 全量测试 | `npm test` **180/180、19 套**、exit 0 |
| 变异表 | `pwsh -NoProfile -File scripts/mutation-check.ps1` 基线全绿、**72 条逐条 RED**、0 SKIP/GREEN/TIMEOUT |
| 长跑自检 | `node tests/soak.mjs 6` A 段 20000/20000 落盘、B 段查询行数 === 磁盘行数 |
| 构建可复现 | `node build.mjs` 产出 44 JS + 44 `.d.ts`，与入库产物逐字节一致 |
| 打包冒烟 | `node scripts/pack-smoke.mjs` 通过（含真装 tarball 写一行五键） |
| 打包干跑 | `npm publish --dry-run` → 93 文件 |

发布后四项核对（逐条做过，数字如下）：

1. **官方源**：`dist-tags.latest` = `0.3.0`（发布后约 4 分钟可见，符合 npm 的「正在处理」提示）；`time.0.3.0` = `2026-10-14T04:47:56Z`（北京时间 12:47:56）。
2. **发布修订**：`npm view dsh-log@0.3.0 gitHead` = `c77ea6e504e79040c9af3c089554e02e47ceeb98`，等于发布那一刻的仓库 HEAD。
3. **包内文档与仓库逐字一致**（下载源上 tarball 解包比 SHA256，前 12 位）：`README.md` `AF3DCFAD6F74`、`INTEGRATION.md` `03DC9AEFC11E`、`LICENSE` `326012A43D1F`、`event-list.template.json` `A024DCBB8AA8` —— 四项全 SAME。
4. **陌生机器装一次**：空目录 `npm install dsh-log@0.3.0` → 装到 0.3.0、44 个 `.d.ts`；运行时冒烟 `createQuickLog` 写一行 → `<cacheDir>/logs-quick/2026-10-14.log` 五键 `[event,fields,level,ts,v]`、`v=3`、`ready` = `{ok:true,pending:0,lastPersistFail:null}`；类型冒烟 `strict` + `types: []`（不装 `@types/node`）+ `skipLibCheck: false` → 四个入口零报错，故意写错的一行如实报 `TS2322`。
   - 踩坑记录：第一次 `npm install dsh-log@0.3.0` 报 `notarget`，是**本机 packument 缓存还停在 0.2.2**；加 `--prefer-online` 即装上（同一天稍后装的人不会遇到）。

发出去的这一份（`npm publish` 原始输出）：

```text
npm notice name: dsh-log
npm notice version: 0.3.0
npm notice filename: dsh-log-0.3.0.tgz
npm notice package size: 134.0 kB
npm notice unpacked size: 410.9 kB
npm notice shasum: 9abee95a47e611aab020a021a772ad92ff4aaf46
npm notice integrity: sha512-XljgcsG1kAuk+9ArdpkY3OxbyW75NN7fbj0mUAEPoSxlAoM67phD8XIppMD6vpRoYwI0Ge2RHryUjrknOK0dXw==
npm notice total files: 93
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
+ dsh-log@0.3.0
```

源上元数据：`dist.fileCount` = 93、`dist.unpackedSize` = 410928、`dist.tarball` = `https://registry.npmjs.org/dsh-log/-/dsh-log-0.3.0.tgz`。

发布这一版的已知边界（已写进下面第三节的发布说明口径，别让使用者自己踩）：

- **破坏性变更**：不兼容 0.2.x。插件按 `INTEGRATION.md` 的迁移七步重开发；`0.2.x` 的 `sampleRate` 参数已删（它从未参与任何判定），`setLogSwitch` 现在只收一个布尔参。
- **跨进程零保护**：同目录多实例的占用登记是模块副本级的，跨进程不设防；文档已写成风险提示（有 `appendText` 时只交错不覆写，没有时可能吃掉对方的行，两种形态都会留 `foreign-write` 诊断）。
- **包内不含 `src`、不含测试**：发出去的是 `dist`（44 JS + 44 `.d.ts`）+ 两份文档 + 模板 + LICENSE；`dist` 是入库产物。
- **0.3.0 是首次带类型的版本**（0.2.x 装到 TS 工程里会报 TS7016）。
- 发布后的回滚口径：`npm deprecate dsh-log@0.3.0 "<原因>"`，不要 `unpublish`（0.3.0 可以被 0.3.1 覆盖修复；只有发出去 24 小时内才允许 unpublish）。

## 一、已发布：dsh-log 0.2.1

- 发布时间：2026-09-12 04:04:23（UTC）
- 发布人：王辰浩（npm 身份 `feather_wch`）
- 发布目标：https://registry.npmjs.org/，标签 `latest`，公开访问
- 发布所用修订：`dad8db4`。官方源记的 `gitHead` 与本仓 `git rev-parse HEAD` 逐字相同，发出去的就是这个提交里的文档。
- 这一版只改文档，源码零改动：重建的 6 个 `dist` 文件与已发布 0.2.0 逐字节相同，对使用者零行为变化，所以按补丁版发。要修的事写在第二节的"已知偏差"里——0.2.0 发出去的包内 README 还写着"包还没发到官方源"，读者照着第一步走就会以为装不上。
- 发布命令（在 `packages/dsh-log` 目录下，先跑 `node build.mjs` 生成产物）：
  1. `node packages/dsh-log/build.mjs`
  2. `npm publish --registry=https://registry.npmjs.org/`
- 授权怎么走：npm 会打印一条 `Authenticate your account at: https://www.npmjs.com/auth/cli/…` 的链接并停在"Press ENTER to open in the browser"，按回车打开浏览器、在已登录的账号下确认，命令才继续。**没有交互终端时（例如后台直接跑）它不做这一步，直接报 `EOTP`（要求一次性验证码）退出，什么都没发出去**——这一版第一次就是栽在这里，换到能交互的终端里重发才成。
- 发布结果关键行：包名 dsh-log、版本 0.2.1、文件数 11、包大小 26.6 kB、解包后 89.6 kB
- 官方源记下的哈希（可用 `npm view dsh-log@0.2.1 dist` 复核）：shasum `f45a5d960e5adcbe8f8212b3e15f269590785185`、integrity `sha512-DnHix0UDQ+TbVo1XL9nSXJEeaokpbC8ZQUHHKAT0NbjuhTWJUOKbRkhwVaCw0D+2F75zCtovY+08OE6OMh/jiQ==`
- 发布后的四项核对（照第三节的清单做，全过）：
  1. 官方源：`version = 0.2.1`、`dist-tags = { latest: '0.2.1' }`。发布那一刻 `npm view` 查到的还是 0.2.0，约 1 分钟后才转过来，属正常同步延迟（CLI 当时提示"正在处理，可能几分钟后才可查"）。
  2. 发布修订：官方源 `gitHead = dad8db41de77d8da9d17ebc416c0f64fc16e90c0`，就是发布那一刻仓库的 HEAD（提交 `dad8db4`）。之后仓库还会继续往前提交，所以复核时查它是否还在历史里（`git merge-base --is-ancestor dad8db4 HEAD` 退出码 0 即通过），不要拿它跟当天的 HEAD 直接比。
  3. 包内文档与仓库逐字一致：把发出去的 tarball 下载解开比对，包内 `README.md` 与 `INTEGRATION.md` 的 SHA256 分别与仓库同名文件相同（`0B09EB4F…`、`7698CE63…`）。0.2.0 就是漏了这一步，把旧稿发了出去。
  4. 陌生机器上装一次：空目录里 `npm install dsh-log@0.2.1`，装到的 README 是修正后的那版，`import { createNodeHostLog } from 'dsh-log/node'` 能建库并写出日志。

## 二、已发布：dsh-log 0.2.0

- 发布时间：2026-09-12
- 发布人：王辰浩（npm 身份见 `npm whoami`）
- 发布目标：https://registry.npmjs.org/，标签 `latest`，公开访问
- 发布所用修订：`e6c871c`（官方源 `npm view dsh-log@0.2.0 gitHead` 可查；提交说明是"说明书修正：进度标题与内容之间必须空一整行"，与本包无关，它只是发布那一刻的仓库最新提交）
- 这一版的已知偏差：**包内 `README.md` 与 `INTEGRATION.md` 是发布当时的旧稿，与本仓当前工作区不一致**——包已经发出去了，包内 README 却还写着"包还没发到官方源"，随包的集成教程也跟着说安装命令装不上。原因是改好这段文字的提交（`af8f999`）在发布之后才落到仓库。**这份偏差已随 0.2.1 修掉，见第一节。**
- 发布命令（在 `packages/dsh-log` 目录下，先跑 `node build.mjs` 生成产物）：
  1. `node packages/dsh-log/build.mjs`
  2. `npm publish --registry=https://registry.npmjs.org/`（发布过程中 npm 要求了一次浏览器授权，授权后继续）
- 发布结果关键行：包名 dsh-log、版本 0.2.0、文件数 11、包大小 25.4 kB、解包后 86.2 kB
- 完整输出逐行如下：

```text
npm notice package: dsh-log@0.2.0
npm notice Tarball Contents
npm notice 14.2kB INTEGRATION.md
npm notice 1.1kB LICENSE
npm notice 16.2kB README.md
npm notice 15.4kB dist/client.js
npm notice 11.1kB dist/config.js
npm notice 1.9kB dist/host.js
npm notice 3.7kB dist/node.js
npm notice 9.2kB dist/phones.js
npm notice 12.4kB dist/store.js
npm notice 127B event-list.template.json
npm notice 870B package.json
npm notice Tarball Details
npm notice name: dsh-log
npm notice version: 0.2.0
npm notice filename: dsh-log-0.2.0.tgz
npm notice package size: 25.4 kB
npm notice unpacked size: 86.2 kB
npm notice shasum: 21128f0f6e2b236dd8ffa5237da90a19d55b8919
npm notice integrity: sha512-+yUgGjSuowSSm[...]snoZANU2KL9Tw==
npm notice total files: 11
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
```

上面清单里的 `INTEGRATION.md` 14.2kB 与 `README.md` 16.2kB 是 0.2.0 发出去的那两份，仓库里已经改过，字节数不再相同，属正常。

- 发布后确认：
  - 官方源上的最新版本与标签：`version = 0.2.0`、`dist-tags = { latest: '0.2.0' }`。
  - 从一个模拟「别人的项目」的空目录里 `npm install dsh-log@0.2.0`，装完能 `import { createNodeHostLog } from 'dsh-log/node'` 并写出日志。
  - 发布真实输出里包含浏览器授权那一步（npm 会打印一条授权链接，在浏览器里确认后命令才返回）。

## 三、怎么再发一版

包目录下的 `publish-wizard.sh`（不随包发布）把全过程做成六段：体检（发布目标、文件数、名字是否被占）、网页登录（扫码）、升版本号、构建与干跑、正式发布（带确认闸）、发布后验证。Windows 上用 Git 自带的 bash 跑（不要用 WSL 的 bash，路径会对不上）：

```sh
"C:\Program Files\Git\bin\bash.exe" publish-wizard.sh
```

向导的"发布后验证"这一段只查官方源上的版本号，并要求把 `npm publish` 的原始输出补进本文档。另外两件事它没做，手动补上，都是几步的事：

1. **核对包内文档与仓库一致**。把刚发出去的包拿下来解开（`npm pack dsh-log@<刚发的版本>`），逐字比对包内 `README.md`、`INTEGRATION.md` 与 `packages/dsh-log/` 下的同名文件；再打开 npm 包页，看 README 开头讲安装的那几句是不是你想要的那几句。0.2.0 就是漏了这一步，把"包还没发到官方源"发了出去。
2. **记下发布修订**。`npm view dsh-log@<刚发的版本> gitHead` 读出这次发布对应的提交，连同版本、文件数、包大小、发布目标，按第一节的格式补一条记录。

两条经验，省下一次返工：

- **发布要在能交互的终端里跑**。没有交互终端时 npm 走不了浏览器授权，直接报 `EOTP` 退出（见第一节的授权说明）。
- **先提交、再发布**。工作区干净时发布，官方源记的 `gitHead` 才等于发出去的那份内容；带着未提交的改动发布，记录里就查不到"到底发了什么"。

## 四、历史：发布演练记录

- 演练时间：2026-09-09 与 2026-09-11（升级到 0.2.0 之前）
- 演练命令：先 `node packages/dsh-log/build.mjs`，再在包目录下 `npm publish --dry-run`（只演练不真发）
- 当时的演练结果：包名 dsh-log、版本 0.1.0、文件数 11、包大小 25.4 kB、解包后 86.2 kB，发布目标同样是官方源。
  逐行输出中与本次的差别只有三处（`package: dsh-log@0.1.0`、`version: 0.1.0`、`filename: dsh-log-0.1.0.tgz`），其余清单与大小一致，故不再重复抄录。
- 白名单变化史：8 文件（首发演练）→ 10 文件（白名单新增 `INTEGRATION.md` 与 `event-list.template.json`）→ 11 文件（新增 Node 程序入口 `dist/node.js`），与 `README.md` 第 9 节一致。
- 说明：`dist` 下 6 个 JS 由本地 build 生成，不入库；本记录文件与发布向导脚本都不在发布白名单内，不进发布包，只留本地作证据。
