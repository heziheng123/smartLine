# 任务时间追踪 设计与需求文档

> 本文档梳理「每日安排任务计时 + 项目时间汇总 + 时间轴可视化」三合一的实现方案。**不修改任何代码**,仅给出设计蓝图与落地点。
> 
> v2 — 重新定位为「任务时间追踪」而非「番茄钟」;补充数据迁移 / 触摸防误触 / 项目语义优化 / 隐私 / 性能策略。
>
> v3 — 用户确认事项落地:产品名定为「任务时间追踪」;CompletionDialog 三层结构(主选项 + 折叠次要 + 二次确认)作为 v1 强制规格;省电模式 + 自动 tick 自适应 v1 默认开启;番茄钟 / 本地加密 / 服务端校验 / 多端接管 UI 均不进 v1。

---

## 1. 背景与目标

### 1.1 用户原始需求

在每日安排(Daily Schedule)界面,任务卡片上需要:

- 一键 **开始计时** / **停止计时**。
- 同一任务可分段计时(多次 start / stop 累加)。
- 首次 stop 后弹出「是否完成任务」对话框:
  - 选择「是」→ 标记任务完成,并结束对该任务的计时。
  - 选择「否」→ 任务保持未完成状态,但保留该段计时数据,可继续对该任务计时。
- 所有计时段都绑定到一个 **项目(Project)**,可按项目汇总时间。
- 提供 **时间轴可视化** 工具,可以直观看到每天 / 每周 / 每个项目的投入分布。

### 1.2 产品定位(关键调整)

**定位为「任务时间追踪」(Task Time Tracking),而非「番茄钟」。**

二者差异:

| 维度 | 番茄钟 | 任务时间追踪 |
|---|---|---|
| 目标 | 强目标(25 min) | 弱目标(随时开关) |
| 结束 | 强结束(强制休息) | 弱结束(用户决定) |
| 反馈 | 铃声 + 提示 | 累计时长显示 |
| 状态 | 工作中 / 休息中 | 计时中 / 空闲 |

数据模型两者兼容(都基于 session),但 UI 不引入「工作 / 休息段循环」,避免 30% 的状态复杂度。**番茄钟在 v1 不实现**(产品定位明确,用户也已确认 v1 不需要工作 / 休息段循环)。如未来需要,可基于现有 session 数据结构独立扩展为 v2 模块,不占用 v1 工期。

### 1.3 设计目标

1. **准确性**:移动端切到后台也能正确累计时长(时间戳 + 可见性 API)。
2. **零侵入**:不改动现有 task / block / timeSlot 模型基础,只在其上叠加新数据层。
3. **防误操作**:用户高频操作(start / stop)必须 500ms 冷却 + 视觉去抖。
4. **可扩展**:未来可替换 / 复用为「自动检测空闲」或「导入 Toggl 等外部源」。
5. **可同步**:与现有 Liveblocks + IndexedDB 协同方案保持一致。
6. **可撤销**:start / stop 操作有独立撤销栈,默认不污染主 Ctrl+Z 流。
7. **可迁移**:数据带 schemaVersion,支持零停机演进。

### 1.4 非目标

- **不做番茄钟工作 / 休息循环(v1 明确不实现,非 P2 候选)**。
- 不做服务器侧计时同步。多端冲突以本地时间戳为准。
- 不做复杂的「离开页面检测」类强制 UI(如全屏警告),仅保证后台冻结 / 切回前台时差值正确。
- **不做客户端加密(v1 明确不实现)**。P2 候选,但当前阶段优先保证功能完整而非安全增强。

## 2. 关键技术问题与对策

### 2.1 后台冻结导致的计时漂移

#### 现象
iOS Safari、Android Chrome 在以下情况会冻结 setInterval / setTimeout:

- 标签 / 应用进入后台但进程未被杀。
- 屏幕锁定。
- 长时间无交互。

冻结期间,即使 setInterval 仍存在,也只会按 1Hz 触发,导致 UI 显示秒数严重滞后。极端情况下会被完全冻结直至切回前台。

#### 对策:以时间戳为准 + 可见性 API

代码层面使用「绝对时间戳」而非「相对计数」。startedAt 在每次 start 时记录,accumulatedMs 在 stop / 暂停时累加 now - lastResumeAt。切回前台触发 visibilitychange → visible 回调,立即 push 当前段累积时间到 store。UI 通过 React 订阅 store 刷新秒数,无需依赖 setInterval。

