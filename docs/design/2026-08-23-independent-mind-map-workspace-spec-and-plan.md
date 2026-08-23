# SmartLine 独立思维导图工作区：完整需求规格与实施计划

文档版本：1.0  
日期：2026-08-23  
状态：待实施  
优先级：隔离与零回归高于功能数量和交付速度

---

## 0. 文档结论

SmartLine 新增一个名为“思维导图”的独立页面。该页面在应用导航中拥有独立入口，所有节点、关系、布局、文档、历史、持久化、同步与 AI 数据均属于 Mind Map 数据域。

本项目最重要的约束不是“尽快做出画布”，而是：

> 思维导图发生任何加载、渲染、存储、同步、导入、AI 或性能故障，都不得改变、阻塞或破坏 SmartLine 现有项目规划、人生地图、每日安排、周矩阵、艾宾浩斯复习和知识大盘的功能与数据。

实现采用“新模块 + 最小壳层接线”：

- 新功能代码集中在 src/mindMap/。
- 只在应用壳层增加导航入口、懒加载分支和局部错误边界。
- 不改造现有知识大盘，不复用其 Store 和业务数据。
- 不把 Mind Map 加入现有统一工作区 Store、同步字段、备份 schema 或跨域命令。
- 本地数据使用独立 IndexedDB 数据库。
- 当前版本不保存任何 SmartLine 业务对象引用。
- 新模块只有在用户进入或预加载“思维导图”页面时才下载；只有页面挂载后才初始化。

任何实现若需要突破上述边界，必须停止该任务并先修改本规格，经确认后才能继续。

---

# 第一部分：产品需求规格

## 1. 产品定义

### 1.1 产品定位

“思维导图”是 SmartLine 内的独立图形工作区，用于：

- 创建树形思维导图。
- 创建非树形自由关系图。
- 自由放置节点。
- 使用连线表达有向、无向或双向关系。
- 使用 Section 和 Group 组织大型图。
- 对单张图进行本地保存、导入、导出、布局和搜索。
- 在后续阶段进行独立实时同步和 AI 图结构操作。

它不是现有“知识大盘”的编辑模式，也不是 Timeline、Project、Task、Daily、EBB、Life Map 的可视化投影。

### 1.2 页面名称与标识

- 用户名称：思维导图
- AppModule 标识：mind-map
- 页面 DOM 标识：view-mind-map
- 模块目录：src/mindMap/
- 本地数据库：smart-line-mind-map
- 本地对象仓库：mind_map
- 本地键前缀：mind-map:

### 1.3 核心目标

1. 用户能在不理解图数据库或绘图软件的前提下创建、编辑和整理导图。
2. 页面具备专业画布编辑器所需的选择、拖动、缩放、历史、快捷键和导出能力。
3. Mind Map 的代码、数据和运行故障不能影响其他 SmartLine 功能。
4. 核心编辑模型能够逐步扩展到 10,000 节点，而不需要重写数据模型。
5. AI、协作和高级性能能力通过独立阶段加入，不能反向污染核心编辑器。

### 1.4 非目标

当前产品不承担：

- 从项目、任务、Daily、EBB、Life Map 或知识大盘创建节点。
- 从 Mind Map 跳转或反查任何 SmartLine 业务对象。
- 在节点中保存 SmartLine 项目 ID、任务 ID、复习 ID或知识节点 ID。
- 与现有知识大盘共享节点或迁移知识大盘数据。
- 修改现有统一工作区 schema。
- 修改现有工作区备份文件结构。
- 修改现有跨域撤销、业务副作用或任务完成逻辑。

---

## 2. “不影响其他功能”的精确定义

### 2.1 数据隔离

Mind Map 必须满足：

- 不读取 Timeline Store。
- 不读取 Daily Store。
- 不读取 EBB Store。
- 不读取 Life Map Store。
- 不读取现有 Graph Store。
- 不写入上述任何 Store。
- 不注册到 workspaceLocalWriteJournal。
- 不写入 workspaceOfflineQueue。
- 不加入 WorkspaceBackup。
- 不加入统一 Liveblocks 工作区的现有 storageMapping。
- 不改变 SmartLine workspace schemaVersion。
- 不在导入导出结构中接受或产生 SmartLine 业务引用。

### 2.2 代码隔离

src/mindMap/ 中禁止导入：

- @/store
- @/ebb
- @/lifeMap
- @/graph
- @/components/dailySchedule/store
- @/services/workspaceSync
- @/services/workspaceBackup
- @/services/actionBridge
- @/services/projectTaskCommands
- @/services/projectTaskEffectCommit
- 任何现有业务视图组件

允许复用的无业务基础设施：

- React、React DOM。
- Zustand。
- D3 的纯布局、缩放或几何能力。
- DOMPurify。
- Lucide 图标。
- Framer Motion 的页面级动效。
- src/utils/persistence.ts 中的 createDedicatedStorage 和 createCoalescedPersistence。
- src/store/client.ts 中的 Liveblocks Client，仅限独立协作阶段。
- src/motion/ 中无业务语义的动效常量。
- SmartLine Design System 的视觉 token 和无障碍规则。

复用基础设施不等于共享数据域。任何共享工具若要求传入业务 Store，Mind Map 不得使用。

### 2.3 运行时隔离

- Mind Map 入口必须使用动态 import。
- 应用首次打开其他页面时，不得创建 Mind Map Store、Worker、Canvas、数据库连接或窗口级事件监听。
- 模块文件被预加载时不得产生副作用。
- 所有初始化必须发生在 MindMapWorkspace 挂载之后。
- 页面卸载后必须清理 requestAnimationFrame、Worker、ResizeObserver、Pointer Capture、计时器和事件监听。
- Mind Map 渲染异常必须被页面级 Error Boundary 捕获。
- Mind Map 存储失败只能在当前页面显示错误，不得进入全局同步警告。
- Mind Map 同步失败不得修改现有 SyncDialog 状态。
- Mind Map 不得被加入 App 的全局 hydration 等待条件。

### 2.4 视觉与交互隔离

- 唯一允许对现有界面产生的可见变化，是主导航新增“思维导图”入口。
- 现有六个入口的名称、图标、顺序和点击行为不得改变。
- Mind Map 样式必须使用 CSS Module 或模块根节点作用域。
- 禁止新增影响 body、button、input、svg、canvas、.tl-app 等全局选择器的样式。
- 禁止修改其他页面的 z-index、overflow、position、尺寸或主题变量。
- Mind Map 快捷键只有页面处于当前视图且焦点不在文本控件中时才生效。
- 页面卸载后不得继续拦截 Space、Delete、Ctrl/Cmd+Z、Ctrl/Cmd+C 或滚轮。

### 2.5 性能隔离

- Mind Map 不得加入主入口同步 bundle。
- 未进入页面时不得运行布局、空间索引、自动保存或同步。
- 页面切走后停止渲染循环和布局 Worker。
- 大图导出、布局和 AI 解析不得占用主线程长任务。
- Mind Map 内存压力不得通过全局缓存保留到其他页面。

### 2.6 隔离验收原则

“没有发现问题”不算通过。必须用自动化测试证明：

