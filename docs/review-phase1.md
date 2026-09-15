# 文字复盘 Phase 1 部署

文字复盘先在浏览器的独立 IndexedDB 数据库 `smart-line-review` 保存。登录后的页面会将本机 Outbox 发送到 Pages Functions；服务端以用户和日期为键写入 D1，payload 包含稳定 Review 容器、工作草稿和全部完成版本，并用 `revision`、操作回执和乐观并发控制防止覆盖。

部署前完成以下配置：

1. 在 Cloudflare 创建 D1 数据库，并执行 [`migrations/0001_reviews.sql`](../migrations/0001_reviews.sql)。
2. 在 Pages 项目的 Production 和 Preview 环境分别绑定该 D1 数据库，绑定名必须是 `REVIEW_DB`。
3. 复用现有 GitHub 登录所需环境变量；未登录的客户端只保留本机草稿。
4. 在 Pages 环境变量中新增加密机密 `DEEPSEEK_API_KEY`；可选变量 `DEEPSEEK_MODEL=deepseek-flash`。它们不得使用 `VITE_` 前缀，也不能放入客户端代码。

部署后，打开“每日复盘”：保存原始文本后可手工编辑或使用“AI 整理”；同一复盘版本的 AI 请求使用 D1 回执复用结果，不会重复调用供应商。完成复盘会保存不可变完成快照，之后的修改自动回到新的工作草稿；任意旧快照可恢复为新的工作草稿。网络中断时内容仍在本机 Outbox，恢复联网后自动同步；同一日期出现并发修改时保留本机内容并要求用户点击“以本机版本继续”后再覆盖云端。

本阶段不处理或上传任何音频；语音输入属于后续 Phase 2。
