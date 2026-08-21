# 人生地图视图重设计 — 需求文档 v13

## Adaptive Life Path / 自适应生命路径

> **版本定位：**
> v13 基于 v12 全量升级。保留“主视图宏观人生路径 + 阶段工作台详细时间轴”的产品架构，同时正式将主路径从固定 S 型曲线升级为 **Adaptive Life Path（自适应生命路径）**。
>
> **核心变化：**
>
> 主路径不再是机械重复的正弦 S 曲线，而是一条会根据人生阶段、重要程度、阶段重叠和当前时间焦点，在 **X 方向自然舒展、收拢、分叉** 的纵向生命路径。
>
> **最重要的底层原则不变：**
>
> > **时间始终严格线性映射到 Y 轴；所有路径形态变化只发生在 X 轴。**

---

# 1. 产品定位

## 1.1 一句话概括

> **主视图看人生节奏与阶段全貌，阶段工作台看阶段内部的项目、系统与具体事件。**

人生地图不是甘特图，也不是任务列表。

它应该首先让用户感受到：

> **“我的人生现在走到哪里了？”**

然后进一步理解：

> **“这个阶段发生了什么？我正在推进什么？”**

---

# 2. 核心产品结构

```text
人生地图
│
├── 主视图：Adaptive Life Path
│   │
│   ├── 时间刻度
│   ├── 自适应生命路径
│   ├── 阶段
│   ├── 关键日期
│   └── 今天
│
└── 阶段工作台：Stage Workspace
    │
    ├── 阶段信息
    ├── 阶段统计
    ├── 独立缩放
    └── 水平时间轴
        ├── 项目
        ├── 子阶段
        ├── 时期重点
        ├── 长期系统
        └── 文字便签
```

---

# 3. Adaptive Life Path 核心概念

## 3.1 定义

Adaptive Life Path 是：

> **一条垂直延伸、时间严格映射到 Y 轴，同时允许在 X 方向根据人生结构自然变化的生命路径。**

它不是一条固定的：

```text
S S S S S
```

而是：

```text
平缓
 ↓
舒展
 ↓
收拢
 ↓
转折
 ↓
分叉
 ↓
重新汇合
```

形成更接近“人生轨迹”的视觉感受。

---

# 4. 六条核心设计原则

## 4.1 时间严格线性

```text
date → Y
```

是唯一真实时间映射。

禁止：

* 压缩空白时间
* Fit-to-Screen
* 根据内容重新排列 Y
* 根据阶段重要程度改变垂直距离

---

## 4.2 曲线只表达视觉节奏

X 轴：

> 只表达路径的视觉形态，不表达实际时间。

因此：

```text
x = visualPath(worldY)
y = time(worldDate)
```

---

## 4.3 阶段可以影响路径形态

阶段可以影响：

* 横向振幅
* 曲率
* 舒展程度
* 局部路径视觉层级

但是：

> **绝对不能影响 Y 轴时间映射。**

---

## 4.4 重要阶段可以“展开”

重要阶段可以让路径在 X 方向更加舒展。

例如：

```text
普通阶段
────╮
    ╰────

重要阶段
     ╭────────╮
─────╯        ╰────
```

这种“展开”只是横向视觉变化。

---

## 4.5 重叠阶段可以“分叉”

当两个或多个阶段同时存在：

```text
        ╭──────╮
───────╯      ╰──────
       ╰──────╮
              ╰──────
```

路径允许形成视觉上的平行分叉。

阶段结束后重新回归主路径。

---

## 4.6 今天是视觉焦点

今天附近：

* 路径透明度提高
* 色彩更加清晰
* Today marker 强化
* 当前阶段视觉优先级提高

但不能产生强烈的“游戏化发光”。

---

# 5. 主路径不是固定公式

v13 不再规定：

> 每年必须用一个完整正弦周期。

改为：

> **路径具有长期连续性、平滑性和自然节奏。**

产品要求：

* 视觉连续
* 不出现尖锐折角
* 不发生自交
* 不发生突然横跳
* 年度尺度下具有舒展变化
* 长时间跨度下不会产生机械重复感

实现可以使用：

* 正弦函数
* Bezier
* Catmull-Rom
* 平滑采样曲线
* 其他经过验证的连续函数

但最终必须满足统一 Geometry API。

---

# 6. Adaptive Life Path 几何模型

