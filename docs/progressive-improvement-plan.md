# SmartLine 渐进式同步架构改进方案

## 执行摘要

本方案通过 **6 个渐进阶段**改进现有 Liveblocks 同步架构，解决核心痛点，避免大规模重写。预计 **2-3 周**完成，风险可控。

### 核心问题
1. 五个独立房间导致跨域事务困难
2. 整数组覆盖导致并发修改互相覆盖
3. 三路合并逻辑复杂（~400 行）且难以验证正确性
4. 冲突处理依赖用户介入，体验差

### 改进目标
1. ✅ 统一房间（已部分完成，schema v7）
2. 🎯 实体级同步（替代数组覆盖）
3. 🎯 简化冲突策略（LWW + 关键字段保护）
4. 🎯 增强审计能力（操作历史 + 定期归档）

---

## 阶段 1：完成统一房间迁移

### 当前状态
- Schema v7 已定义，`buildUnifiedRoomId` 已实现
- 迁移逻辑 `migrateFromLegacyWorkspace` 存在但可能未完全激活
- 文档仍标注 schema v6

### 实施步骤

#### 1.1 确认迁移状态
```typescript
// 检查所有设备的实际房间使用情况
- 读取 localStorage `timeline-sync-settings` 等配置
- 确认是否所有设备都已使用统一房间
- 如果仍有设备使用旧房间，触发迁移流程
```

#### 1.2 验证统一房间数据完整性
```typescript
// 使用现有审计工具检查
workspaceAudit.inspectReferences()
workspaceAudit.inspectEntitySizes()
workspaceAudit.inspectFieldCompleteness()
```

#### 1.3 更新文档
- `docs/architecture.md` schema 版本更新为 v7
- 明确标注旧房间迁移状态

**验收标准：**
- [ ] 所有活跃设备使用 `workspace-{userId}-unified` 房间
- [ ] 审计报告无悬空引用、无数据丢失
- [ ] 文档与代码版本一致

---

## 阶段 2：改造数据结构（数组 → 对象索引）

### 问题根源

当前 Timeline Store 结构：
```typescript
{
  tasks: Task[],        // 整数组同步
  groups: TaskGroup[],  // 整数组同步
  ...
}
```

**问题：**
- 设备 A 修改 `tasks[0]`，推送整个 `tasks` 数组
- 设备 B 同时修改 `tasks[5]`，也推送整个 `tasks` 数组
- Liveblocks LWW 合并：后到达的数组覆盖先到达的，丢失其中一方的修改

### 目标结构

```typescript
{
  tasks: {
    byId: Record<string, Task>,     // 用 LiveMap
    allIds: string[],               // 用 LiveList
    _meta: {
      lastModified: Record<string, number>  // 跟踪每个实体的修改时间
    }
  },
  groups: {
    byId: Record<string, TaskGroup>,
    allIds: string[],
    _meta: { lastModified: Record<string, number> }
  },
  ...
}
```

### Liveblocks 原生支持

使用 **LiveMap** 替代数组：
```typescript
import { LiveMap, LiveList } from '@liveblocks/client';

// 在 storageMapping 中
storageMapping: {
  tasks: {
    byId: new LiveMap<string, Task>(),
    allIds: new LiveList<string>()
  }
}
```

**优势：**
- LiveMap 的每个 key 独立同步，修改 `tasks.byId['task-1']` 不影响 `tasks.byId['task-2']`
- Liveblocks 自动处理 Map 级别的冲突
- 不需要自定义三路合并

### 实施步骤

#### 2.1 创建迁移工具
```typescript
// src/services/dataStructureMigration.ts

export function migrateTasksToIndexed(tasks: Task[]): {
  byId: Record<string, Task>;
  allIds: string[];
  _meta: { lastModified: Record<string, number> };
} {
  const now = Date.now();
  return {
    byId: Object.fromEntries(tasks.map(t => [t.id, t])),
    allIds: tasks.map(t => t.id),
    _meta: {
      lastModified: Object.fromEntries(tasks.map(t => [t.id, now]))
    }
  };
}

export function denormalizeIndexedTasks(indexed: {
  byId: Record<string, Task>;
  allIds: string[];
}): Task[] {
  return indexed.allIds
    .map(id => indexed.byId[id])
    .filter(Boolean);
}
```