1. Mind Map 操作前后五个现有 Store 的序列化 hash 完全一致。
2. Mind Map 不产生现有工作区离线队列字段。
3. Mind Map 不改变现有工作区备份导出结果。
4. Mind Map 抛出渲染错误后，用户可以退出并继续使用项目规划。
5. Mind Map IndexedDB 写入失败后，其他页面仍能创建和编辑数据。
6. 在从未进入 Mind Map 的会话中，不下载其主要功能 chunk。
7. 离开页面后，画布快捷键和滚轮不再被拦截。

---

## 3. 版本范围

### 3.1 Release 1：独立核心编辑器

Release 1 必须包含：

- 独立导航入口和页面。
- 多张独立导图。
- 无限画布。
- 文本节点。
- 节点创建、编辑、移动、调整尺寸、复制、粘贴和删除。
- 单选、多选、框选。
- 直线边、曲线边、有向/无向/双向箭头。
- 边标签、删除和重新连接。
- 平移、缩放、Fit All、Fit Selection、100%。
- Command、Undo、Redo、事务合并。
- 自动保存、手动保存、页面恢复。
- 完整 JSON 导入导出。
- PNG 导出。
- 树形布局、对齐和等间距。
- 搜索与定位。
- 节点与边属性面板。
- 桌面键盘快捷键。
- 手机和平板上的查看、平移、缩放、选择、创建和文本编辑。
- 500 节点流畅、2,000 节点可用。
- 完整隔离测试和现有功能回归测试。

### 3.2 Release 2：高级图编辑

- Section。
- Group。
- Section 自动尺寸、折叠和展开。
- 节点旋转、层级调整。
- Orthogonal Edge。
- 高级边路由和控制点。
- 图片节点。
- URL、Markdown、LaTeX 节点。
- SVG 导出。
- 小地图。
- 命令面板。
- 高级自动整理。
- 5,000 节点性能目标。

### 3.3 Release 3：独立同步与同账号实时状态

- 每张导图使用独立 Liveblocks Room。
- 同账号多设备实时同步。
- 独立 presence。
- 离线编辑与恢复。
- 远端移动、创建和删除反馈。
- 本地历史不与远端历史混合。

Release 3 不得把导图加入现有统一工作区 Room。

### 3.4 Release 4：AI Graph Agent

- 文本转导图。
- AI 创建、修改和删除节点。
- AI 创建关系。
- AI 自动整理和布局。
- AI 对当前图进行重构。
- 所有 AI 写操作生成可预览的 Graph Patch。
- 用户确认后，整个 Patch 作为一个可撤销事务提交。

### 3.5 Release 5：大型图性能与跨账号协作

- 10,000 节点可打开、保存、缩放和定位。
- 布局 Worker。
- 增量渲染与空间索引升级。
- 必要时引入 WebGL。
- 跨账号邀请、成员和权限。

跨账号协作需要独立 ACL 和服务端授权设计。它不属于“仅新增页面即可完成”的改动，必须单独评审后才能实施。

---

## 4. 页面信息架构

### 4.1 页面入口

主导航新增：

- 名称：思维导图
- 图标：独立且不与知识大盘混淆的图形/分支图标
- 位置：现有知识大盘之后
- 悬停或聚焦：允许预加载无副作用的页面 chunk
- 点击：切换到 mind-map，不携带任何业务上下文

### 4.2 页面骨架

~~~text
┌──────────────────────────────────────────────────────────────┐
│ Workspace Bar：文档名 / 新建 / 保存状态 / 撤销 / 重做 / 更多 │
├────────┬───────────────────────────────────────┬─────────────┤
│ 工具栏 │                                       │ Inspector   │
│ 选择   │              无限画布                 │ 对象属性    │
│ 节点   │                                       │ 样式        │
│ 连线   │                                       │ 布局        │
│ Section│                                       │ 文档设置    │
├────────┴───────────────────────────────────────┴─────────────┤
│ 状态栏：缩放 / 节点数 / 边数 / 保存状态 / 同步状态           │
└──────────────────────────────────────────────────────────────┘
~~~

### 4.3 渐进呈现

- Workspace Bar 只直接显示文档名、新建、Undo、Redo 和一个“更多”入口。
- 选择对象后才显示相关 Inspector。
- 高级样式、导入、导出和文档管理进入二级菜单。
- AI 仅在 Release 4 出现。
- 协作状态仅在 Release 3 出现。
- 不显示未实现或不可用按钮。

### 4.4 首次进入

- 若存在上次打开的 Mind Map 文档，打开该文档并恢复其 viewport。
- 若没有文档，创建一张“未命名思维导图”。
- 不读取当前项目、日期、知识节点或其他页面选中状态。
- 首次空画布中央显示：双击创建节点、拖动画布、滚轮缩放。

### 4.5 文档切换

- 页面内提供文档列表。
- 切换前 flush 当前文档待保存内容。
- 每张图恢复自己的 viewport、选择为空、历史互不混用。
- 文档切换失败时继续保留当前图，不显示空白画布。

---

## 5. 文档管理

### 5.1 创建

- 用户可创建多张导图。
- 新文档生成稳定 UUID。
- 默认标题“未命名思维导图”。
- 新文档为空，缩放 100%，viewport 居中。

### 5.2 重命名

- 标题去除首尾空白。
- 空标题恢复默认名称。
- 重命名不进入图形 Undo 历史。
- 重命名立即更新文档索引并进入自动保存。

### 5.3 复制

- 复制文档时为文档和所有对象重新生成 ID。
- 内部 Edge、Section、Group 引用重新绑定。
- 原文档与副本之间不保留引用。
- 副本标题添加“副本”。

### 5.4 删除

- 删除文档必须确认。
- 删除当前文档后打开最近更新的剩余文档。
- 删除最后一张图后自动创建空白图。
- 删除只操作独立 Mind Map 数据库。
- Release 3 后删除远端 Room 必须作为独立操作处理；本地删除失败不得误删远端，反之亦然。

---

## 6. 无限画布与相机

### 6.1 坐标

- 所有对象使用 world coordinate 持久化。
- 屏幕坐标只用于输入与绘制。
- 坐标使用有限 number；NaN、Infinity 和超限坐标在导入时拒绝。

### 6.2 平移

- 鼠标中键拖动平移。
- Space + 左键拖动临时平移。
- 触控板双指平移。
- 触摸双指平移。
- 平移只修改 viewport，不进入图形 Undo 历史。

### 6.3 缩放

- 鼠标滚轮围绕指针缩放。
- 触控板和触摸双指围绕手势中心缩放。
- 最小 5%，最大 800%，默认 100%。
- 缩放只修改 viewport，不进入图形 Undo 历史。

### 6.4 视图命令

- Fit All：适应所有可见对象。
- Fit Selection：适应当前选择；无选择时不执行。
- 100%：恢复 1:1。
- 所有相机动画遵循 reduced motion。

### 6.5 背景

- 支持无网格、点阵和方格。
- 背景设置属于文档设置。
- 网格不参与导出，除非用户在导出对话框明确选择。

---

## 7. 节点系统

### 7.1 Release 1 节点类型

Release 1 只实现 TextNode。数据模型不为尚未实施的节点类型增加空接口或占位逻辑。

### 7.2 创建

- 双击空白位置创建节点。
- 节点中心位于双击的 world coordinate。
- 创建后进入 HTML 文本编辑层。
- 空文本按 Escape 或失焦时取消创建。
- 选中节点后按 Tab 创建右侧子节点并建立有向边。
- 按 Enter 创建下方同级节点；无法确定父级时创建孤立节点。

