# 项目代码审查与修复（2026-09-27）

最新复查及本轮额外 3 项功能修复见 [全面功能复查](D:/obdidianprojects/line/docs/functional-recheck-2026-09-27.md)。下文保留第一轮审查与修复记录。

审查发现的 10 项问题（3 项 P1、7 项 P2）均已完成修复，并补充正式回归测试。其中 8 项在审查阶段通过独立脚本复现，另外 2 项通过备份结构和 CI 配置确认。P1 表示可能覆盖用户数据；P2 表示功能、恢复能力或验证流程存在缺陷。

审阅覆盖应用入口、状态管理、领域命令、时间线、日程、EBB、图谱、人生地图、思维导图、每日复盘、语音、统一同步、备份恢复、服务端 API、鉴权和测试配置，并结合全仓库搜索检查调用关系。大型界面和样式文件主要检查关键路径，不将本次审查描述为每个文件逐行穷尽，也不能据此保证不存在其他问题。修复没有新增依赖，也没有提交或部署。

## 修复结果

| 问题 | 已实施的修复 |
| --- | --- |
| 1. 同步覆盖远端更新 | 副本持久化、哈希等异步准备移到最终检查之前；检查队列与云端快照后立即同步进入 batch，变化时保留队列。 |
| 2. AI 覆盖新内容 | 响应时核对当前复盘对象；期间有编辑则丢弃过期结果并提示重新整理。 |
| 3. 云端缓存被旧引用移除 | 接收远端数据时同步更新 state/ref；等待本地初始化；按单条复盘串行保存，避免旧整列表覆盖新记录。 |
| 4. 服务端版本丢失 | 持久化远端加载、转写回执中的 serverRevision，同时更新待传版本基线。转写成功/失败和延迟同步确认均保留期间的新编辑。 |
| 5. 排序丢失 | 区分单边排序与双边冲突；保留新增实体位置；真正的排序冲突记录副本。 |
| 6. StrictMode 录音不可用 | effect setup 恢复 mounted 标记，并防止异步启动后的旧录音实例继续运行。 |
| 7. 清理遍历提前停止 | 完整遍历对象和数组的所有子项，单独累计是否修改。 |
| 8. 历史备份失败不重试 | 成功才标记日期；正在进行的请求去重；失败释放标记允许重试。 |
| 9. 备份漏复盘 | 文件备份、分块快照及每日云端历史加入可选复盘扩展；包含原始文字、文字草稿、批注与完成版本。旧格式不清除现有复盘。 |
| 10. CI 漏测与类型错误 | 自动发现全部单元测试；修复 100 条测试类型诊断，保持严格类型检查；CI 和 test:all 加入测试类型检查与完整单元测试。 |

复盘恢复会清除旧设备/账号的待传队列和版本基线，作为本机记录保存，后续编辑再进入同步；原始录音文件按现有本地音频策略不纳入备份，界面已明确说明。备份校验允许超过云端接口配额的离线记录，接口原有配额仍保持不变。

正式回归见 [review-data-safety.spec.ts](D:/obdidianprojects/line/tests/e2e/review-data-safety.spec.ts)、[workspace-sync.test.ts](D:/obdidianprojects/line/tests/sync/workspace-sync.test.ts)、[workspace-history.test.ts](D:/obdidianprojects/line/tests/sync/workspace-history.test.ts)、[workspace-backup-mind-map.test.ts](D:/obdidianprojects/line/tests/sync/workspace-backup-mind-map.test.ts) 和 [archive-redaction.test.ts](D:/obdidianprojects/line/tests/auth/archive-redaction.test.ts)。

以下第 1–10 节保留修复前的发现、复现和建议；其中行号对应审查时的代码，修复后已可能移动。

## 1. [P1] 同步最后一次检查后仍有异步等待，云端新修改会被覆盖

位置：[workspaceSync.ts:2138](D:/obdidianprojects/line/src/services/workspaceSync.ts:2138)、[workspaceSync.ts:2158](D:/obdidianprojects/line/src/services/workspaceSync.ts:2158)、[workspaceSync.ts:2172](D:/obdidianprojects/line/src/services/workspaceSync.ts:2172)。

