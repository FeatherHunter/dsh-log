// 被 tests/durability-23.test.mjs 拉起：写若干行 error 后按模式自毁。
// 用法：node kill-child.mjs <cacheDir> <mode> <count>
//   mode=synced  —— 写完后 await synced()，落一个 marker 文件证明「synced 已返回」，然后硬杀自己（SIGKILL）
//   mode=instant —— 写完立刻硬杀自己（不 await synced，允许丢行，但不许落半行）
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHostLog } from '../../dist/node.js'

const cacheDir = process.argv[2]
const mode = process.argv[3]
const count = Number(process.argv[4] || 20)

const hostLog = await createNodeHostLog({ cacheDir }, { pluginId: 'kill', prefix: 'kill' })
const store = hostLog.store
for (let i = 0; i < count; i++) store.log('error', 'kill.row', { i, payload: 'x'.repeat(64) })

if (mode === 'synced') {
  await store.synced()
  writeFileSync(join(cacheDir, 'synced.marker'), 'ok')
}
process.kill(process.pid, 'SIGKILL')
