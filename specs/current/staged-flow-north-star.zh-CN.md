# 北极星链路:分阶段全链路生成流程(Staged Flow)

> 状态:定稿 v1.1(2026-07-13)。对标 `nexu-io/codex-slides`(本地源码
> `~/Projects/personal-work/experiments/ppt-anything`)的 6 步分阶段流,
> 把 Open Design 的「输入 → 澄清 → 生成 → 交付」重塑为一条**全程可见、
> 默认可点、硬交付收尾**的北极星链路。
>
> 链路对**所有产出形态统一**:deck、通用 prototype、landing page、
> mobile 原型、web 原型/应用、长文档(docs)、PDF 报告、图像/视频/音频,全部走同一条
> 五步链路;形态差异(问什么、plan 长什么样、灵感目录取哪个子集、
> 进度按什么计数、交付给什么按钮)**全部收敛进形态矩阵(§5.0)**,
> 新形态接入 = 改配置,不加机制。
>
> 本文是该方向的唯一真相源。实现拆分见 §8 里程碑;每个里程碑单独 PR,
> 且遵守根 `AGENTS.md` 的 UI/CLI 双轨闭环规则。

## 0. 一句话

用户进来随意输入一句话,之后只需要「点点点」——每一步都有推荐默认值和
整体流程预览——几分钟后拿到一个好看、有参考、有据可查的结果,并被明确
引导完成下载或分享(硬交付)。

## 1. 北极星指标链路与现状四问题

### 1.1 链路定义(漏斗)

```
进入产品 → 首次输入(任意粗糙)
        → 需求确认(默认全选,一键开始)
        → [搜索](可选 deep research / 内置基础 search)
        → Plan(brief + 大纲,可编辑,一键确认)
        → 灵感(相关模板排序,默认选中 Top-1,可明确跳过)
        → 生成(并行渲染,进度 N/M)
        → Aha(第一眼好看)
        → 硬交付:下载 或 分享                ← 北极星完成事件
```

度量:每一步的转化率 + 首次输入到硬交付的 TTV(目标 ≤ 8 分钟;
codex-slides 参考值:10+ 页 deck 约 4–5 分钟)。

### 1.2 现状问题(用户原始反馈)

| # | 问题 | 现状根因(代码落点) |
|---|------|--------------------|
| P1 | 过程暴露太多细节、整体预期未知;需求表单无默认选中,逐项选择导致流失 | 进度只有自由文本 TodoWrite 钉卡(`apps/web/src/components/ChatPane.tsx` PinnedTodoSlot),没有固定大阶段;`discovery.ts` 生成的 `<question-form>` 不强制 `defaultValue`,而渲染层其实已支持(`apps/web/src/artifacts/question-form.ts:636` parseDefaultValue) |
| P2 | 理解容易对不齐:没有自动生成的 plan/需求文档 | 澄清答案直接进 prompt,没有落成可编辑的 `brief.md` / `outline.md` 工件与确认点 |
| P3 | 没有灵感选择:不展示社区/相关模板,无默认参考 | `design-templates/`(约 110 个)只在建项目时作为入口 chip,生成中途没有「按主题+大纲排序 → 默认选中 → 明确跳过」的灵感步骤 |
| P4 | 生成完没有下载/分享引导,CTA 欠佳 | 导出/分享藏在 FileViewer 分享菜单(`apps/web/src/components/FileViewer.tsx`);`NextStepActions.tsx` 存在但未与「流程完成」绑定,没有硬交付语义 |

## 2. 对标:codex-slides 的可移植机制

全部经源码核实,可直接借鉴的五个机制:

1. **持久化阶段状态机**(`src/lib/types.ts:228` `ProjectWorkflowStage`):
   `clarify | research | outlining | outline | inspire | rendering | deck`,
   存在 project 上,刷新/离开不丢;`researchMode` 显式镜像在工作流状态里,
   防止 reload 后静默丢掉搜索步骤。
2. **进度卡纯函数**(`src/lib/workflowProgress.ts` `buildWorkflowProgress`):
   输入阶段 + 各步计数,输出 `steps[]`,每步
   `state: complete|active|pending|skipped|error` + 一行 detail
   (如「7 questions confirmed」「Round 1/2 · 9 searches」「Skipped · Using
   the default style」)。research 步只在开启时插入。UI 只做渲染。
3. **带推荐值的动态表单**(`src/lib/onboard.ts` `QuestionSpec.recommended`):
   prompt 硬性要求每个 single 题必须给 `recommended`;固定题(页数/比例/
   分辨率/语言/风格/类目)+ 1 个主题内容题,共 6–7 题;
   `questionSemantics.ts` 做确定性兜底(模型漏了必答题就补上,值语义
   `16:9 · 宽屏` 保证机器可读)。表单预填推荐值、整体可跳过、每题可自由
   文本补充。
4. **灵感排序 + 默认 + 明确跳过**(`src/lib/inspire.ts` `rankCommunityTemplates`):
   一次模型调用把整个风格目录按「主题+大纲」排序并给 Top-4 理由,离线
   关键词兜底;UI 默认高亮 Top-1,一键 Apply,或明确 skip(进度卡记
   「Skipped · Using the default style」而不是消失)。
5. **渲染完成 → 建议 chips**(`src/lib/projectRuns.ts:753`):assistant 消息
   携带 `suggestions: string[]`,渲染成可点 chips,引导下一步。

另外两条工程经验:大纲是**先落盘再渲染**的可确认工件(status
draft → rendering → ready,可断点续渲);research 是 toggle 默认关 +
内置 web_search 兜底,过程有独立 workspace(搜索数/来源数/流式报告)。