### 7.3 文本编辑

- 双击节点或按 Enter/F2 进入编辑。
- 使用 HTML textarea 或 contenteditable overlay，不在 Canvas 内直接接收输入。
- 支持中文输入法。
- composition 期间不得提交快捷键。
- Escape 取消并恢复旧文本。
- Ctrl/Cmd+Enter 提交多行文本；单行模式 Enter 提交。
- 一次编辑会话只生成一个历史事务。

### 7.4 尺寸

- auto 模式根据文本自动计算尺寸。
- manual 模式由用户调整宽高。
- 设定最小和最大宽度。
- 中文、英文、数字和换行使用 Canvas measureText 和缓存测量。
- manual 模式编辑文本不得改变用户指定宽度。

### 7.5 移动

- 拖动节点时实时更新画面和连接线。
- Pointer Move 使用瞬时交互状态，不连续写 Store。
- Pointer Up 时提交一次 move command。
- 多选移动保持相对 offset，并作为一个事务。
- 锁定节点不得移动。

### 7.6 样式

Release 1：

- 填充色和透明度。
- 边框颜色、宽度和样式。
- 圆角。
- 阴影开关。
- 字体大小、字重、颜色、对齐和行高。
- 自动/手动尺寸。
- 锁定。
- 是否参与自动布局。

所有样式字段必须有默认值和合法范围；导入时归一化。

### 7.7 层级

- 节点拥有 zIndex 或统一 zOrder。
- 支持置顶、置底、上移一层、下移一层。
- 层级操作进入历史。

---

## 8. 边与关系

### 8.1 创建

- 节点显示连接手柄。
- 从手柄拖到另一节点后创建 Edge。
- Release 1 不允许悬空边。
- 连接自身默认禁止。
- 重复边允许，但必须可单独选择和删除。

### 8.2 类型

Release 1：

- straight
- curve

Release 2：

- orthogonal
- 可编辑控制点

### 8.3 方向

- none
- forward
- backward
- both

### 8.4 标签

- 双击边进入 HTML 文本编辑层。
- 空标签不渲染。
- 标签属于 Edge，不创建隐藏 Node。
- 标签编辑一次提交一个历史事务。

### 8.5 重新连接

- 拖动端点时显示可连接节点高亮。
- 命中新节点时提交 reconnect command。
- 未命中时恢复原端点。
- 不允许产生悬空或指向不存在节点的 Edge。

### 8.6 删除节点

- 删除节点时同时删除其关联 Edge。
- 节点与关联 Edge 的删除作为一个事务。
- Undo 必须恢复节点、Edge、zOrder 和容器关系。

---

## 9. 选择与操作

### 9.1 单选和多选

- 点击对象：清除旧选择并选择目标。
- Shift + 点击：切换目标选择状态。
- Ctrl/Cmd + 点击：与 Shift 相同。
- 点击空白：清空选择。

### 9.2 框选

- 从空白区域拖动创建选择框。
- 默认选择完全位于框内的节点。
- 设置中可切换为相交模式。
- Edge 只有在用户打开“选择连线”时参与框选。

### 9.3 Escape

优先级：

1. 结束 composition，不做额外处理。
2. 关闭文本编辑或当前临时工具。
3. 关闭菜单或 Inspector 浮层。
4. 清空选择。

### 9.4 复制、剪切和粘贴

- 内部剪贴板包含 nodes、edges、sections、groups 和内部引用。
- 粘贴时全部重新生成 ID。
- 只保留选中对象之间的内部 Edge。
- 粘贴位置相对原对象偏移。
- 若系统剪贴板权限失败，仍保留页面内剪贴板。
- 不读取或写入其他 SmartLine 页面剪贴板格式。

---

## 10. Section 与 Group

本章属于 Release 2。

### 10.1 Section

- Section 是具有标题、边界、样式和折叠状态的空间容器。
- 节点进入 Section 时设置 parentSectionId。
- 节点离开 Section 时清空 parentSectionId。
- 自动模式根据内容 bounding box 调整尺寸。
- 手动模式保持用户尺寸。
- 移动 Section 默认同时移动其可见内容。

### 10.2 折叠

- 折叠后隐藏内部对象的普通渲染。
- 外部 Edge 映射到折叠 Section 的代理端点。
- 内部对象仍可被搜索。
- Fit All 只计算折叠后的可见边界。
- 展开恢复对象原 world coordinate。

### 10.3 Group

- Group 是逻辑组合，不强制绘制外框。
- Group 中对象一起选择、移动和复制。
- 一个对象在 Release 2 中最多属于一个 Group。
- Group 不等同于树形父子关系或 Section。

---

## 11. Command、Undo 与 Redo

### 11.1 唯一写入口

持久图数据只能通过 Mind Map Command 修改。React 组件、Canvas Renderer、AI、同步适配器和导入器不得直接修改 Store 内部对象。

### 11.2 必须进入历史

- 创建、删除、复制和粘贴对象。
- 修改节点文本、样式、尺寸和位置。
- 创建、删除、修改和重连 Edge。
- 创建、删除、移动、折叠 Section。
- 创建和解除 Group。
- 自动布局、对齐和分布。
- AI Graph Patch。

### 11.3 不进入历史

- 相机平移和缩放。
- hover。
- 选择变化。
- 打开菜单或 Inspector。
- 搜索词和搜索定位。
- 远端 presence。
- 自动保存状态。

### 11.4 合并

- 一次连续拖动为一条历史。
- 一次文本编辑会话为一条历史。
- 批量删除为一条历史。
- 一次布局为一条历史。
- 一次 AI 确认结果为一条历史。

### 11.5 历史生命周期

- 每张打开的文档拥有独立历史。
- Release 1 历史只保存在当前浏览器内存。
- 刷新页面后历史清空。
- 历史不导出、不持久化、不进入 Liveblocks。
- 默认最多 100 个事务；达到上限后丢弃最旧事务。

明确不持久化历史，可以避免旧命令跨 schema、跨设备或跨协作状态错误重放。

---

## 12. 布局、对齐与整理

### 12.1 树布局

- 支持左到右、右到左、上到下、下到上。
- 输入为选中根节点可达的树，或当前选择。
- 非树边保留，但不参与树层级计算。
- 不参与布局的锁定节点保持原位置。
- 结果一次提交。

### 12.2 对齐

选择至少两个节点时：

- 左对齐。
- 水平居中。
- 右对齐。
- 顶对齐。
- 垂直居中。
- 底对齐。

### 12.3 分布

选择至少三个节点时：

- 水平均匀分布。
- 垂直均匀分布。

### 12.4 自动整理

- 保留节点 ID、Edge ID、文本和样式。
- 只修改允许布局的对象位置。
- 不随机改变主方向。
- Release 2 才要求 Edge 标签避让和复杂图优化。

---

## 13. 搜索与定位

搜索范围：

- 节点文本。
- Edge 标签。
- Section 标题。
- Group 标题。

行为：

1. 列出匹配结果和对象类型。
2. 点击结果后相机定位到对象。
3. 对象短暂高亮。
4. 若对象位于折叠 Section，先询问是否展开。
5. 搜索不得修改图数据和历史。

---

## 14. 导入、导出与图片

### 14.1 JSON

导出内容：

