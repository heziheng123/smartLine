# SmartLine 开发与测试指南

## 1. 开发环境

CI 使用 Node.js 22。建议本地使用同一主版本，并通过 `npm ci` 严格按 lockfile 安装依赖。

```bash
node --version
npm ci
copy .env.example .env
npm run dev
```

Vite 默认监听 `http://localhost:5173`。端到端测试会单独启动 `127.0.0.1:4173`，不要让其他服务占用该端口。

## 2. 环境变量

### 2.1 浏览器构建变量

| 变量 | 说明 |
| --- | --- |
| `VITE_LIVEBLOCKS_PUBLIC_KEY` | 旧兼容模式 Public Key；正式迁移完成后可停用 |
| `VITE_LIVEBLOCKS_AUTH_ENDPOINT` | 认证模式令牌端点，通常为 `/api/liveblocks-auth` |
| `VITE_DISABLE_PUBLIC_KEY_FALLBACK` | `true` 时禁止回退到公开密钥，缺少认证配置会失败关闭 |
| `UPLOAD_PRIVATE_SOURCEMAPS` | `true` 时生成 hidden sourcemap；不要公开部署 map 文件 |

### 2.2 Pages Functions secrets/vars

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `LIVEBLOCKS_SECRET_KEY` | 云同步需要 | 服务端 Liveblocks Secret Key，必须以 `sk_` 开头 |
| `GITHUB_CLIENT_ID` | 认证需要 | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | 认证需要 | GitHub OAuth App Client Secret |
| `ALLOWED_GITHUB_LOGIN` | 认证需要 | 唯一允许登录的 GitHub 用户名 |
| `SMARTLINE_SESSION_SECRET` | 认证需要 | 至少 32 字符的随机 HMAC 密钥 |
| `AUTH_ALLOW_DEV_BYPASS` | 否 | 仅 localhost 调试可设为 `true`，正式环境必须为 `false` |
| `DEV_AUTH_USER_ID` | 调试可选 | 本地绕过登录时的稳定用户 ID |
| `SMARTLINE_R2` | 归档可选 | Cloudflare R2 bucket binding，不是字符串变量 |

本地调试 Pages Functions 时复制 `.dev.vars.example` 为 `.dev.vars`，真实 secrets 不得提交。

## 3. 代码组织

- `src/domain/`：优先放无 UI、可确定测试的业务规则和规划函数。
- `src/services/`：跨 store 命令、外部 I/O、同步、备份和撤销。
- `src/store/`：Timeline 数据域及持久化；其他大域在自己的目录内维护 store。
- `src/components/`：视图与交互，避免在组件内复制领域规则。
- `functions/`：Cloudflare Pages Functions，每个 API 显式限制方法和缓存。
- `tests/domain/`：纯函数/规则测试；`tests/sync/` 和 `tests/auth/`：Node 环境测试；`tests/e2e/`：真实浏览器流程。

新增跨视图功能时，推荐顺序是：定义稳定 ID 与纯计划函数 → 写领域测试 → 命令层一次提交 → 登记撤销保护 → 接入 UI → 添加 E2E。

## 4. 数据修改约束

### 4.1 项目任务

不要从组件直接改写 `task.blocks`。使用 Timeline store 的 block 方法或 `projectTaskCommands`，确保 Daily、EBB、Graph 副作用和撤销一致执行。

普通任务允许无 `date`；数量和单词任务必须有开始日。所有任务类型的共享判断应复用 `taskRules.ts` 与 `blocks.ts`，不要在各视图独立推断。

### 4.2 分组副本

同一 Task 可能同时位于顶层 `tasks` 与某个 group 的 `children`。更新时必须走会调用 reconciliation 的 store 方法；读取全集使用 `getUniqueTasks`，不能简单拼接两个数组。

### 4.3 Daily 来源

Daily `sourceId` 是引用键。删除、改期、整体顺延、完成与撤销都必须同时考虑 `items` 和 `blocks`。从时间块降级为时段项时保留来源 ID。

### 4.4 日期

持久化日期只使用 `YYYY-MM-DD`，时间只使用 `HH:mm`。不要用 `new Date('YYYY-MM-DD')`；使用 `dateSafe.ts`，避免 UTC 与本地日历日偏移。入口必须同时检查格式、真实日历有效性和 `end >= start`。

### 4.5 云同步

本地用户动作必须经过被 `createWorkspaceTrackedSet` 包装的 set，才能进入统一工作区写入日志。远端 hydration 不应被再次登记为本地修改，否则会形成回写环。

不要在同步未 hydrate 时以空数组覆盖 store。schema 升级必须：增加版本、提供归一化、补充旧数据测试、验证高版本门禁、验证并发首载和离线写入。

## 5. 测试命令

