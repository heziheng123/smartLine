# SmartLine 部署指南

本指南面向 Cloudflare Pages 正式部署。纯本地使用只需 `npm ci && npm run dev`，不需要 GitHub、Liveblocks 或 R2。

## 1. 部署架构

正式推荐链路：

```text
浏览器 → Cloudflare Pages 静态站点
       → /api/auth/* GitHub OAuth
       → /api/liveblocks-auth 房间令牌
       → Liveblocks 统一工作区
       → /api/archives/*（可选 R2）
```

不要把 `LIVEBLOCKS_SECRET_KEY`、GitHub Client Secret 或 session secret 暴露为 `VITE_` 变量。只有 Public Key 可以进入浏览器构建。

## 2. 前置资源

### 2.1 GitHub OAuth App

在 GitHub Developer Settings 创建 OAuth App：

- Homepage URL：正式站点 origin，例如 `https://smartline.example.com`
- Authorization callback URL：`https://smartline.example.com/api/auth/github/callback`

记录 Client ID 和 Client Secret。Preview 域名如需登录，应使用独立 OAuth App 或明确加入对应 callback；不要频繁修改 Production callback。

### 2.2 Liveblocks 项目

创建 Liveblocks 项目并获取：

- Secret Key：Pages Function 签发令牌使用；
- Public Key：只在旧房间兼容迁移阶段需要。

正式稳定后应使用 `/api/liveblocks-auth`，而不是让浏览器长期持有 Public Key。

### 2.3 R2（可选）

创建 Production 和 Preview 两个不同 bucket，并在 Pages 项目中以 `SMARTLINE_R2` 绑定。R2 仅保存月度历史归档；不配置时相关 API 返回 503，其他功能正常。

## 3. Cloudflare Pages 配置

连接 Git 仓库并设置：

- Framework preset：Vite 或 None
- Build command：`npm run build`
- Build output directory：`dist`
- Node.js：22

Pages 会自动识别仓库根目录的 `functions/`。`public/_headers` 会进入构建产物并由 Pages 应用。

### 3.1 构建变量

正式认证模式：

```env
VITE_LIVEBLOCKS_AUTH_ENDPOINT=/api/liveblocks-auth
VITE_DISABLE_PUBLIC_KEY_FALLBACK=true
```

迁移观察期：

```env
VITE_LIVEBLOCKS_PUBLIC_KEY=pk_live_or_test_value
VITE_LIVEBLOCKS_AUTH_ENDPOINT=/api/liveblocks-auth
VITE_DISABLE_PUBLIC_KEY_FALLBACK=false
```

只有完成统一工作区迁移并稳定验证后，才把 fallback 设为 `true` 并删除 Public Key。

### 3.2 服务端 secrets/vars

在 Production 环境设置：

```env
LIVEBLOCKS_SECRET_KEY=sk_live_xxx
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
ALLOWED_GITHUB_LOGIN=your_github_login
SMARTLINE_SESSION_SECRET=至少32字符的随机值
AUTH_ALLOW_DEV_BYPASS=false
```

`SMARTLINE_SESSION_SECRET` 建议使用密码管理器生成 32 字节以上随机值。修改它会使现有登录会话全部失效。

Preview 环境使用独立 secrets 和 R2 bucket；不得复用 Production Secret Key、OAuth secret 或 bucket。

## 4. 首次上线检查

1. 运行 `npm ci`、lint、build、领域测试、系统测试和 E2E。
2. 运行 `npm audit`，处理运行时和构建链漏洞。
3. 部署后访问 `/api/auth/session`，未登录应返回 401/no-store 响应。
4. 完成 GitHub 登录，确认非白名单账号不能进入。
5. 打开同步对话框，连接统一工作区并确认房间形如 `workspace-{identity}-{code}`。
6. 在两个标签页修改不同数据域，确认字段都保留。
7. 断网修改后恢复网络，确认离线队列清空且无冲突副本。
8. 检查响应头 CSP、frame deny、nosniff 和 Service Worker no-cache。
9. 如启用 R2，测试首次 PUT、带 ETag 更新和错误 ETag 的 409。
10. 导出完整 JSON，并实际验证一次本地快照恢复流程。