建立：

```text
src/lifeMap/geometry/lifePathGeometry.ts
```

负责：

```ts
getLifePathX(worldY)
getLifePathPoint(worldY)
getLifePathTangent(worldY)
getLifePathNormal(worldY)

getAmplitudeAt(worldY)
getCurvatureAt(worldY)

createStageBand(...)
createParallelStageBands(...)
```

React 不直接处理复杂路径几何。

---

# 7. 三层坐标系统

所有主视图统一使用：

```text
Time Space
     ↓
World Space
     ↓
Viewport Space
```

---

## 7.1 Time Space

真实日期：

```text
2026-08-20
```

---

## 7.2 World Space

整个生命周期画布的绝对位置。

```ts
worldY = dateToWorldY(date)
```

---

## 7.3 Viewport Space

当前浏览器可视区域。

```ts
viewportY =
  worldY - scrollTop
```

---

# 8. 时间映射

统一：

```ts
dateToWorldY(date)
worldYToDate(y)
```

公式：

```text
worldY =
daysBetween(date, baseDate)
× pixelsPerDay
```

其中：

```text
baseDate = minDate - 90 days
```

---

# 9. 主路径时间范围

主路径默认由：

* LifeMapStage
* LifeEvent
* Today

决定。

```text
minDate =
min(all active Stage.start, all active Event.date, today)

maxDate =
max(all active Stage.end, all active Event.date, today)
```

普通项目、系统、便签不主动拉长主路径范围。

这样可以避免历史孤立数据导致整个地图异常变高。

---

# 10. 前后留白

时间范围：

```text
顶部 +90 天
底部 +90 天
```

总高度：

```text
TotalHeight =
(maxDate - minDate + 180 days)
× pixelsPerDay
```

---

# 11. 缩放

| 级别 | pixels/day |     每年高度 |
| -- | ---------: | -------: |
| 年  |          3 |  ≈1095px |
| 月  |         12 |  ≈4380px |
| 周  |         40 | ≈14600px |
| 日  |         60 | ≈21900px |

缩放只改变：

```text
Y 时间密度
```

不改变：

```text
Path 的基础视觉宽度
```

---

# 12. 路径容器

时间刻度区域：

```text
80px
```

路径区域：

```text
200px
```

中心线：

```text
centerX = 180px
```

路径横向变化围绕 centerX 发生。

---

# 13. 自适应振幅系统

## 13.1 基础振幅

默认：

```text
BaseAmplitude = 30px
```

约为路径宽度：

```text
15%
```

---

## 13.2 最大视觉振幅

允许：

```text
60~80px
```

但必须经过：

* 曲率检查
* Stage band 检查
* overlap 检查
* viewport 边界检查

---

# 14. Path Amplitude Profile

路径不再使用固定 amplitude。

定义：

```ts
amplitude(worldY)
```

它由多个因素共同影响：

```text
BaseAmplitude
+
Stage Influence
+
Importance Influence
+
Today Focus Influence
+
Overlap Influence
```

最终：

```text
x =
centerX
+
amplitude(worldY)
× pathShape(worldY)
```

---

# 15. 阶段驱动的路径展开

阶段本身可以对路径产生视觉影响。

普通阶段：

```text
amplitude = base
```

重要阶段：

```text
amplitude = base × 1.5
```

当前阶段：

```text
amplitude = base × 1.8
```

但具体数值在视觉原型阶段校准。

---

# 16. 阶段影响的平滑过渡

路径不能在阶段边界突然改变振幅。

因此阶段影响需要：

```text
Smooth In
+
Stable
+
Smooth Out
```

例如：

```text
        _________
      /           \
─────               ─────
```

而不是：

```text
──────╮
      ╰────────╮
               ╰────
```

禁止视觉上的突变。

---

# 17. 空白时期

没有阶段的时间段：

> 不显示空白提示。

但是路径本身仍然保持自然连续。

空白时期可以：

* 收窄
* 保持基础振幅
* 非常轻微地降低视觉权重

但不能出现：

> 路径断裂。

---

# 18. 人生转折

可以允许路径在某些重要日期附近出现：

> **轻微方向变化或曲率变化。**

例如：

```text
──────╮
      ╰───╮
          ╰────
```

但必须满足：

* 平滑
* 连续
* 不形成尖角
* 不改变真实时间比例

---