### 2.2 持久化与崩溃恢复

#### 软崩溃:浏览器进程被杀 / 突然断网

- 在 IndexedDB 中冗余存「当前活跃 session 对象」(startedAt + sourceId + lastResumeAt)。
- 启动时 readAll(),找出 endedAt === null 的 session,进入 orphan 检测流程(2.3)。

#### 硬崩溃:数据写入前断电

- 每次 start / stop 操作同步写入 IndexedDB,无延迟。
- 撤销栈写入是 debounce(800ms),但 active session 状态必须立即落盘。

### 2.3 Orphan Session 自适应检测

固定 8 小时阈值太武断(跨时区飞行、夜间忘记关计时会误判)。改为:

- **基线**:取最近 30 天内所有 session 的时长,计算 P95(95 分位数)。
- **软上限**:4 小时(或 P95,取较大值) → 静默归档、底部弹小卡片「以下会话异常,请确认」。
- **硬上限**:8 小时(或 P95 × 1.5,取较大值) → 必弹对话框,强制用户决策。
- **超长**:24 小时以上 → 标记为「长时间未结束」,选项变为「补结束于 X」 / 「丢弃」。

设置页提供开关「禁用 orphan 检测」(信任自己永远不会忘记关)。

### 2.4 触摸防误触发

移动端 250ms tick + iOS Safari 300ms tap delay 容易触发 race condition(双击触发两次 start)。对策:

- useTimerAction hook 封装 start / stop / resume,内置 500ms 冷却(disabled 状态 0.3s 视觉反馈)。
- **抖动检测**:同一 sourceId 1 秒内多次 start / stop,合并为一条 session(开发期 console.warn,生产期静默)。
- TimerButton 组件在 loading 期间禁用 pointer-events,避免快速连点。

### 2.5 与现有操作栈协同

打开 / 关闭计时涉及 store 写入,会与已有 recordOperation + registerUndoExecutor 流程冲突。本设计要求:

- 新的 OperationKind:	ime-tracker.start / 	ime-tracker.stop / 	ime-tracker.edit。
- **撤销隔离**:这些操作进入独立的「会话历史」面板,默认不暴露在主 Ctrl+Z 流里(避免污染日常操作)。
- Ctrl+Z 历史里只显示「任务完成」等真正数据级操作,start / stop 隐藏在「会话历史」入口。

## 3. 数据模型

### 3.1 核心类型(带 schemaVersion)

TimerSession 数据结构(TS 草案):

  interface TimerSession {
    schemaVersion: 1;               // 数据迁移版本,首版固定 1
    id: string;                     // nanoid,全局唯一
    sourceId: string;               // 来自 src/components/dailySchedule/sourceIds.ts 的稳定 ID
    projectId: string;              // 关联到 ProjectDescriptor.id(可空 → 归为「未分类」)
    taskLabel: string;              // 当时显示的任务标题快照(冗余字段,便于离线展示)
    startedAt: number;              // 整段(可包含多个 paused 段)起始时间戳(epoch ms)
    lastResumeAt: number;           // 当前活跃段的起始时间戳(暂停时被替换)
    accumulatedMs: number;          // 暂停 / 暂停前已确认累积毫秒数(暂停时累加 now - lastResume)
    endedAt: number | null;         // 整段结束时间戳;null 表示正在进行中
    pauses: Array<{                 // 暂停历史(可选,用于精确回溯)
      pausedAt: number;
      resumedAt: number | null;     // null 表示当前正在暂停(本期不做手动暂停,预留字段)
    }>;
    note?: string;                  // 用户可选备注
    completionSource:               // 标记任务完成的来源(用于统计与决策)
      TimerCompletionSource;        // timer(来自对话框) | manual(用户直接勾) | auto(自动规则)
    completedAt: number | null;     // 任务完成时间
    origin: TimerOrigin;            // daily-schedule | block | review | manual
    tags?: string[];                // P2:用户打标签,用于统计筛选
    createdAt: number;
    updatedAt: number;
  }

  type TimerCompletionSource = timer | manual | auto;
  type TimerOrigin = daily-schedule | block | review | manual;

### 3.2 迁移机制(Migrator)

