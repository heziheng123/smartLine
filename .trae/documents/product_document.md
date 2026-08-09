# SmartLine 产品文档

本文件保留为编辑器/代理兼容入口。产品文档的权威版本已经迁移到：

- [产品与功能手册](../../docs/product-guide.md)
- [人生地图信息架构与创建流程](../../docs/life-map-information-architecture.md)
- [人生地图项目泳道设计与开发指南](../../docs/life-map-plan-swimlanes.md)
- [项目总览与快速开始](../../README.md)
- [当前代码审查报告](../../docs/code-review-report.md)

## 产品摘要

SmartLine 是本地优先的个人规划与学习工作区，包含人生地图、项目规划、每日安排、周矩阵、艾宾浩斯复习和知识大盘。人生地图从单列添加菜单创建项目、长期系统、关键日期、时期重点和文字便签；长期系统、项目和子阶段按固定“学习 / 工作 / 生活”一级分类与用户可管理的二级分类展示，系统固定在对应分类轨道上方，所有屏幕保留 128px sticky 标签栏。目标实体不再提供任何可见入口或展示。

正式部署推荐 GitHub OAuth + Pages Function + Liveblocks 统一工作区；Cloudflare R2 是可选月度归档层。任何迁移或恢复都应先导出完整 JSON，并遵循失败关闭和 hash 校验流程。

请不要在本文件复制完整功能说明，以免再次与实现产生分叉；更新产品行为时同步修改 `docs/product-guide.md`。