| 命令 | 范围 |
| --- | --- |
| `npm run lint` | ESLint、Hooks 与未使用代码规则 |
| `npm run build` | `tsc -b` + Vite 生产构建 |
| `npm run test:security` | 敏感 token 模式与静态安全响应头；不是完整漏洞扫描 |
| `npm run test:auth` | OAuth、session、Liveblocks auth、R2 鉴权 |
| `npm run test:sync` | 三方合并、版本门禁、队列、Service Worker 策略 |
| `npm run test:duration` | 复习时长领域算法 |
| `npm run test:life-map` | 人生地图创建上下文、系统优先泳道、项目/子阶段布局、schema 与维护期统计 |
| `npm run test:project-shift` | 整项目顺延、Daily 迁移和撤销 guard |
| `npm run test:planning` | 自动冷冻、严格日期与 EBB 分散算法回归 |
| `npm run test:system` | store、迁移、跨域联动与持久化系统模拟 |
| `npm run test:e2e` | 两个 viewport 项目的完整浏览器矩阵 |
| `npm run audit` | npm 官方漏洞库检查 |

建议提交前运行：

```bash
npm run lint
npm run build
npm run test:auth
npm run test:sync
npm run test:duration
npm run test:life-map
npm run test:project-shift
npm run test:planning
npm run test:system
npm run test:e2e
npm run audit
```

`npm run check` 使用项目 devDependencies 中固定版本的 `depcheck`，安装依赖后不需要临时从 registry 下载工具。CI 还会执行 `npm audit --audit-level=moderate`，并显式运行全部领域测试。

## 6. Playwright

配置包含：

- `desktop-chromium`：Desktop Chrome 设备参数；
- `small-screen`：iPhone 13 viewport + Chromium，明确关闭 Playwright 的 `isMobile`；
- 时区固定为 `Asia/Shanghai`；
- 本地默认 4 workers，CI 为 2 workers；
- 单用例 30 秒、expect 7 秒；失败保留 trace、截图和视频。

调试单个文件：

```bash
npx playwright test tests/e2e/project-shift.spec.ts --project=desktop-chromium --workers=1
npx playwright show-report
```

如果出现 `browserType.launch: spawn EPERM`，说明操作系统或沙箱拒绝启动浏览器，不是业务断言失败。若出现首页长期停在“加载中”，先用 `--workers=1` 复跑以区分资源竞争和逻辑回归。不要仅靠提高 expect timeout 掩盖持久化死锁。

`sync-migration-ui.spec.ts` 默认跳过；CI 通过 `MIGRATION_UI_TEST=1` 和认证端点单独运行。

## 7. 测试数据与隔离

E2E 测试会使用浏览器 IndexedDB、localStorage 和固定日期语义。每个测试应显式清空或播种所需 store，不能依赖前一个测试。跨标签页测试必须等待双方 hydrate 后再并发写入。

领域测试应避免真实当前时间；若函数依赖 today，构造靠近今天的日期或给函数增加 reference date 参数。测试任务身份时使用 ID，不用标题。

## 8. 构建产物

`npm run build` 输出 `dist/`，同时为可压缩资源生成 `.gz` 和 `.br`。Vite 根据库拆分 chunk；SheetJS 体积较大但通过动态导入隔离。

发布前检查：

- `dist/index.html` 引用带 hash 的资源；
- `public/_headers` 被复制到根目录；
- `service-worker.js` 与 `manifest.json` 存在；
- 不公开 hidden sourcemap；
- Pages 环境变量与 R2 binding 属于正确环境；
- Preview 不使用 Production secret 或 bucket。

## 9. 安全开发清单

- 任何用户、导入或远端同步 HTML 都必须在渲染点净化；不要新增未审计的 `dangerouslySetInnerHTML`。
- 不允许脚本、事件属性、`javascript:` URI；避免允许任意 `style`，图片协议和大小必须受控。
- Pages Function 对修改操作检查登录、同源、输入大小和方法；响应使用 `no-store`。
- Room 授权必须绑定身份；迁移期的旧房间例外不能长期保留。
- 每次 lockfile 变化运行 `npm audit`，区分运行时直接依赖与仅构建依赖。
- 不把 Public Key 当 secret；Secret Key、OAuth secret、session secret 只能存在服务端环境。

## 10. 常见故障

### 页面一直显示加载中

查看各 store 的 `isHydrated`，检查 IndexedDB 权限、容量和控制台持久化错误；尝试无痕窗口时注意它是全新本地工作区。

### 云端连接后数据不一致

停止继续编辑，先导出完整备份；检查离线队列和冲突副本，再比较本地/远端摘要。不要通过清空某一方来“重试”。

### GitHub 登录循环

检查 OAuth callback URL、`ALLOWED_GITHUB_LOGIN` 大小写、session secret 长度、HTTPS 和浏览器 cookie。localhost 绕过仅用于 Pages 本地调试。

### R2 返回 503

表示 `SMARTLINE_R2` 未绑定。它不会影响本地工作区和 Liveblocks；在 Pages 环境设置 bucket binding 后重新部署。

### 端到端测试偶发超时

确认没有遗留 Vite/Chromium，端口 4173 可用；用单 worker 复现；查看 `test-results/*/error-context.md` 和 trace，而不是只看终端最后一行。