# 19. 今天附近的视觉聚焦

Today 附近：

```text
±90 days
```

路径可以：

* 略微提高振幅
* 提高透明度
* 提高主线清晰度

但只允许：

> **轻微视觉增强。**

不能让今天附近形成巨大的视觉弯曲。

---

# 20. 路径“自然感”规则

必须满足：

### 不机械

不能：

```text
S S S S S S S
```

### 不随机

不能：

```text
╲╱╲╱╲╱╲╱
```

### 不突变

不能：

```text
─────╮
     └────
```

### 不自交

任何缩放级别都不能发生。

### 不产生真实空间误导

X 轴永远不代表时间。

---

# 21. 路径曲率上限

对路径进行动态曲率保护。

始终确保：

```text
Rmin > maxStageOffset
```

当不满足：

```text
自动降低局部 amplitude
```

使曲线更加平缓。

---

# 22. Stage Overlay

阶段依然不是路径本身。

结构：

```text
Base Life Path
       +
Stage Band
```

因此：

* 路径始终存在
* Stage 是覆盖层
* Event 可以独立覆盖
* Today 可以独立覆盖

---

# 23. 阶段弧带

阶段使用：

> 封闭 SVG path

禁止：

* stroke-width
* CSS rectangle
* vertical div

---

# 24. 弧带生成

中心线：

```text
每 4px 采样
```

计算：

```text
tangent
normal
```

左右边界：

```text
center ± normal × halfWidth
```

最终：

```text
left boundary
+
right boundary reverse
+
rounded caps
=
closed path
```

---

# 25. Stage Band 宽度

总路径宽：

```text
200px
```

统一公式：

```ts
bandWidth =
(PATH_WIDTH - gap × (count - 1))
/ count
```

---

# 26. 单阶段

```text
200px
```

视觉重点较轻时可以：

```text
60~100px
```

具体采用：

> **根据阶段重要程度动态决定视觉宽度。**

但整个 stage 布局系统仍以 200px 为最大容器宽度。

---

# 27. 阶段视觉等级

建议加入：

| 等级  |    默认视觉宽度 |
| --- | --------: |
| 普通  |   60~80px |
| 重要  |  90~120px |
| 当前  | 120~160px |
| 强焦点 |    ≤200px |

重要程度可以由：

* 是否包含今天
* 阶段持续时间
* 用户主动选中
* 用户设定的重要性

共同决定。

---

# 28. 阶段颜色

使用 Stage 自己的颜色。

填充：

```text
15%
```

描边：

```text
40%
1px
```

选中：

```text
Accent
2px
```

---

# 29. 阶段文字

使用：

```text
foreignObject
+
HTML div
```

禁止：

* textPath
* writing-mode

---

# 30. 阶段文字角度

计算路径切线：

```ts
angle =
atan2(dy, dx)
× 180 / PI
```

Clamp：

```ts
[-10°, +10°]
```

---

# 31. 阶段重叠

时间重叠时：

```text
主路径
   ↓
左右平行弧带
```

沿法线偏移。

禁止：

```css
translateX
```

作为整体偏移。

---

# 32. 三阶段以内

最多完整展示：

```text
3 条平行弧带
```

宽度动态计算。

---

# 33. 三阶段以上

优先级：

1. 包含今天
2. 当前选中
3. 持续时间最长
4. 其他阶段

隐藏其余：

```text
+N 个阶段
```

---

# 34. Path 分叉的语义

必须注意：

> “分叉”只是视觉上的阶段并行。

它不代表：

* 平行人生
* 两条独立时间轴
* 空间道路
* 两个人生方向

所有分叉仍然共享：

```text
同一个 World Y
```

---

# 35. Event

主路径显示所有未删除 LifeEvent。

关键日期比 Stage 更高层：

```text
Event
>
Stage
>
Base Path
```

---

# 36. Event 视觉

菱形：

```text
8×8px
```

重要程度：

```text
core → Warning
important → Accent
normal → Tertiary
```

外圈：

```text
2px
```

确保 Event 即使位于 Stage 内也完整显示。

---

# 37. Event 聚合

周 / 日级别大量 Event：

```text
◆
◆
+4
```

点击：

> 查看该日期全部事件。

---

# 38. Today

Today：

```text
8~10px
```

弱光晕：

```text
12~16px
```

定位 Today：

```text
260ms smooth scroll
```