#### 2.2 添加兼容层
```typescript
// src/store/index.ts

// 在 Store 接口保持不变，内部转换
export const useTimelineStore = create<TimelineStore>()(
  liveblocks(
    (setState, get) => {
      // ...
      return {
        // 保留原有 API，内部操作索引结构
        addTask: (task: Task) => {
          const state = get();
          setState({
            tasks: {
              byId: { ...state.tasks.byId, [task.id]: task },
              allIds: [...state.tasks.allIds, task.id],
              _meta: {
                lastModified: {
                  ...state.tasks._meta.lastModified,
                  [task.id]: Date.now()
                }
              }
            }
          });
        },
        
        updateTask: (task: Task) => {
          setState({
            tasks: {
              byId: { ...get().tasks.byId, [task.id]: task },
              allIds: get().tasks.allIds, // 不变
              _meta: {
                lastModified: {
                  ...get().tasks._meta.lastModified,
                  [task.id]: Date.now()
                }
              }
            }
          });
        },
        
        // 提供向后兼容的 getter
        get tasks() {
          return denormalizeIndexedTasks(this.tasks);
        }
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        tasks: true,  // 暂时保持，逐步迁移到 LiveMap
        groups: true,
        ...
      }
    }
  )
);
```

#### 2.3 分步迁移五个 Store

**优先级顺序：**
1. Timeline Store（最复杂，但影响面最大）
2. EBB Store（复习任务数组）
3. Daily Store（schedules 对象已按日期索引，主要改 items 数组）
4. Graph Store（节点数组）
5. Life Map Store（已部分使用对象结构）

**每个 Store 的迁移步骤：**
1. 添加数据迁移函数
2. 在 `hydrateStore` 中检测旧格式，自动迁移
3. 更新 storageMapping 为 LiveMap
4. 测试本地读写
5. 测试跨设备同步
6. 删除旧兼容代码

#### 2.4 影子验证
```typescript
// 在迁移期间，同时维护旧结构和新结构
{
  tasks_legacy: Task[],           // 只读，用于对比
  tasks: { byId, allIds, _meta }, // 新结构
}

// 定期对比
setInterval(() => {
  const legacy = get().tasks_legacy;
  const indexed = denormalizeIndexedTasks(get().tasks);
  if (!arraysEqual(legacy, indexed)) {
    console.error('数据结构迁移不一致！');
  }
}, 60000);
```

**验收标准：**
- [ ] 所有 Store 使用索引结构
- [ ] UI 层无感知（API 保持不变）
- [ ] 多设备并发修改不同实体，无覆盖
- [ ] 旧设备连接时自动迁移本地数据

---

## 阶段 3：简化冲突处理逻辑

### 当前问题

`workspaceSyncCore.ts` 的 `mergeWorkspaceValue` 实现了完整三路合并：
- 递归处理嵌套对象和数组
- 按实体 ID 合并数组
- 检测并标记所有冲突路径
- ~150 行复杂逻辑

**代价：**
- 难以测试所有分支
- 冲突检测过于严格，很多情况可以自动解决
- 用户需要手动选择的场景过多

### 新策略

#### 3.1 默认 LWW（Last Write Wins）

```typescript
// 简化后的合并逻辑
function mergeWorkspaceField(
  base: unknown,
  local: unknown,
  remote: unknown,
  fieldName: string
): MergeResult {
  // 1. 如果本地未改，直接用远程
  if (deepEqual(local, base)) {
    return { value: remote, conflict: null };
  }
  
  // 2. 如果远程未改，用本地
  if (deepEqual(remote, base)) {
    return { value: local, conflict: null };
  }
  
  // 3. 双方都改了，检查是否是保护字段
  if (isProtectedField(fieldName)) {
    return {
      value: local, // 保留本地
      conflict: { field: fieldName, local, remote }
    };
  }
  
  // 4. 非保护字段，使用 LWW
  const localTime = getLastModifiedTime(local);
  const remoteTime = getLastModifiedTime(remote);
  return {
    value: remoteTime > localTime ? remote : local,
    conflict: null
  };
}
```

#### 3.2 保护字段列表

只有真正需要用户决策的字段才触发冲突：
```typescript
const PROTECTED_FIELDS = {
  timeline: ['tasks.*.isDeleted'],  // 删除 vs 修改
  ebb: ['reviewTasks.*.completedAt', 'reviewTasks.*.isDeleted'],
  daily: ['retrospectives'],        // 当日复盘
};
```

