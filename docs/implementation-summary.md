# SmartLine 渐进式改进方案 - 实施总结

已完成对当前同步架构的全面分析，并制定了详细的渐进式改进方案。

## 核心发现

### 当前架构的实际问题

1. **数组覆盖问题确实存在**
   - 五个 Store 使用 `storageMapping: { tasks: true, groups: true, ... }` 
   - 整个数组作为单一字段同步，设备 A 修改 `tasks[0]`，设备 B 修改 `tasks[5]`，后者会覆盖前者
   - `setState` 调用仅 6 处（实际通过 `createWorkspaceTrackedSet` 包装），但所有写入最终都经过数组替换

2. **三路合并复杂度高**
   - `workspaceSyncCore.ts` 的 `mergeWorkspaceValue` 实现完整递归合并
   - 按实体 ID 合并数组、递归处理嵌套对象、检测所有冲突路径
   - ~150 行核心逻辑 + 辅助函数，难以验证所有边界情况

3. **统一房间部分完成**
   - Schema v7 已实现，`buildUnifiedRoomId` 正常工作
   - 迁移逻辑存在但文档仍标注 v6
   - 需要确认所有设备实际使用状态

4. **跨标签页同步有降级风险**
   - Web Locks API 作为主路径
   - localStorage 降级无真正互斥，旧浏览器可能并发写入队列

## 渐进式改进方案要点

### 为什么选择渐进式而非 D1 重构

| 对比维度 | 渐进改进 | D1 完全重构 |
|---------|---------|-----------|
| **实施周期** | 2-3 周 | 2-3 月 |
| **代码变更量** | ~2,000 行 | ~15,000 行 |
| **迁移风险** | 低（无需停写） | 高（需要短暂停写切换） |
| **实时性** | 优秀（< 10ms WebSocket） | 一般（200ms+ HTTP 轮询） |
| **回滚难度** | 低（每阶段独立） | 高（依赖服务端状态） |
| **投入产出比** | 解决 80% 痛点，20% 成本 | 解决 95% 痛点，100% 成本 |

### 六个渐进阶段

**阶段 1：完成统一房间迁移（2 天）**
- 验证所有设备使用 `workspace-{userId}-unified`
- 使用现有 `workspaceAudit` 检查数据完整性
- 更新文档 schema 版本 v6 → v7

**阶段 2：改造数据结构为对象索引（5 天）**
- 核心改进：`tasks: Task[]` → `tasks: { byId: Record<string, Task>, allIds: string[] }`
- 使用 Liveblocks 原生 `LiveMap`，每个实体独立同步
- 添加迁移工具自动转换旧数据
- 保持 UI API 不变（向后兼容层）

**阶段 3：简化冲突处理（3 天）**
- 移除复杂递归三路合并
- 默认 LWW（Last Write Wins）+ 时间戳
- 只在保护字段（删除、关键业务状态）触发冲突
- 合并逻辑从 ~400 行降至 < 150 行

**阶段 4：增强审计与历史（2 天）**
- 集成 Liveblocks History API
- 定期归档操作日志到 R2
- 扩展现有审计报告，增加操作频率统计

**阶段 5：优化跨标签页同步（2 天）**
- 强制要求 Web Locks（旧浏览器显示警告）
- 移除 localStorage 降级逻辑
- 使用 BroadcastChannel 优化实时性

**阶段 6：全面测试（3 天）**
- 单元测试覆盖索引结构和合并逻辑
- E2E 测试多设备离线/在线场景
- 真实设备验证

### 关键技术方案

#### 1. LiveMap 解决数组覆盖

```typescript
// 旧结构（问题根源）
{
  tasks: Task[]  // 整个数组同步，任何修改都覆盖全部
}

// 新结构（解决方案）
{
  tasks: {
    byId: LiveMap<string, Task>,  // 每个 task 独立同步
    allIds: LiveList<string>,      // 顺序单独维护
    _meta: { lastModified: Record<string, number> }
  }
}
```

**关键优势：**
- 设备 A 修改 `tasks.byId['task-1']`，设备 B 修改 `tasks.byId['task-2']`，互不影响
- Liveblocks 自动处理 Map 级冲突，无需自定义合并
- 向后兼容：提供 `get tasks()` getter 返回数组格式

#### 2. 简化冲突策略