每个 schemaVersion 对应一个 migrateTimerSession(session): TimerSession 纯函数,链式应用。

  const migrations = {
    v1_to_v2: (s) => ({ ...s, schemaVersion: 2, completionSource: s.completedAt ? timer : null }),
    v2_to_v3: (s) => ({ ...s, schemaVersion: 3, tags: [] }),
    ...
  };

- 启动时 readAll(),对每条 session 跑迁移链,直到 schemaVersion === LATEST。
- 单元测试覆盖所有版本组合(尤其是降级 → 升级 → 降级)。
- 老版本字段以 legacy_ 命名保留,直至稳定 3 个版本后再删除(避免回滚风险)。

### 3.3 与现有 sourceId 的关系

参照 src/components/dailySchedule/sourceIds.ts 已有的 buildProjectBlockSourceId / buildReviewTaskSourceId,session.sourceId 直接复用,保证与 dailySchedule 的任务一一对应。

对于「未在 daily schedule 中的任务」(如直接点某个 block 卡片的计时按钮),生成 sourceId 规则沿用 block:<blockId>,便于将来支持跨视图统计。

### 3.4 持久化字段

新增一个 IndexedDB ObjectStore:timer_sessions,主键 id,二级索引:

- by_sourceId(sourceId)
- by_projectId(projectId)
- by_startedAt(startedAt)
- by_schemaVersion(schemaVersion) — 便于迁移期数据审计

同步:在 store 的 persistence 中添加 timeTracker 字段,Liveblocks 通道复用 room 的 storage 子层(结构与现有 timelineData 类似),保证多端最终一致。

## 4. Store / Hook 设计

### 4.1 useTimerStore(Zustand)

新增独立 Zustand store:src/store/timer.ts。

状态切片:

  TimerState = {
    schemaVersion: 1;                          // 当前 store 持有的最高 schema 版本
    sessions: Record<string, TimerSession>;
    activeSessionId: string | null;            // 全局同时仅允许一个进行中的 session
    lastTickAt: number;                        // 用于 UI 主动轮询,毫秒
    startedAtActive: number | null;            // 当前活跃 session 的 startedAt(冗余以便快速读)
    dismissedOrphanIds: Set<string>;           // 用户已确认的 orphan session ID(避免重复弹)
    settings: {
      tickIntervalMs: 250 | 1000 | 5000;      // 桌面 = 250,移动 = 1000,powerSave = 5000;v1 默认开启自动检测
      powerSaveMode: boolean;                  // v1 默认 true(开启),可在设置中关闭
      orphanDetectionEnabled: boolean;         // 默认 true
      completionDialogPolicy:                  // 决定 Dialog 何时弹出
        first-stop-only                        // 只在首次 stop 弹
        | every-stop;                          // 每次 stop 都弹
    };
  }

动作:

  - startTimer({ sourceId, projectId, taskLabel, origin })  → 创建新 session 或 resume 已结束的
  - stopTimer()  → 将 activeSession.endedAt = now,accumulatedMs += now - lastResume,activeSessionId = null,弹「是否完成」对话框(根据 policy)
  - resumeTimer(sessionId)  → 从已有 session 继续(endedAt = null,lastResume = now)
  - completeTask(sessionId, source: completionSource)  → 同时设置 session.completedAt 与对应 task 的 doneAt
  - reSync()  → 切回前台 / 启动时调用,根据 startedAt 与 now 差值修正 UI
  - updateNote / delete / merge / split(可选)
  - detectOrphans()  → 自适应阈值扫描,返回待处理列表
  - confirmOrphan(sessionId, decision)  → 用户决策 orphan session(保留 / 补结束 / 丢弃)
  - migrateAllSessions()  → 启动时跑迁移链

约束:

- activeSessionId 全局唯一。startTimer 时若已有 active,自动 stop 旧 session(合并到现有 session,生成新 ID)。
- 所有写入必须经过 operationStack(recordOperation)才能进入 store。
- 移动端自动降低 tickIntervalMs(powerSaveMode 时再降到 5000ms)。

### 4.2 useTimerTick(React Hook)

调用形态:const { now, elapsedMs, isActive, isPowerSave } = useTimerTick(sessionId);

实现要点:

- 仅在 isActive 为 true 时启动 setInterval 刷新 now,间隔从 settings 读取。
- 监听 visibilitychange,visible 时立刻设置 now = Date.now(),然后继续 interval。
- sessionId 为 null 时 hook 直接返回。
- powerSaveMode 下不启动 tick,仅依赖 visibilitychange 事件驱动(精度足够,适合纯后台)。

### 4.3 useTimerAction(防误触封装)

  const { start, stop, resume, isDisabled } = useTimerAction(sourceId);

- 内部 500ms 冷却,通过 useRef + setTimeout 实现。
- 抖动检测:1 秒内重复 start / stop,合并为单次操作(开发期 console.warn)。
- 暴露 isDisabled 给 UI 控制按钮 disabled 状态和视觉反馈。

### 4.4 与 timelineStore / dailyScheduleStore 的边界

时间追踪 store 不持有任务定义或 daily schedule 数据。它只通过 sourceId 引用任务。任务完成时调用现有 useStore.getState().updateTaskDone / recordOperation({ kind: task.complete, source: completionSource, ... }) 完成跨 store 协同。

completeTask 流程:

  1. sessionStore.completeTask(sessionId, source)  → 写 session.completedAt + completionSource
  2. timelineStore.recordOperation({ kind: task.complete, taskId, source, sourceId })  → 写 task.doneAt
  3. 触发 dailySchedule 视图重新计算(已订阅 task 状态)

## 5. UI 集成落地点

### 5.1 DailyScheduleView / DailySlotSection

- 在每个 ScheduledItemCard(参考 DailySlotSection 的渲染)中,根据 scheduledItem.sourceId 计算 projectId(复用 projectAppearance.ts),并加入 TimerButton 组件:
  - 默认状态:显示 + 图标,点击调 startTimer。
  - 计时中:activeSession.sourceId === 当前 sourceId,显示方块图标与累计秒数,点击调 stopTimer。
  - 按钮 disabled 状态由 useTimerAction 提供。
- 卡片右下角或底部加入「累计 1h23m」文字,订阅 useTimerTick 实时刷新。
- 已结束 session 的总时长通过 selector selectTotalForSource(sourceId) 给出。

### 5.2 CompletionDialog(v1 强制规格)

**v1 规格确认**:主弹窗只显示两个主选项 + 一个折叠入口,「放弃」操作必须经过「▽ 更多选项 → 二次确认」两步才能触发。这是 v1 强制要求,不允许在 v1 中回归到「平铺三选项」或「放弃放在主弹窗」。

原设计三选项「已完成 / 继续计时 / 放弃当前段」存在严重误操作风险。新设计:

**主弹窗(默认 visible):**

- 文案:「是否将当前任务标记为已完成?」
- 选项:
  - **已完成**(主按钮,绿色):调 completeTask + 关闭 dialog。
  - **继续计时**(次按钮,蓝色):关闭 dialog,保留 activeSession,UI 切回「停止」状态。
  - **更多选项**(▽,折叠):展示次要操作,避免误触。

**次要操作(展开后):**

- **保留但不计入今日统计**(灰色):session 落库但标记 ignoreInStats = true,统计视图排除。
- **补结束于...(时间选择)**:让用户输入预计结束时间,用于快速修正误操作。
- **放弃当前段**(红色,需二次确认):必弹二次确认对话框,输入「我要放弃」才能点击。

新字段:TimerSession 加 ignoreInStats?: boolean,默认 false。统计时过滤 ignoreInStats === true 的 session。

### 5.3 TimerBar(浮动条 — 双形态)

新增一个全局悬浮组件 src/components/timer/TimerBar.tsx,使用「小贴片 + 完整条」双形态:

**小贴片模式(默认):**

- 右下角 24×24 圆形(Things 3 / OmniFocus 风格)。
- 显示:项目色 + 进度环(已计时 / 总目标,目标可配置或留空)。
- 点击展开完整 TimerBar。

**完整模式(展开或设置中设为默认):**

- 顶部或右侧小卡片。
- 显示:计时图标 + 任务标题 + 累计时间 + 暂停按钮(本期暂停 = 软关闭,即同「停止」)。
- 点击展开项目菜单(查看当前会话详情、加备注、跳转到对应任务)。

设置项:用户可锁定为「完整模式」(始终展开)或「贴片模式」。

### 5.4 任务列表卡片的「完成」语义差异

「完成」状态有三种来源,UI 应当区分标记:

- ✓ 来自计时器(小图标角落):说明用户用时间追踪完成了任务,统计归类 timer。
- ✓ 来自手动勾选(普通打勾):说明用户没计时,直接标记完成,统计归类 manual。
- ✓ 来自自动规则(预留):暂未启用。

任务卡片右下角显示小图标,鼠标 hover 提示「完成于 14:23,通过计时器」。

## 6. 统计与时间轴视图

### 6.1 项目时间汇总

新增视图入口:Toolbar 增加一项 「项目时间」。路由复用现有 module 概念(AppModule 新增 time-tracker)。

页面布局:

- 左侧:项目列表(下拉或树形),点击项目后右侧展示该项目的会话明细。
- 右侧:表格 / 卡片视图,列出该项目的所有 session,字段:日期、任务标题、累计时长、备注、完成状态(按钮区分来源)、completionSource。
- 顶部筛选:日期范围(今日 / 本周 / 本月 / 自定义)、来源(每日安排 / 块 / 复盘)、是否完成、是否忽略(ignoreInStats)。
- 数据概览条:今日总时长、本周总时长、对比昨日 / 上周同比变化(箭头 + 百分比)。

### 6.2 时间轴(Timeline) — 增强

新增组件 src/components/timer/TimelineView.tsx,作为 time-tracker 视图下的子标签。

**基础视图:**

- 横轴:时间(默认当天 0:00-24:00,可切换为周 / 月)。
- 纵轴:任务 / 项目,每个 sourceId 一行。
- 横向条块:session 区间,从 startedAt 到 endedAt,颜色按 projectId 分组。
- 当前正在进行中的 session 用条纹动画表示。
- 鼠标 hover 显示:任务标题、开始时间、结束时间、时长、备注、完成状态、completionSource。
- 点击 bar 可跳转到对应任务卡片。

**增强视图(路线图):**

- **聚合视图**:按 1 小时 / 15 分钟粒度聚合,显示为甘特图式密度图(density map)。横向条粗细 = 该时段累计时长。
- **对比模式**:今天 vs 昨天 vs 上周同日,堆叠显示,直观看出「今天是否比平时更专注」。
- **专注度热力图**:横轴时间(小时),纵轴项目,颜色深浅 = 该时段的累计时长。比单纯条块更直观,适合周 / 月视图。

实现:

- 使用 d3-scale / d3-time(项目已依赖 d3)做坐标轴。
- 滚动 / 缩放使用 framer-motion 做平滑过渡。
- 大数据量虚拟化:超过 1000 条 session 时,只渲染可视区域 + 上下各 50 条缓冲。
- 性能:聚合 / 对比模式用 Web Worker 预处理,避免主线程卡顿。

### 6.3 数据导出(可选,延后)

- 提供 CSV 导出按钮:列 = date, sourceId, projectId, taskLabel, startedAt, endedAt, accumulatedMs, note, completed, completionSource, ignoreInStats, schemaVersion。
- 后续可拓展为 ICS(日历)导入 / 导出。

### 6.4 隐私与数据所有权

- 设置页提供「清空所有计时数据」按钮,二次确认(输入「确认清空」才能点)。
- 导出时明确告知「导出的 CSV 包含哪些字段」,避免潜在合规问题。
- P2:本地加密(基于 Web Crypto API,用户级密码),不影响当前阶段。

## 7. 同步与协作

### 7.1 Liveblocks

时间追踪数据对协作语义较敏感(避免 A 在手机上开始计时、B 在电脑上误以为 A 已经完成)。处理策略:

- activeSessionId 字段在 Liveblocks 中以「正在协作中的用户」的 storage 形式存,每端写入时检查 timestamp,以 startedAt 较新者覆盖。
- 跨设备冲突时,UI 在 TimerBar 上显示「另一端正在计时同一任务」并允许用户接管 / 取消。
- 接管 = 把 activeSession 的 createdBy 改为当前用户;取消 = 关闭另一端的 active session。

### 7.2 IndexedDB

主表 sessions 持久化参考 timelineData 的 createCoalescedPersistence,采用 800ms debounce 写入。

崩溃恢复:启动时 readAll(),找出 endedAt === null 且符合 orphan 条件的 session(参见 2.3),弹 toast / 对话框让用户决策。

## 8. 测试计划

### 8.1 单元测试