## 3. 现状盘点:Open Design 已有的积木

重构原则:**激活已有原语,不发明新机制**。

| 积木 | 位置 | 状态 |
|------|------|------|
| 分阶段管线契约(休眠) | `packages/contracts/src/plugins/manifest.ts:73` `PipelineStageSchema`/`PluginPipelineSchema`;`packages/contracts/src/plugins/events.ts` `pipeline_stage_started/completed` | 纯 wire 格式,daemon 尚未发射 |
| GenUI 确认面(已通电) | `apps/daemon/src/routes/genui.ts`(`GET /api/runs/:runId/genui`、`POST .../respond`、`.../prefill`)+ `apps/daemon/src/genui/index.ts` | 路由与持久化可用 |
| 需求表单 | `apps/web/src/artifacts/question-form.ts`(18 种控件、`defaultValue`、`allowCustom`、`maxSelections`);`QuestionFormView`(默认值 seed 在 `QuestionForm.tsx:92`,整体跳过 `:143`);prompt 侧 `apps/daemon/src/prompts/discovery.ts` | 渲染层完备;**prompt 不强制默认值** |
| 进度钉卡 | `apps/web/src/runtime/todos.ts` + `ChatPane.tsx` PinnedTodoSlot | 自由文本 TodoWrite,无固定阶段 |
| 搜索 | `od research search` CLI(`cli.ts:697`)→ `POST /api/research/search`(`routes/media.ts:536`,Tavily);composer `/search` 命令(`ChatComposer.tsx:2392`);research 命令契约 prompt 块(`prompts/research-contract.ts`,产出 `research/<slug>.md`) | 单轮 shallow 可用;**无 plus 菜单开关、无多轮 deep research、无过程 workspace** |
| 模板目录 | `/api/design-templates`(镜像 `/api/skills`);`design-templates/*/SKILL.md`(`od.mode: deck|prototype|...`、tags、baked `example.html` 预览) | 目录齐全;**无中途排序/挑选步骤** |
| 交付 | `apps/web/src/runtime/exports.ts`(PDF/PPTX/HTML/ZIP/MD)、`routes/deploy.ts`(Vercel/CF Pages)、`SocialShareGrid.tsx`、`NextStepActions.tsx` | 能力齐;**入口藏在分享菜单,未与流程收尾绑定** |
| 漏斗埋点 | `run-lifecycle-analytics.ts`(`artifact_count`、`asked_user_question`、`first_artifact_at`) | 有 run 级信号;**无阶段级漏斗、无硬交付事件** |

## 4. 目标体验(用户视角走一遍)

1. **输入**:首页/项目里随意输一句「做个 2026 人形机器人市场调研 PPT」。
   composer 的 ＋ 菜单里有「Deep research」开关(默认关)。
2. **需求确认**(阶段 1/5):右侧 Questions 面板出现 4–6 题,**每题都已
   预选推荐值**(★ 标记),顶部主按钮「按推荐直接开始」,次按钮「逐项
   调整」。同时最新 assistant 消息内出现**表单式流程进度卡**:五步全览,第 1 步 active,
   后四步 pending 各带一行「什么时候开始」的预告。
3. **搜索**(阶段 2/5,条件步):开了 Deep research → 多轮搜索,右侧
   Research workspace 显示「N searches · M sources + 流式 Markdown 报告」;
   没开但意图含事实性内容 → 自动跑一轮内置基础 search(shallow),进度卡
   显示「基础搜索 · N 来源」;纯创意任务 → 此步标记 skipped。产出
   `research/*.md` 进 Design Files,可查可改。
4. **Plan**(阶段 3/5):agent 写出 `generated/brief.md`(结构化需求:
   页数/受众/地区/重点/类型/比例/分辨率,来自表单答案)+
   `generated/outline.md`(逐页大纲)。聊天里出现确认条
   「✓ 确认大纲,生成 N 页」,默认动作就是确认;想改就直接说话或在
   Design Files 里编辑文件。
5. **灵感**(阶段 4/5):右侧灵感面板展示与任务类型相关的模板
   (design-templates + 社区风格),按「brief+大纲」语义排序,**Top-1
   默认选中**并给一行理由;底部两个动作:「用这个风格 →」(主)和
   「不用参考,默认风格」(次,进度卡记 skipped 而非消失)。
6. **生成**(阶段 5/5):按选定模板/风格渲染,进度卡显示 N/M;产物落
   Design Files,预览即时可见。
7. **交付**:生成完成的 assistant 消息下方出现**下一步 CTA 行**:
   「下载 PPTX」「下载 PDF」「分享链接」「继续调整」。点下载/分享即完成
   北极星事件 `hard_delivery`。

全程用户必须做的决定只有三次点击:开始(默认)、确认大纲(默认)、
选风格(默认)——每次都可以不改任何东西直接点。

把首句换成「做个咖啡品牌 landing page」「写一份 30 页行业白皮书 PDF」
「出一版记账 App 移动原型」,**五步与三次默认点击完全不变**——变的只有
每步的内容:问的题、plan 工件的形状、灵感目录的子集、进度计数单位、
交付按钮。这些差异全部由 §5.0 的形态矩阵配置,不产生新流程代码。

## 5. 设计

### 5.0 任务形态矩阵(FlowShape registry)

链路是形态无关的;每种产出形态在注册表里声明自己的五步参数:

| 形态 `shape` | 判定来源 | clarify 固定题骨架(全部带默认值) | plan 工件 | inspire 目录子集 | 进度单位 | deliver CTA |
|---|---|---|---|---|---|---|
| `deck` 演示 | `od.mode: deck` / task-type 答案 | 页数·比例·风格方向·speakerNotes·内容重点 | `brief.md` + `outline.md`(逐页) | deck 模板 + 社区风格 | 页 N/M | 下载 PPTX·下载 PDF·分享·继续调整 |
| `prototype` 通用原型 | `mode: prototype` + 未命中更具体语义 | 平台·保真度·核心流程·视图数·交互深度 | `prototype-plan.md`(视图/状态 + 交互) | `prototype-template` 通用线框/概念模板 | 屏幕 N/M | 预览·下载 ZIP·分享·继续调整 |
| `landing` 落地页 | `mode: prototype` + `platform: desktop` + 单页营销语义 | 区块数·风格·品牌·转化目标 | `structure.md`(区块 + 文案骨架) | `landing-template` 营销/转化模板 | 区块 N/M | 部署分享·下载 HTML/ZIP·继续调整 |
| `mobile` 移动原型 | `mode: prototype` + `platform: mobile` | 屏幕数·iOS/Android·风格·核心流程 | `flows.md`(屏幕清单 + 导航图) | mobile 类模板(含 `plugins/_official/examples`) | 屏幕 N/M | 预览分享·下载 ZIP·继续调整 |
| `webapp` web 原型/应用 | `mode: prototype` + `platform: desktop` + 应用/工作台语义 | 页面数·信息架构·风格 | `plan.md`(IA + 页面清单) | `webapp-template` dashboard/workflow 模板 | 页面 N/M | 部署分享·下载 ZIP·继续调整 |
| `document` 长文档/docs | 长文语义 / 文档类模板 | 章节数·受众·语气·输出格式 | `toc.md`(章节大纲) | `document-template` 决策文档主题 | 章节 N/M | 下载 MD/PDF·分享·继续调整 |
| `report` PDF 报告 | document 变体,PDF-first | 页数·图表密度·受众 | `outline.md`(章节 + 图表清单) | 报告类模板 | 章节 N/M | 下载 PDF·分享·继续调整 |
| `media` 图像/视频/音频 | `mode: image/video/audio` | 数量·比例·风格·时长 | `shots.md`(分镜/画面描述) | image/video 模板(已有类目) | 素材 N/M | 下载素材·分享·继续调整 |

- **形态判定** `resolveFlowShape`:active plugin 的 `od.mode` + `platform`
  直接判定;无 plugin 时由 discovery 的 task-type 路由表单
  (`discovery.ts:48` 已有 `<question-form id="task-type">`)答案映射;
  仍不明确 → clarify 第一题问形态(带默认值)。
- **注册表落在 contracts**(纯 TS,web/daemon/CLI 三端共用):

```ts
export interface FlowShapeSpec {
  id: FlowShapeId;
  stages: FlowStageId[];             // 该形态实际存在的步骤
  planArtifacts: string[];           // 约定工件,如 ['generated/brief.md', 'generated/outline.md']
  progressUnitKey: string;           // i18n key:页/区块/屏幕/章节/素材
  inspireFilter: { modes: string[]; platform?: string };
  deliverActions: FlowDeliverAction[]; // 'pptx'|'pdf'|'html'|'zip'|'deploy'|'social'|'preview'|'md'
}
export const FLOW_SHAPES: Record<FlowShapeId, FlowShapeSpec>;
```

- **prompt 与 UI 同源**:daemon 的 flow 协议段(§5.2)按 `FLOW_SHAPES`
  渲染各形态的工件约定与进度单位,UI 按同一注册表渲染进度卡与 CTA——
  两端不可能漂移。新形态接入 = 注册表加一行 + 该形态的题骨架/工件模板
  prompt 片段 + 灵感目录标签,零新组件。

### 5.1 阶段状态机(contracts)

新增 `packages/contracts/src/api/flow.ts`:

```ts
export type FlowStageId =
  | 'clarify'    // 需求确认
  | 'research'   // 搜索(条件步:deep | basic | skipped)
  | 'plan'       // brief + 大纲(可编辑、需确认)
  | 'inspire'    // 灵感(排序 + 默认选中 | 明确跳过)
  | 'generate'   // 生成
  | 'deliver';   // 交付 CTA(下载/分享)

export type FlowStageState =
  | 'pending' | 'active' | 'complete' | 'skipped' | 'error';

export interface FlowStageSnapshot {
  id: FlowStageId;
  state: FlowStageState;
  /** 一行人话:如「7 个问题已确认」「Round 1/2 · 9 searches」 */
  detail?: string;
  /** generate 阶段:{ done, total } */
  progress?: { done: number; total: number };
}

export interface FlowSnapshot {
  version: 1;
  /** 产出形态(§5.0),决定 stages 组成、进度单位与交付动作 */
  shape: FlowShapeId;
  stages: FlowStageSnapshot[];
  activeStage: FlowStageId | null;
  researchMode: 'deep' | 'basic' | 'off';
  updatedAt: number;
}
```

- 快照持久化在 conversation 行上(daemon SQLite),SSE 重放/刷新可恢复
  ——对应 codex-slides「`researchMode` 显式镜像防丢」的教训。
- SSE:`DaemonAgentPayload` 增加一个事件种类 `flow_stage`
  (payload = `FlowSnapshot`),放进 `packages/contracts/src/sse/chat.ts`
  的 payload union。**先不启用休眠的 `pipeline_stage_started/completed`**
  ——那套是 plugin 管线粒度(atoms/repeat/until),v1 的流程是会话级
  五大步,语义不同;v2 若把每个阶段拆成 plugin atoms 再对接(见 §9)。

