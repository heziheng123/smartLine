# SmartLine 数据架构迁移与恢复

## 当前目标架构

GitHub OAuth 负责用户身份，Cloudflare Pages Functions 使用服务器端 Liveblocks Secret Key 签发令牌。迁移后四个数据域共用一个 `workspace-用户-工作区` 房间；浏览器以 IndexedDB 为主存储，localStorage 只保存设置和关闭页面前的短暂应急日志。

## 安全迁移顺序

1. 在“云同步与完整备份”导出完整 JSON，并保留两份。
2. 保持旧四房间全部连接，点击“检查旧数据”。
3. 核对任务、EBB轮次、每日安排和知识节点数量。
4. 点击“迁移到统一工作区”。程序会自动创建本地快照。
5. 程序复制旧房间数据，比较迁移前后数量与 SHA-256 哈希。
6. 仅当完全一致时切换到统一房间，并下载迁移报告。
7. 实际使用24～48小时；旧四房间和Public Key在此期间不得删除。
8. 如果异常，可在同步设置点击“暂时返回旧房间”。

迁移是复制操作，不会删除或改写旧房间。

## R2（可选）

在 Cloudflare 创建 Production 和 Preview 两个不同的 R2 Bucket，并分别以 `SMARTLINE_R2` 绑定到对应环境。任务附件最大15MB，Liveblocks中只保存附件ID、名称、类型和大小，不保存Base64内容。未绑定R2时附件和历史归档接口返回503，但其他功能不受影响。

## 最终停用旧同步的条件

- 统一房间迁移报告 `verified` 为 `true`。
- 刷新、断网恢复、两台设备和多标签页测试通过。
- Liveblocks后台只出现一个主要工作区房间连接。
- 旧房间至少保留30天。

满足以上条件后，才能删除 `VITE_LIVEBLOCKS_PUBLIC_KEY`、轮换旧Public Key；旧房间仍建议继续保留到30天观察期结束。

停用时先在Production设置 `VITE_DISABLE_PUBLIC_KEY_FALLBACK=true` 并验证认证端点；确认无误后再删除 `VITE_LIVEBLOCKS_PUBLIC_KEY`。这样缺少认证配置时应用会直接拒绝启动，而不会意外退回匿名连接。

## GitHub设置

在仓库分支保护中要求 `CI / verify` 成功后才能合并到 `main`。Preview环境不得绑定Production Secret或Production R2 Bucket。
