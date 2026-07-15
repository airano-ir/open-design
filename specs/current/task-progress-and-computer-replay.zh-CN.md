# 任务进度与可回放 Computer(Task Progress + Replayable Computer)

> 状态:已实现并验收 v1.0(2026-07-15)。对标 Manus 的「极简会话 + 电脑回放」体验,
> 在 `staged-flow-north-star.zh-CN.md`(北极星链路)之上,重塑 Open Design 的
> **过程可见性**:会话只留最关键信息,所有中间过程收进一个**按轮次(round)
> 打点、可回放、可实时跟随**的 Computer 面板;进度以**每一轮任务**为单位,
> 固定悬浮在输入框上方。
>
> 本文是该方向的唯一真相源。实现拆分见 §7 里程碑;每个里程碑单独 PR,
> 遵守根 `AGENTS.md` 的 UI/CLI 双轨闭环规则。

## 0. 一句话

一次提问 = 一个任务(round)。会话里只看到**最精炼的一行行 brief 和最终产物**;
想看细节就点开 **Computer**——它把这一轮已经形成用户价值的 plan、搜索列表、
搜索下钻详情与产物按时间**打点**记录下来,可以 ◀ ▶ 回放、拖动进度条、● Live
实时跟随;任务
完成后有醒目的状态徽章、折叠的过程、一个大的产物预览、以及 3 个可点击回填输入框的追问。

## 1. 现状四问题

1. **进度割裂**:staged-flow 的 `FlowSnapshot`(6 个执行状态,其中交付是结果)
   按**会话**持久化在
   `conversations.flow_json`,内联在最后一条 assistant 消息里;`TodoWrite` 的
   `TodoCard` 不是实体,由消息事件 latest-wins 派生,内联锚定在首条 TodoWrite 上。
   两者互不相干,都**不按轮次**切分。
2. **会话过载**:每个工具动作(搜索/读取/写入/思考)都在会话里铺开完整详情,
   长任务把关键信息淹没。
3. **不可回放**:没有任何地方能看到或回放 agent 的中间过程。
4. **无全局常驻**:进度不常驻可见;用户不知道「当前这一轮在干嘛、结束没」。

## 2. 核心模型:按轮次的 task(不新增数据库表)

- **task = 一次用户提问 = 一个 run**。复用既有的每轮次接缝
  `messages.run_id` / `run_status`。**生成和编辑是不同的 run → 不同的 task**;
  同一会话里再发一条 = 新 task。`run_status` 直接给出
  **live(`running` → 绿色 ● Live)/ 结束(`succeeded|failed|canceled`)**。
- **steps = 对该轮 `events_json` 的精选投影**:把每个可回放 `tool_use` 按 `id`↔`toolUseId`
  与其 `tool_result` 关联,加上 `live_artifact`,按**工具名**分类为步骤种类(§4)。
  `TodoWrite` / `update_plan` 只作为左侧固定 Task progress 的状态源,不进入 Computer
  时间轴和右侧步骤摘要,避免同一份计划在两处重复。事件顺序天然保序(append-only `events_json`);实时顺序
  由每 run 的 `events.jsonl` + 单调 `event id` + `Last-Event-ID` 重放兜底。
- 关键约束(用户明确):全局视图**是输入框上方,不是数据库看板**。因此步骤
  **从已持久化的 `messages.events_json` 派生**,不新增 task/step 表。
- **记录必须完整且鲁棒**:整轮的交互过程(task → todo → 每一步 → computer
  更新 → 交互)都要被完整记录下来。目标是这份记录未来能直接支撑一个**可分享
  的回放链接**(查看全过程 + 看到交付产物 + 下载)。**该分享/在线查看/下载
  能力本期不做**,但派生与记录要做到位,先把这个底层能力做扎实。
