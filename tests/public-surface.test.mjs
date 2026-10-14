// tests/public-surface.test.mjs —— 公开面快照（S7 前置）：四个入口的导出名集合逐字钉死。
//
// 为什么先立这条：源码结构重构（拆 core/engine/host/client/entries）期间，唯一绝不允许变的就是
// **对外导出名**。内部怎么搬都行，公共面变一个名字就是破坏性变更（0.3.0 已声明不兼容 0.2.x，
// 但 0.3.0 内部各步之间不许再动公共面）。有了这张快照，搬代码时漏掉一个 re-export 会立刻红。
//
// 更新方式：确属有意的公共面变更 → 改本文件名单 + 同步 README/INTEGRATION/迁移说明 + 在票面记一笔。
// 只是重构搬文件 → 一个字都不该改，红了就是漏了 re-export。
import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const SURFACE = {
  'dsh-log': [
    'CLIENT_BATCH_INTERVAL_MS',
    'CLIENT_BATCH_MAX',
    'CLIENT_PACKET_BYTES',
    'CLIENT_QUEUE_MAX',
    'DEFAULT_MAX_DAYS',
    'DEFAULT_MAX_QUEUE',
    'DEFAULT_MAX_SIZE',
    'EVENT_KINDS',
    'EVENT_LEVELS',
    'LEGACY_LOG_DIR_NAME',
    'LEGACY_SWITCH_FILE_NAME',
    'LOG_DEBOUNCE_MS',
    'LOG_FORMAT_VERSION',
    'LOG_QUERY_ACTION_SUFFIX',
    'PHONE_ACTIONS',
    'assertPluginId',
    'buildLogQueryPhoneName',
    'buildPhoneName',
    'buildPhoneNames',
    'checkEventFields',
    'computeEventCounts',
    'formatDailyFileName',
    'formatFourSegmentFileName',
    'formatRow',
    'formatRows',
    'lintEventFields',
    'listLogFiles',
    'logFilesOfDate',
    'matchExportFileName',
    'parseEventListManifest',
    'parseLogFileName',
    'parseLogLine',
    'resolveClientLogConfig',
    'resolveHostLogConfig',
    'resolveLogFileName'
  ],
  'dsh-log/host': [
    'HOST_LOG_PHONE_ACTIONS',
    'LOG_DEBOUNCE_MS',
    'LOG_DIR_NAME',
    'LOG_FORMAT_VERSION',
    'LOG_QUERY_ACTION_SUFFIX',
    'LOG_SWITCH_FILE',
    'aggregateLogQuery',
    'buildLogQueryPhoneName',
    'buildPhoneName',
    'buildPhoneNames',
    'checkEventFields',
    'computeEventCounts',
    'createHostLog',
    'createLogStore',
    'formatDailyFileName',
    'formatLogFileName',
    'lintEventFields',
    'listLogFiles',
    'logFilesOfDate',
    'parseEventListManifest',
    'parseLogFileName',
    'registerHostLogPhones',
    'resolveHostLogConfig'
  ],
  'dsh-log/client': [
    'CLIENT_BATCH',
    'LOG_BATCH_MAX',
    'LOG_DEBUG_KEY',
    'LOG_FLUSH_MS',
    'LOG_LEVELS',
    'LOG_PACKET_BYTES',
    'LOG_QUERY_ACTION_SUFFIX',
    'LOG_QUEUE_MAX',
    'LOG_REV',
    'LOG_WATCHDOG_MS',
    'buildClientPhoneNames',
    'buildLogQueryPhoneName',
    'buildPhoneName',
    'buildPhoneNames',
    'createClientLog',
    'debugStorageKey',
    'resolveClientLogConfig'
  ],
  'dsh-log/node': ['createNodeFileService', 'createNodeHostLog', 'createNodeTimer', 'createQuickLog']
}

describe('公开面快照（四个入口的导出名集合）', () => {
  for (const [entry, names] of Object.entries(SURFACE)) {
    it(entry + '：' + names.length + ' 个运行时导出，名字一个不多一个不少', async () => {
      const mod = await import(entry)
      const actual = Object.keys(mod).sort()
      assert.deepEqual(
        actual,
        [...names].sort(),
        entry +
          ' 的公共面变了。若只是重构搬文件，说明漏了 re-export（要补回去）；' +
          '若是有意的公共面变更，改本文件的名单并同步 README/INTEGRATION。\n多出来：' +
          actual.filter((n) => !names.includes(n)).join(', ') +
          '\n少了：' +
          names.filter((n) => !actual.includes(n)).join(', ')
      )
    })
  }

  it('四个入口之间没有意外的同名不同体：共享名取自同一处（同一函数引用）', async () => {
    const root = await import('dsh-log')
    const host = await import('dsh-log/host')
    const client = await import('dsh-log/client')
    const shared = ['LOG_FORMAT_VERSION', 'LOG_QUERY_ACTION_SUFFIX', 'buildLogQueryPhoneName', 'parseLogFileName', 'lintEventFields']
    for (const name of shared) {
      if (name in root && name in host) {
        assert.equal(root[name], host[name], name + ' 在根入口与宿主入口必须是同一个引用（同源转出口，不许各自实现）')
      }
    }
    assert.equal(client.buildPhoneNames, host.buildPhoneNames, 'buildPhoneNames 必须是同一引用')
  })
})