#### 3.3 删除特殊处理

```typescript
// 删除 vs 修改 = 保留墓碑 + 提示用户
if (local.isDeleted && !base.isDeleted && remoteModified) {
  return {
    value: { ...remote, _deletionConflict: true },
    conflict: {
      type: 'delete-vs-modify',
      localDeleted: true,
      remoteSnapshot: remote
    }
  };
}
```

#### 3.4 移除递归合并

改为**按字段合并，不递归进入实体内部**：
```typescript
// 旧逻辑：递归到 task.blocks[0].header.status
// 新逻辑：只合并 tasks.byId['task-1'] 整体

for (const [id, localEntity] of Object.entries(local.byId)) {
  const baseEntity = base.byId[id];
  const remoteEntity = remote.byId[id];
  
  merged.byId[id] = mergeEntity(baseEntity, localEntity, remoteEntity);
}
```

**验收标准：**
- [ ] 合并逻辑 < 100 行
- [ ] 冲突只在保护字段触发
- [ ] 非保护字段自动 LWW，无提示
- [ ] 删除冲突有明确恢复路径

---

## 阶段 4：增强操作历史与审计

### 4.1 完善 Liveblocks History API 集成

Liveblocks 提供内置历史功能：
```typescript
import { useHistory } from '@liveblocks/react';

// 获取最近 100 次操作
const { history, undo, redo } = useHistory();

// 导出操作日志
async function exportOperationLog() {
  const room = liveblocksClient.getRoom(roomId);
  const storage = await room.getStorage();
  const history = storage.getHistory({
    limit: 1000,
    from: Date.now() - 30 * 24 * 3600 * 1000 // 最近 30 天
  });
  
  return history.map(entry => ({
    timestamp: entry.createdAt,
    user: entry.connectionId,
    operations: entry.ops,
    affectedKeys: extractKeys(entry.ops)
  }));
}
```

### 4.2 定期归档到 R2

```typescript
// 每月自动导出操作日志
async function archiveMonthlyOperationLog(year: number, month: number) {
  const log = await exportOperationLog();
  const filtered = log.filter(e => {
    const d = new Date(e.timestamp);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
  
  const backup = {
    version: 1,
    period: `${year}-${String(month).padStart(2, '0')}`,
    operations: filtered,
    generatedAt: new Date().toISOString()
  };
  
  // 上传到 R2
  await fetch(`/api/archives/operations-${year}-${month}`, {
    method: 'PUT',
    body: JSON.stringify(backup)
  });
}
```

### 4.3 扩展现有审计报告

在 `workspaceAudit.ts` 基础上增加：
```typescript
interface OperationAudit {
  last24h: number;
  last7d: number;
  last30d: number;
  topModifiedEntities: Array<{
    entityId: string;
    entityType: string;
    modifyCount: number;
  }>;
  suspiciousPatterns: string[]; // 如：短时间大量删除
}

export async function auditOperationHistory(): Promise<OperationAudit> {
  const log = await exportOperationLog();
  // 统计分析
  // ...
}
```

**验收标准：**
- [ ] 可查询最近 30 天任意时间点的操作
- [ ] 每月操作日志自动归档到 R2
- [ ] 审计报告包含操作频率统计
- [ ] 可按实体 ID 追溯完整修改历史

---

## 阶段 5：优化跨标签页同步

### 当前问题

`workspaceSyncQueueCore.ts` 使用 Web Locks API + localStorage 降级：
```typescript
async function withWorkspaceQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  if ('locks' in navigator) {
    return navigator.locks.request('workspace-queue', fn);
  } else {
    // localStorage 降级，无真正互斥
    return fn();
  }
}
```

**问题：**
- localStorage 降级模式无法保证互斥
- 旧浏览器可能出现并发写入队列

### 改进方案

#### 5.1 强制要求 Web Locks

```typescript
// 不支持 Web Locks 的浏览器显示警告
if (!('locks' in navigator)) {
  showWarning('当前浏览器不支持标签页同步，建议升级浏览器或只使用单个标签页');
}

// 或者完全禁用跨标签页队列
const CROSS_TAB_SYNC_ENABLED = 'locks' in navigator;
```

#### 5.2 使用 BroadcastChannel 优化实时性

