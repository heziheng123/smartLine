# SmartLine 统一地图工作区：产品规格、数据架构与迁移实施方案

文档版本：1.0  
日期：2026-08-24  
状态：产品方向冻结，架构变更待实施  
适用范围：`src/mindMap/`、`src/lifeMap/` 及新建的 `src/mapWorkspace/`  
核心原则：**One Node Model, Multiple Views, Typed Relations, Independent Map Domain**

---

## 0. 执行结论

SmartLine 将以现有独立思维导图为基础，新增一个统一的「地图工作区」。每张地图文档提供两个视图：

| 视图 | 回答的问题 | 坐标语义 |
| --- | --- | --- |
| 思维视图 | 内容之间是什么关系？ | X、Y 都由用户自由决定 |
| 人生视图 | 目标什么时候发生、持续多久？ | Y 只由日期决定，X 只负责泳道与视觉组织 |

两个视图共享同一批节点、规划属性和语义关系，但保留各自独立的布局状态。最终体验是：

> 同一份内容，在思维视图中按关系组织，在人生视图中按时间组织；视图不同，数据不分裂。

本方案同时冻结以下架构结论：

1. 统一范围只限于地图工作区，不扩展成整个 SmartLine 的全局大 Store。
2. 统一的是节点身份与业务属性，不强迫思维层级、规划层级和任意连线共用一个 `parentId`。
3. 规划关系必须使用有类型的 Relation；自由连线可以成环，规划父子关系必须无环。
4. 人生视图严格使用纵向时间轴；阶段是区间，里程碑是时间点，普通卡片没有独立时间位置。
5. 旧人生地图只迁移一次，并进入一张新建的「人生规划（迁移）」地图，不复制到每张旧思维导图。
6. 旧思维导图的每张文档分别迁移为一张地图工作区文档。
7. 新数据域使用独立数据库、独立文档 schema 和独立同步房间，不修改当前 `WORKSPACE_SCHEMA_VERSION = 7` 的全局工作区结构。
8. 在迁移校验、备份恢复和回滚 Gate 全部通过前，旧 Store 不删除；切换后先只读保留。

### 0.1 与现有规格的关系

现有 `docs/design/2026-08-23-independent-mind-map-workspace-spec-and-plan.md` 明确要求思维导图与人生地图隔离，且当前模块边界测试禁止 `src/mindMap/` 导入 `@/lifeMap`。

本方案是一次有意的产品方向升级，但不能通过直接删除隔离护栏来实施。正确做法是：

```text
现有 mindMap 与 lifeMap 保持不变
              │
              ▼
新建 mapWorkspace 数据域与适配器
              │
              ▼
在新数据域内完成两个视图和迁移验证
              │
              ▼
功能开关灰度切换
              │
              ▼
旧模块只读保留，最后再退役
```

在 Phase 0 完成并更新架构决策记录之前，现有隔离规格仍然有效。

---

## 1. 当前基线

### 1.1 独立思维导图

当前思维导图已经具备：

- 多文档与独立 IndexedDB 持久化。
- `MindMapNode`、`MindMapEdge`、Section、Group、zOrder 和 viewport。
- Text、Markdown、LaTeX、URL、Image 节点。
- 独立 Command、Undo、Redo、自动保存和 JSON/PNG/SVG 导出。
- Canvas/WebGL/Worker、空间索引及 5,000 节点性能 Gate。
- 可选的独立同步实现，正式环境默认关闭。
- 严格的模块隔离和零回归测试。

现有 `MindMapNode` 将内容、样式与思维视图坐标放在同一对象中。迁入目标模型时，需要保留节点 ID 和内容，同时把 `x/y/width/height/rotation/style` 提取为思维视图布局记录。

### 1.2 旧人生地图

当前人生地图是独立 Zustand/Liveblocks Store，已有：

- Area、Stage、Theme、Goal/Plan/Phase、System、CheckIn、Event、Focus、Note、Review。
- `createdAt`、`updatedAt`、`revision`、`deletedAt` 等同步元数据。
- 严格的日期映射、阶段带、泳道、事件、批注碰撞和窗口化逻辑。
- 多套人生地图 E2E、领域测试和视觉回归基线。

旧人生地图的业务语义比首版 Goal/Stage/Milestone 更丰富，因此迁移不能把所有实体粗暴压缩成三种节点后立即删除旧数据。无法完整表达的 System、CheckIn 和 Review 必须保留迁移侧车数据，并在功能覆盖完成前继续只读展示。

### 1.3 变更约束

- 不能覆盖当前工作区中的未提交改动。
- 不能让新地图工作区加入现有全局 hydration 阻塞条件。
- 不能让地图同步失败进入全局 SyncDialog 的现有业务警告链路。
- 不能因为统一模型而降低思维导图已经通过的性能和隔离标准。
- 不能为了复用旧组件让 `src/mindMap/` 与 `src/lifeMap/` 互相导入。

---

## 2. 产品目标与非目标

### 2.1 产品目标

1. 用户可以在同一张地图中自由记录内容，并把任意节点转换为目标、阶段或里程碑。
2. 用户切换视图时，节点 ID、标题、正文、规划属性和选择上下文保持一致。
3. 思维视图中的空间移动永远不修改日期。
4. 人生视图中的时间编辑只修改 Planning Metadata，永远不回写思维画布坐标。
5. 所有跨视图业务编辑进入同一文档 Command/History/Persistence。
6. 迁移必须无损、可重复验证、可回滚，并保留旧数据直至退役 Gate 通过。
7. 第一版聚焦 Card、Goal、Stage、Milestone、Mind View 和 Life View 的闭环。

