# Liveblocks + Vercel 部署指南

## ✅ 已完成的改造

我已经完成了以下工作：

1. ✅ 安装了 Liveblocks 依赖包
2. ✅ 改造了 Zustand Store，集成 Liveblocks 中间件
3. ✅ 改造了 SyncDialog 组件，使用 Liveblocks API
4. ✅ 删除了旧的 sync-server 和 WebSocket 服务代码
5. ✅ 创建了 `.env.example` 文件并更新了 `.gitignore`

## 📝 需要你完成的步骤

### 步骤 1：注册 Liveblocks 并获取 API Key

1. 访问 https://liveblocks.io/
2. 点击 **"Sign up"** 使用 GitHub 账号免费登录
3. 登录后，点击 **"Create Project"**（创建项目）
4. 项目名称填写：`smart-timeline`（或任意名称）
5. 进入项目仪表盘，找到 **"API Keys"** 区域
6. 复制你的 **Public Key**（以 `pk_test_` 或 `pk_live_` 开头）

### 步骤 2：配置环境变量

1. 在项目根目录 `d:\project\line` 下，创建 `.env` 文件（复制 `.env.example`）
2. 将你刚才复制的 Public Key 填入：

```env
VITE_LIVEBLOCKS_PUBLIC_KEY=pk_test_你的真实密钥...
```

**⚠️ 重要：`.env` 文件不会被提交到 Git（已配置在 `.gitignore`）**

### 步骤 3：本地测试

在项目根目录运行：

```bash
npm run dev
```

然后在浏览器中打开 `http://localhost:5173`，点击工具栏的"云端同步"按钮，输入一个房间代码（如 `my-timeline-2026`），点击连接。

如果看到"已连接"状态，说明 Liveblocks 已经成功集成！

### 步骤 4：推送到 GitHub

将代码推送到你的 GitHub 仓库：

```bash
git add .
git commit -m "集成 Liveblocks 实时同步服务"
git push
```

### 步骤 5：部署到 Vercel

1. 访问 https://vercel.com/ 并使用 GitHub 登录
2. 点击 **"Add New" → "Project"**
3. 选择你的 GitHub 仓库 `smart-timeline`
4. **关键步骤：配置环境变量**
   - 在部署页面的 **"Environment Variables"** 区域，添加：
   - Name: `VITE_LIVEBLOCKS_PUBLIC_KEY`
   - Value: `pk_test_你的真实密钥...`（填写步骤 1 复制的密钥）
5. 点击 **"Deploy"** 按钮
6. 等待约 1 分钟，Vercel 会生成一个域名，如 `https://smart-timeline.vercel.app`

### 步骤 6：测试实时同步

🎉 **完成！**

现在打开两台设备（电脑和手机，或两个浏览器标签页），访问同一个域名，输入相同的房间代码，就能体验毫秒级实时同步了！

## 🔧 技术细节

### Liveblocks 的优势

- **自动冲突解决（CRDT）**：多人同时修改同一任务，不会出现数据覆盖冲突
- **断线自动重连**：网络不稳定时，Liveblocks 会自动处理
- **免费额度**：每月 100 个并发连接，2GB 流量，个人项目完全够用
- **零服务器维护**：无需维护 WebSocket 服务器，Liveblocks 托管一切

### 数据存储机制

- **本地缓存**：数据同时存储在 LocalStorage（键名：`smart-timeline-data`）
- **云端同步**：通过 Liveblocks 自动同步到云端（tasks, groups, notes, milestones）
- **离线支持**：短暂断线时，本地数据仍然可用，联网后自动同步

## ❓ 常见问题

**Q: 如果忘记配置 API Key，会怎样？**
A: 应用会正常运行在本地模式（无云端同步），所有数据保存在 LocalStorage。

**Q: 房间代码有什么要求？**
A: 房间代码只能是字母、数字、下划线、减号，长度不超过 64 字符。

**Q: 如何查看 Liveblocks 连接状态？**
A: SyncDialog 会显示"已连接"、"连接中..."、"未连接"三种状态。

**Q: 如何导出数据？**
A: 点击工具栏的"导出"按钮，可以下载 JSON 文件，包含所有任务和便签数据。

## 🎯 下一步建议

完成部署后，你可以尝试：

1. 添加"多人在线状态"显示（Liveblocks 提供 Presence API）
2. 实现多人实时鼠标指针（Liveblocks 提供 Cursor API）
3. 添加撤销/重做功能（Liveblocks 提供 Undo/Redo API）

所有这些高级功能只需要几行代码就能实现！

---

**开始享受实时协作吧！** 🚀