- 纯函数 `apps/web/src/runtime/task-steps.ts`:
  - `deriveTaskSteps(message) -> TaskStep[]`,`TaskStep = { id, kind, brief, title,
    toolUse, toolResult, artifact?, ts }`;`brief` 是会话里的一行摘要,其余喂给 Computer。
  - `deriveCurrentRound(messages) -> Round`,给出当前/最新一轮。
  - 共享 DTO 放 `packages/contracts`(`api/tasks.ts`)。

## 3. 三层 + 完成态

### 3.1 Tier 1 · 输入框上方的固定卡片

- 新组件 `PinnedTaskProgress.tsx`,作为 `QueuedSendStrip` 的兄弟节点渲染,
  夹在它和 `.chat-composer-slot` 之间,位于 `.chat-log` 滚动容器之外;复用
  `QueuedSendStrip` 既有的 ResizeObserver/MutationObserver 自动滚动接线。
- 只展示**当前一轮的顶层步骤**:生成 → 稳定的 5 阶段梯
  `Brief / 问题确认 → 搜索（可选）→ 大纲 → 灵感 → 实现`(复用
  `FlowProgressCard`);交付仍是底层 `deliver` 状态和完成 CTA,不占第 6 行。
- TodoWrite 是实现细节,不能把 agent 临时写的工具清单变成用户可见的阶段模型:
  当前 flow 的 `updatedAt` 不早于当前轮 `startedAt` 时,5 阶段 flow 优先;
  只有后续轻量编辑轮(当前轮开始时间晚于最后一次 flow 更新)才展示 TodoWrite / update_plan。
- **可折叠**(复用 `.accordion-collapsible` 的 `0fr→1fr` 网格动画):
  - 展开 = `Task progress` 标题 + N/M + 顶层清单;
  - 折叠 = 单行 `[Computer 入口缩略图] [当前正在执行的步骤] [N/M ⌄]`;
  - 点标题行折叠/展开;点缩略图打开 Computer。
- **Live 徽标**:该轮 run 活跃时显示绿色 ● Live;结束翻转为终态(§3.3)。
- 按轮次:新一轮替换卡片内容;上一轮的折叠摘要 + 产物**留在会话对应轮次处**
  (历史 = 向上滚动)。

### 3.2 Tier 2 · 极简会话(会话是入口与 reference;详情全在 Computer)

信息架构定位(面向普通用户,层级最优):
- **左侧会话 = 入口 + reference + 状态 + 最终产物**。它只承载最简单有效的信息:
  一行行 brief、任务**状态**、以及最终**产物**入口。
- **Computer = 可回放价值内容的唯一详情载体**,只包含 plan 正文、搜索列表、
  搜索下钻详情与已经可看的文档/图片/HTML 等产物。Todo 状态只在
  左侧固定 Task progress 展示和更新。

- 运行中,会话里每个顶层步骤只显示**一行精炼 brief**(`TaskStep.brief`)+ 状态
  字形,而非完整工具卡;点 brief 在 Computer 里打开该步骤。
- **移除内联的**完整 `FlowProgressCard`、锚定 `TodoCard`,以及 staged 轮次里
  逐工具的完整 `ToolCard`——这些详情改由 Computer 承载。会话只留 brief + 最终
  文字输出。既满足「屏幕上只有一张权威进度卡」的仓库规则,也满足「不过载」。

### 3.3 完成态(每一轮)

- **醒目终态徽章**:由 `run_status` 驱动的清晰状态标识——绿色 `✓ Task completed`,
  及 `✗ Task failed` / `⊘ Stopped` 变体,给用户强感知;Tier 1 的 ● Live 徽标同步
  翻转。复用/增强既有 `assistant-completion-row`,不另起并行信号。
- **折叠**:把 task/todo 详情折进 Tier 1 折叠行 + 会话里该轮一行折叠摘要。
- **大产物预览卡**:复用 `ProducedFiles` + `pickPreviewableArtifact` /
  `pickPlanDocument`,渲染该轮主产物的一个大号可点预览;点击在 Computer 的
  `FileViewer` 里打开。**其余产物文件 → Computer**,不散落在会话里。