```typescript
const syncChannel = new BroadcastChannel('smartline-sync');

// 本地修改后立即通知其他标签页
function notifyOtherTabs(entityType: string, entityId: string) {
  syncChannel.postMessage({
    type: 'entity-updated',
    entityType,
    entityId,
    timestamp: Date.now()
  });
}

// 其他标签页收到通知，直接从 Liveblocks 拉取
syncChannel.onmessage = (event) => {
  if (event.data.type === 'entity-updated') {
    // 本地 Store 已通过 Liveblocks middleware 自动更新
    // 只需刷新 UI（如果需要）
  }
};
```

**验收标准：**
- [ ] 不支持 Web Locks 的浏览器显示明确警告
- [ ] 支持的浏览器跨标签页延迟 < 100ms
- [ ] 移除 localStorage 降级逻辑

---

## 阶段 6：全面测试与验证

### 6.1 单元测试

```typescript
// tests/sync/indexed-structure.test.ts
describe('索引结构迁移', () => {
  test('数组转索引保持数据完整', () => {
    const tasks = [{ id: 'a', name: 'Task A' }, { id: 'b', name: 'Task B' }];
    const indexed = migrateTasksToIndexed(tasks);
    const restored = denormalizeIndexedTasks(indexed);
    expect(restored).toEqual(tasks);
  });
  
  test('并发修改不同实体无覆盖', async () => {
    // 模拟两个设备同时修改
    const deviceA = createMockStore();
    const deviceB = createMockStore();
    
    await Promise.all([
      deviceA.updateTask({ id: 'task-1', name: 'Updated by A' }),
      deviceB.updateTask({ id: 'task-2', name: 'Updated by B' })
    ]);
    
    // 等待同步
    await delay(1000);
    
    // 两个修改都应保留
    expect(deviceA.getTask('task-1').name).toBe('Updated by A');
    expect(deviceA.getTask('task-2').name).toBe('Updated by B');
    expect(deviceB.getTask('task-1').name).toBe('Updated by A');
    expect(deviceB.getTask('task-2').name).toBe('Updated by B');
  });
});
```

### 6.2 端到端测试

```typescript
// tests/e2e/multi-device-sync.spec.ts
test('多设备离线后恢复同步', async ({ page, context }) => {
  // 设备 1：在线修改
  await page.goto('/');
  await page.click('[data-testid="add-task"]');
  await page.fill('input[name="taskName"]', 'Device 1 Task');
  
  // 设备 2：离线状态
  const page2 = await context.newPage();
  await page2.context().setOffline(true);
  await page2.goto('/');
  await page2.click('[data-testid="add-task"]');
  await page2.fill('input[name="taskName"]', 'Device 2 Offline Task');
  
  // 设备 2 恢复在线
  await page2.context().setOffline(false);
  await page2.reload();
  
  // 等待同步完成
  await page2.waitForSelector('[data-sync-status="synced"]');
  
  // 验证：两个设备都能看到对方的任务
  await expect(page.locator('text=Device 2 Offline Task')).toBeVisible();
  await expect(page2.locator('text=Device 1 Task')).toBeVisible();
});
```

### 6.3 真实设备测试

**测试场景：**
1. 两台电脑 + 一台手机同时在线编辑
2. 手机离线 24 小时后重新连接
3. 一台电脑网络频繁断连
4. 清除一台设备的 IndexedDB，重新同步
5. 旧版本客户端连接统一房间
6. 大量数据（1000+ 任务）的同步性能

**验收标准：**
- [ ] 所有场景无数据丢失
- [ ] 冲突提示少于 5% 的操作
- [ ] 同步延迟 < 2 秒（正常网络）
- [ ] 离线队列重放 100% 成功率

---

## 回滚与应急预案

### 每个阶段的回滚点

| 阶段 | 回滚方法 | 数据损失风险 |
|------|---------|-------------|
| 1. 统一房间 | 恢复旧房间配置，Liveblocks 房间仍保留 | 无 |
| 2. 索引结构 | 使用 `denormalizeIndexedTasks` 恢复数组格式 | 无 |
| 3. 简化合并 | 恢复 `mergeWorkspaceValue` 旧逻辑 | 无（已同步数据保留） |
| 4. 审计增强 | 纯功能增加，无需回滚 | 无 |
| 5. 跨标签页优化 | 禁用 BroadcastChannel，保留旧队列 | 无 |
| 6. 测试 | 无需回滚 | 无 |

### 紧急修复流程

