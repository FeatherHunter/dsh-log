# 0.3.0 实现期验证记录（自查咬出的缺陷与门禁）

> 这份记录只写「怎么验的、验出了什么」——设计意图见 `research/14-architecture-plan.md`，
> 早期对抗审查的缺陷表见 `research/12-0.3.0-adversarial-review.md`。
> 时间跨度：2026-10-13 ~ 2026-10-14。所有数字都是本机实测。

## 一、门禁（每次改动后都跑）

| 门禁 | 命令 | 当前结果 |
| --- | --- | --- |
| 类型 | `node node_modules/typescript/bin/tsc -p tsconfig.json` | exit 0（`.bin/tsc` 垫片坏，必须直调） |
| 全量测试 | `npm test`（pretest 先 `node build.mjs`） | **163/163，17 套，exit 0** |
| 变异表 | `pwsh -NoProfile -File .local/mutation-check.ps1` | 57 条，基线先全绿、逐条必须 RED（见第五节） |
| 长跑自检 | `node tests/soak.mjs 0 --fast` / `node tests/soak.mjs 6` | 快速模式通过；全量见第四节 |
| 构建可复现 | `rm -rf dist && node build.mjs` | 产物与删除前逐字节一致 |
| 发行面 | `npm pack --dry-run` | 93 文件、44 个 `.d.ts`、114.8 kB |

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
  返回 `{ ok: false, reason: 'rename-not-effective' }`，降级为继续追加。`reason` 三态：
  `no-rename` / `rename-threw` / `rename-not-effective`（README §6.1 已写明）。
- **回归线**：`tests/rotation.test.mjs` 的 B1d（假适配器下 50 行一行不丢、无封存件、`dropped` 0、
  `reason === 'rename-not-effective'`）；B1b 断言 `reason === 'no-rename'`。
- **教训**：能力协商不能只看「方法在不在」，还要看「它做完之后世界变了没有」。

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

### 5. 无效变异与假覆盖（方法学）
- **M45 无效**：把 `exports.types` 指向不存在的文件 → 测试仍绿，因为 TS 会退回同目录的 `node.d.ts`。
  改成掏空声明本体（TS2305）才 RED。
- **M20 无效**：把 `flushNow` 在途分支改成返回已 resolve 的 promise → 咬不住，因为 `synced()` 自己用
  `flushInFlight !== null` 守循环，不依赖返回值。换成承重的 `while` 条件变异才 RED。
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
- 用法：`node tests/soak.mjs 0 --fast`（秒级）/ `node tests/soak.mjs 6`（6 分钟）。
  它**不进** `npm test` 的 glob（`tests/*.test.mjs`），属于显式触发的地基检查。

## 五、诚实边界（没做到的）

- **跨进程零保护**：目录占用登记是模块副本级的（`src/engine/dir-lease.ts` 的 `dirHolders`/`dirWaiters`），
  同进程两份 dist 互不可见，跨进程更不设防；文档已写成风险提示（危险窗口是并发读改写，不是必然覆写）。
- **逐字搬运无 git 基线可比**：仓库历史停在 0.2.x 时代，重构期的中间态没有提交，所以「这一步只搬了代码」
  只能靠当时的测试 + 变异表背书，不能事后独立复核。
- **`dist/` 入库**：包不发 `.d.ts` 之外的东西，但 dist 是入库产物（构建链有 `pretest` 保证不过期）。
- **未实测**：磁盘满 / 只读盘 / 真机 rename 失败（只有内存 fs 验过）、DSH 真实宿主链路、
  多实例长时间 soak、0.3.0 真发布（本机 `npm whoami` 报 ENEEDAUTH，需要先登录）。