Today 只是：

> 当前时间焦点。

不使用强游戏化光效。

---

# 39. 时间刻度

始终位于路径左侧。

不跟随曲线变化。

年：

```text
2025
2026
2027
```

月：

```text
1月
2月
3月
```

日：

```text
18
19
20
```

---

# 40. 年份锚点

每年增加非常弱的水平 anchor。

作用：

> 帮助用户快速理解长时间跨度。

不是装饰线。

---

# 41. 主视图工具栏

只保留：

```text
[新建阶段]
[年 / 月 / 周 / 日]
[定位今天]
```

---

# 42. 创建阶段

默认：

```text
drag = scroll
```

点击：

```text
新建阶段
```

以后：

```text
drag = select date range
```

---

# 43. 创建预览

拖拽期间显示：

> 半透明 Stage Band

同时：

```text
开始日期
结束日期
```

跟随鼠标更新。

---

# 44. Stage Workspace

点击阶段后：

```text
主路径 Stage selected
       ↓
Workspace 滑入
```

Workspace 是：

> 当前阶段的详细工作空间。

---

# 45. Workspace 宽度

推荐：

```text
400~480px
```

最小：

```text
380px
```

---

# 46. Workspace 结构

```text
Stage Header
     ↓
Stage Stats
     ↓
Timeline Toolbar
     ↓
Horizontal Timeline
```

---

# 47. Workspace 横向时间轴

时间轴真实宽度由：

```text
阶段持续天数
× sidebarPixelsPerDay
```

决定。

必须支持：

> **水平滚动。**

禁止压缩时间以适应 sidebar。

---

# 48. Workspace 缩放

支持：

* 月
* 半月
* 周
* 日

默认：

| 阶段长度   | 默认 |
| ------ | -- |
| >1年    | 月  |
| 3个月~1年 | 半月 |
| 1周~3个月 | 周  |
| <1周    | 日  |

---

# 49. Workspace 项目

显示：

```text
LifeGoal.kind = plan
```

时间有交集即显示。

---

# 50. 项目轨道

复用：

```text
assignInclusiveIntervalTracks
```

时间不重叠：

> 共用轨道。

时间重叠：

> 自动分轨。

---

# 51. 子阶段

`kind=phase`：

> 跟随父项目显示。

保留现有子阶段逻辑。

---

# 52. 跨阶段项目

完整项目：

```text
████████████████████
     Stage focus
```

阶段外部分：

> 最多显示当前 viewport 20%。

并使用：

```text
渐隐
```

表示还有延伸。

---

# 53. 系统

每个长期系统一行。

Check-in：

> 严格按实际日期定位。

---

# 54. 系统聚合

同周 >5 次：

```text
● 7
```

hover：

> 显示具体统计。

---

# 55. 阶段外系统

默认不显示阶段外 check-in。

hover 行：

> 阶段外还有 N 次打卡。

---

# 56. 无打卡系统

仍然显示系统行：

```text
系统名称
        此阶段暂无打卡记录
```

---

# 57. 时期重点

不出现在主路径。

全部进入 Workspace：

* LifeTheme
* LifeFocus
* range LifeMapNote

---

# 58. 时期重点视觉

水平色带：

```text
──────────────
暑期备考主线
```

使用分类颜色。

---

# 59. Pin Note

1px 竖线：

```text
      │
```

hover：

> 内容卡片。

---

# 60. Range Note

低透明度时间色带：

```text
████████████
```

---

# 61. 同日便签

一天最多显示一个完整卡片。

其余：

```text
+N
```

点击展开。

---

# 62. Stage Header

显示：

```text
名称
日期范围
描述
完成率
项目数
活跃系统数
```

操作：

```text
编辑
删除
关闭
```

---

# 63. Stage 统计

项目数：

```text
交集内 kind=plan
```

完成率：

```text
阶段内 plan + phase
calculateGoalProgress()
算术平均
```

系统：

```text
active
+
时间交集
```

---

# 64. 空阶段

显示：

> 此阶段暂无关联内容

按钮：

```text
创建项目
创建便签
```

---

# 65. Stage 编辑

在 Workspace Header 中编辑：

* 名称
* 日期
* 描述
* 颜色

修改实时反映到：

> 主路径 + Workspace。

---

# 66. Stage 删除

确认：

> 删除阶段不会删除其中的项目和系统。