代码重新读取云端 root，确认没有变化后，又等待保存冲突副本和计算哈希；之后才执行 `room.batch`。这段等待期间如果收到其他设备的修改，仍会用此前的合并结果写回整字段。后续确认检查的是已提交的数据，因此可能将这次覆盖认定为成功并清除本地队列。

**独立复现：**基线便签名称为 `base name`，本机修改颜色。最后一次检查返回后注入远端名称 `new remote name`；同步结果将名称恢复为 `base name`，返回 `applied: 1, conflict: false`。使用实际同步函数和可控模拟 room，未访问真实用户云端。

**修复建议：**将副本持久化、哈希等异步准备工作移到最终检查之前；紧邻同步 batch 重新检查云端快照及待同步队列，检查和写入之间不要再等待。发现变化时保留队列并重新合并。

## 2. [P1] AI 整理完成时覆盖请求期间新增或修改的复盘内容

位置：[ReviewView.tsx:271](D:/obdidianprojects/line/src/review/components/ReviewView.tsx:271)。

`runAi` 在请求前捕获 `current`，响应后仍对这个旧对象调用 `applyAiAnalysis`，再通过 `update` 替换整份复盘。请求期间用户仍可保存新记录或修改内容，因此这些操作会被旧文档覆盖，并进入本地存储和同步队列。

**独立复现：**保存旧记录后触发 AI，并延迟响应；期间保存新记录；释放响应后读取持久化数据，原始记录只剩旧记录。

**修复建议：**记录请求对应的内容版本，响应时读取最新复盘；仅在来源版本匹配时应用结果，或者将结果作为待确认候选合并，避免直接替换请求开始时的整份文档。

## 3. [P1] 云端复盘加载后未更新引用，编辑另一天会移除本地缓存记录

位置：[ReviewView.tsx:99](D:/obdidianprojects/line/src/review/components/ReviewView.tsx:99)、[ReviewView.tsx:113](D:/obdidianprojects/line/src/review/components/ReviewView.tsx:113)。

加载云端复盘时更新了 React 状态并保存到本地，但没有更新 `reviewsRef.current`。后续 `update` 使用这个旧引用构造完整列表并保存，刚加载的其他日期记录会从列表中消失。

**独立复现：**本地已有 9 月 26 日复盘，加载云端 9 月 27 日后，两天均已缓存；切回 26 日追加记录，持久化列表只剩 26 日。这里确认的是本地缓存被删除，未观察到远端文档删除。

**修复建议：**集中管理复盘列表写入，使状态、引用与持久化数据同步更新。远端结果的接收还应等待本地初始化完成，避免初始化前返回的结果被忽略。

## 4. [P2] 云端复盘版本号只更新界面，下一次保存使用错误基线

位置：[ReviewView.tsx:105](D:/obdidianprojects/line/src/review/components/ReviewView.tsx:105)、[sync.ts:33](D:/obdidianprojects/line/src/review/sync.ts:33)。语音回执处理也有同类写入路径。

接收云端文档后，`serverRevision` 仅写入 React 的 `syncStates`，没有持久化。`enqueueReviewSync` 却从仓库读取同步状态生成 `baseRevision`，因此新设备下一次编辑会以 `null` 或旧版本为基线，触发不必要的 409 冲突。

**独立复现：**接收 revision 7 后界面状态已更新，但持久化同步状态中没有该版本。错误基线如何导致 409，可沿队列构造和服务端版本检查代码确认。

**修复建议：**接受远端文档或语音回执时，持久化对应版本；通过与队列相同的串行机制更新，避免覆盖已有待提交状态。

## 5. [P2] 三方合并保留远端顺序，静默丢弃本地块排序

位置：[workspaceSyncCore.ts:328](D:/obdidianprojects/line/src/services/workspaceSyncCore.ts:328)。

实体数组同时有本地和远端变化时，合并 ID 总是优先采用远端顺序。即使远端只改内容、本地只调整顺序，合法的本地排序也会丢失，而且不会报告冲突。任务的 `blocks` 会受影响。

**独立复现：**基线为 `[a,b]`，本地调整为 `[b,a]`，远端只修改 a 的内容；合并结果为 `[a,b]`，冲突列表为空。

**修复建议：**独立合并实体内容和排列顺序；仅一端改变顺序时采用该端顺序，两端同时移动时使用明确的冲突或合并规则。

## 6. [P2] StrictMode 开发模式下语音按钮无法进入录制状态

