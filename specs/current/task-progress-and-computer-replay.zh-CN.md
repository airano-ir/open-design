# 任务进度与可回放 Computer(Task Progress + Replayable Computer)

> 状态:定稿 v1.0(2026-07-14)。对标 Manus 的「极简会话 + 电脑回放」体验,
> 在 `staged-flow-north-star.zh-CN.md`(北极星链路)之上,重塑 Open Design 的
> **过程可见性**:会话只留最关键信息,所有中间过程收进一个**按轮次(round)
> 打点、可回放、可实时跟随**的 Computer 面板;进度以**每一轮任务**为单位,
> 固定悬浮在输入框上方。
>
> 本文是该方向的唯一真相源。实现拆分见 §7 里程碑;每个里程碑单独 PR,
> 遵守根 `AGENTS.md` 的 UI/CLI 双轨闭环规则。

## 0. 一句话

一次提问 = 一个任务(round)。会话里只看到**最精炼的一行行 brief 和最终产物**;
想看细节就点开 **Computer**——它把这一轮的搜索、读取、思考、plan、灵感、产物
全部按时间**打点**记录下来,可以 ◀ ▶ 回放、拖动进度条、● Live 实时跟随;任务
完成后有醒目的状态徽章、折叠的过程、一个大的产物预览、以及 3 个可点的追问。

## 1. 现状四问题

1. **进度割裂**:staged-flow 的 `FlowProgressCard`(6 阶段)按**会话**持久化在
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
- **steps = 对该轮 `events_json` 的精选投影**:把每个 `tool_use` 按 `id`↔`toolUseId`
  与其 `tool_result` 关联,加上 `live_artifact` 与 TodoWrite 写入,按**工具名**
  分类为步骤种类(§4)。事件顺序天然保序(append-only `events_json`);实时顺序
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
- 只展示**当前一轮的顶层步骤**:生成 → 6 阶段梯(复用 `FlowProgressCard`);
  编辑 → 更轻的顶层 TodoWrite 清单。
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
- **Computer = 全过程的唯一详情载体**,包含**核心 task 步骤本身**、每个 todo、
  搜索/读取/思考/plan/灵感/产物,以及它们的完整内容与时间轴回放。

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
- **3 个追问 chip**:复用/扩展 `NextStepActions`,每轮完成后给 3 个建议追问;
  点击即发送。来源:一期用简单启发式,三期改为 agent 提供(如 `<od-followups>` 标记)。

### 3.4 Tier 3 · 可回放的 Computer 面板

右侧面板是**标签系统**(`FileWorkspace` 的 `.ws-body` 分派;标签持久化在
`tabs_state` / `ProjectTabsState`),现状**没有回放/时间轴**。因此:

- 把 Computer 作为**新的保留 body 类型**——新增标签 id 约定,与 `live:` /
  `terminal:` / `chat:` 并列(如 `computer:<runId>`),在 `.ws-body` 分派里渲染
  新组件 `OdComputerPanel.tsx`:
  - **顶部**状态行 `Using {tool} · {target}`,取自当前/选中步骤。
  - **正文**用**既有 family 卡**渲染选中步骤的类型化内容——`WebSearchCard`
    (搜索列表)、`FileReadCard`(读取详情)、`FileWriteCard`/`TodoCard`
    (plan/大纲)、`WebFetchCard`,以及 `FileViewer`(产物/deck 预览)。
  - **底部时间轴**:◀ ▶ 上一步/下一步、可拖拽进度条、● Live + **Jump to live**;
    下方是 `Task progress` 迷你摘要。
- **两种呈现**:(a) 停靠 **Side view**(分栏里的新 body);(b) 全局 **弹框**
  (同一 `OdComputerPanel`)。二者可切换。**运行即放大**:一轮开始时激活
  `computer:` 标签(可配合 `workspaceFocused`)并实时跟随。
- 复用:标签壳 + `ProjectTabsState` 持久化;既有 `liveArtifactEvents` 流的追加
  模式;`FileViewer` + `ToolCard` family 卡渲染内容。这是**新 body 类型**,不是
  fork `FileViewer`。

## 4. 打点步骤种类(按工具名分类)

| kind | 触发(工具名 / 事件) | Computer 正文渲染 |
| --- | --- | --- |
| `plan` / `outline` | `TodoWrite` / 写 plan 产物(`generated/outline.md` 等) | `TodoCard` / `FileWriteCard` |
| `search` | `WebSearch` / `web_search` | `WebSearchCard` |
| `search-drilldown` | `WebFetch` / `web_fetch` / 对搜索结果的 `Read` | `WebFetchCard` / `FileReadCard` |
| `read` | `Read` / `read_file` | `FileReadCard` |
| `inspiration` | 灵感阶段标记 / `generated/inspiration.json` | 灵感卡 / `FileViewer` |
| `generate` | 写/改 `generateExtensions` 文件、`live_artifact` | `FileViewer`(产物/deck) |
| `thinking` | `thinking` 事件 | 思考文本 |

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
由 daemon 只读路由返回某轮派生的 `TaskStep[]`(读既有 `messages.events_json`,
**无迁移**),DTO 落 `packages/contracts`。UI + CLI + contract 同一 PR 落地,
PR 模板 Surface area 两个框都勾。

## 7. 里程碑(每个单独 PR)

- **M1 · 会话体验**:按轮 task 模型 + Tier 1 固定折叠卡 + live/结束徽标 +
  完成态(折叠、大产物卡、3 追问 chip)。详情暂留内联但可折叠,先出可见价值。
- **M2 · Computer + 极简会话**:`task-steps.ts` 派生;`OdComputerPanel` 作为新
  `computer:` body + 弹框;时间轴 + Jump-to-live + 运行即放大;把详情从会话搬进
  Computer(Tier 2 极简 brief)。CLI + contract。
- **M3 · 打磨**:追问生成;补齐步骤种类;18 语言 i18n;测试;本文校订。

## 8. 验收

- `pnpm --filter @open-design/web typecheck` + `test`;为 `deriveTaskSteps` /
  `deriveCurrentRound`、Tier 1 折叠、完成态(选产物 + 3 chip)写单测。
- 通过 `mocks/` 回放一段 generate+edit 会话(PATH overlay + `OD_MOCKS_TRACE`),
  验证:按轮切换、live→结束、极简 brief、Computer 回放/上一步下一步、Jump-to-live、
  各步骤种类渲染、完成折叠、大产物卡、3 追问 chip。
- 双 namespace `tools-dev` 人工核验:跑一次 deck 生成,看固定卡 + Computer 实时
  (自动放大),回放上一步;再跑一次编辑,确认是独立 task;点一个追问 chip。
- `od task steps <id> --json` 与 UI 所见一致。