- **3 条推荐追问**:在 `NextStepActions` 前独立展示与当前任务相关的 3 条轻量列表;
  点击只回填并聚焦输入框,不自动发送,方便用户修改后追问。来源:一期用上一条用户需求与
  简单启发式生成,后续可改为 agent 提供(如 `<od-followups>` 标记)。

### 3.4 Tier 3 · 可回放的 Computer 面板

右侧面板是**标签系统**(`FileWorkspace` 的 `.ws-body` 分派;标签持久化在
`tabs_state` / `ProjectTabsState`),现状**没有回放/时间轴**。因此:

- 把 Computer 作为**新的保留 body 类型**——新增标签 id 约定,与 `live:` /
  `terminal:` / `chat:` 并列(如 `computer:<runId>`),在 `.ws-body` 分派里渲染
  新组件 `OdComputerPanel.tsx`:
  - **顶部**状态行 `Using {tool} · {target}`,取自当前/选中步骤。
  - **正文**用**既有 family 卡**渲染选中步骤的类型化内容——`WebSearchCard`
    (搜索列表)、`FileReadCard`(读取详情)、`FileWriteCard`(plan/大纲)、
    `WebFetchCard`,以及 `FileViewer`(产物/deck 预览)。TodoWrite、loading 和纯执行日志
    不在 Computer 渲染。
  - **底部时间轴**:◀ ▶ 上一步/下一步、可拖拽进度条、● Live + **Jump to live**;
    下方是 `Task progress` 迷你摘要。
- **两种呈现**:(a) 停靠 **Side view**(分栏里的新 body);(b) 全局 **弹框**
  (同一 `OdComputerPanel`)。二者可切换。**运行即放大**:一轮开始时激活
  `computer:` 标签(可配合 `workspaceFocused`)并实时跟随。
- **统一 Computer 外壳**:右侧最大的一级容器固定命名为 Computer；Design Files、
  Browser、文件预览、终端、Questions 与每轮回放标签都属于它的内部工作区，不再与
  Computer 并列。外壳标题行只承载当前上下文、全屏/Side view 和关闭操作。
- **会话优先的 1:1 布局**:首次打开按 `chat 1fr / 8px 拖拽柄 / Computer 1fr`
  呈现，用户拖拽后仅持久化会话宽度；关闭 Computer 后会话占满全部可用宽度，重新从
  文件/回放入口打开时恢复分栏。关闭只隐藏并保留内部工作区挂载，避免 iframe、文件预览
  和回放状态反复重建。
- **全屏与弹框退出语义**:Computer 可独占右侧全部工作区并一键回到 Side view；回放弹框
  的关闭按钮同时退出弹框和右侧 Computer，让会话恢复全屏。显式 Dock 操作仍只把弹框
  放回已打开的 Computer。
- **会话头部入口**:会话右上角提供 Open Design Cloud、打开 Design Files、新建会话、
  历史记录和更多操作；更多操作内包含 Rename / Delete，文件入口直接打开 Computer 内
  的 Design Files，Cloud 入口复用既有 Cloud 设置/订阅引导。
- 复用:标签壳 + `ProjectTabsState` 持久化;既有 `liveArtifactEvents` 流的追加
  模式;`FileViewer` + `ToolCard` family 卡渲染内容。这是**新 body 类型**,不是
  fork `FileViewer`。

### 3.5 Computer 内容价值规范（展示白名单）

Computer 是“看 AI 产出价值”的舞台，不是开发者事件流、日志控制台或 Todo 镜像。
原始事件继续完整持久化，但进入 Computer 时间轴前必须经过以下白名单投影：

1. **Plan 正文**：已经写入并可阅读的 plan / outline / inspiration 文档内容；
   TodoWrite、update_plan、TaskCreate/TaskUpdate 等任务状态快照不属于 plan 正文。
