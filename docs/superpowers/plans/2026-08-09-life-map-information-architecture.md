# 人生地图信息架构重构 Implementation Plan

> 历史实施计划：已被 `2026-08-09-life-map-interface-simplification.md` 取代。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将人生地图重构为目标、项目、长期系统、关键日期四个一级对象，并提供清晰的项目子阶段与规划概览流程。

**Architecture:** 用纯函数承载创建上下文、子阶段空闲区间和时期重点投影；schema 6 只增加可选关系字段；创建菜单、实体编辑器和规划概览从现有大组件中逐步拆分，画布布局保持独立。

**Tech Stack:** React 18、TypeScript、Zustand、Day.js、Vite、Node test、Playwright。

## Global Constraints

- 保留当前脏工作区和所有无关改动。
- 不自动改写任何目标、项目、子阶段、人生时期或关键日期日期。
- 底层 `kind: 'plan' | 'phase'` 和旧集合名称保持兼容。
- 桌面与手机继续使用 128px 固定标签栏，项目胶囊保持 26px。

---

### Task 1: 纯创建逻辑与时期重点适配

- [x] 为创建上下文优先级、全局关键日期、子阶段首个空闲区间和时期重点投影写失败测试。
- [x] 新增 `lifeMapCreationContext.ts` 与 `lifeMapPeriodFocus.ts` 的最小实现。
- [x] 运行人生地图领域测试并重构重复逻辑。

### Task 2: schema 6、关系与迁移

- [x] 为 schema 5→6、无领域关键日期、无效关系降级和备份恢复写失败测试。
- [x] 扩展类型、规范化、Store、schema、备份、同步队列和系统模拟。
- [x] 运行人生地图、同步和系统测试。

### Task 3: 四对象创建菜单与渐进式编辑

- [x] 先写 E2E，断言添加菜单只有四项且关键日期无需领域。
- [x] 拆出 `LifeMapCreateMenu`，移除低频对象和自然语言输入。
- [x] 重构实体编辑器的基础字段与更多设置。
- [x] 在全局入口、项目编辑器和项目胶囊增加子阶段入口。
- [x] 验证分类继承、子阶段继承、无空闲区间和目标关联。

### Task 4: 规划概览、时期重点与术语

- [x] 先写桌面/小屏抽屉、术语和旧主题画布显示 E2E。
- [x] 新增 `LifeMapPlanningDrawer`，收纳长期系统、时期重点、复盘、结构设置和画布工具。
- [x] 将人生阶段、计划阶段、阶段说明等用户文案统一替换。
- [x] 接入时期重点兼容层并修复旧主题未进入画布的问题。
- [x] 按后续要求把长期系统放入所属领域，并固定在项目轨道上方。

### Task 5: 完整验证和文档

- [x] 更新产品、架构、迁移和开发文档。
- [x] 运行 lint、check、build、life-map、sync、system。
- [x] 按 E2E 规格文件分别运行，最后运行完整 Playwright。
- [x] 自审数据迁移、无障碍、移动端和脏工作区差异。