位置：[VoiceCaptureButton.tsx:37](D:/obdidianprojects/line/src/review/components/VoiceCaptureButton.tsx:37)、[main.tsx:29](D:/obdidianprojects/line/src/main.tsx:29)。

effect 清理将 `mounted.current` 设为 `false`，但 setup 没有恢复为 `true`。React 开发模式的 StrictMode 重放 effect 后，该标志永久为 false。启动录音的异步回调因此提前返回，无法正常更新状态和调用 `onStarted`。

**独立复现：**实际组件挂载于 StrictMode，模拟录音启动被调用 1 次，`onStarted` 为 0 次，按钮仍显示“开始说”。未使用真实麦克风；该结论限定于开发模式 effect 重放。

**修复建议：**每次 effect setup 恢复 mounted 标志，并正确清理对应录音实例。

## 7. [P2] 旧专注数据清理遇到第一个变化后停止遍历

位置：[redact-focus.ts:10](D:/obdidianprojects/line/functions/api/archives/redact-focus.ts:10)、[redact-focus.ts:26](D:/obdidianprojects/line/functions/api/archives/redact-focus.ts:26)。

递归清理使用带副作用的 `Array.some`。第一个子项返回 true 后，后面的兄弟节点不会再被处理，数组和对象分支都存在此问题。客户端还会在接口成功后记录清理已完成，使遗漏通常不会自动补清。

**独立复现：**输入 `{first:{focusSessions:[1]}, second:{focusSessions:[2]}}`，输出为 `{first:{}, second:{focusSessions:[2]}}`，函数仍返回成功发生修改。

**修复建议：**完整遍历所有子项，单独累计 changed；不要用短路操作承担清理副作用。补充多个兄弟节点和嵌套数组的回归用例。

## 8. [P2] 每日云端历史第一次保存失败后，当天不再重试

位置：[workspaceHistory.ts:74](D:/obdidianprojects/line/src/services/workspaceHistory.ts:74)、[workspaceSync.ts:1576](D:/obdidianprojects/line/src/services/workspaceSync.ts:1576)。

日期在请求之前被加入 `attemptedDates`，请求失败时不移除；调用方又吞掉错误。因此一次临时网络失败会使当前页面会话当天的后续保存全部直接返回，历史备份缺失。

**独立复现：**第一次请求失败，第二次调用没有发出请求，总请求次数仍为 1。

**修复建议：**成功后才记录日期，或失败时清除标记；并发去重使用正在进行的 Promise，区分“正在保存”和“已成功保存”。

## 9. [P2] 完整工作区备份不包含每日复盘数据

位置：[workspaceBackup.ts:37](D:/obdidianprojects/line/src/services/workspaceBackup.ts:37)、[workspaceBackup.ts:734](D:/obdidianprojects/line/src/services/workspaceBackup.ts:734)、[review/repository.ts:5](D:/obdidianprojects/line/src/review/repository.ts:5)。

**静态确认：**备份格式和导出、恢复流程覆盖 timeline、lifeMap、EBB、graph、daily schedules、settings、mindMap，没有覆盖独立 `smart-line-review` 仓库。每日复盘原始记录、草稿、批注和完成版本无法通过完整备份恢复。未同步的复盘在换浏览器或清理本地数据后尤其无法找回。

**修复建议：**给备份加入可选复盘扩展并兼容旧格式，或者提供独立复盘导出，并明确现有完整备份的范围。音频是否导出应遵循产品现有本地音频策略，不能简单假定应上传云端。

## 10. [P2] CI 漏跑 22 个单元测试文件，测试类型检查存在 100 条错误

位置：[package.json:10](D:/obdidianprojects/line/package.json:10)、[ci.yml:24](D:/obdidianprojects/line/.github/workflows/ci.yml:24)、[tests/tsconfig.json](D:/obdidianprojects/line/tests/tsconfig.json)。

**静态确认：**单元测试脚本逐个枚举文件；17 个测试文件未被任何对应脚本列入，涉及每日复盘、语音、同步状态和思维导图。CI 还没有运行 `test:mind-map`，再漏 5 个文件，共 22 个。即使执行 `test:all`，也仍漏前述 17 个文件。