2. **搜索列表**：`WebSearch` / `web_search` 已返回的结果列表；仅有 tool_use、仍在等待
   结果或失败的搜索不创建回放帧。
3. **搜索下钻详情**：`WebFetch` / `web_fetch` 或 URL 读取已经返回的正文详情。
4. **生成产物**：已经可看的文档、图片、HTML、演示、表格、音视频等产物；包含已完成的
   `generate_image` / `generate_video` / `generate_speech`，并优先直接用 `FileViewer` /
   live artifact 呈现真实内容，不用占位 loading 替代。

默认排除：Todo/进度更新、thinking、Bash/命令、Glob/Grep/文件列表、普通源码读取、
心跳、Preparing、spinner/skeleton、仅有 tool_use 的加载态、错误/重试噪音和未知工具。
排除只影响 Computer 展示，不删除原始事件，也不影响左侧 Task progress 与诊断能力。

执行规范：Todo 状态可以在每个 durable 工作项完成时更新，但昂贵校验不跟着逐项重复。
先完成同一批实现/生成 Todo，再把 checklist、构建、Browser / Computer Use 和回归测试合并到
最后一次验证步骤；只有会决定后续操作是否安全的破坏性/高风险检查可以中途打断批次。

交互约束：用户一旦拖动时间轴、点上一步或点进度摘要中的历史步骤，即进入
**history lock**；同一 run 的新事件只增加 `max`，不得改写当前 `stepId`。只有显式点击
`Jump to live`、走到最新一步，或开始新的 run 才恢复实时跟随。

## 4. 打点步骤种类(按工具名分类)

| kind | 触发(工具名 / 事件) | Computer 正文渲染 |
| --- | --- | --- |
| `plan` / `outline` | 写 plan 产物(`generated/outline.md` 等) | `FileWriteCard` / `FileViewer` |
| `search` | `WebSearch` / `web_search` | `WebSearchCard` |
| `search-drilldown` | `WebFetch` / `web_fetch` / 对搜索结果的 `Read` | `WebFetchCard` / `FileReadCard` |
| `read` | 仅 URL 搜索下钻读取 | `FileReadCard`;普通源码读取不进入 Computer |
| `inspiration` | 灵感阶段标记 / `generated/inspiration.json` | 灵感卡 / `FileViewer` |
| `generate` | 写/改 `generateExtensions` 文件、`live_artifact` | `FileViewer`(产物/deck) |
| `thinking` | `thinking` 事件 | 不进入 Computer;保留在原始事件中 |

分类复用既有:`toolFamily()`、`file-ops.ts` 名单、`isTodoWriteToolName()`。

## 5. 复用与接缝

- Tier 1:`FlowProgressCard`、`.accordion-collapsible`、`QueuedSendStrip` 自动滚动接线。
- 完成态:`assistant-completion-row`、`ProducedFiles` + `pickPreviewableArtifact` /
  `pickPlanDocument`、`NextStepActions`。
- Tier 3:`FileWorkspace` 标签壳 + `ProjectTabsState`、`liveArtifactEvents` 流、
  `FileViewer`、`ToolCard` family 卡、`tool-renderers.ts`。
- 派生:`runtime/file-ops.ts`、`runtime/todos.ts`。

## 6. UI / CLI 双轨(仓库硬规则)

新增 `od task steps <conversationId> [--round N] [--json]`(或扩展 `od flow status`),
由 daemon 只读路由返回某轮完整派生的 `TaskStep[]`(读既有 `messages.events_json`,
**无迁移**),DTO 与 `taskStepComputerContentKind()` 白名单策略都落在
`packages/contracts`。CLI 保留完整诊断轨迹，UI 使用同一 contract 策略投影 Computer；
展示过滤不删除原始记录。UI + CLI + contract 同一 PR 落地，PR 模板 Surface area 两个框都勾。

## 7. 里程碑(每个单独 PR)