- 格式标识。
- schemaVersion。
- 文档元数据。
- nodes、edges、sections、groups。
- zOrder。
- viewport 和文档设置。

不导出：

- Undo/Redo 历史。
- 本地 selection。
- presence。
- Inspector 状态。
- Liveblocks Room 信息。
- SmartLine 业务引用。

导入必须：

- 先解析到临时对象。
- 验证格式、版本、大小、ID、引用和数值范围。
- 归一化可修复问题。
- 发现高版本时拒绝覆盖现有文档。
- 完成验证后才原子替换或创建新文档。
- 失败时当前文档保持不变。

### 14.2 PNG

- 支持全部内容、当前选择和当前视口。
- 在离屏 Canvas 中渲染。
- 支持透明或文档背景。
- 外部图片污染 Canvas 时给出明确错误，不输出损坏文件。

### 14.3 SVG

Release 2 支持：

- 节点形状。
- 文本。
- Edge。
- 箭头。
- 基础样式。

SVG 文本内容必须转义，禁止输出可执行脚本、foreignObject 和事件属性。

### 14.4 图片

Release 2 图片导入：

- 用户上传文件存入 Mind Map 独立数据库。
- 默认限制 MIME、单文件大小和总空间。
- 外部 URL 必须为 HTTPS。
- 图片加载失败显示占位，不阻塞文档。
- 删除最后一个引用后可清理本地 Blob。

---

## 15. 自动保存与恢复

### 15.1 本地存储

使用：

- databaseName：smart-line-mind-map
- storeName：mind_map
- index key：mind-map:index
- document key：mind-map:document:{documentId}
- asset key：mind-map:asset:{assetId}

不得使用现有 smart-timeline 数据库的业务 Store。

### 15.2 保存策略

- Command 提交后将当前文档标记 dirty。
- 使用 350ms 合并写入。
- 连续拖动期间不逐帧写 IndexedDB。
- 手动保存立即 flush。
- visibilitychange 为 hidden 时 flush。
- beforeunload 只写 namespaced 应急日志。
- 写失败保留当前内存数据并显示“未保存”。
- 重试不得阻塞用户切换到其他 SmartLine 页面。

### 15.3 schema

- 文档必须包含 schemaVersion。
- 每次迁移是纯函数，输入旧文档，输出新文档。
- 迁移前保留原值，迁移成功后再覆盖。
- 未知更高版本只能只读提示或拒绝打开，绝不能降级覆盖。

---

## 16. 独立协作

本章属于 Release 3。

### 16.1 Room 隔离

- 一张文档一个 Room。
- Room ID 使用现有 owner-scoped workspace 前缀，并追加 mind-map 和 documentId。
- 不与现有五个 Store 进入同一统一 Room。
- 不调用 connectUnifiedWorkspace。
- 不把 Mind Map 同步状态加入现有 SyncDialog。
- Mind Map 页内显示自己的连接状态和错误。

### 16.2 同步内容

同步：

- 文档对象。
- Node、Edge、Section 和 Group。
- 文档标题与设置。

Presence：

- 用户颜色。
- 当前光标。
- 正在编辑或拖动的对象 ID。

不持久同步：

- Camera。
- 本地 selection。
- Inspector。
- Undo/Redo。

### 16.3 冲突原则

- 对象以稳定 ID 合并。
- 不使用整张文档快照覆盖远端。
- 多人修改不同对象应独立合并。
- 同一字段冲突采用明确的最后提交语义或冲突提示，不产生损坏对象。
- 删除与修改冲突不得复活半个对象。
- 同步结果必须通过 normalizeGraph。

### 16.4 当前认证限制

现有认证主要授权房间所有者。真正的跨账号邀请需要：

- 成员列表。
- 邀请和撤销。
- 房间 ACL。
- 只读/编辑权限。
- 服务端授权变更。

因此 Release 3 先提供同账号多设备；跨账号协作必须在 Release 5 单独立项。

---

## 17. AI Graph Agent

本章属于 Release 4。

### 17.1 输入

- 自然语言。
- Markdown。
- 缩进文本。
- Mermaid 的受支持子集。
- 当前导图选中对象。

### 17.2 输出

AI 只能输出经过 schema 校验的 Graph Patch：

- createNodes。
- updateNodes。
- deleteNodeIds。
- createEdges。
- updateEdges。
- deleteEdgeIds。
- layoutChanges。

### 17.3 执行

1. 收集最小必要上下文。
2. 调用 Mind Map 专用 AI endpoint。
3. 校验响应大小、ID、引用和字段。
4. 在页面内展示新增、修改和删除预览。
5. 用户确认。
6. 通过 Command Pipeline 一次提交。
7. 可 Undo。

### 17.4 安全

- AI 不得访问其他 SmartLine Store。
- AI endpoint 不接收其他业务数据。
- AI 不直接调用 Zustand setState。
- AI 不模拟鼠标或键盘。
- 超过阈值的删除必须突出显示数量。
- 校验失败不产生部分修改。

---

## 18. 数据模型

### 18.1 文档索引

~~~ts
interface MindMapIndex {
  schemaVersion: number
  activeDocumentId: string | null
  documents: MindMapDocumentSummary[]
}

interface MindMapDocumentSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  edgeCount: number
}
~~~

### 18.2 文档

~~~ts
interface MindMapDocument {
  kind: 'smart-line-mind-map'
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
  nodes: Record<string, MindMapNode>
  edges: Record<string, MindMapEdge>
  sections: Record<string, MindMapSection>
  groups: Record<string, MindMapGroup>
  zOrder: string[]
  viewport: ViewportState
  settings: MindMapSettings
}
~~~

使用实体 Record 而不是依靠数组顺序查找，可以保持稳定 ID，并为大图、按实体同步和增量渲染提供基础。zOrder 单独保存绘制顺序。

### 18.3 Node

~~~ts
interface MindMapNode {
  id: string
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  rotation: number
  text: string
  content?: string
  sizeMode: 'auto' | 'manual'
  parentSectionId: string | null
  groupId: string | null
  locked: boolean
  participatesInLayout: boolean
  style: NodeStyle
  createdAt: number
  updatedAt: number
}
~~~

Release 1 的类型与运行时校验都只接受 type 为 text。Release 2 实施对应渲染、编辑和安全校验时，再把联合类型扩展为 image、url、markdown 和 latex。

### 18.4 Edge

~~~ts
interface MindMapEdge {
  id: string
  sourceId: string
  targetId: string
  type: 'straight' | 'curve' | 'orthogonal'
  direction: 'none' | 'forward' | 'backward' | 'both'
  label: string
  style: EdgeStyle
  createdAt: number
  updatedAt: number
}
~~~

### 18.5 Section 与 Group

~~~ts
interface MindMapSection {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  sizeMode: 'auto' | 'manual'
  collapsed: boolean
  style: SectionStyle
}

interface MindMapGroup {
  id: string
  title: string
  memberIds: string[]
}
~~~

### 18.6 运行时状态

以下状态不属于 MindMapDocument：

- selection。
- hover。
- activeTool。
- textEditingSession。
- dragSession。
- marquee。
- history。
- presence。
- saveStatus。
- render statistics。

运行时状态不得被 JSON 导出或 Liveblocks 持久化。

### 18.7 归一化

normalizeMindMapDocument 必须：