确认：

```text
deletedAt
+
关闭 Workspace
+
移除 Stage
```

---

# 67. Stage 切换

点击另一个 Stage：

> Workspace 内容直接切换。

不需要关闭再打开。

---

# 68. 关闭

支持：

* ✕
* Esc
* 空白点击

空白点击条件：

```text
位移 <5px
时间 <300ms
```

---

# 69. 动效

### Stage Hover

```text
120ms
```

### Stage Select

```text
120~180ms
```

### Workspace

```text
220ms
```

### Zoom

```text
260ms
```

### Locate Today

```text
260ms
```

### Tooltip

```text
160ms
```

全部支持 reduced motion。

---

# 70. v1 不做复杂 L 型转场

不做：

```text
垂直路径
 ↓
90°折叠
 ↓
水平时间轴
```

只做：

```text
Stage Highlight
+
简单视觉连接
+
Workspace Slide In
```

复杂转场作为 v2 实验。

---

# 71. 时间深度视觉

v1 只允许：

> 远离今天的背景元素略微降低透明度。

不做：

* 色相变化
* 蓝红偏移
* 大范围渐变
* 复杂大气透视

---

# 72. Adaptive Path 的视觉层级

建议：

```text
远期
↓
较淡

近期
↓
正常

当前 ±90天
↓
清晰

当前 Stage
↓
重点

Today
↓
焦点
```

---

# 73. 路径视觉优先级

```text
Today
>
Selected Stage
>
Important Stage
>
Event
>
Normal Stage
>
Base Path
>
Background
```

注意 Event 虽然层级高于 Stage，但不能遮挡 Today。

最终：

```text
Today > Event > Stage > Path
```

---

# 74. 视觉宽度原则

路径本身：

```text
3px
```

Stage：

```text
60~200px
```

Event：

```text
8px
```

Today：

```text
8~10px
```

所有元素形成明显层级。

---

# 75. 性能

主视图必须使用窗口化渲染。

仅渲染：

```text
Viewport
+
约 1 屏 Buffer
```

---

# 76. 滚动性能

滚动过程中：

* 不频繁提交 React 状态
* 避免重建全量路径
* 避免生成不可见 foreignObject
* 停止滚动后统一提交稳定状态

---

# 77. Geometry Layer

建议：

```text
src/lifeMap/geometry/
├── lifePathGeometry.ts
└── stageBandGeometry.ts
```

---

# 78. Selector Layer

建议：

```text
src/lifeMap/selectors/
└── lifeMapSelectors.ts
```

包括：

```ts
getLifeMapDateRange()
getVisibleStages()
getVisibleEvents()
getStageContents()
getStageStats()
getStageOverlaps()
getPathProfile()
```

---

# 79. Component Layer

建议：

```text
LifeMapWorkspace
LifeMapToolbar
LifeMapCanvas
LifeMapTimeRuler
LifePath
StageBand
EventMarker
TodayMarker
StageStats
StageOverflow

StageWorkspace
StageHeader
StageStats
StageTimeline
StageProjectTrack
StageSystemRow
StageFocusBand
StageNote
```

---

# 80. 技术栈

必须：

```text
React
+
原生 SVG
+
HTML Overlay
+
Zustand
```

禁止：

* D3
* ECharts
* Three.js
* 复杂图表库

---

# 81. 不允许的实现方式

禁止：

```text
CSS 矩形模拟 Stage
```

禁止：

```text
stroke-width 模拟厚弧带
```

禁止：

```text
writing-mode: vertical-rl
```

禁止：

```text
大量 DOM 渲染整个多年时间轴
```

禁止：

```text
用 Fit-to-Screen 压缩真实时间
```

禁止：

```text
不同组件自己定义 date → position
```

---

# 82. 数据兼容

`LifeMapStage` 直接复用。

新增：

```ts
description?: string
```

其他数据模型不迁移。

---

# 83. 旧字段

继续保留：

```text
placement
layoutLane
```

但新视图不使用其布局意义。

---

# 84. 视觉规范

整体基调：

> 克制、柔和、精确、长期主义。

禁止：

* 霓虹
* 过强发光
* 大面积玻璃
* 夸张渐变
* 游戏化 UI

---

# 85. 生命路径的视觉目标

用户看到路径时，不应该想到：

> “波浪图。”

应该想到：

