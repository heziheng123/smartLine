# SmartLine

SmartLine 是一个面向个人长期规划、项目执行、每日安排与复习管理的本地优先 Web 应用。它把人生目标、年度项目、项目任务、每日时间安排、艾宾浩斯复习和知识树放在同一个工作区中，并通过统一的数据协议保持跨视图联动。

项目基于 React 18、TypeScript、Vite 和 Zustand。浏览器端以 IndexedDB 为主存储；可选接入 GitHub OAuth、Liveblocks 实时同步和 Cloudflare R2 历史归档。应用同时提供 PWA、离线写入队列、完整工作区备份、本地快照和冲突恢复。

## 功能概览

- **人生地图**：项目、项目子阶段、长期系统、关键日期、时期重点和文字便签；按固定“学习 / 工作 / 生活”一级分类与可自由管理的二级分类展示，长期系统在分类轨道顶部，支持上下泳道、128px sticky 标签栏、维护暂停与批量顺延。历史目标仅作底层兼容保留，不在 UI 出现。
- **项目规划**：年度时间轴、项目分组、里程碑、便签、块式项目文档和整项目顺延。
- **每日安排**：时段/时间块排程、拖拽、自由事项、数量进度、每日复盘和学习记录。
- **周矩阵**：按周组织任务，提供待规划河流、跨日拖拽、批量处理和冷冻仓。
- **艾宾浩斯复习**：按复杂度与间隔生成复习轮次，支持负载分散、逾期调整和每日复习规划。
- **知识大盘**：树形知识结构、节点激活、项目任务绑定、复习联动、学习摘要和归档。
- **数据安全**：完整 JSON 备份、压缩快照、跨标签页协调、离线队列、三方合并、GitHub 准入和 R2 月度归档。

详细使用说明见 [产品与功能手册](docs/product-guide.md)，技术设计见 [架构与数据说明](docs/architecture.md)。

## 快速开始

环境要求：Node.js 22（CI 使用版本）、npm 10 或更高版本；Chromium 仅在端到端测试时需要。

```bash
npm ci
copy .env.example .env
npm run dev
```

默认开发地址为 `http://localhost:5173`。未配置 Liveblocks 时仍可使用本地功能；如需云同步，按 [部署指南](DEPLOY_GUIDE.md) 配置环境变量和 Pages Functions。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | TypeScript 检查并生成生产包 |
| `npm run lint` | 运行 ESLint |
| `npm run test:all` | 运行安全、领域、系统和端到端测试 |
| `npm run test:e2e` | 运行桌面与小屏 Chromium 测试 |
| `npm run test:e2e:ui` | 以 Playwright UI 模式调试 |
| `npm run check` | 类型检查并运行项目内固定版本的 `depcheck` |
| `npm run audit` | 查询 npm 已知依赖漏洞 |

测试矩阵、目录约定和调试说明见 [开发与测试指南](docs/development.md)。

## 运行模式

1. **纯本地模式**：不配置 Liveblocks，数据保存在当前浏览器 IndexedDB。
2. **兼容同步模式**：使用 `VITE_LIVEBLOCKS_PUBLIC_KEY` 连接旧房间，仅建议用于历史部署迁移。
3. **认证统一工作区**：GitHub OAuth 登录后，由 Pages Function 使用 `LIVEBLOCKS_SECRET_KEY` 为当前用户和房间签发最小权限令牌；这是正式部署推荐方式。

环境变量、Cloudflare Pages、R2 和迁移步骤见 [部署指南](DEPLOY_GUIDE.md) 与 [数据架构迁移指南](docs/data-architecture-migration.md)。

## 项目结构

```text
src/
  auth/                 GitHub 会话门禁
  components/           时间轴、项目文档、每日安排与通用 UI
  domain/               跨视图业务规则与纯计算
  ebb/                  艾宾浩斯复习模块
  graph/                知识大盘模块
  lifeMap/              独立人生地图数据域
  services/             命令、撤销、备份、同步和归档
  store/                时间轴 store 与持久化
  utils/                日期、布局、导入和富文本净化
functions/              Cloudflare Pages Functions
public/                 PWA、Service Worker 和安全响应头
tests/                   领域、鉴权、同步和 Playwright 测试
scripts/                 安全扫描与系统模拟
docs/                    产品、架构、开发、审查与迁移文档
```

## 数据注意事项

- 首次连接统一工作区会比较本地与云端的摘要和 SHA-256；双方非空且不一致时拒绝自动覆盖。
- 启用同步、迁移房间、导入备份或升级 schema 前，先在“云同步与完整备份”中导出完整 JSON。
- 不要手工编辑 IndexedDB 或 Liveblocks Storage；恢复时优先使用应用内快照、冲突副本和完整备份。
- 完整备份当前 schema 版本为 `6`；版本 1–5 会自动升级并规范化人生地图分类、全局关键日期和可选关系，高版本数据会被旧客户端拒绝加载。

## 当前质量状态

当前门禁覆盖源代码、Pages Functions、构建脚本、主要业务算法和桌面/小屏浏览器流程。每次发布以前述固定命令的实时结果为准，不在文档中固化容易过期的测试数量。详见[代码审查与修复报告](docs/code-review-report.md)和[开发与测试指南](docs/development.md)。

## 文档索引

- [产品与功能手册](docs/product-guide.md)
- [架构与数据说明](docs/architecture.md)
- [开发与测试指南](docs/development.md)
- [人生地图信息架构与创建流程](docs/life-map-information-architecture.md)
- [人生地图项目泳道设计与开发指南](docs/life-map-plan-swimlanes.md)
- [部署指南](DEPLOY_GUIDE.md)
- [数据架构迁移指南](docs/data-architecture-migration.md)
- [代码审查报告](docs/code-review-report.md)