**执行确认：**`npx tsc -p tests/tsconfig.json --noEmit` 输出 100 条 TypeScript 诊断，包括过期参数、数据结构不匹配和 JSX 配置问题。tsx 只转译，所以运行时测试通过不能证明测试代码类型正确；应用构建也未覆盖这些测试类型错误。

**修复建议：**统一按目录发现单元测试并让 CI 执行，避免新增文件漏入脚本；修复测试配置及过期 fixture 后加入测试类型检查。

## 审查阶段验证结果（修复前）

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |
| 全部 auth / sync / domain / mind-map 的 `*.test.ts` | 288 / 288 通过；使用目录发现补足现有脚本遗漏 |
| `npm run test:system` | 73 / 73 通过 |
| `npm run test:security` | 通过；仅代表该脚本检查范围 |
| `npm audit --json` | 当前安装依赖报告 0 个已知漏洞 |
| `npx depcheck` | 通过 |
| 测试 TypeScript 检查 | 失败，100 条诊断 |
| 选定桌面 E2E | 42 通过、1 失败、1 跳过 |
| 独立问题复现 | 上述 8 项行为问题均复现 |

选定 E2E 覆盖应用壳、多设备同步、撤销、时间线恢复及 Liveblocks transport。失败发生在首个冷启动用例的 beforeEach：7 秒内主导航没有出现，页面仍在加载；单独重跑仍失败。尚未确定是本地启动性能、测试时限还是应用问题，不将其算作已确认的生产缺陷。跳过的是需要 `LIVEBLOCKS_TRANSPORT_TEST=1` 的真实传输测试。

曾启动全量浏览器矩阵（460 个用例），因启动及 teardown 连续超时而中止，随后改为单 worker 的选定用例。**全量 E2E、全部浏览器/移动端，以及真实 Cloudflare、Liveblocks、AI 和麦克风集成没有完成验证。**

复现脚本：[review-probes.mjs](D:/obdidianprojects/line/.dbg/review-probes.mjs)；结果：[review-probes.log](D:/obdidianprojects/line/.dbg/review-probes.log)。这些调试文件被 git 忽略，不属于正式测试套件。其他验证日志也保存在 `.dbg`，供本地追溯。

上述内容为审查阶段记录。复现脚本断言的是修复前的错误行为，不作为修复后的验证入口；正式验证使用仓库中的测试。

## 修复后验证结果与限制

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |
| `npm run test:types` | 通过，原 100 条诊断已消除，未关闭 strict 或排除旧测试 |
| `npm run test:unit` | 296 / 296 通过 |
| `npm run test:system` | 73 / 73 通过 |
| `npm run test:security` | 通过 |
| `git diff --check` | 通过 |
| 完整桌面/小屏 E2E 矩阵首次运行 | 476 项：448 通过、22 条件跳过、6 失败；失败涉及三组旧测试断言，各两个视口 |
| 相关 E2E 复测 | 58 项中 56 通过；两项剩余图谱用例随后修正测试等待条件，并单独复测 2 / 2 通过 |
| 新增数据安全回归 | 两个视口共 18 / 18 通过，包含 AI/ASR 请求期间编辑、延迟确认、云端缓存/版本、StrictMode 录音、完整备份往返、哈希及提交阶段同步竞争 |
| CI 单独启用的同步迁移 UI | 设置 MIGRATION_UI_TEST=1 和本地认证接口后，桌面 3 / 3 通过 |

全量运行暴露的旧断言分别是假定图谱头部只有五个按钮、假定周日的明天仍在当前周，以及假定 UI 目录导入只有一次提交。测试已适配实际行为，并保留结构、持久化、整批撤销等结果验证。小屏图谱用例增加正常关闭节点控制台的操作和导入完成/撤销持久化等待；控制台关闭按钮补充了可访问名称。没有取消业务验证或使用强制点击掩盖遮挡。

这里报告的是一次全量运行与修正后的针对性复测，不声称在最终代码上重新运行了一次全量矩阵。审查阶段的冷启动超时在本轮全量运行中未重现，因此没有将其认定为生产缺陷或添加性能补丁。真实 Cloudflare、Liveblocks 网络传输、AI 服务和麦克风设备集成仍未验证；本次数据安全回归使用可控接口和录音模拟。两个视口均为 Chromium，不代表所有浏览器。

本地日志位于 `.dbg/fix-*.log`（被 git 忽略）。
