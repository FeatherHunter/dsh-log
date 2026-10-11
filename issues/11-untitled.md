<!-- DSH-IDEMPOTENCY-KEY: deck-mdcap-980-verify-20261009 -->
# 【临测】测试床隔离验证试票


<!-- DSH-IDEMPOTENCY-KEY: deck-mdcap-980-verify-20261009 -->
# 【临测】测试床隔离验证试票

## Question

验证980隔离规则可行：新建是否落进 .scratch/issues/ 与旧 issues/01-10 物理隔离。

## 进度

验证结论（2026-10-09 测试床会话实测）：新建落在旧 issues/11-untitled.md（398字节），未建 .scratch，物理隔离不成立；读回OK，列票可数（open含11共10行），快照01仍0/0；幂等复用OK（同锚重建仍回11，无12）；01-10长度建前后一致，待关后复核。

## Comments

## Answer

Status: resolved
Type: task
Blocked by:
Labels: wayfinder:task

## Comments


## Answer

