# SmartLine 技术文档

本文件保留为编辑器/代理兼容入口。技术文档的权威版本为：

- [架构与数据说明](../../docs/architecture.md)
- [开发与测试指南](../../docs/development.md)
- [人生地图信息架构与创建流程](../../docs/life-map-information-architecture.md)
- [人生地图项目泳道设计与开发指南](../../docs/life-map-plan-swimlanes.md)
- [部署指南](../../DEPLOY_GUIDE.md)
- [数据架构迁移与恢复](../../docs/data-architecture-migration.md)
- [全面代码审查报告](../../docs/code-review-report.md)

## 技术摘要

前端使用 React 18、TypeScript、Vite 和 Zustand。五个业务 store 以 IndexedDB 为本地主存储，通过字段写入日志、离线队列和三方合并接入 Liveblocks 统一房间。Cloudflare Pages Functions 提供 GitHub OAuth、HMAC session、房间范围令牌和可选 R2 归档。

当前完整工作区 schema 为 `6`。schema 5 引入 `lifeMapPlanGroups` 与领域映射；schema 6 支持全局关键日期和可选对象关系。当前 UI 将 `LifeArea` 视为学习/工作/生活下的二级分类，并排除历史 `kind: 'goal'` 投影；底层字段、Store、同步和备份保持兼容。长期系统/项目/子阶段布局、创建上下文和时期重点兼容均由独立纯逻辑模块承载。滚动固定元素使用 CSS sticky，小地图关闭时禁止逐帧画布 DOM 写入。

请不要在本文件维护另一套完整架构说明；实现变化统一更新 `docs/architecture.md` 和 `docs/development.md`。