- **M1 · 会话体验**:按轮 task 模型 + Tier 1 固定折叠卡 + live/结束徽标 +
  完成态(折叠、大产物卡、3 条推荐追问)。详情暂留内联但可折叠,先出可见价值。
- **M2 · Computer + 极简会话**:`task-steps.ts` 派生;`OdComputerPanel` 作为新
  `computer:` body + 弹框;时间轴 + Jump-to-live + 运行即放大;把详情从会话搬进
  Computer(Tier 2 极简 brief)。CLI + contract。
- **M3 · 打磨**:追问生成;补齐步骤种类;18 语言 i18n;测试;本文校订。

## 8. 验收

- `pnpm --filter @open-design/web typecheck` + `test`;为 `deriveTaskSteps` /
  `deriveCurrentRound`、Tier 1 折叠、完成态(选产物 + 3 chip)写单测。
- 通过 `mocks/` 回放一段 generate+edit 会话(PATH overlay + `OD_MOCKS_TRACE`),
  验证:按轮切换、live→结束、极简 brief、Computer 回放/上一步下一步、Jump-to-live、
  各步骤种类渲染、完成折叠、大产物卡、3 条推荐追问。
- 双 namespace `tools-dev` 人工核验:跑一次 deck 生成,看固定卡 + Computer 实时
  (自动放大),回放上一步;再跑一次编辑,确认是独立 task;点一条推荐追问并确认只回填未发送。
- `od task steps <id> --json` 的原始顺序与 UI 派生源一致；contract 白名单测试应能从同一
  `TaskStep[]` 精确复现 Computer 所见的价值帧。

## 9. 实施与验收记录（2026-07-15）

- [x] M1：每轮 task、输入框上方固定进度卡、Live/终态、完成后自动折叠、主产物与
  3 条推荐追问已落地；追问位于 Next step 前，点击只回填输入框。
- [x] M2：`computer:<runId>` 持久标签、自动聚焦、Side view / 弹框切换、类型化正文、
  上一步/下一步、拖拽时间轴与 Jump to live 已落地；会话正文已收敛为摘要、状态与主产物。
- [x] M3：共享步骤投影覆盖 plan / outline / search / search-drilldown / read / write /
  edit / list / command / inspiration / generate / thinking / tool；Web 文案已补齐全部 locale。
- [x] UI / CLI 双轨：daemon 只读任务路由与 `od task steps <conversationId>
  [--round N] [--json]` 使用同一份 `packages/contracts` 投影，无数据库迁移。
- [x] 自动化验证：contracts、daemon route/CLI/mock replay、Web task 派生/固定卡/
  完成态/Computer/FileWorkspace 测试，Web 生产构建，仓库 guard、typecheck 与 i18n 检查。
- [x] 实机验证：在可见 Browser 中跑完一轮真实 42 步任务，覆盖读取、搜索、规划、写入、
  编辑与命令；确认运行期 Computer 自动打开、完成后仅保留一个 Computer 标签、历史回放、
  Jump to live、弹框/Side view 切换、终态折叠、主产物及 3 个追问。另以两个独立 namespace
  同时启动并核对各自 daemon/web 状态与日志归属。

### 9.1 交互打磨补充验收（2026-07-15）

- [x] 首内容到达前同步渲染明确的 `Preparing...` 状态；录制回放的可见 Browser 实测在发送后
  416 ms 内出现，不再只留一个空白 Assistant 容器。
- [x] Computer 的历史选择改为按 `stepId` 锁定。live 回放中选择 Grep 后，slider max 从 1
  增至 2 时标题仍保持 Grep；点击 Jump to live 后切到最新 Edit。
- [x] Computer 底部 Task progress 支持独立折叠，只投影可回放 task steps；TodoWrite / update_plan
  变化只展示在输入框上方的 Task progress。输入框进度保留折叠能力，并在新 live round 自动展开。
