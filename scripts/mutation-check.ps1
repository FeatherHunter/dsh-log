# 变异自检：每一条断言，都必须「把修复改回旧行为就变红」。
# 做法：把 dist+src+tests 复制到临时目录，逐条注入变异，只跑相关用例，看是否变红。
# 脚本随仓提交（CI 的 windows 作业直接跑它）；探针脚本仍在 .local/（不入库）。
# 仓库根：默认按本脚本所在目录的上一级推；也可用 -RepoRoot 显式指定，便于在别的副本上跑表。
# 只跑名字里含某个子串的变异：调表时定位单条（`-Only M63`）；留空跑全表。
param([string]$RepoRoot = '', [string]$Only = '')
$ErrorActionPreference = 'Stop'
$src = if ($RepoRoot) { $RepoRoot } else { Split-Path -Parent $PSScriptRoot }
$tmpRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$work = Join-Path $tmpRoot ('dsh-mut-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
Copy-Item (Join-Path $src 'tests') (Join-Path $work 'tests') -Recurse
# src 也要带上：tests/client.test.mjs 有一条「源码里不再有旧全局」的静态断言要读 src/。
Copy-Item (Join-Path $src 'src') (Join-Path $work 'src') -Recurse
# 包内模板也要带上：tests/eventList.test.mjs 要读 event-list.template.json。
Copy-Item (Join-Path $src 'event-list.template.json') (Join-Path $work 'event-list.template.json')
# package.json 也要带上：#27 的发行面那两套要读 exports/files 字段，且靠「包自引用」（name+exports）
# 按包名 import 'dsh-log'；消费者类型那套还把 $work 当被依赖的包用 junction 装一次。
Copy-Item (Join-Path $src 'package.json') (Join-Path $work 'package.json')
# node_modules 用 junction 挂过来：发行面那两套要跑真 tsc，$work 里没有依赖会让基线直接红
# （曾把整张表挡在门外）。
New-Item -ItemType Junction -Path (Join-Path $work 'node_modules') -Target (Join-Path $src 'node_modules') | Out-Null

# 冻结快照：dist 与 package.json 从源仓一次性复制到 $snap，之后每轮从 $snap 复位。
# 理由（2026-10-14 独立审查）：重构期间 `node build.mjs` / `npm test` 会在背后重建 dist，
# 若每轮再从活仓库复制，同一次跑表里的各条变异会落在不同构建上，结论不可解释。
# 快照指纹打印出来，好让「这次结论对应哪个构建」可追溯。
$snap = Join-Path $work '_snap'
New-Item -ItemType Directory -Path $snap | Out-Null
Copy-Item (Join-Path $src 'dist') (Join-Path $snap 'dist') -Recurse
Copy-Item (Join-Path $src 'package.json') (Join-Path $snap 'package.json')
$distRoot = Join-Path $snap 'dist'
$fingerText = (Get-ChildItem $distRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
  (Get-FileHash $_.FullName -Algorithm SHA256).Hash + '  ' + $_.FullName.Substring($distRoot.Length + 1)
}) -join "`n"
$sha = [System.Security.Cryptography.SHA256]::Create()
$fingerHash = [System.BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerText))).Replace('-', '').Substring(0, 16)
Write-Host "dist 快照指纹: $fingerHash（本次结论只对应这个构建）"

# 基线：未变异的副本必须先全绿，否则后面每一条 RED 都可能是「本来就在红」，整张表没有意义。
Copy-Item (Join-Path $snap 'dist') (Join-Path $work 'dist') -Recurse
# 显式列举测试文件，**不用 glob 参数**：Node 22 在 Windows 上对「带反斜杠的 glob 实参」处理
# 与 Node 24 不同（CI 的 windows+node22 作业里基线就栽在这儿，本地 node24 却过）。
$testFiles = @(Get-ChildItem (Join-Path $work 'tests') -Filter '*.test.mjs' -File | Sort-Object Name | ForEach-Object { $_.FullName })
$base = & node --test @testFiles 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host '基线不绿，变异表无意义 —— 先修测试：'
  $tail = $base | Select-Object -Last 20
  $tail | ForEach-Object { $_ }
  # CI 里把这段塞进 job summary：GitHub 的作业日志要鉴权才下得下来，summary 不用。
  if ($env:GITHUB_STEP_SUMMARY) {
    $lines = @('## 变异表基线不绿（' + $testFiles.Count + ' 个测试文件）', '')
    $lines += ($tail | ForEach-Object { [string]$_ })
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n")
  }
  Remove-Item $work -Recurse -Force
  exit 1
}
Write-Host '基线全绿，开始注入变异。'