- 删除重复或空 ID。
- 拒绝非有限坐标和尺寸。
- 限制尺寸、颜色、字体和透明度范围。
- 删除指向不存在节点的 Edge。
- 清除无效 Section 和 Group 引用。
- 清理 zOrder 中不存在或重复的 ID。
- 把缺失的可绘制对象补入 zOrder。
- 验证文本和总对象数量限制。
- 不修改任何其他 SmartLine 数据。

---

## 19. 渲染架构

### 19.1 分层

~~~text
MindMapDocument
      ↓
Command Store
      ↓
Geometry Cache + Spatial Index
      ↓
Viewport Culling
      ↓
Render Scheduler
   ┌───────────────┐
   ↓               ↓
Canvas 2D       HTML Overlay
背景/边/节点      文本编辑/菜单/Inspector
~~~

### 19.2 原则

- 不使用“一个永久 Node = 一个 React 组件”。
- React 只负责页面壳、工具栏、Inspector、菜单和编辑 Overlay。
- Canvas 负责网格、Edge、节点背景、文本显示、选择框和辅助线。
- DOM 中只保留当前编辑器和少量交互 Overlay。
- Store 更新后由 Render Scheduler 合并绘制。

### 19.3 Release 1 技术选择

- Canvas 2D。
- 已安装 D3 hierarchy 用于树布局。
- 已安装或原生相机数学用于缩放。
- 简单 uniform grid 空间索引。
- 原生 crypto.randomUUID 生成 ID。
- 不在基准测试前增加 Pixi、Konva、React Flow、ELK 或其他大型依赖。

如果 5,000 或 10,000 节点基准证明 Canvas 2D 不足，再在 Release 5 评估 WebGL。不得为“以后可能需要”提前维护两套 Renderer。

---

## 20. 性能指标

### 20.1 测试数据

每个规模同时规定：

- 节点数。
- Edge 数不低于节点数的 1.2 倍。
- 平均节点文本 20 个中文字符。
- 20% 节点在当前 viewport。
- 测试视口 1440×900、deviceScaleFactor 1。
- 使用项目约定的 Chromium 版本。

### 20.2 目标

500 节点：

- 普通拖动和缩放目标 60 FPS。
- Pointer Move 不触发 React 节点列表重渲染。
- Fit All 小于 100ms。

2,000 节点：

- 视口交互中位帧率不低于 45 FPS。
- 选择和拖动无连续 100ms 以上主线程长任务。
- 打开本地文档小于 1.5s。

5,000 节点：

- Release 2 目标。
- 非视口对象裁剪。
- 打开、缩放、定位和保存可用。

10,000 节点：

- Release 5 目标。
- 可以打开、保存、缩放、定位。
- 大布局在 Worker 执行。
- 不要求所有 10,000 节点同时位于视口仍保持 60 FPS。

### 20.3 性能不得牺牲

- 数据正确性。
- Undo 完整性。
- 安全校验。
- 无障碍基础。
- 其他页面的启动和交互性能。

---

## 21. 快捷键

| 快捷键 | 行为 |
| --- | --- |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z | Redo |
| Ctrl/Cmd+C | Copy |
| Ctrl/Cmd+V | Paste |
| Ctrl/Cmd+X | Cut |
| Delete/Backspace | Delete |
| Ctrl/Cmd+A | Select All |
| Escape | Cancel / Clear |
| Space + Drag | Pan |
| Tab | 创建子节点 |
| Enter | 编辑或创建同级节点 |
| F | Fit All |
| Shift+F | Fit Selection |
| 1 | 100% |
| + / - | Zoom |
| Ctrl/Cmd+S | Flush Save |

规则：

- 只在 mind-map 当前激活时注册。
- 输入框、textarea、contenteditable 和 composition 状态不触发画布快捷键。
- 浏览器保留快捷键不得被无必要覆盖。
- 卸载页面时全部注销。

---

## 22. 右键菜单与属性面板

节点菜单：

- 编辑文本。
- 复制、剪切、删除。
- 创建子节点。
- 创建连接。
- 样式。
- 置顶、置底。
- 锁定。
- Release 2：创建 Section、Group。
- Release 4：AI 操作。

边菜单：

- 编辑标签。
- 反转方向。
- 修改样式。
- 删除。

空白菜单：

- 创建节点。
- 粘贴。
- 全选。
- Fit All。
- 自动布局。
- 显示/隐藏网格。
- 导入、导出。

菜单不得使用全局 document click 常驻监听；只在菜单打开时注册，并在关闭或卸载时清理。

---

## 23. 移动端与响应式

Release 1：

- 手机进入 mind-map 时直接使用其独立全屏工作区，不使用现有 PhoneWorkspace 的业务摘要。
- 支持单指选择和拖动节点。
- 支持双指缩放和平移。
- 支持创建节点和编辑文本。
- Inspector 以底部 Sheet 出现。
- 低频操作进入更多菜单。
- 触控目标至少 44px。

Release 1 不要求：

- 完整桌面快捷键。
- 复杂 Edge 控制点。
- 大规模布局编辑。
- 10,000 节点移动端性能。

---

## 24. 无障碍

- 页面根节点具有明确工作区名称。
- 工具按钮都有可访问名称和 Tooltip。
- 菜单支持方向键和 Escape。
- Inspector 字段具有关联 label。
- 颜色不是选择、锁定或错误的唯一表达。
- 文本与背景满足 WCAG AA。
- 支持 reduced motion。
- 浏览器 200% 缩放时主要操作仍可访问。
- Canvas 提供隐藏的当前选择摘要和操作说明。
- 关键命令可通过命令面板或菜单完成，不能只依赖拖拽。

---

## 25. 安全与限制

- Markdown 和富文本显示使用 DOMPurify。
- 禁止导入脚本、事件属性、foreignObject 和危险 URL。
- JSON 导入限制文件大小、对象数量、文本长度和嵌套深度。
- 图片限制 MIME、大小和总存储。
- 所有外部图片只允许 HTTPS。
- ID 由 crypto.randomUUID 生成。
- AI 输出不可信，必须执行与 JSON 导入相同的 schema 校验。
- 导出文件名净化。
- Mind Map 错误日志不得包含导图全文或用户输入的 AI 密钥。

---

## 26. 错误与恢复

必须有：

- 页面加载失败状态。
- 文档不存在状态。
- schema 高版本状态。
- IndexedDB 不可用状态。
- 保存失败状态。
- 导入失败状态。
- 导出失败状态。
- Worker 失败回退。
- Release 3 同步断开状态。
- Release 4 AI 失败状态。

原则：

- 错误局限在当前页面。
- 不用 window.alert 作为主要错误 UI。
- 不静默丢弃未保存修改。
- 不因为单个对象损坏而覆盖整个文档。
- 恢复按钮只重试 Mind Map，不刷新整个 SmartLine。
- 始终提供“返回项目规划”。

---

## 27. 最终验收

### A. 页面与隔离

- [ ] 导航新增思维导图，现有入口名称、顺序和行为不变。
- [ ] Mind Map 为独立懒加载 chunk。
- [ ] 未进入页面时无 Mind Map 初始化副作用。
- [ ] Mind Map 不导入五个现有业务 Store。
- [ ] Mind Map 不加入 workspace sync、backup 和 schema。
- [ ] Mind Map 故障不影响其他页面。
- [ ] 其他 Store 数据在 Mind Map 操作前后 hash 不变。

### B. 文档与持久化