- [x] 输入框 Computer 入口由静态图标升级为当前步骤的轻量结构化缩略预览；只接收 step
  label / glyph / status / live 原始值并使用 `memo`，不挂载 iframe、不截图，避免 token delta
  触发高成本重绘。
- [x] 生产构建 Browser 视觉验收发现并修复右侧 step 文案被父级 grid 压进 18px marker 列的
  布局问题；最终 DOM 与截图均确认完整文案可见。详细记录见根目录 `design-qa.md`。
- [x] 信息架构补充验收：Computer 投影显式过滤 TodoWrite / update_plan，右侧标题、正文、
  时间轴和步骤摘要均不再出现 Todo；Todo 更新只保留在左侧固定进度卡，并优先于旧的
  会话级 staged flow。两侧统一使用 Icon 组件，并重新校准标题、状态、N/M、折叠箭头和
  时间轴控制的尺寸与基线。
- [x] 右侧收敛为单一 Computer 一级容器，Pages / Design Files、Browser、文件预览、终端、
  Questions 与回放全部在其内部；默认双栏实测为 `636 / 8 / 636px`，拖拽后为
  `756 / 8 / 516px`，恢复 Side view 后重新回到精确 1:1。
- [x] Computer 关闭后会话实测占满 `1280px` 且拖拽柄卸载；Computer 全屏时右侧占满
  `1280px`、会话隐藏。回放弹框的关闭按钮同时退出弹框和 Computer，最终回到会话全屏。
- [x] 会话头部 Open Design Cloud、Design Files、新建、历史、更多菜单均完成生产运行态
  校验；Design Files 会重开 Computer 并激活文件入口，Rename / Delete 使用既有会话能力。
- [x] Web 全量回归：426 个测试文件通过，4,392 条用例通过、7 条跳过；同时通过仓库
  `guard`（78 条策略测试）、根级 `typecheck` 与 Web 生产构建。
- [x] 五阶段进度补充验收：用户可见固定为
  `Brief / 问题确认 → 搜索（可选）→ 大纲 → 灵感 → 实现`;TodoWrite 只在后续
  轻量编辑轮接管。等待 brief 时显示“等待回复”而非“任务已完成”,pending 阶段不挂
  旧轮次产物。`od flow status --json` 与人类可读输出均通过真实 daemon 验证。

### 9.2 多形态、灵感组合与桌面韧性补充验收（2026-07-15）

- [x] 使用可见 Browser / Desktop runtime 和零 token mock provider 覆盖 8 类真实 query：
  deck、prototype、landing、mobile、webapp、document、report、media。8/8 返回正确
  `FlowShapeId`，且第一屏均进入 `Brief & questions`，搜索仍作为第二个可选阶段显示。
- [x] Inspiration 不再只选模板：同一面板并列展示真实模板预览与可用设计系统（色板、
  分类、说明）；用户可以只选其一或组合选择。生产桌面实际选择
  `market-diligence-report + agentic` 后，项目 `skillId` / `designSystemId`、
  `FlowSnapshot.inspireChoice` 与 `generated/inspiration.json` 三处一致。
- [x] System prompt 默认质量管线已覆盖所有模式：生成前运行 `design-taste-frontend`，
  交付前运行 anti-slop / brand 自检与 `impeccable-design-polish`；简单动效 CSS first，
  只有时间线/滚动编排等复杂场景才使用 GSAP，并强制 reduced-motion fallback。
- [x] Desktop 可选 pet 页面发生重定向或加载失败时，不再阻断主窗口 reveal；新增红绿
  回归测试隔离该错误，真实桌面重启确认主应用可用且失败只记录为可选 pet 日志。
- [x] 跨多轮持久化只保留一个可替换的 Computer 回放标签。点击历史轮次摘要仍可把该轮
  放入同一回放位，不再堆出多个同名 Computer 标签；生产桌面确认 tab 数从多个收敛为 1。