$mutations = @(
  @{ name = 'M1a 目录键不折叠（normalizeLogDir 直接返回原串）'; file = 'engine/dir-lease.js'
     pattern = '目录键归一'
     from = "    s = s.replace(/\\/g, '/');`n    const rooted"
     to   = "    s = s.replace(/\\/g, '/');`n    return s;`n    const rooted" },
  @{ name = 'M1b node 入口不做 realpath（原样传 cacheDir）'; file = 'node.js'
     pattern = '符号链接（R9）'
     from = 'syncCacheDir: realCacheDir(cacheDir)'
     to   = 'syncCacheDir: cacheDir' },
  @{ name = 'M2 交还不唤醒等待者（去掉 first()）'; file = 'engine/dir-lease.js'
     pattern = '三路并发'
     from = "    try {`n        first();`n    }"
     to   = "    try {`n        void first;`n    }" },
  @{ name = 'M3 beginWrite 挪到 no-dir 早退之后（配对失衡）'; file = 'engine/switch-file.js'
     pattern = 'begin/end 配对'
     from = "        beginWrite(); // 与 finally 里的 endWrite 严格配对：早退路径也走 finally，不许失衡`n        try {`n            const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null;`n            if (!dir) {`n                notePersistFail('persistSwitch', 'no-dir', '');`n                return;`n            }"
     to   = "        try {`n            const dir = typeof getCacheDir === 'function' ? await getCacheDir() : null;`n            if (!dir) {`n                notePersistFail('persistSwitch', 'no-dir', '');`n                return;`n            }`n            beginWrite();" },
  @{ name = 'M4 开关文件不占常驻持有（键置空）'; file = 'store.js'
     pattern = '开关文件独立占位'
     from = 'const syncSwitchKey = normalizeLogDir(syncSwitchPath);'
     to   = "const syncSwitchKey = '';" },
  @{ name = 'M5 建库失败不回滚已登记持有'; file = 'store.js'
     pattern = '开关文件独立占位'
     from = "    catch (e) {`n        if (ownedDirKey) {"
     to   = "    catch (e) {`n        if (false) {" },
  @{ name = 'M6 冲突态不再拦清空（files 守卫置 false）'; file = 'host/files.js'
     pattern = '冲突态降级'
     from = "        if (dirConflictOf(ctx))`n            return { ok: false, removed: 0 };"
     to   = "        if (false)`n            return { ok: false, removed: 0 };" },
  @{ name = 'M7 冲突态不再拦导出（files 守卫置 false）'; file = 'host/files.js'
     pattern = '冲突态降级'
     from = "if (dirConflictOf(ctx)) {"
     to   = "if (false) {" },
  @{ name = 'M8 封存阈值改成永不触发（超阈值也不封存）'; file = 'engine/pipeline.js'
     tests = 'rotation'; pattern = 'B1 '
     from = 'if (existingBytes > 0 && existingBytes + pendingBytes > config.maxSize) {'
     to   = 'if (false) {' },
  @{ name = 'M9 保留把「今天之外全清」（cutoff 改成今天）'; file = 'core/retention.js'
     tests = 'rotation'; pattern = 'B2 '
     from = 'return todayDay - (maxDays - 1)'
     to   = 'return todayDay' },
  @{ name = 'M10 降级不留自监控行（去掉 log.rotate.degraded）'; file = 'engine/pipeline.js'
     tests = 'rotation'; pattern = 'B1b'
     from = "extra += buildRowText('info', 'log.rotate.degraded', { file: fileName, reason: seal.reason })"
     to   = 'void 0' },
  @{ name = 'M11 满队列时 error 也丢新（不越过配额）'; file = 'engine/pipeline.js'
     tests = 'rotation'; pattern = 'B3'
     from = 'if (queue.length >= config.maxQueue * ERR_QUEUE_CEILING) {'
     to   = 'if (true) {' },
  @{ name = 'M12 封存不记 audit（去掉 rotate.seal 记账）'; file = 'engine/pipeline.js'
     tests = 'rotation'; pattern = 'B1 '
     from = "await appendAudit(logDir, {`n                            ts: Date.now(),`n                            op: 'rotate.seal',"
     to   = "await Promise.resolve({`n                            ts: Date.now(),`n                            op: 'rotate.seal'," },
  # —— 第二轮独立审查（No-Go R1–R12）的回归线：每条必改都要能被咬住 ——
  @{ name = 'M13 R1 记录电话回包恒真（丢行也回 ok:true）'; file = 'engine/pipeline.js'
     pattern = 'R1'; from = 'return { ok: rejected === 0, accepted: accepted, skipped: skipped, rejected: rejected, dropped: getDroppedCount() };'
     to   = 'return { ok: true, accepted: accepted, skipped: skipped, rejected: rejected, dropped: getDroppedCount() };' },
  @{ name = 'M14 R2 冲突闸门不自愈（永远拦到 release）'; file = 'store.js'
     pattern = 'R2/R3'; from = "    function conflictStillLive() {`n        if (!dirConflict)"
     to   = "    function conflictStillLive() {`n        return true;`n        if (!dirConflict)" },
  @{ name = 'M15 R3 丢弃数把自监控行也数上'; file = 'engine/pipeline.js'
     tests = 'isolation'; pattern = '冲突丢批不丢自监控行'
     from = "            if (rows[i].isDiagnostic !== true)`n                n += 1;"
     to   = "            n += 1;" },
  @{ name = 'M16 R5 冲突期攒下的自监控行永不补写'; file = 'engine/pipeline.js'
     pattern = 'R5'; from = 'while (queue.length > 0 || retryBuffer.length > 0 || (deferredDiagnosticRow !== null && !conflictStillLive())) {'
     to   = 'while (queue.length > 0 || retryBuffer.length > 0) {' },
  @{ name = 'M17 R8 开关文件不占常驻持有（写盘期可被后写者覆盖）'; file = 'engine/switch-file.js'
     pattern = 'R8'; from = '            if (!claimSwitchKey(switchKey, failDir))'
     to   = '            if (false)' },
  @{ name = 'M18 R9 node 入口不解析符号链接（junction 当两个目录）'; file = 'node.js'
     pattern = 'R9'; from = 'syncCacheDir: realCacheDir(cacheDir)'
     to   = 'syncCacheDir: cacheDir' },
  @{ name = 'M19 R11 等待预算 200 毫秒改 30 毫秒（预算内重叠被判冲突）'; file = 'engine/dir-lease.js'
     pattern = 'R11'; from = 'const DIR_LEASE_WAIT_MS = 200;'
     to   = 'const DIR_LEASE_WAIT_MS = 30;' },
@{ name = 'M20 flush 循环不再排空重试位与诊断行（队列空 ≠ 全都写完了）'; file = 'engine/pipeline.js'
    tests = 'isolation'; pattern = '冲突期自监控行不丢'
    from = 'while (queue.length > 0 || retryBuffer.length > 0 || (deferredDiagnosticRow !== null && !conflictStillLive())) {'
    to   = 'while (queue.length > 0) {' },
  # —— #24 追踪验收线（tests/trace-24.test.mjs）：child 继承与整链不截断也要能被咬住 ——
  @{ name = 'M21 child 不继承父链（来源降级成 none）'; file = 'client.js'
     tests = 'trace-24'; pattern = 'A2 child 链'
     from = "tsrc = 'inherited';"
     to   = "tsrc = 'none';" },
  @{ name = 'M22 整链查询截断成 100 行（超上限就断链）'; file = 'host/query.js'
     tests = 'trace-24'; pattern = 'A3 整链拉取'
     from = 'const entries = bag.map((r) => ({ ts: r.ts, level: r.level, event: r.event, fields: r.fields }));'
     to   = 'const entries = bag.slice(0, 100).map((r) => ({ ts: r.ts, level: r.level, event: r.event, fields: r.fields }));' },
  # —— 第三轮复核（reviewer 1b6b1bfd）指出的「实现对、网没盖」：补上网，再证明网咬得住 ——
  @{ name = 'M23 解闸（N2）：release() 无条件清 dirConflict'; file = 'store.js'
     pattern = '解闸（N2）'; from = "        const key = ownedDirKey;"
     to   = "        const key = ownedDirKey;`n        dirConflict = '';" },
  @{ name = 'M24 synced 收尾三重防线全拆（队列空即返回，N3）'; file = 'engine/pipeline.js'
     pattern = 'synced() 等待在途写盘（N3）'
     from = 'if (queue.length === 0 && retryBuffer.length === 0 && !diagnosticDue && !flushing && !flushQueued && !pendingPersistFail && flushInFlight === null)'
     to   = 'if (queue.length === 0 && retryBuffer.length === 0)' },
  @{ name = 'M37 synced 不补写攒下的诊断行（复核必改 1）'; file = 'engine/pipeline.js'
     tests = 'isolation'; pattern = '冲突闸门只丢用户行'
     from = 'const diagnosticDue = deferredDiagnosticRow !== null && !conflictStillLive()'
     to   = 'const diagnosticDue = false' },
  @{ name = 'M25 交还不延后（N6）：在途写盘期间就摘常驻持有'; file = 'store.js'
     pattern = 'release()'
     from = "                releasePendingKeys.push(key);`n            if (switchKey)`n                releasePendingKeys.push(switchKey);"
     to   = "                dropPermanentHolder(key, dirToken);`n            if (switchKey)`n                dropPermanentHolder(switchKey, dirToken);" },
  @{ name = 'M26 聚合不按 limit 截断（U2）'; file = 'host/aggregate.js'
     pattern = '聚合截断（U2）'; from = 'entries: entries.slice(0, limit),'
     to   = 'entries: entries.slice(0),' },
  @{ name = 'M27 聚合点名无权不早退 denied（U3）'; file = 'host/aggregate.js'
     pattern = '聚合点名无权（U3）'
     from = 'return { ok: true, entries: [], denied: [wanted], expired: false, nextCursor: null, skipped: 0 };'
     to   = 'return { ok: true, entries: [], denied: [], expired: false, nextCursor: null, skipped: 0 };' },
  @{ name = 'M28 第 6 个电话撞名不报错（U5）'; file = 'host.js'
     pattern = '查询电话撞名（U5）'; from = '    if (registry.has(queryName)) {'
     to   = '    if (false) {' },
  @{ name = 'M29 记录电话回包恒真（U7/R1）'; file = 'engine/pipeline.js'
     pattern = '记录电话回包说实话（R1）'
     from = 'return { ok: rejected === 0, accepted: accepted, skipped: skipped, rejected: rejected, dropped: getDroppedCount() };'
     to   = 'return { ok: true, accepted: accepted, skipped: skipped, rejected: rejected, dropped: getDroppedCount() };' },
  @{ name = 'M30 写失败也响 onDrop（U8）：把不丢的行报成丢了'; file = 'engine/pipeline.js'
     tests = 'host'; pattern = '写失败不丢行'
     from = "                        retryBuffer = batch.concat(retryBuffer);"
     to   = "                        emitOnDrop('write-fail');`n                        retryBuffer = batch.concat(retryBuffer);" },
  @{ name = 'M31 单批超阈值不留 info 自监控（R3）'; file = 'engine/pipeline.js'
     tests = 'rotation'; pattern = '单批自己就超阈值（R3）'
     from = 'else if (existingBytes === 0 && pendingBytes > config.maxSize) {'
     to   = 'else if (false) {' },
  # —— 接缝（客户端 ↔ 宿主真机链路）的咬点：两侧单测都在，接缝只有这一套在管 ——
  # 锚点按 0.3.0 Track 1d 之后的实现重写（客户端现在把回包拆成 ok/rejected，失败进 settleSendFailure）。
  @{ name = 'M32 客户端把宿主拒收当成功（接缝）'; file = 'client/send.js'
     tests = 'e2e-030'; pattern = '接缝四'
     from = '                if (ok && rejected === 0) {'
     to   = '                if (true) {' },
  @{ name = 'M33 客户端拒收不记丢弃（接缝）'; file = 'client/send.js'
     tests = 'e2e-030'; pattern = '接缝四'
     from = '            logDroppedState.count += rc >= 0 ? Math.min(rc, countable) : countable;'
     to   = '            void rc;' },
  @{ name = 'M34 重试位超限静默丢（R2 高水位）'; file = 'engine/pipeline.js'
     tests = 'isolation'; pattern = '写失败高水位'
     from = "                dropped += 1;`n                emitOnDrop('write-fail');"
     to   = "                dropped += 1;" },
  # —— 闸门那一批里的诊断行保护点（#19 复核必改 3）：删掉 defer、或让它取错行，都必须被咬住 ——
  @{ name = 'M35 闸门不保留诊断行（复核必改 3）'; file = 'engine/pipeline.js'
     tests = 'isolation'; pattern = '冲突闸门只丢用户行'
     from = "            deferDiagnosticRows(batch);`n            return 'dropped';"
     to   = "            return 'dropped';" },
  @{ name = 'M36 闸门保留的是批尾（吞用户行，复核必改 3）'; file = 'engine/pipeline.js'
     tests = 'isolation'; pattern = '冲突闸门只丢用户行'
     from = '      if (batch[i].isDiagnostic === true) {'
     to   = '      if (i === batch.length - 1) {' },
  # —— #25 验收线 A5：读侧文件集合退回「只认当日可写文件」，接缝不变式必须变红 ——
  # 锚点在 core/file-name.js（0.3.0 起文件名解析下沉到领域层）：daily 正则去掉可选序号段，
  # 封存件 `YYYY-MM-DD.N.log` 立刻对读侧隐形（正是 D1 那个「磁盘 14 行、查询 5 行」的缺陷）。
  @{ name = 'M38 读侧只认当日可写文件（封存件对读侧不可见，D1 回归）'; file = 'core/file-name.js'
     tests = 'seam-invariant'; pattern = 'D1 回归线'
     from = 'const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;'
     to   = 'const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.log$/;' },
  # —— #26 验收线 A4 的两条咬点（客户端诚实计数与重试位）——
  @{ name = 'M39 客户端拒收按整批计（一行被拒报成整批丢）'; file = 'client/send.js'
     tests = 'client'; pattern = '转发失败先进重试位'
     from = '            logDroppedState.count += rc >= 0 ? Math.min(rc, countable) : countable;'
     to   = '            logDroppedState.count += countable;' },
  @{ name = 'M40 客户端失败批次不回收（传输失败即丢 error）'; file = 'client/send.js'
     tests = 'client'; pattern = '转发失败先进重试位'
     from = '            logRetryState.rows = entries.slice();'
     to   = '            logRetryState.rows = [];' },
  # —— #27 发行面（类型与入口）：每条都要能把「发出去的东西坏掉」钉红 ——
  # 注意：PowerShell 单引号里 `n 不是转义（会变成字面反引号+n），带换行的锚点必须用双引号。
  @{ name = 'M41 exports 去掉 ./node 的 types 条件（消费者又变隐式 any）'; file = 'package.json'; path = 'package.json'
     tests = 'release-surface'; pattern = 'exports 四个子路径'
     from = "    `"./node`": {`n      `"types`": `"./dist/node.d.ts`",`n      `"default`": `"./dist/node.js`"`n    }"
     to   = "    `"./node`": {`n      `"default`": `"./dist/node.js`"`n    }" },
  @{ name = 'M42 去掉根入口（import ''dsh-log'' 变 ERR_PACKAGE_PATH_NOT_EXPORTED）'; file = 'package.json'; path = 'package.json'
     tests = 'release-surface'; pattern = '根入口可用'
     from = "    `".`": {`n      `"types`": `"./dist/index.d.ts`",`n      `"default`": `"./dist/index.js`"`n    },`n"
     to   = '' },
  @{ name = 'M43 根入口偷偷拖进 node: 内建（浏览器侧消费者被拖累）'; file = 'index.js'
     tests = 'release-surface'; pattern = '根入口不把 Node'
     from = '// AUTO-GENERATED by build.mjs — DO NOT EDIT. Source: src/index.ts'
     to   = "import { readFile } from 'node:fs/promises';`nvoid readFile;`n// AUTO-GENERATED by build.mjs — DO NOT EDIT. Source: src/index.ts" },
  @{ name = 'M44 把已删的空转兼容物加回公共面（调用方以为接上了）'; file = 'client.js'
     tests = 'release-surface'; pattern = '空转兼容物'
     from = 'export function debugStorageKey(pluginId) {'
     to   = 'export const buildLogDebugKey = debugStorageKey;`nexport function debugStorageKey(pluginId) {' },
  # M45 说明：只把 exports.types 指向不存在的文件是**无效变异**——TS 会退回同目录的 node.d.ts（实测 GREEN），
  # 所以这条改打声明本身：把 dist/node.d.ts 掏空，消费者的 import 必须报 TS2305。
  @{ name = 'M45 声明被掏空（入口还有 JS，但类型没了）'; file = 'node.d.ts'
     tests = 'consumer-types'; pattern = '四个入口都有类型'
     from = "import type { HostLog } from './host.js';"
     to   = 'export {};' },
  # —— S3 架构门禁（tests/arch.test.mjs）：分层线破了必须当场红 ——
  @{ name = 'M46 core 反向依赖引擎（分层线破）'; path = 'src\core\level.ts'
     tests = 'arch'; pattern = 'core/ 零 IO'
     from = "export const LOG_LEVEL_ORDER = ['error', 'warn', 'info', 'debug'] as const"
     to   = "import { createLogStore } from '../store.js';
void createLogStore;
export const LOG_LEVEL_ORDER = ['error', 'warn', 'info', 'debug'] as const" },
  @{ name = 'M49 引擎面反向依赖客户端面（面与面互相认识）'; path = 'src\engine\io.ts'
     tests = 'arch'; pattern = '三个面互不认识'
     from = 'export interface EngineIoInput {'
     to   = "import { createSendStage } from '../client/send.js';
void createSendStage;
export interface EngineIoInput {" },
  @{ name = 'M47 platform 反向依赖引擎（分层线破）'; path = 'src\platform\ports.ts'
     tests = 'arch'; pattern = 'platform/ 只许 node:'
     from = 'export interface LogTimer {'
     to   = "import { createLogStore } from '../store.js';
void createLogStore;
export interface LogTimer {" }
  @{ name = 'M48 门面丢掉 EVENT_LEVELS 转出口（公开面破）'; file = 'config.js'
     tests = 'release-surface'; pattern = '根入口可用'
     from = ', EVENT_LEVELS, EVENT_KINDS }'
     to   = ', EVENT_KINDS }' }
  @{ name = 'M50 客户端不按 entries.length - accepted 兜底（宿主回 ok:false 却不报 rejected 时静默丢账）'; file = 'client/send.js'
     tests = 'client'; pattern = '按 entries.length - accepted 兜底'
     from = 'if (!ok && rejected === 0) {'
     to   = 'if (false) {' }
  # —— 2026-10-14 独立审查必改 #1/#2/#3：常驻放行认清单声明、ready 说真话、不写内部路标行 ——
  # M52 把「清单里 kind=resident 也算常驻」拆掉，退回只看包内固定 43 条（审查实测的旧行为）。
  @{ name = 'M52 常驻放行不认清单声明（退回只看包内固定 43 条）'; file = 'core/resident.js'
     tests = 'resident-levels'; pattern = '宿主：清单里 kind=resident'
     from = 'for (const name of declaredResidentEvents(manifest))'
     to   = 'for (const name of [])' }
  # M53 客户端接线不回传清单（两端各有一次接线，M52 只管集合本体，这条管客户端那一次）。
  @{ name = 'M53 客户端常驻集合不看清单（接线只传空集）'; file = 'client.js'
     tests = 'resident-levels'; pattern = '客户端：清单声明的 resident'
     from = 'residentEvents: residentEventSet(config.eventList),'
     to   = 'residentEvents: new Set(),' }
  # M54 ready 回执恒真：写盘失败也报 ok:true（审查实测的旧行为：调用方以为落定了）。
  @{ name = 'M54 ready 回执恒真（写盘失败也报 ok:true）'; file = 'node.js'
     tests = 'node'; pattern = 'ready 回执说真话'
     from = 'return { ok: pending === 0, pending: pending, lastPersistFail: lastPersistFail };'
     to   = 'return { ok: true, pending: pending, lastPersistFail: lastPersistFail };' }
  # M55 ready 不刷队列：取属性只回报状态，不把此刻为止的行刷到底。
  @{ name = 'M55 ready 不刷队列（只回报状态）'; file = 'node.js'
     tests = 'node'; pattern = 'ready 回执说真话'
     from = 'await store.synced();'
     to   = 'void store;' }
  # M56 客户端把「被开关挡下」谎报成「已入队」（两端回执同口径的断言必须咬得住）。
  @{ name = 'M56 客户端把 skipped 谎报成 queued'; file = 'client/write.js'
     tests = 'client'; pattern = 'log 回执与宿主同口径'
     from = "return 'skipped';"
     to   = "return 'queued';" }

  # —— 2026-10-15 客户端丢弃计数与宿主同口径：只数用户行，库自己写的诊断行不算 ——
  # M76 诊断行不打标记 → 转发汇总行混进计数（修前行为：1 行用户日志报成「丢 2 行」）。
  @{ name = 'M76 诊断行不打 isDiagnostic 标记（汇总行被算成用户行）'; file = 'client/write.js'
     tests = 'client'; pattern = '诊断行不计入丢弃'
     from = '            isDiagnostic: isDiagnostic === true'
     to   = '            isDiagnostic: false' }
  # M77 计数不排除诊断行 → 退回 entries.length（修前行为）。
  @{ name = 'M77 计数不排除诊断行（退回 entries.length）'; file = 'client/send.js'
     tests = 'client'; pattern = '宿主长坏链条终止'
     from = '            const countable = userRowCount(entries);'
     to   = '            const countable = entries.length;' }
  # M78 接线走错入口 → 库自己的三行没走 logDiagnostic，等于没标记。
  @{ name = 'M78 接线走错入口（诊断行走了普通 log）'; file = 'client.js'
     tests = 'client'; pattern = '诊断行不计入丢弃'
     from = '        logDiagnostic: write.logDiagnostic,'
     to   = '        logDiagnostic: write.log,' }

  # —— 2026-10-15 读侧工具（0.4.0）：渲染丢人话、阈值失效、坏行照印、根目录不认、跟读不跟、无 shebang ——
  # M79 渲染时不取 message → 人话丢了（读侧存在的意义）。
  @{ name = 'M79 渲染丢 message（人话没了）'; file = 'core/read-row.js'
     tests = 'format-row'; pattern = '渲染：本地时间形状固定'
     from = "    const message = typeof fields[messageField] === 'string' ? fields[messageField] : '';"
     to   = "    const message = '';" }
  # M80 --level 阈值失效 → 任何级别都显示（等于没过滤）。
  @{ name = 'M80 --level 阈值失效（不过滤）'; file = 'cli/tail.js'
     tests = 'cli-tail'; pattern = '过滤：--level'
     from = "        if (typeof severity === 'number' && severity > LEVEL_SEVERITY[options.level])"
     to   = "        if (false)" }
  # M81 解析不了的行也照原样印 → 半行、坏行、audit 行全混进人话列表。
  # 注意锚点取在 collectMatches：那里与 outputOf 都有 null 守卫（双保险），只改 outputOf 是**等效变异**
  # （实测 GREEN），必须改「跳过解析失败行」这一处才咬得住。
  @{ name = 'M81 坏行/半行照原样印'; file = 'cli/tail.js'
     tests = 'cli-tail'; pattern = '默认渲染：按写入顺序'
     from = "                const row = parseLogLine(line);`n                if (row === null || !matches(row, options, nowMs))`n                    continue;"
     to   = "                const row = parseLogLine(line);`n                if (row === null) {`n                    out.push(line);`n                    continue;`n                }`n                if (!matches(row, options, nowMs))`n                    continue;" }
  # M82 可执行入口丢掉 shebang → npx dsh-log 装出来不能执行。
  @{ name = 'M82 bin 丢掉 shebang'; file = 'cli.js'
     tests = 'release-surface'; pattern = 'bin 指向真实文件'
     from = "#!/usr/bin/env node"
     to   = "// no-shebang" }
  # M83 只认日志目录、不看根目录下的 logs-*/ → 给父目录就说「没找到」。
  @{ name = 'M83 不认日志根目录（logs-* 不扫）'; file = 'cli/tail.js'
     tests = 'cli-tail'; pattern = '目录发现：给日志根目录'
     from = "        const names = (await listDirNames(path)) ?? [];"
     to   = "        const names = [];" }
  # M84 -f/--follow 被忽略 → 只印一次就退出。
  @{ name = 'M84 -f 跟读被忽略'; file = 'cli/args.js'
     tests = 'cli-tail'; pattern = '-f 跟读'
     from = "        if (arg === '-f' || arg === '--follow') {"
     to   = "        if (false) {" }
  # M87 宿主链上下文：seq 不前进（同一上下文每行都报 0）→ 链内的先后顺序丢失。
  @{ name = 'M87 链上下文 seq 不前进'; file = 'core/trace.js'
     tests = 'host-trace'; pattern = '同上下文三行'
     from = "            if (outcome !== 'skipped')"
     to   = "            if (false)" }

  # M88 宿主链上下文：child() 复用父 spanId → 「每一步一个 span」这条语义消失。
  @{ name = 'M88 child 复用父 spanId'; file = 'core/trace.js'
     tests = 'host-trace'; pattern = 'child()：traceId 不变'
     from = "                spanId: overrides?.spanId ?? genId(8)"
     to   = "                spanId: overrides?.spanId ?? spanId" }

  # M89 宿主链上下文：不搬保留字 → SDK 自己注入的 traceId 直接覆盖调用方传的值（静默丢数据）。
  @{ name = 'M89 上下文不搬保留字（静默覆盖调用方的值）'; file = 'core/trace.js'
     tests = 'host-trace'; pattern = '保留字所有权'
     from = "            if (relocated.shadow) {"
     to   = "            if (false) {" }

  # M90 公共面没挂 trace → store.trace 不是函数（宿主侧链上下文根本拿不到）。
  @{ name = 'M90 公共面没挂 store.trace'; file = 'store.js'
     tests = 'host-trace'; pattern = '同上下文三行'
     from = "        trace: trace,"
     to   = "        trace: undefined," }

  # M91 低层 store.log 被接成上下文路径 → 不经上下文的调用方字段被改写（破坏「原样透传」回归线）。
  @{ name = 'M91 低层 store.log 走上上下文（改写既有行为）'; file = 'store.js'
     tests = 'host-trace'; pattern = '低层不变'
     from = "        log: log,`r`n        trace: trace,"
     to   = "        log: (level, event, fields) => trace().log(level, event, fields),`r`n        trace: trace," }

  # M92 入口不写启动头（目录不自述）→ 第三方拿目录看不到「谁写的、哪一版」（research/18 §2.2 的缺口回来）。
  @{ name = 'M92 入口不写启动头（目录不自述）'; file = 'node.js'
     tests = 'startup-header'; pattern = '入口自动写启动头'
     from = "    await store.writeStartupHeader();"
     to   = "    void store;" }
  # M93 导出摘要的版本回退成恒 unknown → 真记下来的 pluginVersion 被丢掉（对外承诺「摘要说真话」失效）。
  @{ name = 'M93 摘要版本恒 unknown（丢掉真记的 pluginVersion）'; file = 'host/files.js'
     tests = 'startup-header'; pattern = '入口自动写启动头'
     from = "        pluginVersion: (headerInfo && headerInfo.pluginVersion) || 'unknown',"
     to   = "        pluginVersion: 'unknown'," }

  # M94 目录摘要不再点名「哪些格子读不出来」→ 交接文本里 unknown 成了无解释的黑洞。
  @{ name = 'M94 摘要不点名读不出来的格子'; file = 'core/log-digest.js'
     tests = 'cli-export'; pattern = '环境缺失一律 unknown'
     from = "            unknown.push('header');"
     to   = "            if (false) unknown.push('header');" }
  # M95 export 静默忽略筛选选项 → 使用者以为筛过了，实际交出去的是整个目录（比报错更坏）。
  @{ name = 'M95 export 静默忽略筛选选项'; file = 'cli/args.js'
     tests = 'cli-export'; pattern = '筛选选项对 export 当场报错'
     from = "    if (options.command === 'export') {"
     to   = "    if (false) {" }
  # M96 export 不做「半行切分」而直接按 \n 切 → 交出去的东西里留半截 JSON（永远解析不了）。
  # （历史：原锚点想改 `if (line.trim() !== '')`，实测那条分支对半行本来就不承重——
  #  半行是被 splitLogLines 归到 partial 里的，所以改成动切行这一步才是承重的。）
  @{ name = 'M96 export 吐出半行（交出去的东西里留半截 JSON）'; file = 'cli/export.js'
     tests = 'cli-export'; pattern = '只读：跑完 export'
     from = "        const { lines } = splitLogLines(text);"
     to   = "        const lines = text.split('\n');" }

  # ---- 0.3.4：独立审查（review-033）咬出的六处诚实性/口径问题（每条都对着一条回归线） ----
  # M97 读不出来的文件被写成「0 字节空文件」→ 收日志的人以为没事（列目录时还在、读时没了）。
  @{ name = 'M97 读不出来的文件冒充空文件（丢掉 unreadable 标记）'; file = 'core/log-digest.js'
     tests = 'cli-export'; pattern = '读不出来的文件不许冒充空文件'
     from = "            files.push({ name: name, bytes: 0, rows: 0, bad: 0, unreadable: true });"
     to   = "            files.push({ name: name, bytes: 0, rows: 0, bad: 0 });" }
  # M98 启动头取第一条 → 多实例写过的目录会自述成「最早那次启动」（现状最贴近的应是最后一条）。
  @{ name = 'M98 启动头取第一条（多实例写过的目录应取最后一条）'; file = 'core/log-digest.js'
     tests = 'cli-export'; pattern = '启动头取'
     from = "            if (row.event === 'host.start')"
     to   = "            if (row.event === 'host.start' && header === null)" }
  # M99 缺的格子不点名 → 文本写 pid=0/unknown，机器读 unknown 却以为「dir 记下来了」。
  @{ name = 'M99 缺的格子不点名（pid=0 冒充真 pid）'; file = 'core/log-digest.js'
     tests = 'cli-export'; pattern = 'unknown 逐个点名'
     from = "            if (header.pid === 0)"
     to   = "            if (false)" }
  # M100 宿主侧把「只带 _shadow」也算成保留字冲突 → 冲突计数变成「用过 _shadow 的次数」。
  @{ name = 'M100 宿主侧影子计数把「只带 _shadow」也算成冲突'; file = 'core/trace.js'
     tests = 'host-trace'; pattern = '影子计数只数'
     from = "            if (relocated.reservedMoved)"
     to   = "            if (relocated.shadow)" }
  # M101 客户端同样把「只带 _shadow」算成冲突，还多写一行影子告警（那句话在此时是假的）。
  @{ name = 'M101 客户端影子计数把「只带 _shadow」也算成冲突（连影子行一起写）'; file = 'client/write.js'
     tests = 'runtime-t7'; pattern = '只带 _shadow'
     from = "        if (shadow && relocated.reservedMoved) {"
     to   = "        if (shadow) {" }
  # M102 启动头不幂等 → Node 入口使用者照文档再手调一次就多写一行自述。
  @{ name = 'M102 启动头不幂等（手调一次多写一行自述）'; file = 'store.js'
     tests = 'startup-header'; pattern = '再手调一次不会写出第二行'
     from = "            if (headerInfo !== null)"
     to   = "            if (false)" }
  # M103 Node 入口不给 getPlatform → 它写出的每个目录 os 恒 unknown（写者自己的平台本是可知事实）。
  @{ name = 'M103 Node 入口不给 getPlatform（目录自述的 os 恒 unknown）'; file = 'node.js'
     tests = 'startup-header'; pattern = '带 os（写者自己的'
     from = "DEFAULT_CWD: cacheDir, getPlatform: () => ({ os: process.platform }) }"
     to   = "DEFAULT_CWD: cacheDir }" }
  # M85 对齐时把 ANSI 转义也算进宽度 → 上色后整个人话列位推歪。
  @{ name = 'M85 对齐把 ANSI 算进宽度'; file = 'core/read-row.js'
     tests = 'format-row'; pattern = '渲染：默认不上色'
     from = "    const padCount = Math.max(0, eventWidth - event.length);"
     to   = "    const padCount = Math.max(0, eventWidth - (colored.length + event.length));" }
  # M86 子命令 tail 被当成目录名（2026-10-15 用户实测的 0.3.1 缺陷）：
  # 帮助写着 dsh-log tail <目录...>，实现却不认这个子命令 → 每次带子命令调用都白吐一行
  # 「没找到日志目录：tail」（退出码仍是 0、日志照常输出，所以只有肉眼看得见）。
  # 0.3.3 起同一处判定也认 export，锚点跟着改成两子命令的形状。
  @{ name = 'M86 不认 tail 子命令（当成目录名）'; file = 'cli/args.js'
     tests = 'cli-tail'; pattern = '子命令 tail 真被认'
     from = "        if ((arg === 'tail' || arg === 'export') && !subcommandSeen && options.paths.length === 0) {"
     to   = "        if (false) {" }

  # M57 封存照单全收：rename 调完就当搬走了，不回查目录（2026-10-14 soak 实测的旧行为：
  # 假适配器下整篇被覆写、20k 行静默丢 12500 行、dropped 仍是 0）。
  @{ name = 'M57 封存不回查目录（rename 说成功就当真）'; file = 'engine/rotation.js'
     tests = 'rotation'; pattern = 'rename 说成功却没搬走'
     from = "        if (after !== null && after.indexOf(sealedName) >= 0) {"
     to   = "        if (true) {" }

  # M58 封存前不先确认「列得出目录」：rename 照做（2026-10-14 独立审查 N1 实测的旧行为：
  # 有 rename 没 listDir 时文件被真搬走、回查失败报「没封成」→ 旧文被整篇重写，一行变两份）。
  @{ name = 'M58 封存前不先确认列得出目录（一行变两份）'; file = 'engine/rotation.js'
     tests = 'rotation'; pattern = '有 rename 但没 listDir'
     from = "        if (names === null)`n            return { ok: false, reason: 'no-listdir' };"
     to   = "        if (false)`n            return { ok: false, reason: 'no-listdir' };" }

  # M59 搬到别的名字不算搬走：目录里多出新文件也不清 existing（旧文被重写一遍 → 一行两份）。
  @{ name = 'M59 搬到别的名字不算搬走（旧文重写一遍）'; file = 'engine/rotation.js'
     tests = 'rotation'; pattern = '搬到了别的名字'
     from = "            if (appeared.length > 0 && !srcStillThere) {"
     to   = "            if (false) {" }

  # M60 只看「多了个新文件」不判源文件还在不在：复制不删源的适配器被误判成「已搬走」→ 整篇覆写
  # （2026-10-14 第二轮复核实测的旧行为：丢 10/40 行、dropped 仍是 0）。
  @{ name = 'M60 复制不删源被当成搬走（整篇覆写）'; file = 'engine/rotation.js'
     tests = 'rotation'; pattern = '复制到异名但没删源'
     from = "            if (appeared.length > 0 && !srcStillThere) {"
     to   = "            if (appeared.length > 0) {" }
  # M61 跨进程检测失效：别的写者动过文件也不再留 foreign-write 诊断（2026-10-14 四维审查必改 4 的回归线）。
  @{ name = 'M61 跨进程检测失效（foreign-write 不落诊断）'; file = 'engine/pipeline.js'
     tests = 'runtime-t7'; pattern = '文件被外部追加过'
     from = "if (readOk && fileName === expectedFileName && expectedFileBytes >= 0 && existingBytes !== expectedFileBytes) {"
     to   = "if (false) {" }
  # M62 追加能力被无视：明明有 appendText 也退回整篇覆写（追加路回归线必须咬住）。
  # 锚点跟着实现走：2026-10-14 对抗审查给「是否用追加」加了「有没有被判死」这一项。
  @{ name = 'M62 追加能力被无视（退回整篇覆写）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '追加路真被用上'
     from = "const appendable = !appendUnusable && (await canAppend());"
     to   = "const appendable = false;" }
  # M63 追加后不累加已有尺寸：自己记的尺寸偏小 → 永远到不了封存阈值（轮转在追加路下失效）。
  # 咬点是 ⑤（多批**小**追加），不是 ③ —— ③ 一批就超阈值，尺寸记不累加也照样封存（曾把 pattern
  # 指向 ③，表里报 GREEN，靠 `-Only M63` 打印原始输出才看清是「指错了用例」而不是「断言没咬住」）。
  @{ name = 'M63 追加后不累加已有尺寸（追加路下永不封存）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '尺寸是累加的'
     from = "const expectedAfter = beforeBytes + appendedBytes;"
     to   = "const expectedAfter = appendedBytes;" }
  # M64 封存前不确认真实长度：外来写者动过文件也不再留 foreign-write（追加路绕掉跨进程判定）。
  @{ name = 'M64 封存前不确认长度（追加路绕掉跨进程判定）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '封存之前会读一次确认'
     from = "if (appendable && !readOk && existingBytes > 0 && existingBytes + pendingBytes > config.maxSize) {"
     to   = "if (false) {" }
  # M65-M67 追加能力的「首次信任」检查（2026-10-14 对抗审查补：适配器可能声明了 appendText 却什么都不做，
  # 历史上假 rename 就这样吞掉过 12500 行）。
  # M65 不比对「观察到的长度」与「应有长度」→ 撒谎适配器的那批行静默消失。
  @{ name = 'M65 不验证追加是否落地（撒谎的 appendText 静默吃行）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '撒谎的 appendText'
     from = "if (observedBytes >= baselineBytes + unverifiedTotalBytes) {"
     to   = "if (observedBytes !== null) {" }
  # M66 判定无效却不退回读改写 → 那批行就此不见（兜底标志置假）。
  @{ name = 'M66 判定追加无效却不退回读改写（那批行不见）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '撒谎的 appendText'
     from = "needWriteFallback = true;"
     to   = "needWriteFallback = false;" }
  # M67 判死之后仍继续用追加（坏适配器每批都白试一遍）→ ⑥ 的「此后不再依赖追加」断言必须咬住。
  # 历史：这条原先是「算 appendable 时无视 appendUnusable」，实测在该用例下会让用例挂死（180 秒超时），
  # 换成「永远不把能力判死」等价且能快速失败。
  @{ name = 'M67 判死追加能力后仍继续追加（白试一遍）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '撒谎的 appendText'
     from = "appendUnusable = true;"
     to   = "appendUnusable = false;" }
  # M68 大块一次性追加（不按行边界切块）→ 两个进程各写大行时会互相插进去，落成半行 JSON
  # （实测 20×64KB 两进程 → 2 条坏行）。
  @{ name = 'M68 大块一次性追加（不切块，半行风险回来）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '按行边界切块追加'
     from = "for (const piece of splitForAppend(pending))"
     to   = "for (const piece of [pending])" }
  # M72 追加路只在首触核对一次（不再按次数/字节周期性核对）→ 适配器「第一次写对、之后不写」时行静默消失
  # （对抗审查 #1：noop-after-first 实测 60 行只落 5 行、dropped=0、lastPersistFail=null）。
  @{ name = 'M72 追加核对只在首触做一次（后程撒谎静默吃行）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '第一次写对、之后不写'
     from = "if (await canSize()) {"
     to   = "if (await canSize() && appendVerifiedFileName !== fileName) {" }
  # M73 追加失败后的兜底不再按行重建（退回 current + 整批）→ 截断型适配器留下的空洞变成重复行 + 粘连半行
  # （对抗审查 #2：half 实测 20 行落成 31 行、其中 1 条永远解析不了的粘连行）。
  @{ name = 'M73 兜底不按行重建（重复行 + 粘连半行回来）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '只写一半'
     from = "if (appendable && fallbackCarry !== '') {"
     to   = "if (false) {" }
  # M74 没有 stat 能力时不攒「待核对文本」（只记一个记账数字）→ 核对窗口内那几批的行找不回来，永久丢失。
  @{ name = 'M74 待核对文本不攒（核对窗口内的行丢了找不回）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '没有 stat 能力'
     from = "unverifiedAppends = unverifiedText;"
     to   = "unverifiedAppends = '';" }
  # M75 按行重建时不剔掉「已经落过的本批行」→ 同一批行会被写两遍（重复行）。
  @{ name = 'M75 按行重建不剔已落行（重复行）'; file = 'engine/pipeline.js'
     tests = 'append-write'; pattern = '只写一半'
     from = "if (line === '' || wantedSet.has(line))"
     to   = "if (line === '')" }
)

$rows = @()
foreach ($m in $mutations) {
  if ($Only -and $m.name -notlike ('*' + $Only + '*')) { continue }
  Remove-Item (Join-Path $work 'dist') -Recurse -Force -ErrorAction SilentlyContinue
  # 从冻结快照复位（不是活仓库）：保证整张表跑在同一个构建上。
  Copy-Item (Join-Path $snap 'dist') (Join-Path $work 'dist') -Recurse
  # package.json 也在变异面内（#27 的 exports/files），每轮复位，避免上一条的变异残留。
  Copy-Item (Join-Path $snap 'package.json') (Join-Path $work 'package.json') -Force
  $rel = if ($m.path) { $m.path } else { 'dist\' + $m.file }
  $f = Join-Path $work $rel
  $text = [System.IO.File]::ReadAllText($f)
  $from = $m.from -replace "`r`n", "`n"
  $to = $m.to -replace "`r`n", "`n"
  $norm = $text -replace "`r`n", "`n"
  if (-not $norm.Contains($from)) { $rows += [pscustomobject]@{ 变异 = $m.name; 结果 = 'SKIP（锚点没找到）' }; continue }
  $norm = $norm.Replace($from, $to)
  [System.IO.File]::WriteAllText($f, $norm)
  # 模式按**字面**用：--test-name-pattern 收的是正则，用例名里的 () 会被当空分组，
  # 于是「synced() 等待在途写盘（N3）」这类名字永远匹配不上 —— 而 node 匹配不到时仍退 0，
  # 会把「根本没跑」误报成 GREEN（这张表踩过一次）。
  $pat = [regex]::Escape($m.pattern)
  $testPath = Join-Path $work ('tests\' + $(if ($m.tests) { $m.tests } else { 'isolation' }) + '.test.mjs')
  # 用 .NET 的 Process + ArgumentList 直接起进程：一是避免 shell 再解释一遍正则模式，
  # 二是**必须能超时**——变异可能让被测代码死循环（2026-10-14 实测：某条变异把用例挂死，
  # 整张表 13 分钟没动静，CI 上就会一直挂到作业上限）。超时时长 180 秒，按「不可信」处理。
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = (Get-Command node).Source
  $psi.UseShellExecute = $false
  # 工作目录必须钉在临时副本上：不设的话 cwd 还是活仓库，凡是靠 process.cwd() 定位 dist 的测试
  # 都会读到**没被变异**的那份，把注入的缺陷漏成 GREEN（2026-10-15 实测 M79–M85 六条假绿）。
  $psi.WorkingDirectory = $work
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($argItem in @('--test', '--test-reporter=spec', ("--test-name-pattern=" + $pat), $testPath)) { $psi.ArgumentList.Add($argItem) }
  $proc = [System.Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $exited = $proc.WaitForExit(180000)
  if (-not $exited) {
    try { $proc.Kill($true) } catch { }
    $rows += [pscustomobject]@{ 变异 = $m.name; 结果 = 'TIMEOUT（用例挂死，不可信）' }
    continue
  }
  $out = @($outTask.Result -split "`r?`n") + @($errTask.Result -split "`r?`n")
  $code = $proc.ExitCode
  # 真跑过用例才会有缩进的结果行（  ✔ /  ✖）；一条都没有就是没匹配到，不能算「咬住」。
  $ranAny = ($out | Select-String -Pattern '^\s+[✔✖]' ) -ne $null
  $verdict = $(if (-not $ranAny) { 'SKIP（模式没匹配到用例）' } elseif ($code -eq 0) { 'GREEN（断言没咬住！）' } else { 'RED（符合预期）' })
  # 非 RED 时把原始输出打出来：SKIP/GREEN 都要能当场看出「是没跑、还是真没咬住」。
  # （M63 出过「手工单跑红、表里报 GREEN」的疑点，靠这段原始输出定位。）
  if ($verdict -notlike 'RED*') {
    Write-Host ''
    Write-Host ("--- 非 RED 详情：" + $m.name + "（" + $verdict + "）")
    $out | Select-Object -Last 25 | ForEach-Object { Write-Host ('    ' + $_) }
  }
  $rows += [pscustomobject]@{ 变异 = $m.name; 结果 = $verdict }
}
$rows | Format-Table -AutoSize
Remove-Item $work -Recurse -Force
# 闸门（2026-10-14 为 CI 加）：只要有一条不是 RED（SKIP 或 GREEN），整表不算通过。
# 理由：SKIP = 锚点没匹配到（变异根本没注入），GREEN = 断言没咬住（防线是摆设）——
# 两种都意味着「这条回归线不可信」，不能让 CI 绿着过去。
$notRed = $rows | Where-Object { $_.结果 -notlike 'RED*' }
if ($notRed) {
  Write-Host ''
  Write-Host ('变异表未通过：' + $notRed.Count + ' 条不是 RED')
  $notRed | Format-Table -AutoSize
  # CI 可见性：作业日志要鉴权，job summary 不用——把非 RED 的名字与原始输出留在 summary 里。
  if ($env:GITHUB_STEP_SUMMARY) {
    $lines = @('## 变异表未通过：' + $notRed.Count + ' 条不是 RED', '')
    $lines += ($notRed | ForEach-Object { '- `' + $_.变异 + '` → ' + $_.结果 })
    $lines += @('', '详情见作业日志的「非 RED 详情」段。')
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ($lines -join "`n")
  }
  exit 1
}
Write-Host ('变异表通过：' + $rows.Count + ' 条全部 RED')
