# 事件快照变更记录（#18 Q6 增量门）

> 增量门只认这一节：事件总数与 `tests/event-snapshots/_baseline.json` 之差绝对值超 5 时，
> 必须在这里写明增删原因，否则 `tests/snapshot.test.mjs` 判红。红的是“无 changelog”不是字段本身：
> 补上说明后跑 `node tests/update-snapshots.mjs` 更新基线即转绿。

## 2026-10-11 基线（total=4）

- 初始基线：从 `tests/eventList.test.mjs` 的 `makeSample` 事件生成 4 个快照
 （`snapshot.built`、`gh.exec`、`chain.cache.miss`、`log.persist.fail`）。
- 口径：未知事件名 + envelope 非法 = 红（error）；其余未知字段 = 黄（warn）。