```typescript
// 如果发现严重同步问题，立即禁用云端写入
localStorage.setItem('EMERGENCY_OFFLINE_MODE', 'true');

// 在应用启动时检查
if (localStorage.getItem('EMERGENCY_OFFLINE_MODE') === 'true') {
  console.warn('应急离线模式已启用');
  // 禁用所有 Liveblocks 写入
  liveblocksClient.disconnect();
}

// 用户可导出本地数据，等待修复
exportWorkspaceBackup();
```

---

## 实施时间表

| 阶段 | 预计时间 | 依赖 |
|------|---------|------|
| 1. 完成统一房间 | 2 天 | 无 |
| 2. 索引结构改造 | 5 天 | 阶段 1 |
| 3. 简化冲突处理 | 3 天 | 阶段 2 |
| 4. 审计增强 | 2 天 | 无（可并行） |
| 5. 跨标签页优化 | 2 天 | 阶段 2 |
| 6. 全面测试 | 3 天 | 阶段 1-5 |
| **总计** | **17 天** | |

**缓冲时间：** 3-5 天应对意外问题

**最终交付：** 2-3 周

---

## 成功指标

### 定量指标

1. **数据完整性**
   - 零数据丢失（通过备份对比验证）
   - 悬空引用 < 0.1%

2. **同步性能**
   - 正常网络延迟 < 2s
   - 跨标签页延迟 < 100ms
   - 离线队列重放成功率 > 99%

3. **冲突率**
   - 需要用户介入的冲突 < 5% 总操作
   - 自动解决的冲突 > 95%

4. **代码质量**
   - 合并逻辑从 ~400 行降至 < 150 行
   - 单元测试覆盖率 > 80%
   - E2E 测试覆盖核心场景

### 定性指标

1. **用户体验**
   - 多设备编辑"感觉像单机"
   - 冲突提示明确且少见
   - 离线操作可靠

2. **可维护性**
   - 新开发者能理解同步逻辑
   - 添加新字段无需修改合并逻辑
   - 调试冲突有清晰日志

---

## 与 D1 方案对比

| 维度 | 渐进改进 | D1 重构 |
|------|---------|---------|
| 实施时间 | 2-3 周 | 2-3 月 |
| 代码变更 | ~2,000 行 | ~15,000 行 |
| 风险等级 | 低 | 高 |
| 数据迁移 | 无需手动迁移 | 需要停写切换 |
| 实时性 | 优秀（< 10ms） | 一般（200ms+） |
| 审计能力 | 30 天历史 + R2 归档 | 完整操作日志 |
| 成本 | $8/月（Liveblocks） | $0-$5/月（D1） |
| 回滚难度 | 低（每阶段独立） | 高（依赖服务端） |

---

## 下一步行动

1. **立即开始：** 阶段 1（统一房间验证）
2. **周内完成：** 阶段 1-2（索引结构核心改造）
3. **两周内：** 完成所有阶段并通过测试
4. **观察期：** 运行 30 天，收集反馈
5. **长期决策：** 根据实际效果决定是否继续探索 D1 方案

---

## 技术债务清理

改进过程中顺便清理：
1. ✅ 文档 schema 版本同步（v6 → v7）
2. 移除未使用的旧房间迁移代码（观察期后）
3. 统一错误处理模式
4. 补充关键路径的类型断言
5. 删除过时的注释和 TODO

---

## 附录：关键代码位置

### 需要修改的文件
- `src/store/index.ts` - Timeline Store 索引化
- `src/ebb/store.ts` - EBB Store 索引化
- `src/components/dailySchedule/store.ts` - Daily Store 索引化
- `src/graph/store.ts` - Graph Store 索引化
- `src/lifeMap/store.ts` - Life Map Store 索引化
- `src/services/workspaceSyncCore.ts` - 简化合并逻辑
- `src/services/workspaceSyncQueueCore.ts` - 跨标签页优化

### 需要新增的文件
- `src/services/dataStructureMigration.ts` - 数据结构迁移工具
- `src/services/operationLogArchive.ts` - 操作日志归档
- `tests/sync/indexed-structure.test.ts` - 索引结构测试
- `tests/e2e/multi-device-sync.spec.ts` - 多设备测试

### 文档更新
- `docs/architecture.md` - Schema 版本、数据结构说明
- `docs/progressive-improvement-plan.md` - 本方案（新建）
- `README.md` - 更新同步机制说明