### 5.2 阶段驱动:标记为主,启发式兜底

OD 的架构是「daemon 孵化外部 agent CLI」,不能像 codex-slides 那样由
服务器逐阶段发起模型调用。因此 v1 用**流内协议 + daemon 解析**:

- **主通道**:system prompt 增加 flow 协议段(`apps/daemon/src/prompts/`
  新增 `flow.ts`,由 `composeSystemPrompt` 挂入,BYOK 侧同步
  `packages/contracts/src/prompts/system.ts` 镜像):agent 在进入/完成
  每个阶段时输出单行标记
  `<od-flow stage="plan" state="active" detail="正在写大纲"/>`。
  daemon 端仿照 `runAskedUserQuestion`(`run-artifacts.ts:241`)在重组的
  text_delta 流里解析该标记(**渲染前剥离**,同 `<question-form>` 处理
  方式),更新 `FlowSnapshot` 并发射 `flow_stage` 事件。
- **兜底启发式**(daemon 侧,标记缺失时也能推进,防模型漏发):
  - 检出 `<question-form id="discovery">` → clarify active;收到表单答案
    的 user 消息 → clarify complete。
  - tool_use 命中 `od research search` → research active;
    `research/*.md` 工件落盘 → research complete。
  - `generated/outline.md`/`brief.md` 写入 → plan active;确认条被点击
    → plan complete。
  - 灵感面板 apply/skip 动作 → inspire complete/skipped(这个由 UI 直接
    POST,天然可靠)。
  - 首个可预览工件事件 → generate active;run 正常收尾 → generate
    complete、deliver active。
- 两通道结论冲突时**以更靠后的阶段为准**(单调推进,不回退;用户显式
  返工除外,由新一轮 clarify/plan 标记重置)。

### 5.3 进度卡(FlowProgressCard)

- 新组件 `apps/web/src/components/FlowProgressCard.tsx` + CSS Module,
  渲染 `FlowSnapshot`:标题「任务进度 · 第 X / N 步」,每步一行
  (✓ / ◔ / ○ / ⊘ / ✕ + label + detail),完全对应参考截图 1 的
  「Presentation progress · Step 5 of 5」。
- 位置:作为表单式状态块渲染在**最新 assistant 消息内部**,随聊天内容滚动;
  新 assistant 消息到达后进度卡跟随到最新消息,`FlowSnapshot` 更新时原位刷新,
  不钉在 `.chat-log` 顶部。
- 与 TodoWrite 的关系:FlowProgressCard 和 TodoWrite 各自沿用消息时间线,
  不互相替代;非 flow 会话(纯 chat、tune-collab)不渲染进度卡,保持现状。
- pending 步必须带「何时开始」预告文案(「大纲确认后开始」),这是
  P1「预期体感未知」的直接解药。
- 展开/收起沿用 `.accordion-collapsible` 契约;动效遵守 UI animation
  philosophy(ease-out、进 200ms 出 140ms)。
- i18n:全部新文案进 `apps/web/src/i18n/types.ts` + 18 个 locale。

### 5.4 需求确认:默认值成为硬规则

prompt 侧(`apps/daemon/src/prompts/discovery.ts`):

- 新增硬规则:**每个 radio/select 题必须带 `defaultValue`(推荐值)**;
  checkbox 题给出推荐组合;number 题给推荐数字。仿照 codex-slides
  `questionSemantics.ts`,在 daemon 侧加确定性校验:解析 discovery 表单
  时(web 端 `question-form.ts` 已能读 `defaultValue`),对缺省的题按
  题型补默认(radio → 第一个选项),保证「模型可引导、不可依赖」。
- 题量上限从当前实践收敛到 **4–6 题**:页数/比例(或平台)/风格方向/
  1 个主题内容题 + 任务形态特有题(deck 的 speakerNotes switch 保留,
  `discovery.ts:142` 已有 defaultValue: true 的先例)。
- 已有信息不再问:Project metadata / Plugin inputs 预答逻辑
  (`discovery.ts:151`)不变。

UI 侧(`QuestionForm.tsx` / `QuestionsPanel.tsx`):

- 表单顶部加**主 CTA「按推荐直接开始」**:等价于当前 seeded 默认值
  直接 submit(`formatFormAnswers` 原样走 `/api/chat`,零新 API)。
  现有「全部跳过」保留为文字链。
- 每个预选项右上角加 ★「推荐」角标(对应 codex-slides
  `onb-recommended`)。
- 逐项调整仍然可用——默认路径变快,不砍能力。
- **默认值语义 = 选中推荐选项,而非填充 custom answer**:有限选项题
  (radio/select/checkbox/direction-cards)的 `defaultValue` 只用于**高亮
  选中对应选项**;当默认值不落在任何选项上(模型漂移,或流式解析时
  `defaultValue` 只到了一半,如「现代极简…」只流到「现」)必须回退到题型
  默认(radio → 首项),**绝不把这段游离字符串塞进自由文本 custom 框**。
  实现:`QuestionForm.tsx` `seedDefaultForQuestion` 对有限选项题只保留能
  映射到真实选项的默认值,其余丢弃并回退。
- **流式 re-seed(不冻结半截默认值)**:Questions tab 流式期用容错解析
  (`parsePartialQuestionForm`),某题的推荐默认值可能在字段首次渲染后才
  流完。`QuestionForm.tsx` 用 `touchedRef` 记录用户已改动的题,对**未改动**
  的题在表单更新时重新按最新默认值 seed(而不是只回填 `undefined`),
  保证流完后默认值落成「选中的推荐选项」而非停在半截的 custom 文本。

### 5.5 搜索:＋菜单开关 + 内置基础 search