### 2.2 第一版非目标

- 不接入 Daily、周矩阵、EBB 或知识大盘。
- 不把地图节点绑定为 SmartLine 项目或任务对象。
- 不做跨地图 Reference Node。
- 不做 Goal 自动汇总进度。
- 不做复杂依赖网络、关键路径和资源排程。
- 不做多人同时编辑 Planning 的复杂冲突 UI。
- 不为了人生视图重写已稳定的 Canvas/WebGL 渲染器。
- 不在第一版删除旧 Life Map Store 或旧 Mind Map 数据库。
- 不在第一版实现 Adaptive Life Path 曲线。

### 2.3 成功体验

核心闭环必须在一次连续操作中完成：

```text
创建普通节点
  → 整理内容关系
  → 转换为阶段
  → 设置开始和结束日期
  → 切换人生视图
  → 看到严格时间区间
  → 修改日期
  → 撤销
  → 回到思维视图且内容与空间位置不变
```

---

## 3. 信息架构

### 3.1 页面与文档

产品名称：地图工作区  
代码标识：`map-workspace`  
文档标识：`smart-line-map-workspace`

一张 `MapWorkspaceDocument` 是一个独立工作区，内部包含：

```text
Map Workspace Document
├── Nodes                  共享内容与规划属性
├── Relations              有类型的语义关系
├── Planning Areas         规划领域目录
├── Mind View State        空间布局、Section、Group、边样式
├── Life View State        缩放、折叠、泳道偏好
├── Assets                 图片等资源引用
└── Migration Receipt      迁移来源与校验信息
```

### 3.2 页面骨架

```text
┌──────────────────────────────────────────────────────────────┐
│ SmartLine  地图名称      [思维视图] [人生视图]   撤销 重做 更多 │
├──────────┬─────────────────────────────────────┬─────────────┤
│ 工具栏   │                                     │ Inspector   │
│ 选择     │                                     │ 内容        │
│ 节点     │              当前视图               │ 规划        │
│ 连线     │                                     │ 外观        │
│ 规划节点 │                                     │ 关系        │
├──────────┴─────────────────────────────────────┴─────────────┤
│ 缩放 / 节点数 / 保存状态 / 当前时间粒度 / 本地或同步状态      │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 视图切换

- 切换视图不创建副本，不执行数据同步，也不产生 Undo 记录。
- 若当前节点在目标视图可见，则保持选中并定位。
- 普通 Card 未挂载到规划节点时不进入主时间轴，切换后显示在「未规划内容」抽屉。
- 当前 viewport 分别保存在 Mind View State 和 Life View State 中。
- 文档标题、保存状态、Undo/Redo 和更多菜单属于共享壳层。

---

## 4. 统一领域语言

### 4.1 核心对象

| 对象 | 定义 | 是否拥有日期 |
| --- | --- | --- |
| Card | 笔记、资料、想法和普通内容 | 否 |
| Goal | 希望达成的结果 | 可选开始日期与目标日期 |
| Stage | 具有明确起止日期的持续区间 | 必须有开始和结束日期 |
| Milestone | 某一天发生的关键事件 | 必须有一个日期 |
| Planning Area | 学习、工作、生活等分类目录 | 否 |

### 4.2 Area 的冻结决策

第一版中 Area 是独立的分类目录，不是 `nodeKind`。原因是：

- Area 与 `planning.area` 同时存在会形成重复真相源。
- “英语”既可能是内容节点，也可能是领域名称，两者不应被强制视为同一个对象。
- Area 主要服务筛选、颜色和泳道分组，不需要承担自由图节点能力。

用户仍然可以创建名为“英语”的普通节点，并让若干规划节点引用 `english` Area；未来如需语义绑定，可新增显式 Relation，不修改第一版模型。

### 4.3 关系类型

| Relation | 语义 | 约束 |
| --- | --- | --- |
| `mind` | 思维视图中的自由关系或树边 | 可多父、可成环、可重复 |
| `planning-parent` | Goal/Stage/Milestone 的规划层级 | 每个子节点最多一个父节点，禁止成环 |
| `attachment` | 普通 Card 挂载到规划节点 | Card 可被引用；第一版只允许一个主要挂载目标 |
| `reference` | 非层级引用 | 可多对多，不影响布局与日期 |

Section 与 Group 是思维视图容器，不是业务 Relation；移动 Section 不改变规划层级。

---

## 5. 目标数据模型

以下类型是目标语义，不要求第一阶段一次性替换全部现有实现。

```ts
type ISODate = string; // YYYY-MM-DD，按本地日历日期解释

interface MapWorkspaceDocument {
  kind: 'smart-line-map-workspace';
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;

  nodes: Record<string, MapNode>;
  relations: Record<string, MapRelation>;
  planningAreas: Record<string, PlanningArea>;

  mindView: MindViewState;
  lifeView: LifeViewState;

  migration?: MigrationReceipt;
}