- [x] 重新实测上一步（3/3 → 2/3）、Jump to live（2/3 → 3/3）、右侧 Task progress
  折叠、左侧五阶段卡展开和 `Brief / Research(optional) / Outline / Inspiration /
  Implement` 五个标签完整可见。

### 9.3 设计垂类体验优先级补充（2026-07-15）

- [x] system prompt 把“需求充分与设计质量优先于过早执行”提升为最高原则；进入
  research/plan 前必须获得或可靠推断产出、受众、内容/信息架构、范围、品牌/参考、
  约束与成功标准，缺少会实质改变结果的信息时继续澄清。
- [x] 默认 task-type 与 discovery 表单把末项升级为“成功标准与约束”，引导用户说明
  什么叫优秀，同时继续遵守单卡、推荐默认值与不重复提问约束。
- [x] flow protocol 明确进度是真实工作契约：慢操作前先发 active，detail 必须具体，
  durable 工作落地后才更新 done/total，禁止为了显得忙而制造重复/虚假进度。
- [x] Inspiration 协议同步到组合模型：模板和/或设计系统同时作为视觉证据与 source of
  truth；生成按小批次持久化并持续挂载最新可用预览，使回放与实时查看都不出现空窗。
- [x] focused prompt tests 覆盖 daemon、API/contracts 与 8 个 flow shape，确保上述体验
  原则不会在本地 provider 与 BYOK/API 路径间漂移。

### 9.4 价值白名单、项目工作区与最终合并验收（2026-07-15）

- [x] Computer 共享投影收敛为四类价值帧：plan 正文、搜索列表、搜索下钻详情、已完成
  产物；TodoWrite / update_plan、普通源码读取、命令、列表、thinking、loading、失败重试与
  未知工具仍完整持久化，但不进入 Computer。生产录制回放的 Computer 作用域内未发现
  Todo / Preparing / Loading / Bash / Grep / Glob 等噪音。
- [x] discovery / system prompt 明确采用批量验证：同一批实现和生成 Todo 全部完成后，
  最后只运行一次 checklist、构建、Browser / Computer Use 与回归测试；不再在每个 Todo
  后重复昂贵校验。
- [x] 右侧 Task progress 可独立折叠，生产态实测从 `229px` 展开区收敛为 `45px` 单行；
  左侧输入框上方的五阶段进度保持独立、可折叠，并继续作为 Todo 更新的唯一 UI。
- [x] history lock 生产态停在 `Step 5 of 19`（slider `4/18`）后保持不动；新数据只推进
  max。点击 Jump to live 后才切到 `18/18`，按钮随即消失。
- [x] Computer 是右侧一级外壳，Design Files、Browser、文件/产物预览与回放均在其中；
  放大为居中工作区，关闭后拖拽柄卸载且会话占满内容区，重新打开保留内部标签与用户调整
  过的分栏宽度。
- [x] 常驻 Project 侧栏实测支持 `256px ↔ 72px` 折叠、搜索、项目切换与状态展示；搜索
  `Matrix` 精确返回 report / media / document / webapp / mobile / landing / prototype 七个项目。
- [x] 视觉 QA 发现并修复 Electron 中挂载 iframe 的 Computer 做 FLIP scale 后出现黑色
  合成块的问题：预览层保持挂载但不再参与父级缩放，背景继续自然淡入；从弹框还原分栏时
  在浏览器绘制前同步失效旧合成块，普通内容仍保留 FLIP。重建生产桌面并对 Side → Modal →
  Side 双向截图复核后均不再出现黑块。
- [x] 最终一次性门禁：contracts `36` 条、daemon flow/task/CLI/mock `37` 条、Web
  核心链路 `92` 条全部通过；Web typecheck、生产 build、仓库 guard 与 diff 检查通过。
  8 类 query（deck / prototype / landing / mobile / webapp / document / report / media）继续由
  同一共享路由测试覆盖。详细视觉记录见根目录 `design-qa.md` 的
  “Final value-only Computer and project workspace” 段落。