- **入口**:`ComposerPlusMenu.tsx` 增加「Deep research」开关行
  (`PlusMenuSubmenu` 平级直接动作),状态持久在会话上并镜像进
  `FlowSnapshot.researchMode`;开启后 composer 显示一个可关的
  「Deep research」pill。`/search` 命令保留(专家路径)。
- **三档语义**:
  - `deep`:多轮(默认 2 轮)研究循环——规划角度 → 并发
    `od research search` → 汇总缺口 → 补搜 → 写报告。复用现有 research
    命令契约(`prompts/research-contract.ts`),prompt 升级为多轮协议;
    `ResearchDepth` 的 `medium/deep` 档位(contracts 已定义,
    `RESEARCH_DEFAULT_MAX_SOURCES` 12/30)在 `apps/daemon/src/research/`
    落实(Tavily depth 参数 + 多查询)。
  - `basic`(默认):用户没开 deep,但 clarify 后 agent 判定意图需要
    事实支撑(市场数据、竞品、引用)→ 自动跑一轮 shallow 搜索;flow
    协议要求 agent 在 brief.md 里声明「已做基础搜索,N 个来源」。
  - `off`:纯创意/无事实需求 → research 步 skipped,进度卡明示。
- **过程可视化**(参考截图 3):research 阶段 active 时,右侧面板显示
  Research workspace 卡:searches / sources 计数 + live 步骤列表 + 流式
  报告。v1 从简:计数与步骤由 `flow_stage` 的 detail 滚动更新,报告文件
  落盘后在 Design Files 打开;完整 workspace(独立 SSE 通道)排 v2。

### 5.6 Plan:落盘工件 + 一键确认

- flow 协议要求(deck 任务):clarify 完成后 agent 必须先写
  `generated/brief.md`(表单答案 + 系统推荐的结构化复述;参考截图 1 左栏
  的「系统推荐:页数 12 / 受众 投资人 / …」)与 `generated/outline.md`
  (逐页标题 + 要点),**然后停下**,输出确认请求。
- 确认交互:复用 `<question-form>`(id="plan-confirm",单题 radio:
  「✓ 确认,生成 N 页」默认选中 /「我要修改」+ allowCustom 自由文本)。
  聊天里渲染为醒目确认条——不新增交互机制,walk 现有
  QuestionsBanner/QuestionsPanel 通路。
- 默认确认由 host 直接 `POST /api/conversations/:id/flow/plan-confirm`:
  原子落 user answer、把 plan 标为 complete 并立即打开 inspire 面板,
  **不启动一个只负责复述“已确认”的空 agent turn**。这样确认到灵感可见
  是本地状态转移,不受模型 TTFT/是否漏 marker 影响;「我要修改」仍进入 agent
  turn 修改 plan 并再次确认。
- 修改路径:用户自然语言说改 → agent 改 `outline.md` 再次确认;或用户
  直接在 Design Files 编辑文件后说「按这个来」。
- 其余形态按 §5.0 矩阵取各自的 plan 工件(landing=`structure.md` 区块+
  文案骨架;mobile=`flows.md` 屏幕+导航;document=`toc.md` 章节;
  media=`shots.md` 分镜),确认条文案随形态与进度单位变化,交互不变。

### 5.7 灵感:排序 + 默认选中 + 明确跳过

- **数据面**:新端点 `POST /api/inspire/rank`
  (`apps/daemon/src/routes/inspire.ts` + contracts
  `packages/contracts/src/api/inspire.ts`):入参
  `{ brief, outlineTitles[], mode }`,出参
  `{ ranked: templateId[], reasons: Record<id, string> }`。
  实现同 codex-slides `inspire.ts`:目录(`/api/design-templates` +
  社区风格,先按 §5.0 的 `inspireFilter`(od.mode/platform)取形态子集)
  拼进一次模型调用排序,**关键词打分离线兜底**(秒出,不阻塞流程);
  排序结果必须包含子集全量、id 校验去重。document/report 形态通过
  `document-template` / `report-template` tags 分开候选集,避免互相串场。
- **UI 面**(参考截图 4):灵感面板(右侧 tab 或浮层)——顶部搜索 +
  分类 chips(由 `od.mode`/tags 派生),卡片带预览图(baked
  `example.html` 截图/poster)与一行理由;**Top-1 默认选中**,底部主 CTA
  「用 “X” 生成 →」、次动作「不用参考,默认风格」。选择/跳过直接 POST
  回 daemon(记录进 FlowSnapshot),然后作为下一 user 消息注入
  (`[inspiration — <template-id>]`),agent 按既有 design-template 机制
  应用(拷贝 seed/风格块)。
- **CLI 闭环**:`od inspire rank --brief-file <path> --json`
  (SUBCOMMAND_MAP 注册),同一端点。
- 已在建项目时选了模板/design system 的会话:inspire 步预标记
  complete(detail=「已在创建时选定 X」),不重复打扰——对应
  codex-slides「inspire 只在未选模板时出现」。

### 5.8 交付:下一步 CTA(硬交付)

- generate 完成时,flow 协议要求 assistant 收尾消息后紧跟一个
  **NextStep CTA 行**(升级 `NextStepActions.tsx`):动作集直接取
  §5.0 矩阵的 `deliverActions`——deck:PPTX/PDF/分享;landing/webapp:
  部署分享/HTML/ZIP;mobile:预览分享/ZIP;document/report:MD/PDF;
  media:素材下载;所有形态都带「继续调整」。
- 动作直接调既有能力:`exports.ts` 的 `exportProjectAsPptx/Pdf/Html`、
  deploy 路由、SocialShareGrid——**不新做导出,只把入口从分享菜单提级
  到流程收尾**。