- [ ] 创建、重命名、复制、切换和删除文档。
- [ ] 每张文档独立保存和恢复。
- [ ] IndexedDB 使用独立数据库。
- [ ] 自动保存、手动 flush 和失败恢复可用。
- [ ] 高版本文档不会被覆盖。

### C. Canvas

- [ ] 平移、缩放、Fit All、Fit Selection、100% 正确。
- [ ] 鼠标指针中心缩放正确。
- [ ] 页面卸载后无残留监听和渲染循环。

### D. Node

- [ ] 创建、编辑、移动、尺寸、样式、锁定。
- [ ] 复制、粘贴、删除。
- [ ] 单选、多选和框选。
- [ ] 中文输入法正确。

### E. Edge

- [ ] 创建、删除、重连。
- [ ] straight、curve。
- [ ] 四种方向。
- [ ] 标签和样式。

### F. History

- [ ] Undo、Redo。
- [ ] 拖动、输入、批量操作事务合并。
- [ ] 删除节点 Undo 同时恢复 Edge 和容器关系。
- [ ] 刷新后历史按设计清空。

### G. Layout 与搜索

- [ ] 四向树布局。
- [ ] 对齐和均匀分布。
- [ ] 搜索、定位和高亮。

### H. 导入导出

- [ ] JSON 完整往返。
- [ ] 非法 JSON 不改变当前文档。
- [ ] PNG 三种范围导出。
- [ ] 不包含任何 SmartLine 业务引用。

### I. 响应式与无障碍

- [ ] 桌面、平板、手机基础操作可用。
- [ ] 200% 缩放可用。
- [ ] reduced motion。
- [ ] 键盘菜单和焦点可用。

### J. 性能

- [ ] 500 节点达到 Release 1 指标。
- [ ] 2,000 节点达到 Release 1 指标。
- [ ] Mind Map 不增加其他页面运行时工作。

---

# 第二部分：实施架构

## 28. 目录结构

~~~text
src/mindMap/
├── index.ts
├── MindMapWorkspace.tsx
├── MindMapErrorBoundary.tsx
├── config.ts
├── model/
│   ├── types.ts
│   ├── defaults.ts
│   ├── schema.ts
│   ├── normalize.ts
│   └── ids.ts
├── state/
│   ├── store.ts
│   ├── runtimeStore.ts
│   └── selectors.ts
├── commands/
│   ├── types.ts
│   ├── execute.ts
│   ├── history.ts
│   ├── nodeCommands.ts
│   ├── edgeCommands.ts
│   └── layoutCommands.ts
├── persistence/
│   ├── repository.ts
│   ├── migrations.ts
│   └── documentIndex.ts
├── canvas/
│   ├── MindMapCanvas.tsx
│   ├── camera.ts
│   ├── coordinates.ts
│   ├── renderer.ts
│   ├── renderScheduler.ts
│   ├── geometry.ts
│   ├── hitTest.ts
│   ├── spatialIndex.ts
│   └── interactionController.ts
├── layout/
│   ├── treeLayout.ts
│   ├── align.ts
│   └── layout.worker.ts
├── clipboard/
│   └── graphClipboard.ts
├── importExport/
│   ├── json.ts
│   ├── png.ts
│   └── svg.ts
├── sync/
│   ├── room.ts
│   ├── adapter.ts
│   └── presence.ts
├── ai/
│   ├── graphPatch.ts
│   ├── validatePatch.ts
│   └── client.ts
├── components/
│   ├── WorkspaceBar.tsx
│   ├── ToolRail.tsx
│   ├── Inspector.tsx
│   ├── DocumentMenu.tsx
│   ├── ContextMenu.tsx
│   ├── TextEditorOverlay.tsx
│   ├── SearchPanel.tsx
│   └── StatusBar.tsx
└── styles/
    └── MindMapWorkspace.module.css
~~~

目录可以随实现合并小文件；不得为了匹配树形结构创建空抽象。原则是边界清楚、文件数量最少，而不是每个概念都必须单独建文件。

## 29. 允许修改的现有文件

Release 1 只允许最小修改：

1. src/components/Toolbar.tsx
   - AppModule 增加 mind-map。
   - NAV_ITEMS 最后增加思维导图。
2. src/App.tsx
   - 增加 lazy loader。
   - APP_VIEW_ORDER 末尾增加 mind-map。
   - 增加 preload 分支、页面名称和渲染分支。
   - 手机模式下 mind-map 直接进入独立全屏页面。
   - 不把 Mind Map hydration 加入任何全局等待条件。
3. src/components/mobile/PhoneWorkspace.tsx
   - 仅在类型要求下补充 mind-map 名称映射。
   - 不增加 Mind Map 业务实现。
4. .env.example
   - 可选增加 VITE_MIND_MAP_ENABLED。
5. docs/
   - 更新架构和产品文档。
6. tests/
   - 新增 Mind Map 和隔离性测试。

若标准 Worker 能力被 Vite 正常处理，不修改 vite.config.ts。

## 30. 禁止修改的现有文件区域

除非先修改本规格并获得确认，禁止修改：