- time-tracker/store:startTimer / stopTimer / resumeTimer / completeTask 状态机正确性。
- 时间累加:模拟 visibility 切换 + setInterval 跳过,验证 accumulatedMs 与真实 elapsed 一致。
- Undo / Redo:每次 start / stop 操作能正确撤销(在独立面板)。
- 迁移链:覆盖所有 schemaVersion 组合,确保降级 → 升级 → 降级不丢字段。
- Orphan 检测:P95 计算正确,边界场景处理合理(无历史数据时 fallback 到固定阈值)。

### 8.2 集成测试

参考 tests/agent/* 的 vitest 模式新增 tests/timer/*。

- DailyScheduleCard 点击开始 → store 中出现 activeSession,卡片 UI 切换。
- 弹「是否完成」对话框 → 选已完成 → store 中 session.completedAt 有值 + 任务 done + completionSource = timer。
- 任务卡片直接勾选完成 → completionSource = manual。
- 同任务再次 start → 新 session 创建并追加到 sessions 数组。
- 跨日期:把 today 的 session 在 tomorrow 又点 start,store 中应出现 2 条 session。
- 抖动合并:1 秒内连点 5 次 start,store 中只创建 1 条 session。
- Orphan 流程:模拟 10 小时前开始的 session → 启动时弹确认对话框。

### 8.3 移动端手动测试

- iOS Safari:开始 → 锁屏 5 分钟 → 解锁 → 累计时间显示 = 5 分钟整。
- Android Chrome:开始 → 切到其他 app 1 小时 → 切回 → 累计时间 = 1 小时整。
- 多 tab:tab1 开始,tab2 暂停 / 启动同一任务,tab1 需收到事件并更新 activeSessionId。
- 触摸防抖:在 DailyScheduleCard 上快速连点 5 次,最终只有 1 条 session。
- 省电模式:开启 powerSaveMode,后台 30 分钟后再切回,时间正确。

## 9. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 浏览器彻底杀死后台进程 | session 永远无法在结束态被记录 | 启动时 orphan 检测 + 用户确认 + P2 可选服务端 |
| 多端同时计时同一 sourceId | 重复累计 | Liveblocks 锁 + 最近写入胜出 + 接管 UI |
| 大量历史 session 导致首屏渲染慢 | UI 卡顿 | 列表虚拟化 + 按需加载 + Worker 预处理 |
| 服务端无校验 | 任意客户端可伪造长时长 | 第一阶段不做服务端校验,记录为本地信任数据;第二阶段引入汇总校验 |
| 计时跨越午夜 / DST | 时间桶分组错位 | 所有时间均用 epoch ms 存储,展示时按本地时区分桶,跨日用 dayjs.startOf(day) |
| 触摸 race condition | 误触发 start / stop | 500ms 冷却 + 抖动合并 + 视觉 disabled 反馈 |
| Orphan 误判 | 跨时区 / 长任务被误标异常 | 自适应 P95 阈值 + 4h / 8h 分级 + 用户开关 |
| 主 Ctrl+Z 污染 | 撤销 start/stop 影响日常操作 | 独立「会话历史」面板 |
| 数据迁移 bug | 旧数据损坏 / 字段丢失 | schemaVersion + 迁移链 + 老字段 legacy_ 保留 3 版 |
| 移动端电量 | 长任务持续 tick 耗电 | powerSaveMode + 自适应 tick 间隔 |

## 10. 实施阶段(可独立合并)

阶段 0:数据模型 + Store + 迁移骨架(2 天)
- 定义 TimerSession 类型(含 schemaVersion)、Zustand store、IndexedDB schema。
- 实现迁移框架,首个迁移函数 to_v1(identity),写迁移测试。
- 不接入 UI,先在控制台验证 start / stop / undo / orphan 行为。

阶段 1:DailyScheduleCard 按钮 + 全新 CompletionDialog(3 天)
- DailySlotSection 渲染 TimerButton(带防抖)。
- 接入 ConfirmationDialogHost,新增 timer.completion kind(主/次要双层选项)。
- 新增 timer.orphan-confirm kind(用于孤儿会话)。
- 完成基础计时循环 + completionSource 写入。

阶段 2:TimerBar(双形态)+ 可见性同步(2 天)
- 全局浮动条组件(小贴片 + 完整模式)。
- 监听 visibilitychange 立即重算 elapsed。
- 移动端 tick 间隔自适应。

阶段 3:项目时间页 + 表格(2 天)
- 路由 + 模块注册。
- 列表 / 筛选 / 详情 / 数据概览条。
- SessionHistoryPanel 撤销面板(独立于主 Ctrl+Z)。

阶段 4:Timeline 可视化(4 天)
- d3 + framer-motion,基础条块 + 悬停 + 点击跳转。
- 聚合视图(密度图)。
- 对比模式 + 专注度热力图。
- 大数据量虚拟化 + Worker 预处理。

阶段 5:Liveblocks 同步 + 多端冲突(2 天)
- room storage 适配。
- 跨端冲突接管 UI。

阶段 6:数据迁移 / 导出 / 复盘集成 / 隐私(2-3 天)
- CSV 导出。
- 与复盘视图打通(聚合进 daily review + 提示未 stop 的 session)。
- 「清空所有计时数据」+ 「禁用 orphan 检测」设置项。
- P2 入口:本地加密开关。

## 11. 关键文件改动清单

新建:
- src/store/timer.ts
- src/types/timer.ts
- src/store/timerMigrations.ts
- src/components/timer/TimerBar.tsx
- src/components/timer/CompletionDialog.tsx
- src/components/timer/ProjectTimeView.tsx
- src/components/timer/TimelineView.tsx
- src/components/timer/TimerButton.tsx
- src/components/timer/SessionHistoryPanel.tsx
- src/components/timer/OrphanConfirmDialog.tsx
- src/components/timer/timerStoreAdapter.ts
- src/hooks/useTimerTick.ts
- src/hooks/useTimerAction.ts
- tests/timer/store.test.ts
- tests/timer/migration.test.ts
- tests/timer/integration.test.tsx

修改:
- src/App.tsx(注册新模块、新 dialog kind、孤儿检测启动钩子)
- src/components/dailySchedule/DailySlotSection.tsx(渲染按钮)
- src/components/dailySchedule/DailyScheduleView.tsx(可选:展示「累计时长」+ 完成来源图标)
- src/components/Toolbar.tsx(新增导航项)
- src/styles/*(新增 timer.css)
- src/store/timelineData.ts(可选:暴露 sourceId ↔ task 关系查询,接收 completionSource)
- src/components/ConfirmationDialogHost.tsx(支持多级 dialog + 二次确认模式)

不动:
- src/types/index.ts(任务 / block 数据结构保持不变)
- src/store/index.ts 已有 timelineStore(只在末尾追加,不破坏旧 API)




本方案用最小侵入方式叠加「任务时间追踪 + 项目汇总 + 时间轴」三层能力:

- **核心机制**:时间戳 + 可见性 API 解决移动端计时漂移。
- **数据层**:schemaVersion + 迁移链保证可演进,completionSource 区分完成来源。
- **UI 层**:TimerBar 双形态 + 全新 CompletionDialog 三层选项结构。
- **统计层**:基础表格 + 聚合 / 对比 / 热力图三种可视化。
- **同步层**:Liveblocks + IndexedDB,多端冲突有接管 UI。
- **运维层**:Orphan 自适应检测 + 移动端省电模式 + 触摸防抖。
- **隐私层**:清空按钮 + 字段透明的导出。

整体改动约 16 个新文件、7 个文件的小幅扩展,分 7 阶段独立合并(增加了阶段 0 的迁移骨架和阶段 6 的隐私 / 复盘集成)。任一阶段失败不影响主线运行。

**最重要的 4 个关键调整**:

1. 产品定位从「番茄钟」改为「任务时间追踪」,避免 30% 的不必要状态复杂度。
2. CompletionDialog 从 3 选项改成「2 主选项 + 折叠次要 + 二次确认」结构,显著降低误操作风险(v1 强制规格,详见 §13.2)。
3. 数据从第一天就带 schemaVersion,迁移链从阶段 0 开始搭建,把「零停机演进」作为基础能力。
4. 性能 / 电量策略默认开启(powerSaveMode + 自适应 tick),省电作为开箱即用的体验。

**v1 强制规格清单见 §13,所有实现不得偏离。**
## 12. 总结

本方案用最小侵入方式叠加「任务时间追踪 + 项目汇总 + 时间轴」三层能力:

- **核心机制**:时间戳 + 可见性 API 解决移动端计时漂移。
- **数据层**:schemaVersion + 迁移链保证可演进,completionSource 区分完成来源。
- **UI 层**:TimerBar 双形态 + 全新 CompletionDialog 三层选项结构。
- **统计层**:基础表格 + 聚合 / 对比 / 热力图三种可视化。
- **同步层**:Liveblocks + IndexedDB,多端冲突有接管 UI。
- **运维层**:Orphan 自适应检测 + 移动端省电模式 + 触摸防抖。
- **隐私层**:清空按钮 + 字段透明的导出。

整体改动约 16 个新文件、7 个文件的小幅扩展,分 7 阶段独立合并(增加了阶段 0 的迁移骨架和阶段 6 的隐私 / 复盘集成)。任一阶段失败不影响主线运行。

**最重要的 4 个关键调整**:

1. 产品定位从「番茄钟」改为「任务时间追踪」,避免 30% 的不必要状态复杂度。
2. CompletionDialog 从 3 选项改成「2 主选项 + 折叠次要 + 二次确认」结构,显著降低误操作风险(v1 强制规格,详见 §13.2)。
3. 数据从第一天就带 schemaVersion,迁移链从阶段 0 开始搭建,把「零停机演进」作为基础能力。
4. 性能 / 电量策略默认开启(powerSaveMode + 自适应 tick),省电作为开箱即用的体验。

**v1 强制规格清单见 §13,所有实现不得偏离。**
## 13. v1 强制规格锁定(用户确认)

以下决策已在 v3 用户确认环节落实,v1 实现不得偏离:

### 13.1 产品命名
- 产品名:**任务时间追踪**(Task Time Tracking)。
- Toolbar / 模块名 / 文档 / 测试报告统一使用「任务时间追踪」,避免「番茄钟」字样出现在用户可见界面。
- 内部 store / 文件 / 类型名沿用英文 timer / session,与产品命名解耦。

### 13.2 CompletionDialog 三层结构

主弹窗默认可见区域只显示两个按钮:

- **已完成**(主按钮):调 completeTask。
- **继续计时**(次按钮):保留 activeSession。

次要操作必须藏在「▽ 更多选项」折叠菜单里:

- 保留但不计入今日统计(灰色)。
- 补结束于...(时间选择)。
- 放弃当前段(红色)。

「放弃当前段」必须经过二次确认:弹出对话框,要求输入「我要放弃」才能点击确认(防御性输入,避免误触)。

**禁止在 v1 中**:把「放弃」放回主弹窗 / 用普通二次确认替代文本输入 / 删除折叠入口。

### 13.3 性能 / 电量默认开启

- 移动端自动检测:启用 1000ms tick(替代桌面端 250ms)。
- powerSaveMode 默认 true:用户首次启动无需手动开启,即可获得省电体验。
- 设置页提供开关,允许用户强制 250ms tick(高刷新场景,如演示)。

### 13.4 v1 不实现的功能(明确排除)

| 功能 | 状态 | 备注 |
|---|---|---|
| 番茄钟工作 / 休息循环 | **v1 不实现** | 数据模型兼容,留 v2 扩展 |
| 客户端本地加密(Web Crypto) | **v1 不实现** | 个人效率数据,合规优先级低 |
| 多端 Liveblocks 接管 UI | **v1 不实现** | 第一版仅做本地存储 + Liveblocks 同步(以最新写入为准) |
| 服务端计时校验 | **v1 不实现** | 完全本地信任模型 |
| 番茄钟式铃声 / 通知 | **v1 不实现** | 与定位冲突 |

### 13.5 v1 必交付物(从 §10 实施阶段提取的核心)

- TimerSession 类型 + schemaVersion 迁移骨架(阶段 0)。
- DailyScheduleCard TimerButton + useTimerAction 防误触(阶段 1)。
- CompletionDialog 三层结构(阶段 1,按 §13.2)。
- TimerBar 双形态(阶段 2)。
- 项目时间汇总页(阶段 3)。
- Timeline 基础条块视图(阶段 4 的最小子集,密度图 / 对比 / 热力图推到 v2)。
- IndexedDB 持久化 + orphan 检测(阶段 7 中合并,不再单独占阶段)。
- 设置页:tick 间隔 / powerSaveMode / orphan 检测开关(阶段 6 末尾)。

