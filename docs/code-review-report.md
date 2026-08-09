# SmartLine 全面代码审查与修复报告

审查与修复日期：2026-08-09
审查范围：`src/`、`functions/`、`public/`、`scripts/`、`tests/`、构建配置、CI、依赖清单和项目文档。

## 1. 最终结论

本轮对核心业务逻辑、跨 Store 联动、日期算法、EBB 排期、富文本安全、同步与离线流程、响应式交互、依赖和 CI 进行了静态审查与动态验证。审查确认的 9 类问题均已修复，并补充了针对性领域测试、浏览器回归和工程质量门禁。

最终验证结果为：ESLint、TypeScript、depcheck、生产构建、安全扫描、npm 漏洞审计、118 项 Node/系统测试和 226 项双视口 Playwright 矩阵均无失败。Playwright 中 222 项通过，4 项因测试条件按设计跳过。

这表示在当前代码、依赖锁文件和已覆盖环境中没有已知未处理故障。任何软件都无法仅凭一次审查证明未来或所有外部环境中绝对不存在缺陷；后续变更仍须持续执行本文所列质量门禁。

## 2. 已修复问题

### 2.1 自动冷冻的数据一致性与撤销原子性

状态：已修复。

- 新增纯领域函数 `collectOverdueFreezeTargets`，只选择未完成、未归档、有合法计划日且确实早于阈值的普通单日任务。
- 持续数量/单词任务不会被自动冷冻。
- Store 使用 `freezeOverdueBlocks` 一次事务提交所有目标，不再逐块产生持久化与撤销记录。
- 同一事务删除对应 Daily 引用，并保存可恢复快照；一次撤销同时恢复任务日期和每日安排。
- 提交前按预期日期重新校验；撤销前检查顶层任务及全部分组副本，避免覆盖后续编辑或分叉副本。
- 未命中的任务保持对象和 `blocksUpdatedAt` 不变。

### 2.2 依赖漏洞与富文本净化边界

状态：已修复。

- `dompurify` 锁定到 3.4.13，`postcss` 锁定到 8.5.26；间接依赖同时更新。
- 最终 `npm audit --audit-level=moderate` 报告 0 个漏洞。
- 富文本移除 `style`、`class`、`id`、事件属性、表单/SVG/MathML/嵌入对象等高风险能力。
- URI 仅允许 HTTP(S)、邮件、站内绝对路径和锚点；图片拒绝 data URI、畸形地址及非 HTTPS 外链。
- 安全检查脚本会在净化白名单重新放开布局属性或 data image 时直接失败。

### 2.3 EBB 同批复习轮次的最小间隔

状态：已修复。

生成每一轮时，智能分散同时检查既有任务和本批已经生成的轮次，因此同一批新轮次也遵守 `minTopicGapDays`。新增领域测试覆盖同批两轮向后避让的结果。

### 2.4 严格日期与区间校验

状态：已修复。

- `makeLocalDayjs` 对不存在的公历日期返回 invalid，不再接受 JavaScript Date 的自动进位。
- Timeline 任务、分组、便签、里程碑和旧 life stage 在 hydration 时统一校验日期。
- 倒序任务/分组区间会安全收敛；无效值使用明确回退值，不传播无效日期。
- 手动分组对话框拒绝空日期、不可能日期和结束早于开始的区间，并提供可访问错误提示。
- EBB 生成入口使用相同的严格日期规则。

### 2.5 CI 与工具链可复现性

状态：已修复。

- `depcheck` 固定为 devDependency，`npm run check` 使用本地二进制，不再通过 `npx` 临时下载。
- CI 在安装后执行 moderate 级 npm audit。
- CI 显式运行 duration、life-map、project-shift 和 planning 领域测试。
- Playwright 默认 worker 数统一为 2，降低资源竞争导致的假失败。

### 2.6 浏览器测试的导航竞态与小屏菜单层级

状态：已修复。

- 动态导入 Store 的竞态测试只在执行上下文被导航销毁时进行有限重试，真实断言错误仍会立即失败。
- 小屏 Dock 的“新建”菜单通过 body portal 渲染，位置随按钮、窗口尺寸和滚动更新，不再被横向滚动容器裁剪或被时间轴拦截点击。
- 分组一致性测试同样等待导航后的稳定执行上下文。

## 3. 算法与业务规则复核

本轮重点确认以下调用链与不变量：

- 项目任务在 Timeline、项目文档、Daily、周矩阵中的身份以稳定 task/block ID 关联，不依赖标题。
- 完成、取消、改绑、自动复习、Daily 清理和批量操作通过统一命令/事务边界提交。
- 项目整体顺延只移动符合条件的未完成普通任务；固定事项和不符合条件的数据保持不变，Daily 冲突降级到时段槽位。
- EBB 轮次身份由稳定序号维护，改期不重排历史；复杂度、间隔、补充轮次和节点状态由领域/系统测试覆盖。
- Life Map 的领域、目标、阶段、系统、维护期和复盘独立于项目任务，并进入完整工作区同步与备份。
- 本地 IndexedDB、离线写入日志、Liveblocks hydration、三方合并、schema 高版本门禁和多标签并发均有自动化测试。
- Service Worker 不缓存 API、认证、Liveblocks 或非 GET 请求；在线导航优先获取新 shell，离线才回退完整缓存。

## 4. 最终验证记录

| 检查 | 最终结果 |
| --- | --- |
| `npm run lint` | 通过，0 error |
| `npm run check` | TypeScript 与 depcheck 通过 |
| `npm run build` | 通过，2446 modules transformed |
| `npm run test:security` | 通过 |
| `npm run test:auth` | 8/8 通过 |
| `npm run test:sync` | 13/13 通过 |
| `npm run test:duration` | 3/3 通过 |
| `npm run test:life-map` | 12/12 通过 |
| `npm run test:project-shift` | 5/5 通过 |
| `npm run test:planning` | 3/3 通过 |
| `npm run test:system` | 74/74 通过 |
| `npm run test:e2e` | 222 通过、4 条件跳过、0 失败（226 项，桌面 + 小屏） |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |

系统模拟中的“simulated IndexedDB failure”日志是故障注入用例的预期输出：测试确认写入失败时会保留应急日志，并非测试失败。

## 5. 新增回归覆盖

- `tests/domain/planning-regressions.test.ts`：自动冷冻过滤、EBB 同批间隔、严格日期规则。
- `tests/e2e/regression-guards.spec.ts`：富文本攻击载荷、分组日期校验、批量冷冻/Daily/撤销一致性。
- 既有项目顺延领域与 E2E 测试已纳入 CI。
- 同步写入日志与分组副本一致性测试增加导航竞态保护。

## 6. 持续质量要求

合并或发布前至少运行：

```bash
npm ci
npm run lint
npm run check
npm run build
npm run test:all
npm audit --audit-level=moderate
```

涉及日期、同步 schema、富文本白名单、任务身份、跨 Store 事务或撤销 guard 的修改，必须同时更新领域测试与真实浏览器测试；不能用跳过、降低安全阈值或忽略 audit 的方式让门禁变绿。