## 5. 旧房间迁移

历史部署可能使用五个房间：Timeline 主房间、`ebb-`、`daily-`、`graph-`、`life-map-`。迁移步骤详见 [数据架构迁移指南](docs/data-architecture-migration.md)。关键原则：

- 迁移前导出两份完整备份；
- 迁移是复制，不删除旧房间；
- 摘要和 SHA-256 都一致后才切换；
- 至少观察 30 天再停用 Public Key fallback；
- 任一端有不同非空数据时，不允许自动覆盖。

## 6. R2 归档行为

API 路径为 `/api/archives/{YYYY-MM}`，支持 GET、HEAD、PUT：

- 必须有有效 GitHub session；
- 月份严格匹配 `YYYY-MM`；
- payload 必须为 JSON，`version` 为 1 且 `period` 与路径一致；
- 最大 10 MiB；
- 对象按 GitHub 用户 ID 隔离；
- 已存在对象的更新必须携带当前 ETag，否则返回 409。

R2 不是 Liveblocks 的替代品，也不是实时备份；它用于长期历史归档。

## 7. 回滚

静态版本回滚前先确认旧版本支持当前 `schemaVersion`。如果云端由更高版本写入，旧客户端会拒绝连接，这是保护行为，不应绕过。

推荐顺序：

1. 暂停多设备编辑；
2. 从当前版本导出完整备份；
3. 保留当前 Pages deployment；
4. 验证待回滚版本支持当前 schema 7；任何只支持 schema 6 或更早版本的客户端都不能写入已升级的生产工作区；
5. 回滚静态部署但不删除 Liveblocks/R2；
6. 登录、hydrate、离线队列和导出全部验证后恢复使用。

## 8. 监控与维护

- 每次依赖更新运行完整测试和 `npm audit`；
- 定期检查 Pages Functions 4xx/5xx、Liveblocks 连接失败和 R2 409；
- 关注 IndexedDB 容量、快照数量和离线冲突副本；
- 保留至少一份不在浏览器中的完整 JSON；
- OAuth、Liveblocks 和 session secret 轮换要分阶段进行，避免同时失去登录和同步能力。

## 9. 常见问题

### 登录后立即返回登录页

检查 callback URL、HTTPS、cookie、session secret 长度和白名单用户名。Cloudflare Preview 域名必须在对应 OAuth App 中配置 callback。

### `/api/liveblocks-auth` 返回 503

`LIVEBLOCKS_SECRET_KEY` 缺失或不以 `sk_` 开头。变量必须配置在 Pages Functions 环境，不是前端构建变量。

### 统一工作区提示本地和云端冲突

这是失败关闭保护。新版同步弹窗会显示“以云端为准”和“以本机为准”，执行前自动保存双方本地恢复点。先确认哪台设备的数据更完整，再选择方向；不要清 localStorage 或 IndexedDB 规避提示。

### 新电脑输入房间号后看不到平板旧数据

认证模式会先检查统一工作区，再检查历史五房间架构。发现旧数据后会先保存恢复点并迁移；如果两端都有不同内容，会要求明确选择方向。确认生产构建设置了 `VITE_LIVEBLOCKS_AUTH_ENDPOINT=/api/liveblocks-auth`，且 Pages Functions 中的 `LIVEBLOCKS_SECRET_KEY` 和 GitHub 白名单配置正确。

### R2 返回 409

归档已被其他设备修改。重新 GET/HEAD 获取最新 ETag，合并或确认内容后再 PUT。

### PWA 更新后仍显示旧界面

确认 `service-worker.js` 响应为 `no-cache, no-store`，刷新并等待新 worker 激活；不要给 service worker 文件设置 immutable 缓存。
