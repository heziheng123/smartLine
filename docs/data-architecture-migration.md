# SmartLine 数据架构迁移与恢复

## 1. 当前目标

当前推荐架构使用 GitHub OAuth 确认用户身份，Cloudflare Pages Function 使用 Liveblocks Secret Key 为指定房间签发令牌。Timeline、Life Map、EBB、Daily 和 Graph 五个数据域共享一个 `workspace-{用户}-{工作区}` 房间。浏览器以 IndexedDB 为主存储，localStorage 只保存设置、租约、revision 和紧急写入日志。

完整工作区 schema 当前为 `6`。版本 1–5 会在加载时归一化为版本 6。版本 5 引入固定项目大类偏好和 `LifeArea.planGroupId`；版本 6 允许全局关键日期，并增加项目到结果目标、关键日期到项目的可选关系。

## 2. 迁移前检查

1. 在“云同步与完整备份”导出完整 JSON，至少保存两份到不同位置。
2. 确认五个 store 都完成加载，备份摘要无 issue。
3. 保持旧 Public Key 和旧五房间可访问。
4. 停止其他设备编辑，等待离线队列清空。
5. 记录项目、分组、人生地图条目、复习轮次、每日安排天数、复盘和知识节点数量。
6. 在 Liveblocks 控制台确认源房间存在，不要删除或重命名。

## 3. 旧架构房间

给定旧 room code，应用会读取：

```text
{roomCode}             Timeline
ebb-{roomCode}         EBB
daily-{roomCode}       Daily + retrospectives
graph-{roomCode}       Knowledge Graph
life-map-{roomCode}    Independent Life Map
```

旧房间不带 owner 前缀，是迁移期兼容例外。统一工作区完成后应结束该授权路径。

## 4. 安全迁移流程

1. 点击“检查旧数据”，等待五个房间全部返回。
2. 核对迁移前摘要，任何房间超时或 schema 异常都停止迁移。
3. 点击“迁移到统一工作区”。程序先创建本地快照。
4. 程序读取旧房间并组装完整 `WorkspaceBackup`。
5. 对源数据计算规范化 JSON 的 SHA-256。
6. 将数据复制到目标统一房间。
7. 重新读取目标房间，比较摘要和 SHA-256。
8. 只有 `verified = true` 时才写入统一架构设置并连接目标房间。
9. 下载并保留迁移报告，与迁移前备份放在一起。

迁移是复制操作，不修改或删除旧房间。

## 5. 首次统一工作区连接规则

连接前会比较本机与云端：

| 本地 | 云端 | 行为 |
| --- | --- | --- |
| 非空 | 不存在/空 | 以本地初始化新工作区 |
| 空 | 非空 | 使用云端数据 |
| hash 相同 | hash 相同 | 直接连接 |
| 非空且不同 | 非空且不同 | 拒绝连接，要求人工处理 |

不得通过清空浏览器存储绕过最后一种冲突。应先导出双方数据，再决定保留或合并方向。

## 6. 观察期

统一房间切换后至少观察 30 天：

- 刷新后数据完整；
- 断网编辑后能恢复；
- 两台设备和多标签页修改不会丢字段；
- Daily 完成状态与项目任务一致；
- EBB 轮次和知识绑定一致；
- Life Map 维护期、打卡和布局保存；
- 离线队列最终清空，无未处理冲突副本；
- Liveblocks 后台主要连接只出现在统一房间。

观察期内保留旧房间、Public Key 和迁移前备份。

## 7. 停用旧同步

满足以下条件后才执行：

- 迁移报告 `verified` 为 `true`；
- 观察期验证全部通过；
- 至少一次完整备份恢复演练成功；
- 所有常用设备已升级到支持统一 schema 的版本。

先在 Production 设置：

```env
VITE_LIVEBLOCKS_AUTH_ENDPOINT=/api/liveblocks-auth
VITE_DISABLE_PUBLIC_KEY_FALLBACK=true
```

验证登录和令牌端点后，再删除 `VITE_LIVEBLOCKS_PUBLIC_KEY` 或轮换旧 Public Key。旧房间可继续只读保留一段时间。

## 8. 本地快照与完整备份

完整备份包含 Timeline、独立 Life Map、EBB、Graph、Daily、Retrospective 和部分设置。导入前进行严格结构、ID、日期、时间和引用校验，并先创建快照。

本地快照采用分段存储：header、timeline、lifeMap、ebb、graph、daily、settings。浏览器支持时使用 gzip；相同块复用以减少空间。快照仍位于当前浏览器，不替代外部 JSON 备份。

## 9. 冲突与恢复

统一同步保存每个待写字段的 base 值。远端也变化时执行 base/local/remote 三方合并：实体数组按 ID，普通对象按属性递归合并；无法安全判断的路径记录为冲突。

发生异常时：

1. 停止继续编辑；
2. 导出当前完整备份；
3. 查看离线队列与冲突副本；
4. 恢复冲突副本前先创建快照；
5. 恢复后核对摘要和关键业务记录；
6. 确认无误再刷新云端。

如果统一迁移失败，可暂时切回旧房间。切回只改变连接架构，不应删除统一房间或本地数据。

## 10. schema 升级与降级

远端 `metadata.schemaVersion` 高于客户端支持版本时，客户端拒绝连接，防止旧代码覆盖新字段。正确做法是升级客户端，不是删除 metadata。

schema 4 升级到 schema 5 时，归一化会补齐“学习 / 工作 / 生活”三条大类偏好：学习默认位于时间轴上方，工作和生活默认位于下方；学习成长映射到学习、职业发展映射到工作，其余领域回退到生活。旧项目的 `placement` 字段保留，但不再控制新泳道。

schema 5 升级到 schema 6 时不复制或删除实体：缺少 `areaId` 的关键日期保留为全局内容；无效关键日期领域降级为全局；无效 `relatedPlanId` 只清除关键日期关系。历史 `outcomeGoalId` 不再参与界面逻辑，但会与 `kind: 'goal'` 数据一起原样保留在同步和备份中。已删除的默认二级分类使用 tombstone 保留，恢复后不得自动补回。迁移不会改写任何项目、子阶段、长期系统、人生时期或关键日期的日期。

`lifeMapPlanGroups` 已进入实体级同步、离线写入日志、三方合并、完整备份和快照。迁移验收时应额外核对三个大类均存在、领域映射合法，并在两台设备上验证整组换边可以持久化。

需要回滚应用版本时，先确认旧版本支持当前 schema；否则只保留静态部署回滚点，不要让旧版本写入生产房间。

## 11. R2 归档

Production 与 Preview 使用不同 bucket，并以 `SMARTLINE_R2` 绑定。R2 归档按 GitHub 用户 ID 和月份隔离，使用 ETag 条件写防止多设备覆盖。

R2 仅是历史归档层：未绑定时返回 503，不影响本地、Liveblocks、完整备份和快照。归档最大 10 MiB，月份必须为 `YYYY-MM`。

## 12. 迁移验收清单

- [ ] 两份迁移前完整备份已离开浏览器保存
- [ ] 五个旧房间都读取成功
- [ ] 迁移前后摘要一致
- [ ] SHA-256 一致且报告 verified
- [ ] 刷新、离线、双设备、多标签页通过
- [ ] 项目、人生地图、EBB、Daily、复盘、Graph 数量一致
- [ ] 完成/取消和跨视图联动通过
- [ ] 本地快照恢复演练通过
- [ ] 30 天观察期完成
- [ ] 认证端点稳定后停用 Public Key fallback
- [ ] Preview 与 Production secrets/bucket 完全隔离