- 触发方式:web 端在收到 `flow_stage`(deliver active)时本地渲染 CTA
  行(不依赖模型输出按钮文案,保证 100% 出现);模型只负责收尾话术。
- 点击任一下载/分享动作 → 上报 `hard_delivery`(见 §5.10),deliver 步
  标记 complete。「继续调整」不结束 deliver(还可以回来下载)。

### 5.9 UI/CLI 双轨闭环清单

| 能力 | HTTP | UI | CLI |
|------|------|----|----|
| flow 快照读取 | `GET /api/conversations/:id/flow` | FlowProgressCard | `od flow status --conversation <id> --json` |
| plan 确认 | `POST /api/conversations/:id/flow/plan-confirm` | plan-confirm 默认按钮 | `od flow confirm <id> [--prompt-file <path\|->] --json` |
| 灵感排序 | `POST /api/inspire/rank` | 灵感面板 | `od inspire rank --json` |
| 灵感选择/跳过 | `POST /api/conversations/:id/flow/inspire`(apply/skip) | 面板按钮 | `od inspire apply/skip` |
| deep research 开关 | 会话 PATCH(现有会话更新面) | ＋菜单开关 | `od chat --research deep|basic|off`(现有 research 参数扩展) |

导出/分享/研究已有 CLI 面,不重复建设。

### 5.10 北极星埋点

在 `run-lifecycle-analytics.ts` 体系上补阶段级漏斗(PostHog,延续
`ai-native-observability-loop.md`):

- `flow_stage_transition`:`{ stage, state, conversationId, elapsedMs }`
  ——六个阶段的进入/完成/跳过全记录。
- `flow_defaults_used`:需求表单是「按推荐直接开始」(true)还是逐项
  调整(false)+ 修改题数。
- `inspire_choice`:`{ picked: templateId | null, rank, skipped }`。
- `hard_delivery`:`{ kind: pptx|pdf|html|zip|deploy|social, msFromFirstInput }`
  ——**北极星完成事件**。
- 漏斗视图:首次输入 → clarify complete → plan complete → generate
  complete → hard_delivery,各步转化率 + P50/P90 TTV。

## 6. 代码落点汇总

| 层 | 文件 | 变更 |
|----|------|------|
| contracts | `src/api/flow.ts`(新)、`src/api/inspire.ts`(新)、`src/sse/chat.ts`(+`flow_stage` payload)、`src/prompts/system.ts`(flow 协议镜像) | M0/M3 |
| daemon | `prompts/flow.ts`(新,协议段)、`prompts/discovery.ts`(默认值硬规则、题量收敛)、流解析(`server.ts`/`claude-stream.ts` 邻域,`<od-flow>` 标记剥离+解析)、`routes/flow.ts`(新)、`routes/inspire.ts`(新)、`research/`(medium/deep 落实)、`cli.ts`(`od flow`、`od inspire`) | M0–M4 |
| web | `FlowProgressCard.tsx`(新)、`ChatPane.tsx`(钉卡接线)、`QuestionForm.tsx`(按推荐开始 + ★)、`ComposerPlusMenu.tsx`(Deep research 开关)、灵感面板(新)、`NextStepActions.tsx`(交付 CTA)、`artifacts/question-form.ts`(如需 option 级标注则扩展,首选题级 `defaultValue` 不动)、i18n 18 locale | M1–M5 |
| 规范 | `discovery.ts` 与 `packages/contracts/src/prompts/system.ts` 保持镜像(AGENTS.md「Asking the user questions」既有要求) | 全程 |

红线(来自根 AGENTS.md):web 不 import daemon `src/**`;共享 DTO 全走
contracts;新端点三件套(HTTP+UI+CLI)同 PR;`src/` 下不加测试,测试进
`tests/`;i18n key 先进 `types.ts`。

## 7. 验证策略

- **流解析**:`<od-flow>` 标记解析/剥离 + 兜底启发式,用 `mocks/` 回放
  录制会话验证(PATH-overlay,`OD_MOCKS_TRACE`),不烧真实额度;红 spec
  先行(Bug follow-up workflow)。
- **daemon HTTP 边界**:flow 快照持久化/恢复、inspire rank 离线兜底、
  apply/skip 幂等——e2e Vitest(`e2e/tests/`,tools-dev harness)。
- **UI**:表单默认值 seed + 「按推荐直接开始」一键路径、进度卡五步状态、
  交付 CTA 出现率——Playwright(`e2e/ui/`,`@/playwright/suite`)。
- **验收基准(北极星彩排)**:一句话输入 → 全默认三次点击 → 拿到产物
  → 点交付 CTA,全程 ≤ 8 分钟、零自由文本输入(首句除外)。**至少跑
  两种形态**(deck + landing page)以证明链路形态无关。

## 8. 里程碑(每个独立 PR,含验收;实现后逐项打勾 ✅)

> 本节是活的实现看板:每完成一项就把 `[ ]` 改成 `[x]` 并在行尾标注
> 日期/PR。M0–M5 以 **deck 为参考竖切**,但所有机制从第一天起按
> §5.0 形态矩阵实现(形态无关);M6 负责把其余形态铺开。

### M0 契约与阶段事件(基座)

- [x] contracts:`src/api/flow.ts`(FlowStageId/FlowStageState/
      FlowStageSnapshot/FlowSnapshot/FlowShapeId/FlowShapeSpec/
      `FLOW_SHAPES` 注册表/`FlowDeliverAction` + `applyFlowMarker`
      单调推进纯函数 + `parseOdFlowMarkers`/`stripOdFlowMarkers`)
      并从 index 导出 — 2026-07-13