> **“我的人生正在向前延伸。”**

路径应该具有：

* 连续性
* 节奏
* 舒展
* 转折
* 当前焦点
* 长期感

---

# 86. Adaptive Life Path 的核心视觉语义

### 收拢

表示：

> 普通、平稳的时间段。

### 舒展

表示：

> 人生阶段的重要展开。

### 曲率变化

表示：

> 进入新的阶段或转折。

### 分叉

表示：

> 多阶段并行。

### 汇合

表示：

> 重叠阶段结束，重新回到统一人生轨迹。

### Today Focus

表示：

> 当前人生位置。

---

# 87. 路径变化必须克制

路径变化不能成为“数据编码图表”。

不能让用户看到：

> “这里弯得比较厉害，所以重要性是 80%。”

路径只是：

> **人生时间的叙事视觉隐喻。**

真正的数据仍然通过：

* Stage
* Event
* Stage Workspace

表达。

---

# 88. 测试

必须建立 Geometry 单元测试：

```text
dateToWorldY
worldYToDate
getLifePathX
getTangent
getNormal
getAmplitude
createStageBand
createParallelStageBands
```

---

# 89. Geometry 关键断言

必须保证：

```text
Y 映射严格线性
曲线连续
路径不自交
Stage band 不自交
法线偏移稳定
角度 ∈ [-10°, +10°]
缩放不破坏时间比例
```

---

# 90. E2E

至少覆盖：

* 无 Stage
* 单 Stage
* 多 Stage
* Stage overlap
* 四个以上 overlap
* Today
* Event
* 创建
* 编辑
* 删除
* Workspace
* 项目
* 系统
* Note
* Zoom
* Horizontal Scroll
* Locate Today

---

# 91. 性能测试

至少：

```text
10年
20年
50年
100个 Stage
500个 Event
1000个 Event
```

要求：

> DOM 数量与当前可视窗口相关，而不是与整个历史数据量线性增长。

---

# 92. v1 必须完成

```text
Adaptive Life Path
严格时间 Y 映射
Stage
Event
Today
Stage overlap
Stage Workspace
Projects
Phases
Systems
Focus
Notes
独立缩放
水平时间轴
创建/编辑/删除 Stage
Zustand 联动
窗口化渲染
性能测试
E2E
```

---

# 93. v1 不做

```text
复杂 L 型空间折叠
3D
复杂透视
强大气效果
色相随时间变化
主路径 Focus
移动端完整交互
无限 Stage nesting
复杂路径粒子效果
```

---

# 94. 实施顺序

```text
Phase 1
数据兼容
LifeMapStage.description

Phase 2
Time / World / Viewport

Phase 3
Adaptive Life Path Geometry

Phase 4
Base Path + Time Ruler

Phase 5
Stage Overlay

Phase 6
Event + Today

Phase 7
Stage Selection

Phase 8
Stage Workspace

Phase 9
Projects + Phases

Phase 10
Systems + Focus + Notes

Phase 11
Virtual Window

Phase 12
Performance

Phase 13
E2E

Phase 14
视觉打磨
```

---

# 95. 最终视觉目标

最终页面应该形成这样的视觉感受：

```text
                2025

                  ╲
                   ╲
                    ╭─────────╮
                    │ 大学阶段 │
                   ╰─────────╯
                          ╲
                           ╲
                            ╭──────╮
                            │ 转折  │
                       ╭────╯
                      ╱
                     ╱
                    ● Today
                   ╱
              ╭────╯
              │ 工作阶段
              ╰──────────╮
                         ╲
                          ╲
                           ╭────────
                                2027
```

它不是严格意义上的地图。

它也不是普通甘特图。

它是：

> **一条按照真实时间向下延伸、会随人生阶段自然舒展、收拢、分叉和重新汇合的生命路径。**

---

# 96. 最终产品理念

SmartLine 人生地图最终应该从：

> **“我有哪些计划？”**

升级为：

> **“我的人生正在经历什么？”**

再进一步：

> **“我现在在哪里？这个阶段是什么？接下来我要走向哪里？”**

---

# 97. 最终一句话定义

> **Adaptive Life Path 是一条严格由真实时间驱动、由人生阶段赋予节奏的纵向生命路径：时间决定它向哪里前进，人生阶段决定它如何舒展，而当前时刻决定用户此刻应该关注哪里。**