- src/store/**
- src/ebb/**
- src/lifeMap/**
- src/graph/**
- src/components/dailySchedule/**
- src/services/workspaceSync*
- src/services/workspaceBackup*
- src/services/workspaceLocalWriteJournal*
- src/services/workspaceOfflineQueue*
- src/services/actionBridge.ts
- src/services/projectTaskCommands.ts
- src/services/projectTaskEffectCommit.ts
- src/types/index.ts 中现有业务类型
- 现有业务 CSS
- 现有业务测试断言

禁止通过修改或删除现有测试来让回归通过。

---

# 第三部分：实施计划

## 31. 总体执行规则

每个阶段都遵循：

1. 记录阶段开始前 git status，保留用户已有改动。
2. 先写该阶段最小失败测试。
3. 只修改当前阶段白名单文件。
4. 实现最小可用能力。
5. 运行 Mind Map 测试。
6. 运行隔离测试。
7. 运行受影响的现有回归。
8. 阶段 Gate 未通过不得进入下一阶段。

任何失败若来自用户已有未提交改动，不覆盖、不回退，先定位并报告。

## 32. Phase 0：基线与隔离护栏

目标：在写功能前先建立“不能碰什么”的自动防线。

任务：

- [ ] 记录当前 build、typecheck 和现有核心测试结果。
- [ ] 新增 tests/mind-map/module-boundary.test.ts。
- [ ] 扫描 src/mindMap 的 import，拒绝所有禁止业务路径。
- [ ] 新增 tests/e2e/mind-map-isolation.spec.ts 骨架。
- [ ] 实现读取五个 Store 稳定快照和 hash 的测试 helper。
- [ ] 记录打开 Mind Map 前后的 localStorage、IndexedDB 和 workspace queue 变化。
- [ ] 定义 Mind Map 专用 data-testid 前缀 mind-map-。

Gate：

- 边界测试可在出现一个禁止 import 时稳定失败。
- 现有测试基线有记录。
- 没有修改任何现有业务实现。

## 33. Phase 1：页面壳与懒加载

目标：新增空白独立页面，同时证明它不会影响其他页面。

新增：

- src/mindMap/index.ts
- src/mindMap/MindMapWorkspace.tsx
- src/mindMap/MindMapErrorBoundary.tsx
- src/mindMap/config.ts
- src/mindMap/styles/MindMapWorkspace.module.css

最小接线：

- Toolbar 增加入口。
- App 增加 lazy import 和独立渲染分支。
- PhoneWorkspace 只补类型映射。

测试：

- 页面入口可访问。
- 其他六个页面仍可逐一打开。
- 不进入页面时不加载主要 chunk。
- 页面抛错后 Error Boundary 可返回 Timeline。
- CSS 不改变其他页面关键布局截图。
- 手机上进入 mind-map 时不渲染 PhoneWorkspace 业务摘要。

Gate：

- build 和 app-shell E2E 通过。
- 新页面错误不导致应用白屏。
- 其他 Store hash 不变。

## 34. Phase 2：数据模型与独立持久化

目标：完成多文档和可靠本地保存。

任务：

- [ ] 定义 Release 1 数据类型和默认值。
- [ ] 使用 crypto.randomUUID。
- [ ] 实现 normalizeMindMapDocument。
- [ ] 实现独立数据库 repository。
- [ ] 实现文档 index。
- [ ] 实现创建、重命名、复制、切换和删除。
- [ ] 实现 350ms 合并保存、手动 flush 和应急日志。
- [ ] 实现 schemaVersion 和 v1 migration 入口。
- [ ] 高版本文档拒绝覆盖。

测试：

- 单文档保存刷新恢复。
- 多文档互不影响。
- 文档复制引用重绑。
- IndexedDB 写失败不改变其他页面。
- Mind Map 操作不改变 WorkspaceBackup。
- localStorage 只出现 mind-map 前缀。

Gate：

- 刷新恢复无数据丢失。
- 五个现有 Store hash 不变。
- workspace schema 和同步队列不变。

## 35. Phase 3：Command 与 History

目标：建立之后所有写操作的唯一通道。

任务：

- [ ] 定义 Command、Patch 和 Transaction。
- [ ] 实现 execute、undo、redo。
- [ ] 实现每文档独立历史。
- [ ] 历史限制 100 个事务。
- [ ] 实现创建、删除、更新、移动 Node 命令。
- [ ] 实现创建、删除、更新、重连 Edge 命令。
- [ ] 禁止 UI 直接 set 持久数据。

测试：

- 每个命令 apply/revert 对称。
- 批量删除完整恢复。
- 删除节点同时恢复 Edge。
- 文档 A 的 Undo 不影响文档 B。
- 刷新后历史清空但文档内容保留。

Gate：

- 后续持久数据修改均可追踪到 Command。
- History 测试全部通过。

## 36. Phase 4：相机、Renderer 与交互控制器

目标：建立可测试的无限画布内核。

任务：

- [ ] world/view 坐标转换。
- [ ] Camera 平移、指针中心缩放和范围限制。
- [ ] Canvas DPR 适配。
- [ ] Render Scheduler。
- [ ] 基础 Node 和 Edge 绘制。
- [ ] bounding box、hit test 和 viewport culling。
- [ ] Pointer Capture 与交互状态机。
- [ ] 页面卸载完整 cleanup。

测试：

- 坐标往返误差。
- 指针中心缩放前后对象屏幕位置稳定。
- Fit All 和 Fit Selection。
- hit test 层级正确。
- 卸载后无活动 RAF、Worker 和 window listener。

Gate：

- 空画布与 500 静态节点可稳定绘制。
- 画布操作不触发其他 Store 更新。

## 37. Phase 5：节点编辑

目标：完成 Release 1 节点闭环。

任务：

- [ ] 双击创建。
- [ ] HTML 文本 Overlay。
- [ ] 中文 IME。
- [ ] auto/manual 尺寸。
- [ ] 单选、多选、框选。
- [ ] 单节点和多节点拖动。
- [ ] resize。
- [ ] 样式 Inspector。
- [ ] 锁定与 zOrder。
- [ ] Tab 子节点和 Enter 同级节点。

测试：

- 空文本取消。
- composition 不被快捷键截断。
- 拖动只生成一个历史。
- 多选保持 offset。
- 锁定对象不移动。
- 文本测量中英文换行正确。

Gate：

- 创建、编辑、保存、刷新、Undo 闭环通过。

## 38. Phase 6：Edge、剪贴板与快捷键

目标：形成完整图结构编辑。

任务：

- [ ] 连接手柄。
- [ ] straight 和 curve。
- [ ] 四种方向与箭头。
- [ ] Edge 选择和标签。
- [ ] Edge 重连。
- [ ] 内部剪贴板。
- [ ] 系统剪贴板适配。
- [ ] 页面级快捷键注册和清理。
- [ ] 右键菜单。

测试：

- 无悬空边。
- 重连失败恢复原端点。
- 粘贴重新生成 ID 并重绑内部 Edge。
- 输入框不触发画布 Delete/Ctrl+A。
- 离开页面后其他页面快捷键不受影响。

Gate：

- Node + Edge + History + Persistence 完整 E2E 通过。

## 39. Phase 7：布局、搜索和导入导出

目标：完成 Release 1 的生产可用工具。

任务：

- [ ] 四向树布局。
- [ ] 对齐和分布。
- [ ] 搜索、定位和高亮。
- [ ] JSON 校验、导入和导出。
- [ ] PNG 离屏导出。
- [ ] 文档菜单和保存状态。
- [ ] 状态栏。

测试：

- 布局无节点重叠。
- 布局一次 Undo 恢复全部位置。
- JSON 往返内容一致。
- 非法、高版本或超限文件不改变当前文档。
- PNG 导出尺寸和范围正确。
- 导入文件无法写入其他 Store。

Gate：

- Release 1 功能验收 A–I 全部通过。

## 40. Phase 8：移动端、无障碍与 Release 1 性能

目标：完成 Release 1 质量门槛。

任务：

- [ ] 触摸平移和缩放。
- [ ] 移动端节点创建、选择和文本编辑。
- [ ] Inspector Bottom Sheet。
- [ ] 键盘菜单和焦点管理。
- [ ] reduced motion。
- [ ] Canvas 可访问摘要。
- [ ] 500/2,000 节点基准数据生成器。
- [ ] 空间索引和几何缓存。
- [ ] 性能回归测试。

Gate：

- 390px、820px、1440px 视口验收通过。
- 500/2,000 节点达到指标。
- 现有页面性能没有可测回退。

## 41. Phase 9：Release 2 高级编辑

任务：

- [ ] Section 和 Group 数据与命令。
- [ ] Section 进入、离开、移动、自动尺寸和折叠。
- [ ] Orthogonal Edge 和控制点。
- [ ] 图片、URL、Markdown、LaTeX 节点。
- [ ] SVG 安全导出。
- [ ] 小地图和命令面板。
- [ ] 5,000 节点 benchmark。

Gate：

- Section 折叠不损坏内部对象或 Edge。
- 图片和 SVG 安全测试通过。
- 5,000 节点可打开、保存、缩放和定位。

## 42. Phase 10：Release 3 独立同步

任务：

- [ ] 设计每文档 Room ID。
- [ ] 页面挂载时按文档进入 Room，切换和卸载时离开。
- [ ] 实体级同步，不同步整张快照。
- [ ] Presence。
- [ ] 离线队列只属于 Mind Map。
- [ ] 本地/远端/基础三方合并。
- [ ] 删除与修改冲突测试。
- [ ] Mind Map 页面内同步状态。

禁止：

- 修改 workspaceSync。
- 修改 workspaceBackup。
- 把 Mind Map Store 加入现有统一 Room。
- 把同步状态加入现有 SyncDialog。

Gate：

- 两个浏览器上下文同账号同步通过。
- Mind Map 断网和冲突不影响其他同步域。

## 43. Phase 11：Release 4 AI

任务：

- [ ] 定义 Graph Patch schema。
- [ ] 实现输入裁剪和对象引用。
- [ ] 新增 namespaced Mind Map AI endpoint。
- [ ] 实现输出校验。
- [ ] 实现变更预览。
- [ ] 用户确认后通过 Command 提交。
- [ ] 完整 Undo。

Gate：

- AI 无法直接访问或修改 Store。
- 删除预览明确。
- 无效输出零修改。
- AI endpoint 不接收其他 SmartLine 数据。

## 44. Phase 12：Release 5 10k 与跨账号协作

10k：

- [ ] 分析 profiler，不凭猜测换技术。
- [ ] 布局迁入 Worker。
- [ ] 增量更新空间索引和几何缓存。
- [ ] 只有 Canvas 2D 达不到目标时才评估 WebGL。
- [ ] 10,000 节点 benchmark 和内存测试。

跨账号：

- [ ] 单独设计成员和 ACL。
- [ ] 服务端授权变更安全评审。
- [ ] 邀请、撤销、只读和编辑权限。
- [ ] 审计和滥用限制。

跨账号部分会修改页面外的服务端权限边界，必须单独批准，不得作为普通前端任务顺带实施。

---

# 第四部分：测试与发布

## 45. 单元测试

至少覆盖：

- schema 和 normalize。
- migration。
- coordinates 和 camera。
- bounding box 和 hit test。
- spatial index。
- Edge geometry。
- tree layout。
- Command apply/revert。
- History 合并。
- clipboard ID 重映射。
- JSON import validation。
- Graph Patch validation。

## 46. 集成测试

1. 创建节点 → 保存 → 刷新 → 恢复。
2. 创建 Edge → 保存 → 刷新 → 恢复。
3. 多选移动 → Undo → 全部恢复。
4. 删除节点 → Undo → Node、Edge 和 zOrder 恢复。
5. 文档切换 → 各自 viewport 和内容恢复。
6. IndexedDB 失败 → 当前页面提示 → 其他页面可用。
7. 非法导入 → 当前文档不变。
8. 页面卸载 → 监听、RAF 和 Worker 清理。
9. Release 3：离线修改 → 恢复网络 → 一致。

## 47. E2E

新增：

- tests/e2e/mind-map-navigation.spec.ts
- tests/e2e/mind-map-editor.spec.ts
- tests/e2e/mind-map-history.spec.ts
- tests/e2e/mind-map-persistence.spec.ts
- tests/e2e/mind-map-import-export.spec.ts
- tests/e2e/mind-map-isolation.spec.ts
- tests/e2e/mind-map-mobile.spec.ts
- tests/e2e/mind-map-performance.spec.ts

隔离 E2E 必须执行：

- 进入 Mind Map 前保存五个 Store hash。
- 在 Mind Map 创建、编辑、删除、布局、导入和导出。
- 切回每个现有页面验证可打开和基础操作。
- 再次读取五个 Store hash，必须一致。
- 检查 workspace queue、backup 和 sync room 未出现 Mind Map 字段。
- 强制 Mind Map 抛错后验证 Timeline 可用。
- 验证离开后 Space、Delete、Ctrl/Cmd+Z 和滚轮不被 Mind Map 拦截。

## 48. 每阶段回归命令

快速阶段：

~~~text
npm run check
npm run build
~~~

按影响运行：

~~~text
npm run test:auth
npm run test:sync
npm run test:duration
npm run test:life-map
npm run test:project-shift
npm run test:planning
npm run test:security
npm run test:system
~~~

发布候选：

~~~text
npm run test:all
~~~

如果完整 E2E 因环境不可用无法执行，发布状态必须标记为未验证，不得宣称零回归。

## 49. 发布策略

- VITE_MIND_MAP_ENABLED 作为构建期开关。
- 默认开发环境开启。
- 正式发布前先完成 Release 1 Gate。
- 关闭开关时隐藏导航且不加载 Mind Map。
- 回滚只需要关闭入口；独立数据库保留，避免用户数据丢失。
- 禁止回滚时删除 Mind Map IndexedDB。

## 50. 回滚与故障控制

若上线后发现问题：

1. 关闭 Mind Map 功能开关。
2. 验证其他六个页面恢复正常。
3. 保留独立数据库。
4. 修复后重新开启。
5. 只有用户明确执行“删除所有思维导图数据”时才清理数据库。

由于 Mind Map 不进入工作区 schema、backup 和其他 Store，关闭功能不需要迁移或回滚其他业务数据。

---

# 第五部分：风险与决策

## 51. 主要风险

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 直接扩展知识大盘 | 引入跨域耦合 | 明确禁止，创建 src/mindMap |
| 把 Store 加入全局 hydration | 阻塞整个应用启动 | Mind Map 只在页面内 hydrate |
| 全局快捷键残留 | 其他页面交互异常 | 页面级注册与卸载测试 |
| 全局 CSS 泄漏 | 其他页面视觉回归 | CSS Module + 截图回归 |
| 整图快照同步 | 多人覆盖和大数据性能差 | Release 3 实体级同步 |
| 一开始使用 WebGL | 双渲染器和维护成本 | Canvas 2D，基准后升级 |
| 把历史持久化或同步 | schema 和协作重放错误 | 历史仅本地内存 |
| 导入绕过 Command | 数据损坏且不可撤销 | 临时校验后原子命令 |
| AI 直接写 Store | 绕过历史和安全 | Graph Patch + 确认 + Command |
| 跨账号协作改动认证 | 扩大安全边界 | Release 5 单独评审 |

## 52. 已做出的关键决策

1. 新建页面，不改造知识大盘。
2. 新建数据域，不接入现有五个业务 Store。
3. 使用独立 IndexedDB 数据库。
4. 不加入现有统一工作区同步和备份。
5. Release 1 使用 Canvas 2D，不提前引入大型画布依赖。
6. Undo/Redo 不跨刷新、不跨设备。
7. Release 1 只实现 TextNode。
8. Section、Group、高级节点、协作和 AI 分阶段交付。
9. 真正跨账号协作需要单独批准服务端权限改动。
10. 每阶段必须先通过隔离 Gate，再增加功能。

---

# 53. 开工清单

在第一行功能代码提交前确认：

- [ ] 本文档已确认。
- [ ] Release 1 范围已冻结。
- [ ] Phase 0 基线测试已运行并记录。
- [ ] 当前脏工作区文件已记录且不会被覆盖。
- [ ] 允许修改文件白名单已确认。
- [ ] module-boundary 测试已建立。
- [ ] mind-map-isolation E2E 骨架已建立。
- [ ] 功能开关策略已确认。

只有以上全部完成，才开始页面壳和数据模型实施。

---

# 54. 一句话验收标准

> 用户可以在新增的“思维导图”页面中独立完成导图的创建、编辑、保存、恢复和导出；无论该页面如何操作或失败，SmartLine 现有六个页面的数据、同步、备份、快捷键、样式、启动和主要功能都保持原样。
