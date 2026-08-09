# Life Map Plan Swimlanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将人生地图的主计划与计划阶段改为“学习 / 工作 / 生活 → 人生领域 → 最少重叠轨道”的固定标签泳道。

**Architecture:** 以新增的同步大类偏好和 `LifeArea.planGroupId` 提供数据归属；纯布局模块只输出几何结果；现有人生地图画布消费布局结果并继续渲染所有非项目图层。

**Tech Stack:** React 18、TypeScript、Zustand、Day.js、Liveblocks、Node test runner、Playwright。

## Global Constraints

- 只接管 `plan` 和 `phase`；其他人生地图内容保持现有语义。
- 固定栏全端 128px，不增加折叠。
- 大类位置同步，项目筛选仅为会话状态。
- 不修改任何现有日期。
- 保留当前脏工作区全部既有改动。

---

### Task 1: 数据模型、规范化与 schema 5

**Files:** `src/lifeMap/types.ts`、`src/lifeMap/data.ts`、`src/lifeMap/store.ts`、`src/services/workspaceBackup.ts`

- [ ] 先在 `tests/domain/life-map.test.ts` 写默认三大类、领域映射和非法数据修复测试并确认失败。
- [ ] 增加大类类型、默认配置、领域字段、规范化、Store 更新动作与 schema 5。
- [ ] 运行 `npm run test:life-map`，确认新旧领域测试全部通过。

### Task 2: 纯泳道布局算法

**Files:** 新建 `src/lifeMap/planSwimlaneLayout.ts`，新建 `tests/domain/plan-swimlane-layout.test.ts`

- [ ] 写包含结束日重叠、最少轨道、不同领域隔离、阶段继承、筛选、全同侧与稳定排序测试并确认失败。
- [ ] 实现 `buildPlanSwimlaneLayout` 及输入/输出类型。
- [ ] 运行新增领域测试并保持 `npm run test:life-map` 通过。

### Task 3: 同步、离线队列与完整备份

**Files:** `src/services/workspaceSync.ts`、`src/services/workspaceOfflineQueue.ts`、`src/services/workspaceSyncQueueCore.ts`、`src/components/SyncDialog.tsx`

- [ ] 先扩展同步与系统测试，覆盖 schema 5、新集合写入/恢复及旧版升级并确认失败。
- [ ] 将新集合接入字段映射、队列、冲突合并、备份摘要和恢复。
- [ ] 运行 `npm run test:sync`、`npm run test:system`。

### Task 4: 领域管理与大类偏好 UI

**Files:** `src/components/lifeMap/LifeMapWorkspace.tsx`

- [ ] 先写 Playwright 用例，验证领域映射选择和大类换边跨刷新保留并确认失败。
- [ ] 在领域编辑器加入项目大类选择，并把大类偏好和回调传给画布。
- [ ] 运行相关 Playwright 单文件桌面与小屏项目。

### Task 5: 固定栏与项目泳道渲染

**Files:** `src/components/lifeMap/LifeMapView.tsx`、新建 `src/components/lifeMap/PlanSwimlaneLayer.tsx`、对应人生地图样式文件

- [ ] 写 E2E：128px 固定栏、横向滚动、阶段跟随、筛选独立和缩放不换行；确认失败。
- [ ] 将 plan/phase 从旧 `projectBands` 分离，渲染纯布局结果并把上下高度接入 `axisY`。
- [ ] 保留系统、复盘、目标、人生阶段、里程碑、注解和既有交互。
- [ ] 运行完整人生地图 E2E。

### Task 6: 文档和完整验证

- [ ] 更新 README、产品、架构、开发与数据迁移文档中的 schema 和泳道说明。
- [ ] 运行 lint、check、build、life-map、sync、system 和完整 E2E。
- [ ] 检查 `git diff --check` 和工作区状态，确认未覆盖无关改动。