```typescript
// 移除复杂递归合并，改为简单策略
function mergeEntity(base, local, remote) {
  if (deepEqual(local, base)) return remote;  // 本地未改
  if (deepEqual(remote, base)) return local;  // 远程未改
  
  // 双方都改了
  if (isProtectedField(field)) {
    return { value: local, conflict: true };  // 用户选择
  }
  
  // 使用 LWW
  return remote.lastModified > local.lastModified ? remote : local;
}
```

**保护字段列表（仅这些触发用户选择）：**
- `tasks.*.isDeleted`（删除 vs 修改）
- `reviewTasks.*.completedAt`（完成状态）
- `retrospectives`（每日复盘）

## 实施时间线

```
Week 1:
  Day 1-2: 阶段 1（统一房间验证）
  Day 3-5: 阶段 2（Timeline Store 索引化）
  
Week 2:
  Day 1-2: 阶段 2（其他 4 个 Store 索引化）
  Day 3-5: 阶段 3（简化冲突处理）
  
Week 3:
  Day 1-2: 阶段 4-5（审计增强 + 跨标签页优化）
  Day 3-5: 阶段 6（测试与验证）
```

## 成功指标

### 定量目标
- ✅ 零数据丢失（通过备份对比）
- ✅ 并发修改不同实体：0% 覆盖率
- ✅ 冲突提示：< 5% 总操作
- ✅ 同步延迟：< 2s（正常网络）
- ✅ 代码减少：合并逻辑从 ~400 行降至 < 150 行

### 定性目标
- 多设备编辑"感觉像单机"
- 离线操作完全可靠
- 新开发者能快速理解同步逻辑
- 添加新字段无需修改合并代码

## 回滚保障

每个阶段都有独立回滚点：
- **阶段 1-2**：数据双向兼容，可随时切回数组格式
- **阶段 3**：保留旧合并逻辑代码，Git 版本可恢复
- **阶段 4-5**：纯功能增加，不影响核心同步
- **紧急措施**：`localStorage.setItem('EMERGENCY_OFFLINE_MODE', 'true')` 立即禁用云端写入

## 与 D1 方案的关系

**短期策略（当前）：**
- 执行渐进式改进，2-3 周解决 80% 痛点
- 观察 30 天，收集真实冲突频率数据

**中期决策（3-6 个月后）：**
- 如果渐进改进满足需求 → 继续优化 Liveblocks 方案
- 如果仍有明显痛点 → 考虑小范围 D1 试点（如 Daily Retrospective）

**长期可能性（1 年后）：**
- D1 正式 GA 且试点成功 → 完整迁移
- Liveblocks 推出新功能 → 保持现有方案
- 混合架构 → 热数据 Liveblocks，冷数据 D1

## 技术债务清理

趁改进过程顺便处理：
1. ✅ 文档 schema 版本同步（v6 → v7）
2. 移除未使用的旧房间代码（观察期后）
3. 统一错误处理模式
4. 补充关键类型断言
5. 删除过时 TODO 注释

## 文件清单

**新增文档：**
- `docs/progressive-improvement-plan.md`（完整方案，96KB）

**待修改文件：**
- `src/store/index.ts`（Timeline Store 索引化）
- `src/ebb/store.ts`（EBB Store 索引化）
- `src/components/dailySchedule/store.ts`（Daily Store）
- `src/graph/store.ts`（Graph Store）
- `src/lifeMap/store.ts`（Life Map Store）
- `src/services/workspaceSyncCore.ts`（简化合并）
- `src/services/workspaceSyncQueueCore.ts`（跨标签页）
- `docs/architecture.md`（更新 schema 版本）

**待新增文件：**
- `src/services/dataStructureMigration.ts`（迁移工具）
- `src/services/operationLogArchive.ts`（日志归档）
- `tests/sync/indexed-structure.test.ts`（单元测试）
- `tests/e2e/multi-device-sync.spec.ts`（E2E 测试）

## 下一步

如果你同意这个方案，我可以立即开始：

1. **阶段 1：统一房间验证**
   - 读取你所有设备的 localStorage 同步配置
   - 运行现有 `workspaceAudit` 检查数据完整性
   - 更新 `docs/architecture.md` 的 schema 版本

2. **阶段 2：Timeline Store 索引化（核心）**
   - 创建数据迁移工具
   - 改造 Timeline Store 为索引结构
   - 添加向后兼容层
   - 本地测试验证

需要我开始实施吗？还是你想先讨论方案的某个具体部分？