interface MapNode {
  id: string;
  content: NodeContent;
  planning?: PlanningMetadata;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

type NodeContent =
  | { type: 'text'; text: string }
  | { type: 'markdown'; text: string }
  | { type: 'latex'; text: string }
  | { type: 'url'; text: string; url: string }
  | { type: 'image'; text: string; assetId: string };

type PlanningMetadata = GoalPlanning | StagePlanning | MilestonePlanning;

interface GoalPlanning {
  kind: 'goal';
  areaId?: string;
  status: 'planned' | 'active' | 'paused' | 'completed' | 'archived';
  priority: 'low' | 'normal' | 'high';
  startDate?: ISODate;
  targetDate?: ISODate;
  progress: number; // v1 手动，0..100
  color?: string;
}

interface StagePlanning {
  kind: 'stage';
  variant: 'stage' | 'project' | 'phase' | 'theme' | 'focus';
  areaId?: string;
  status: 'planned' | 'active' | 'paused' | 'completed' | 'archived';
  priority: 'low' | 'normal' | 'high';
  startDate: ISODate;
  endDate: ISODate;
  progress: number; // v1 手动，0..100
  color?: string;
}

interface MilestonePlanning {
  kind: 'milestone';
  areaId?: string;
  status: 'planned' | 'completed' | 'archived';
  priority: 'low' | 'normal' | 'high';
  date: ISODate;
  color?: string;
}
```

### 5.1 Relation 使用判别联合

```ts
type MapRelation =
  | {
      id: string;
      kind: 'mind';
      sourceId: string;
      targetId: string;
      label: string;
      direction: 'none' | 'forward' | 'backward' | 'both';
    }
  | {
      id: string;
      kind: 'planning-parent';
      parentId: string;
      childId: string;
    }
  | {
      id: string;
      kind: 'attachment';
      planningNodeId: string;
      contentNodeId: string;
      role: 'primary' | 'supporting';
    }
  | {
      id: string;
      kind: 'reference';
      sourceId: string;
      targetId: string;
      label?: string;
    };
```

禁止把所有关系放进一个带大量可选字段的接口。每个 Relation 必须在类型层表达端点和约束。

### 5.2 思维视图状态

```ts
interface MindViewState {
  nodeLayout: Record<string, {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    sizeMode: 'auto' | 'manual';
    locked: boolean;
    participatesInLayout: boolean;
    style: NodeStyle;
  }>;
  edgeStyle: Record<string, EdgePresentation>;
  sections: Record<string, MindSection>;
  groups: Record<string, MindGroup>;
  zOrder: string[];
  viewport: { x: number; y: number; scale: number };
  settings: MindViewSettings;
}
```

节点内容与空间布局分离后，人生视图不会误读 `x/y`，思维视图移动也不会产生业务日期变更。

### 5.3 人生视图状态

```ts
interface LifeViewState {
  viewport: {
    anchorDate: ISODate;
    pixelsPerDay: number;
    scrollX: number;
  };
  collapsedNodeIds: string[];
  pinnedLaneByNodeId: Record<string, number>;
  hiddenAreaIds: string[];
  showUnscheduledTray: boolean;
  pathMode: 'straight' | 'adaptive'; // v1 只启用 straight
}
```

Life View 不持久化节点 Y 坐标。Y 必须每次从日期和 time mapper 计算。

### 5.4 迁移侧车

旧人生地图中暂未被核心模型完整表达的数据，进入只读迁移侧车：

```ts
interface MigrationReceipt {
  source: 'mind-map' | 'life-map';
  sourceSchemaVersion: number;
  migratedAt: number;
  sourceChecksum: string;
  targetChecksum: string;
  idMap: Record<string, string>;
  warnings: MigrationWarning[];
  preservedLegacyPayload?: unknown;
}
```

`preservedLegacyPayload` 只用于无损回滚、迁移审计和旧详情只读展示，不允许成为新功能的长期动态业务模型。

---

## 6. 数据不变量

所有写操作、导入、同步合并和迁移都必须经过同一套校验器。

### 6.1 节点

- ID 在单文档内唯一、稳定且不可通过普通更新修改。
- `content.type` 表示内容渲染方式，不表示规划语义。
- `planning.kind` 是 Goal/Stage/Milestone 的唯一真相源，不再额外设置 `nodeKind`。
- 删除节点时同时删除其 Relation、视图布局和资源引用。
- 取消规划属性不删除节点内容和思维布局。

### 6.2 日期

- 所有日期使用 `YYYY-MM-DD`，按本地日历日处理，不以 UTC 毫秒直接相减。
- Stage 必须满足 `startDate <= endDate`，起止日期都包含在区间内。
- Milestone 只能拥有一个 `date`。
- Goal 无日期时进入「待定日期」区域，不得伪造今天作为日期。
- Goal 只有 `targetDate` 时显示目标点；同时有开始和目标日期时显示目标区间。

### 6.3 关系

- Relation 的所有端点必须存在。
- `planning-parent` 的父子双方都必须具有 Planning Metadata。
- 一个规划节点最多拥有一个 `planning-parent` 父节点。
- `planning-parent` 图必须为 DAG；形成循环的命令在提交前拒绝。
- `attachment.primary` 第一版每个 Card 最多一个；`supporting` 可以多个。
- Mind Relation 不改变规划层级，Planning Relation 不自动创建 Mind Edge。

### 6.4 进度

- 第一版所有 Goal 和 Stage 进度均手动维护。
- 进度只允许 0–100。
- Milestone 使用状态，不使用百分比。
- 自动聚合必须作为未来单独功能加入，不能悄悄覆盖手动值。

---

## 7. 思维视图规格

### 7.1 保留能力

迁移后的思维视图必须保持当前独立思维导图能力：

- 多类型节点、自由画布、选择、框选、复制、粘贴和删除。
- Straight、Curve、Orthogonal Edge 及方向、标签、控制点。
- Section、Group、折叠、层级和自动布局。
- 搜索、定位、Fit All、Fit Selection、100%。
- JSON、PNG、SVG 导入导出。
- 现有图片 Asset Store 与引用计数语义。
- Canvas/WebGL/Worker 和大图性能策略。

### 7.2 规划节点的表现

规划节点仍是普通可编辑节点，只增加轻量语义标识：

| 类型 | 标识 | 思维视图默认权重 |
| --- | --- | --- |
| Goal | 圆环或靶心角标 | 强 |
| Stage | 时间区间角标 | 中 |
| Milestone | 菱形角标 | 中 |
| Card | 无规划角标 | 轻 |

思维视图中的自由样式继续生效；人生视图使用独立的语义视觉，不直接复制任意填充、旋转和尺寸。

### 7.3 空间操作规则

| 操作 | 修改内容 |
| --- | --- |
| 拖动节点 | `mindView.nodeLayout[x/y]` |
| 调整尺寸 | `mindView.nodeLayout[width/height]` |
| 树形布局 | Mind View Layout |
| 创建普通连线 | `relation.kind = mind` |
| 拖入 Section | Section membership |
| 建立规划父子 | 只能通过明确的规划操作创建 |

任何纯空间操作都不得修改 `planning.startDate/endDate/date/targetDate`。

---

## 8. 人生视图规格

### 8.1 不可妥协的坐标规则

```text
Y = dateToPosition(date)
X = lane / branch / adaptive path presentation
```

- Y 是时间事实。
- X 只表达分类、并行关系、内容分支和视觉节奏。
- Adaptive Life Path 未来只能改变 X，不能改变任何日期对应的 Y。
- 视觉碰撞解决不得挪动时间锚点；标签可以避让，但必须用连接线指回真实日期。

### 8.2 时间映射

采用日历 ordinal 映射，避免夏令时和时区导致一天不是固定毫秒数：

```ts
y(date) = dayOrdinal(date, baseDate) * pixelsPerDay
```

Stage 的真实区间为：

```ts
top = y(startDate)
bottom = y(addCalendarDays(endDate, 1))
```

这样单日 Stage 也拥有一天的真实高度。为了可点击而增加的最小命中区只能扩大 hit target，不能扩大数据带并制造虚假时间跨度。

### 8.3 节点表现

#### Goal

- 开始和目标日期都有：显示总览区间和进度。
- 只有目标日期：显示目标点和倒计时语义。
- 没有日期：显示在「待定日期」抽屉，不进入时间主轴。

#### Stage

- 必须显示为从开始到结束的区间带，不得退化为起点上的普通矩形卡片。
- 区间带长度表达时间跨度，标签在带侧边或内容区显示。
- 多个并行 Stage 自动分配泳道。

#### Milestone

- 使用菱形时间点。
- 名称和状态位于点旁边。
- 同日事件聚合，展开后查看完整列表。

#### Card

- 默认没有独立时间位置。
- 通过 Attachment 挂载到 Goal 或 Stage 后，显示在所属规划节点右侧内容分支。
- 默认只展开选中节点的主要 Card；其余以数量摘要显示，避免时间轴变成知识图谱。

### 8.4 三层布局

```text
时间标尺              规划泳道                    内容分支
2026.07 ─────── ●/区间 Stage ─────────────── Card
2026.08 ─────── │                               Card
2026.09 ─────── ●                               +3
```

桌面端建议列宽：

- 时间标尺：固定 88–112px。
- 规划区域：弹性宽度，支持多泳道。
- 内容分支：240–360px，可折叠。
- Inspector：280–340px。

具体像素作为视觉实现 token，不写入业务数据。

### 8.5 分轨与碰撞

分轨使用稳定的 interval partition：

1. 按开始日期、结束日期、稳定 ID 排序。
2. 选择最左侧可容纳当前区间的泳道。
3. 同一天结束与开始的区间视为重叠，因为结束日期包含在内。
4. 用户固定泳道只是一项展示偏好；发生冲突时显示提示并临时避让。
5. 标签避让不修改节点时间；必要时折叠成摘要。

### 8.6 时间缩放

| 粒度 | 适用场景 | 标签策略 |
| --- | --- | --- |
| 日 | 短期执行 | 显示完整标题和内容分支 |
| 周 | 阶段规划 | 显示主要节点与里程碑 |
| 月 | 年度规划 | 折叠普通 Card |
| 年 | 长期人生地图 | 只显示 Goal、重要 Stage、核心 Milestone |

缩放必须围绕指针或视口中心的锚定日期进行，缩放前后该日期保持在同一屏幕位置。

---

## 9. 核心交互

### 9.1 Card 转换为规划节点

入口：右键菜单、Inspector 或命令面板。

```text
转换为规划节点
├── 目标
├── 阶段
└── 里程碑
```

流程：

1. 用户选择类型。
2. Inspector 只显示该类型必填字段。
3. 校验通过后一次性提交 Command。
4. 节点 ID、内容、资源、Mind Layout 和 Mind Relation 全部保持不变。
5. 人生视图立即出现该节点；若日期未完整，则进入待定区域并给出明确提示。

### 9.2 取消规划属性

- 保留节点、内容、资源、思维位置和 Mind Relation。
- 删除该节点的 Planning Metadata。
- 删除其 `planning-parent` 关系。
- 如果存在被挂载 Card 或子规划节点，必须先显示影响预览：解除关系、重新挂到父节点或取消操作。
- 整个操作作为一个可撤销事务提交。

### 9.3 人生视图日期编辑

默认拖动 Stage 本体只选择节点。只有以下操作可以修改日期：

- 拖动顶部日期手柄：修改开始日期。
- 拖动底部日期手柄：修改结束日期。
- 开启「移动区间」后拖动区间带：整体平移，保持持续天数。
- 拖动 Milestone 专用手柄：修改单日日期。

交互必须具备：

- 实时日期预览。
- 按当前时间粒度吸附。
- `Shift` 临时关闭吸附。
- `Escape` 取消并恢复。
- Pointer Up 只提交一个 Command。
- 一次 Undo 完整恢复日期、泳道和受影响布局。
- 键盘提供等价的前移/后移一天或一个当前刻度操作。

### 9.4 视图间选择同步

- 共享 `selectedNodeIds` 只属于运行时，不持久化。
- 切换后目标节点不可见时，显示原因和可执行入口，例如“该节点尚未设置日期”。
- 不允许为了保持选中而给 Card 自动生成日期。

### 9.5 渐进式 Inspector

普通 Card：内容、资源、思维外观。  
Goal：增加领域、状态、开始、目标、进度、优先级。  
Stage：增加领域、状态、开始、结束、进度、优先级。  
Milestone：增加领域、日期、状态、优先级。

未选择规划类型前，不显示十几个空规划字段。

---

## 10. Command、History 与事务

### 10.1 目标

每张 Map Workspace 文档只有一套业务 History。用户在思维视图转换节点、在人生视图修改日期后，可以跨视图连续撤销。

### 10.2 事务边界

以下操作各产生一个事务：

- 创建、删除或转换一个节点。
- 一次文本编辑会话。
- 一次单选或多选移动。
- 一次 Stage 日期拖拽。
- 一次关系创建、重连或删除。
- 一次自动布局。
- 一次批量迁移导入不进入用户 Undo，但产生迁移回滚点。

Viewport、选中状态、悬停、拖动预览和缩放不进入业务 History。

### 10.3 命令结构

```ts
interface MapCommand {
  id: string;
  label: string;
  timestamp: number;
  apply(document: MapWorkspaceDocument): MapWorkspaceDocument;
  invert(before: MapWorkspaceDocument, after: MapWorkspaceDocument): MapCommand;
}
```

实现可以继续使用现有思维导图的差异快照策略，但必须保持：

- 大图拖动期间不连续写 Store。
- Pointer Up 才创建历史记录。
- 远端协作变更不混入本地 Undo 栈。
- 所有命令提交前经过不变量校验。

---

## 11. 持久化、同步与导入导出

### 11.1 独立数据域

建议新建：

```text
IndexedDB: smart-line-map-workspace
├── map_workspace_index
├── map_workspace_documents
├── map_workspace_assets
├── map_workspace_migration_receipts
└── map_workspace_sync_state
```

该数据库不属于当前全局 Workspace Store，因此：

- 不修改 `WORKSPACE_SCHEMA_VERSION = 7`。
- 不加入现有 workspace offline queue。
- 不让地图故障阻塞项目、Daily、EBB 或知识大盘。
- 地图备份和恢复采用独立入口。

### 11.2 保存语义

- 文档和索引通过同一串行写入队列保存。
- 自动保存可以合并短时间连续更新。
- 页面离开、文档切换和导出前必须 flush。
- 浏览器异常关闭时保留 emergency snapshot。
- Asset 引用计数按文档维护，迁移和删除后重新校验。
- 保存失败只在地图工作区内显示，不覆盖旧数据。

### 11.3 Schema 迁移

- `MapWorkspaceDocument.schemaVersion` 从 1 开始独立演进。
- 每次版本升级提供纯函数 migrator 和 fixture。
- 读取高于当前版本的文档时拒绝写入，并提示升级客户端。
- 归一化只能修复可证明安全的字段；不能静默丢弃未知规划数据。

### 11.4 同步

第一轮发布保持本地模式。同步仅在以下 Gate 通过后开启：

- 两浏览器同文档创建、移动、转换、日期编辑和删除一致。
- 断网编辑恢复无丢失。
- 图片资源先上传成功再发布引用。
- 删除与恢复有明确 tombstone 语义。
- 本地 History 与远端操作边界正确。
- 同账号文档目录发现、重命名和删除通过真实环境测试。

建议每张文档使用独立房间：

```text
map-workspace-{account-scope}-{document-id}
```

禁止把所有地图文档加入现有全局工作区 Room。

### 11.5 导入导出

- JSON 必须包含共享节点、Relation、两套 View State、Area 和 migration receipt 摘要。
- 图片导出继续支持重新内嵌，保证单文件迁移。
- 旧 Mind Map JSON 作为受支持的导入源，经预览后转换。
- 旧 Life Map 备份只能通过专用迁移器导入，不能伪装成普通 Map JSON。
- 导入前展示节点数、关系数、规划节点数、警告和冲突策略。

---

## 12. 旧数据迁移

### 12.1 文档对应规则

当前存在“多张思维导图”和“一份旧人生地图”，不能自动一一对应。冻结规则如下：

```text
每张旧 Mind Map 文档
  → 一张同名 Map Workspace 文档

一份旧 Life Map 数据
  → 一张新建的「人生规划（迁移）」Map Workspace 文档
```

旧 Life Map 不复制到每张思维导图，避免数据重复、ID 冲突和后续多份真相源。

如果用户希望把某张导图和「人生规划（迁移）」合并，后续提供带预览的“移动/复制到另一张地图”操作；该行为不是自动迁移的一部分。

### 12.2 Mind Map 映射

| 旧字段 | 新位置 |
| --- | --- |
| Document id/title/timestamps | MapWorkspaceDocument |
| MindMapNode id/content/resource | MapNode.content |
| x/y/width/height/rotation/style | mindView.nodeLayout |
| MindMapEdge | relation.kind = mind + mindView.edgeStyle |
| Section/Group/zOrder | mindView |
| viewport/settings | mindView |
| imageAssetId | 新 Asset Store，保留引用 |

迁移后必须保持节点和边 ID；只有跨文档合并发生冲突时才生成新 ID，并记录在 `idMap`。

### 12.3 Life Map 映射

| 旧实体 | 新模型 | 说明 |
| --- | --- | --- |
| LifeArea | PlanningArea | 保留名称、颜色、顺序 |
| LifeMapStage | StagePlanning.variant=`stage` | 保留起止、颜色、重要性和 area 关系 |
| LifeTheme | StagePlanning.variant=`theme` | 作为有时间跨度的主题 |
| LifeGoal kind=`goal` | GoalPlanning | 保留目标日期、状态、进度 |
| LifeGoal kind=`plan` | StagePlanning.variant=`project` | `start` 到 `targetDate` |
| LifeGoal kind=`phase` | StagePlanning.variant=`phase` | 用 planning-parent 连接原项目 |
| LifeEvent | MilestonePlanning | 保留日期、重要性和关联项目 |
| LifeFocus | StagePlanning.variant=`focus` | 保留区间与领域 |
| LifeMapNote | Card + Attachment/Reference | 日期锚点先保留在迁移侧车 |
| LifeReview | Card + 只读迁移详情 | v1 不伪造规划类型 |
| LifeSystem | 只读迁移实体 | 循环计划能力完成前不降级成普通 Stage |
| LifeSystemCheckIn | 只读迁移实体 | 与 System 一起保留 |

这张表是迁移规则，不代表第一版 Life View 必须编辑所有旧实体。无法完整编辑的内容必须明确显示“旧数据，只读”，不能静默丢失或假装已经覆盖。

### 12.4 迁移步骤

1. 读取旧源数据，只做归一化和校验，不写回。
2. 生成源数据 checksum 和不可变备份。
3. 在内存中生成目标文档和 ID Map。
4. 执行目标模型不变量校验。
5. 比较实体数量、日期、文本、资源和关系。
6. 显示迁移报告和所有 warning。
7. 用户确认后写入新数据库。
8. 重新读取新文档并计算目标 checksum。
9. 通过后写入 Migration Receipt。
10. 旧入口切换为只读；旧存储保持原样。

迁移器必须幂等：对同一 source checksum 重复执行时，不得生成第二份无提示副本。

### 12.5 回滚

- 功能开关关闭后，应用继续打开未修改的旧页面和旧 Store。
- 新数据库损坏不能影响旧数据库。
- 回滚不反向覆盖旧数据；如需把新编辑导回旧系统，必须使用单独的受控导出，不做隐式双写。
- 灰度期禁止双写，因为两种模型无法保证所有语义可逆。

### 12.6 旧数据退役 Gate

只有同时满足以下条件，才能讨论删除旧 Store：

- 所有用户迁移成功率和失败原因可见。
- 节点、日期、关系、资源、System、CheckIn、Review 均有完整去向。
- 备份导出与全新环境恢复通过。
- 回滚演练通过。
- 至少两个稳定发布周期未出现阻断级迁移问题。
- 产品明确确认不再需要旧只读页面。

即便通过，也优先归档旧数据，不直接物理删除。

---

## 13. 代码架构

### 13.1 目标目录

```text
src/mapWorkspace/
├── domain/
│   ├── model.ts
│   ├── relations.ts
│   ├── invariants.ts
│   ├── commands.ts
│   └── history.ts
├── persistence/
│   ├── repository.ts
│   ├── assets.ts
│   ├── schemaMigration.ts
│   └── emergencySnapshot.ts
├── migration/
│   ├── mindMapImporter.ts
│   ├── lifeMapImporter.ts
│   ├── migrationReport.ts
│   └── fixtures/
├── selectors/
│   ├── mindProjection.ts
│   └── lifeProjection.ts
├── views/
│   ├── mind/
│   └── life/
├── sync/
├── testing/
└── MapWorkspace.tsx
```

### 13.2 依赖方向

```text
domain ← persistence
domain ← selectors ← views
domain ← migration adapters → legacy read-only types
domain ← sync
```

规则：

- `domain` 不导入 React、Zustand、IndexedDB、Liveblocks、`src/mindMap` 或 `src/lifeMap`。
- 旧模块之间仍禁止互相导入。
- 只有 `migration/` 可以读取旧模型，并且不得写回旧 Store。
- 新视图读取 selector projection，不直接拼接旧 Store 数据。
- 日期与布局算法保持纯函数，可在无 DOM 环境下测试。

### 13.3 渐进复用

不一次性重写现有思维画布。优先顺序：

1. 新领域模型通过 selector 投影成现有 Renderer 可消费的形状。
2. 保持现有 Canvas/WebGL/Worker、命中检测和导出实现。
3. 把现有 Mind Store 的文档职责逐步移到 Map Workspace Store。
4. 只有在性能和回归 Gate 通过后，旧 `src/mindMap` 壳层才退役。

人生视图同样复用已经验证的时间映射、区间分轨、碰撞和窗口化纯逻辑，但不直接绑定旧 Life Store。

---

## 14. 分阶段实施计划

每个 Phase 必须独立通过测试和回滚检查；不能以“后续阶段会修”为理由越过 Gate。

### Phase 0：架构决策与基线冻结

交付：

- 确认本方案取代“永久隔离”的产品方向，但保留迁移期隔离。
- 记录当前 Mind Map、Life Map、全局 Store 的测试与性能基线。
- 添加功能开关，默认关闭新 Map Workspace。
- 固化旧数据 fixture 和真实匿名化样本。

Gate：不修改任何旧数据，所有现有测试保持通过。

### Phase 1：领域模型与独立 Repository

交付：

- `MapWorkspaceDocument`、Planning 联合类型和 Typed Relation。
- 不变量校验、归一化、schema migrator。
- 新 IndexedDB repository、index、asset 和 emergency snapshot。
- Command/History 基础。

Gate：模型、日期、循环检测、删除级联和持久化恢复单元测试全部通过。

### Phase 2：思维视图投影与功能等价

交付：

- 把新文档投影到现有思维 Renderer。
- 新文档内完成节点、边、Section、Group、历史和导出。
- 旧 Mind Map 导入预览和只读 dry-run。

Gate：当前思维导图 Release 1/2 能力与 5,000 节点 Gate 不回退。

### Phase 3：Planning Metadata 与转换闭环

交付：

- Goal、Stage、Milestone Inspector。
- Card 转换、取消规划、Planning Parent 和 Attachment。
- 待定日期区域。
- 跨视图共享选择与统一 Undo。

Gate：转换、撤销、重做、保存、重新打开后结果一致。

### Phase 4：只读人生视图

交付：

- 严格纵向时间映射。
- Goal、Stage 区间、Milestone 点和内容分支。
- 分轨、聚合、折叠、四级时间缩放和窗口化。
- 直线 Life Path。

Gate：任何 X 变化都不改变日期；所有时间位置可逆且视觉回归通过。

### Phase 5：人生视图编辑

交付：

- 日期手柄、区间平移、吸附、预览和取消。
- 键盘等价操作。
- 日期编辑进入同一 History 和 Persistence。

Gate：一次拖动只有一个历史事务，误拖不会修改日期，跨视图 Undo 正确。

### Phase 6：旧数据迁移器

交付：

- Mind Map 批量迁移。
- Life Map 到「人生规划（迁移）」文档。
- 校验报告、checksum、ID Map、warning 和不可变备份。
- 不支持实体的只读详情。

Gate：全部 fixture 100% 可解释；任何未映射字段都产生明确 warning 或进入保留侧车。

### Phase 7：受控 Beta

交付：

- 新入口只对测试用户开启。
- 迁移前备份、迁移后核对和一键回到旧入口。
- 迁移及运行错误可观察但不上传正文等敏感内容。

Gate：真实设备、断电恢复、浏览器升级、低存储空间和大文档场景通过。

### Phase 8：默认切换与旧页面只读

交付：

- 主入口改为地图工作区。
- 旧 Mind Map 和 Life Map 页面只读保留。
- 新创建内容只进入 Map Workspace。

Gate：无阻断级数据问题，并完成全量备份恢复演练。

### Phase 9：旧丰富语义补齐

交付：

- 根据产品决策补齐 System、CheckIn、Review 等能力，或明确归档策略。
- 支持跨地图移动/复制与冲突预览。
- 评估 Goal 自动聚合，但默认仍尊重手动值。

Gate：旧人生地图所有仍保留的数据都有可用去向。

### Phase 10：Adaptive Life Path 与旧系统退役评审

交付：

- Adaptive Path 只改变 X 的几何实现。
- 旧 Store 退役报告、回滚报告和归档方案。

Gate：曲线不改变时间精度；退役 Gate 全部满足后另行批准删除。

---

## 15. 测试与验收

### 15.1 领域单元测试

- Card/Goal/Stage/Milestone 的合法与非法状态。
- Stage 起止日期和单日区间。
- Goal 无日期、仅目标日期和完整区间。
- `planning-parent` 单父约束和循环检测。
- Attachment 约束和删除级联。
- 取消规划时的依赖预览。
- 日期 ordinal 的时区和夏令时边界。
- 文档 normalize、schema upgrade 和高版本拒绝写入。
- Command invert、事务合并、Undo/Redo。

### 15.2 思维视图回归

- 节点、边、Section、Group、图片、Markdown、LaTeX、URL。
- 复制粘贴、导入导出、自动布局和搜索定位。
- 思维拖动前后 Planning Metadata 深比较完全相同。
- 离开页面后快捷键、Worker、RAF 和 Pointer Capture 清理。

### 15.3 人生视图测试

- 日期到 Y 可逆。
- X、泳道和 Adaptive Path 不改变日期。
- 单日 Stage 不为零高度。
- Stage 重叠稳定分轨。
- 同日 Milestone 聚合。
- Card 展开与折叠不改变时间锚点。
- 标签碰撞避让不改变真实节点位置。
- 日、周、月、年缩放保持锚定日期。
- 日期拖动预览、取消、提交和 Undo。

### 15.4 迁移测试

- 每种旧实体至少一份 fixture。
- 软删除、缺失可选字段、非法日期、孤儿引用和重复 ID。
- 源/目标数量与 checksum 报告。
- 重复运行幂等。
- 中途写入失败不会留下可被误打开的半成品文档。
- 图片 Blob、内联图片和缺失资源。
- 旧数据始终保持未修改。

### 15.5 性能 Gate

沿用现有思维导图基线：

- 500 节点拖动和缩放目标 60 FPS，Fit All < 100ms。
- 2,000 节点中位帧率不低于 45 FPS，本地打开 < 1.5s。
- 5,000 节点可打开、保存、缩放、定位和使用 Worker 布局。

人生视图沿用 v14 数据集：

- 10 年、100 Stage、300 Project、500 Annotation 平滑滚动。
- 20 年、500 Project、1,000 Annotation 无明显交互阻塞。
- 50 年、2,000 Annotation 的 DOM 数量必须随视口窗口化，不随总量线性常驻。

新模型和 selector 不得使现有 5,000 节点基线退化超过评审允许范围；任何明显退化必须先优化再进入下一阶段。

### 15.6 响应式与无障碍

- 1440×1000：完整三栏与 Inspector。
- 820×1180：折叠工具栏，Inspector 使用抽屉。
- 390×844：单泳道阅读，编辑进入底部 Sheet。
- 所有图标按钮有名称和键盘焦点。
- 日期手柄可以键盘操作并播报当前日期。
- 不以颜色作为规划类型和状态的唯一表达。
- 支持 reduced motion 和高对比度。

### 15.7 一句话验收标准

> 同一个节点能够在思维视图自由移动、在人生视图严格按时间呈现；任何视图操作都只修改其负责的数据，保存、撤销、迁移和回滚均不产生第二份真相源。

---

## 16. 风险与缓解

| 风险 | 后果 | 缓解 |
| --- | --- | --- |
| 把所有关系塞进 `parentId` | 思维层级与规划层级互相破坏 | Typed Relation 与独立约束 |
| 重写思维 Renderer | 性能与编辑能力大幅回退 | selector 投影、渐进复用、性能 Gate |
| Stage 先实现成普通卡片 | 后期区间布局和拖拽返工 | 第一版即使用真实区间几何 |
| 默认拖动修改日期 | 高频误操作 | 专用手柄、编辑模式、预览、Escape、Undo |
| Life Map 复制进每张导图 | 多份规划数据和无法合并 | 单独迁移文档，后续显式移动/复制 |
| 旧丰富实体被粗暴降级 | System、Review 等数据丢失 | 只读侧车与退役 Gate |
| 双写新旧 Store | 模型不可逆导致漂移 | 单向迁移，旧 Store 冻结只读 |
| 修改全局 workspace schema | 扩大故障半径 | 独立 Map Workspace 数据库与房间 |
| UTC 毫秒计算日期 | 跨时区错一天 | 本地日历 ordinal 与统一日期工具 |
| 大图统一 History 快照过重 | 内存和交互退化 | 差异记录、事务合并、拖动结束提交 |

---

## 17. 冻结决策清单

| 编号 | 决策 |
| --- | --- |
| D-01 | 产品名称使用「地图工作区」，包含思维视图和人生视图 |
| D-02 | 一个节点模型，多套视图状态，多种有类型关系 |
| D-03 | Area 是分类目录，不是第一版节点类型 |
| D-04 | Life View 的 Y 永远由日期决定 |
| D-05 | Stage 从第一版开始就是时间区间 |
| D-06 | 普通 Card 默认没有时间，挂载后从属于规划节点 |
| D-07 | 第一版进度手动维护，不自动聚合 |
| D-08 | 旧 Life Map 迁入独立的「人生规划（迁移）」文档 |
| D-09 | 新数据域使用独立数据库，不修改全局 workspace schema |
| D-10 | 迁移期不双写，旧系统先只读后退役 |
| D-11 | Adaptive Life Path 延后，且未来只改变 X |
| D-12 | System、CheckIn、Review 未完整覆盖前不得删除旧数据 |

---

## 18. 开工前检查表

- [ ] 产品确认本方案的冻结决策。
- [ ] 更新现有“独立思维导图”规格中的长期隔离结论，保留迁移期护栏。
- [ ] 建立 `map-workspace` 功能开关，默认关闭。
- [ ] 保存当前 Mind Map 与 Life Map 测试、性能和视觉基线。
- [ ] 准备旧数据匿名化 fixture 和损坏数据 fixture。
- [ ] 先实现纯领域模型、校验器和迁移报告，不先改 UI。
- [ ] 新 Repository 完成原子保存、失败恢复和高版本拒绝写入。
- [ ] Mind Renderer 投影通过后再开发 Planning Inspector。
- [ ] 只读 Life View 通过时间几何 Gate 后再开放拖拽编辑。
- [ ] 迁移器完成 checksum、幂等、备份和回滚后再进入 Beta。
- [ ] 旧 Store 的任何删除另立评审，不与默认切换同一版本执行。

---

## 19. 最终产品定义

SmartLine Map Workspace 不是把思维导图和人生地图并排放在一个页面，也不是让两个 Store 在后台互相同步。

它是：

> 一份节点内容、一组明确的规划属性和关系，在空间视角与时间视角中的两种专业投影。

实现上必须始终坚持：

```text
One Node Model
     ↓
Typed Relations
     ↓
Mind Projection + Life Projection
     ↓
One Command / History / Persistence per Document
     ↓
Independent Map Domain
```

只有同时做到“共享数据不分裂”和“视图职责不串线”，这次统一才算成功。