- [x] contracts:`src/sse/chat.ts` 增加 `flow_stage` payload(全量快照,
      非增量)— 2026-07-13
- [x] daemon:`<od-flow>` 标记解析(`flow/engine.ts` createFlowTracker,
      跨 chunk 边界增量消费)+ web 渲染前剥离(AssistantMessage
      `cleaned` memo 调 `stripOdFlowMarkers`)— 2026-07-13
- [x] daemon:兜底启发式(question-form 检出→clarify/research tool_use→
      research/plan 工件落盘→plan/html 写入与工件事件→generate/
      `[form answers]` 回声→clarify complete/run 干净收尾→deliver)
      — 2026-07-13
- [x] daemon:FlowSnapshot 会话级持久化(conversations.flow_json 列 +
      get/setConversationFlow)+ flow_stage 走 run 事件环形缓冲天然支持
      SSE 重放 — 2026-07-13
- [x] daemon:`GET /api/conversations/:id/flow`(`routes/flow.ts`)
      — 2026-07-13
- [x] CLI:`od flow status <conversationId> [--json]`(SUBCOMMAND_MAP
      注册 + 主帮助文案)— 2026-07-13
- [x] prompt:协议段单一来源放 contracts
      `prompts/flow-protocol.ts`(`renderFlowProtocol(shape)` 按
      FLOW_SHAPES 渲染),daemon 与 contracts 两个 composeSystemPrompt
      同时接受 `flowProtocol` 字段——**比 spec 原设想更优:引用同一函数,
      零字节漂移**;daemon 侧在 composeDaemonSystemPrompt 按
      resolveFlowShape 注入 — 2026-07-13
- [ ] 测试:标记解析/剥离单测 ✅(contracts flow.test.ts 15 例 + daemon
      flow-engine.test.ts 9 例 + flow-routes.test.ts 3 例);mocks 回放
      启发式推进 **未做**(排到 M2 前的回归项)

*验收状态*:兜底通道单独(无标记)推进五步已由 flow-engine.test.ts
覆盖;「刷新快照不丢」由 flow-routes.test.ts 的 round-trip 用例覆盖;
真机 mocks 回放待补。

*验收*:mocks 回放一次 deck 会话,`GET /flow` 返回单调推进的五步快照;
刷新页面快照不丢;兜底通道单独(无标记)也能走完五步。

### M1 进度卡 + 表单默认值(首个用户可见里程碑)

- [x] web:`FlowProgressCard` 组件 + CSS Module(五步/状态图标/detail/
      pending 预告文案/进度 N/M + 单位)— 2026-07-13
- [x] web:钉卡接线(ChatPane `.chat-log-wrap` 之上的兄弟节点,同
      QueuedSendStrip 模式;`syncFlowCard` 注册进 ResizeObserver +
      MutationObserver 双观察者;非 flow 会话 `flowSnapshot=null` 不渲染,
      TodoCard 原样保留——**与 spec 原文差异:v1 不替代 TodoCard,两卡
      并存**,flow 卡管大阶段、Todo 卡管本轮任务,后续观察再定去留)
      — 2026-07-13
- [x] web:`flow_stage` SSE 消费(providers/daemon.ts `onFlowStage`
      专用 handler,不进 AgentEvent union)+ ProjectView 会话级 state +
      载入时 `fetchConversationFlow` 恢复 — 2026-07-13
- [x] prompt:discovery 默认值硬规则(每个有限选择题必带
      `defaultValue`;默认模板全部补默认;题量收敛 4–6,硬上限 7)
      — 2026-07-13
- [x] web:表单确定性补默认(`seedQuestionValue`:**仅 radio** 无
      defaultValue 时补首项——**与 spec 原文差异:select 不补**,现有
      回归护栏(必填 select 如 ElevenLabs 语音选择必须保持未答禁提交)
      证明折叠控件静默预选是错的;select 依赖模型显式 defaultValue)
      — 2026-07-13
- [x] web:「按推荐直接开始」主 CTA(QuestionsPanel Continue 按钮在
      pristine 态换文案与 testid,任何编辑或恢复的草稿回退为「继续」;
      埋点 submitSource 增加 'recommended')+ ★ 推荐角标(OptionCopy,
      radio/checkbox 命中 defaultValue 的选项)— 2026-07-13
- [x] i18n:26 个新 key 进 `types.ts` + **19** 个 locale(spec 原文写
      18,实际含 `it` 共 19),parity 测试 13/13 通过 — 2026-07-13
- [ ] 测试:进度卡状态渲染单测 ✅(FlowProgressCard.test.tsx)+ 表单
      默认值/必填回归 ✅(QuestionForm.test.tsx 12 例全绿);
      Playwright 一键提交端到端 **未做**(排 M2 前回归项)

*验收状态*:代码路径齐备;「新会话第一屏见五步」依赖 daemon 首帧
`flow_stage` 发射(已实现,startChatRun 初始 emit);真机 Playwright
彩排待补。

### M2 Plan 工件 + 确认条

- [x] flow 协议:clarify 后必须落 `planArtifacts`(按形态)再停下
      — 2026-07-13
- [x] plan-confirm 表单(默认「✓ 确认生成 N <单位>」),daemon 同时阻止
      未确认 plan/灵感时提前进入 generate — 2026-07-13
- [x] 自然语言改大纲回路 + Design Files 卡片式增删改排/直接编辑回路
      — 2026-07-13
- [ ] 测试:确认前零渲染单测 ✅;改大纲后按新大纲生成的 Playwright
      彩排待补

*验收*:确认前无任何渲染发生;改一处大纲重新确认后按新大纲生成。

### M3 灵感步

- [ ] contracts + daemon:`POST /api/inspire/rank`(形态子集过滤 +
      模型排序 + 关键词离线兜底)
- [x] web:灵感面板(搜索/分类 chips/预览卡/Top-1 默认选中/明确跳过)
      — 2026-07-13
- [x] daemon:apply/skip 落进 FlowSnapshot;apply 物化模板框架并推进状态
      — 2026-07-13
- [x] CLI:`od inspire rank/apply/skip` — 2026-07-13
- [ ] 测试:离线排序/apply/skip 幂等/模板物化单测 ✅;模型渐进 rerank 与
      选中模板真实影响最终渲染的端到端彩排待补

*验收*:断网(离线兜底)时面板仍秒出;skip 后进度卡显示「已跳过 ·
使用默认风格」;选中的模板真实影响渲染风格。

### M4 搜索整合

- [x] web:首页与项目内＋菜单「Deep research」开关(会话持久 +
      composer pill + 首条自动发送透传) — 2026-07-13
- [x] daemon:basic 自动搜索契约(事实需求时一轮 shallow;纯创意由 agent
      标记 skipped) — 2026-07-13
- [x] daemon:medium/deep 深度参数 + deep 默认两轮「广搜→查缺补漏」
      研究协议(`research/` 报告落盘) — 2026-07-13
- [x] web:research 阶段过程展示 v1(两轮状态/detail + 面板内增量报告 +
      Design Files 入口) — 2026-07-13
- [ ] 测试:开关/深度/研究面板单测 ✅;deep 真实多轮报告且大纲引用事实的
      provider mock E2E 待补

*验收*:开关状态刷新不丢;deep 模式产出多轮 `research/*.md` 且大纲
引用其中事实;纯创意任务 research 步显示 skipped。

### M5 交付 CTA + 埋点

- [x] web:NextStepActions 升级,generate 阶段提前预告、deliver 阶段本地启用
      CTA 行(动作集取 `FLOW_SHAPES[shape].deliverActions`)— 2026-07-14
- [x] 埋点:`flow_stage_transition` / `flow_defaults_used` /
      `inspire_choice` / `hard_delivery`(带 `ms_from_first_input`;硬交付只在
      导出/部署成功或社交分享动作发生时上报)— 2026-07-14
- [ ] 漏斗看板(PostHog)
- [ ] 测试:CTA/事件 contracts/默认路径/阶段 diff/真实 PPTX 成功回调单测
      ✅;PostHog 网络请求动态验收待补

*验收*:每次成功生成 100% 出现 CTA 行;点击下载后 PostHog 收到
`hard_delivery` 且带 msFromFirstInput。

### M6 形态铺开(prototype/landing/mobile/webapp/document/report/media)

- [x] 每形态:FLOW_SHAPES 注册行 + clarify 默认骨架 + 通用可编辑 plan grammar
      + 灵感目录标签映射 + 流式生成工件类型 + deliver 动作映射 — 2026-07-14
- [x] prototype/landing/mobile/webapp 灵感目录补齐:各 3 个高价值现有模板
      完成 tags + platform 级独立过滤 — 2026-07-14
- [x] document/report 灵感目录补齐:首批 6 个高价值决策场景模板 +
      tags 级独立过滤 — 2026-07-14
- [ ] 每形态一次北极星彩排(≤ 8 分钟、三次默认点击)
- [ ] e2e:六形态资源闭包矩阵已覆盖;真实 agent 的完整默认点击链路彩排待补

*验收*:新形态接入证明为「只改注册表 + prompt 片段 + 目录标签」,
零新组件;landing 与 document 各通过一次完整彩排。

依赖:M1–M5 都依赖 M0;M2 依赖 M1(默认值决定 brief 质量);M3/M4 可
并行;M5 之后 M6 铺开。

## 9. 风险与开放问题

1. **模型漏发/错发 `<od-flow>` 标记** → 双通道设计(§5.2)已兜底;
   验收以「兜底通道单独也能走完五步」为准。
2. **多 agent runtime 差异**(claude/codex/gemini…):flow 协议段进
   composeSystemPrompt 对所有 runtime 生效,但标记遵从度不同——启发式
   兜底是通用层;mocks 各家 trace 都要回放。
3. **与 plugin pipeline(休眠原语)的关系**:v2 把每个 FlowStage 映射为
   `PipelineStage`(atoms 化),届时 `flow_stage` 事件可降级为
   `pipeline_stage_*` 的投影;v1 不做,避免为会话级流程强套 plugin 语义。
4. **灵感目录规模**(~110+ 社区风格)单次排序 token 成本:目录行压缩
   (id|name|tags|一句话)+ 只对 `od.mode` 匹配的子集排序;必要时离线
   兜底先出、模型排序到后覆盖(渐进增强)。
5. **老会话/非 flow 任务**:tune-collab、纯 chat、图像单张等不进五步流,
   `FlowSnapshot` 缺省 null,UI 全部保持现状——灰度开关按任务形态放量。
6. **分享的定义**:v1 硬交付=下载/部署/社交分享任一;只读 share link
   (无部署)是否要做一等公民,待定(codex-slides 也在 roadmap)。
7. **document/report 形态的灵感目录**:首批已补 board decision memo、
   product RFC、B2B renewal business case、executive operating review、
   market diligence、policy impact 六个高价值场景。统一使用
   `od.mode: template`,再以 `document-template` / `report-template`
   tags 做形态级隔离;后续按硬交付与复用数据扩充。
