# UI 样式对齐 spec — supreme-veil 分支新 UI 回归 Open Design 生产风格

> 状态:实施中。本 spec 由审计驱动:对 origin/main 以来新增的 16 个 `.module.css` + 7 个全局样式 diff 做了逐行审计,发现两类系统性 bug 与一批"框线风"违规。目标是把所有新 UI 刷回 `apps/web/src/styles/tokens.css` 定义的生产设计语言,不改任何行为逻辑。

## 1. 背景与目标

本分支(13 commits, +28K 行)落地了 Manus 式三层结构:常驻 ProjectSidebar、轻量会话 + PinnedTaskProgress、可回放 Computer 面板、staged flow 五阶段链路。但新 UI 的 CSS 存在:

- **系统性 bug**:引用不存在的 token(`--success`/`--danger`/`--warning`/`--font-mono`/`--bg-hover`),其中 11 处无 fallback **完全不渲染颜色**(sidebar 状态点、任务终态徽标等);
- **框线风(wireframe)**:平的 `1px solid var(--border)` + `--bg-subtle` 无阴影卡片、虚线占位框、灰上灰 chip;
- **刻度漂移**:5/7/9/11/14/16/17px 越界圆角、硬编码纯黑阴影、字面 cubic-bezier/时长、999px 字面量、6.5px 不可读字号。

目标:全部收敛到 token 与生产配方,light/dark 双主题自动生效,零行为变更。

## 2. 视觉基准(权威文件)

- Token 事实来源:`apps/web/src/styles/tokens.css`(surface/border/text/accent/semantic/shadow/radius/motion/font 全套,dark 覆盖已备好)
- 共享按钮:`packages/components/src/button.module.css`(variants: default/primary/primary-ghost/ghost/subtle;size: icon)
- 对话框:`packages/components/src/dialog.module.css`(backdrop `rgba(28,27,26,0.42)` + `blur(4px)`;面板无边框、`--bg-elevated` + `--radius-lg` + `--shadow-lg`、`scale(0.97)` 起手 pop-in)
- 生产卡片:`apps/web/src/styles/home/recent-projects.css`(`--bg-panel` + `--border` + hover `--border-strong` + `--shadow-sm` + `translateY(-1px)`)
- 本分支内的金标准:`TemplateCardsQuestion.module.css`(`--bg-elevated` + `--shadow-xs→sm`、`--selected` 选中环)与 `ImageGenerationSettings.module.css`(唯一正确使用 `--green`/`--red` 的新文件)——直接抄它们的模式。

核心口诀:**层级靠明度差 + 阴影,不靠加重边框;主行动 = 陶土橙 `--accent`,选中态 = `--selected` 蓝(二者刻意分离,不要"修"掉蓝色);展示标题用 `var(--serif)` + 负字距;缓动只用 `var(--ease-out)`,进 200 / 出 140 / 微反馈 120。**

## 3. 机械替换规则(所有批次通用)

| 现状 | 替换为 | 说明 |
|---|---|---|
| `var(--success[, #hex])` | `var(--green)`(背景用 `--green-bg`,边框 `--green-border`) | 幽灵 token,≈40 处 |
| `var(--danger[, #hex])` | `var(--red)` / `--red-bg` / `--red-border` | 同上,`#d9534f` 是 Bootstrap 红 |
| `var(--warning[, #hex])` | `var(--amber)` / `--amber-bg` | 同上 |
| `var(--font-mono)` | `var(--mono)` | FlowProgressCard:168、ResearchWorkspacePanel:208 |
| `var(--bg-hover…)` | `var(--bg-subtle)` | OdComputerPanel:43,102 |
| `var(--bg-panel, #fff)` 等带 hex fallback | 去掉 fallback | token 恒存在 |
| 字面 `cubic-bezier(0.23,1,0.32,1)` | `var(--ease-out)` | 仅限本分支新增文件内 |
| 字面 `200ms`/`140ms`/`120ms`(过渡) | `var(--dur-enter)`/`var(--dur-exit)`/`var(--dur-quick)` | 同上 |
| `border-radius: 999px` | `var(--radius-pill)` | |
| 圆角 5/6/7px(控件、chip) | `var(--radius-sm)` | |
| 圆角 8/9px | `var(--radius)` | |
| 圆角 10/11px | `var(--radius-md)` | |
| 圆角 12–17px(卡片/大表面) | `var(--radius-lg)` | 17px 的 PinnedTaskProgress 也收到 lg |
| 硬编码纯黑阴影(卡片级) | `var(--shadow-sm)` 或 `var(--shadow-md)` | |
| 硬编码纯黑阴影(浮层/弹框级) | `var(--shadow-lg)` | |
| backdrop `rgb(15 18 22 / 38%)` | `rgba(28, 27, 26, 0.42)` + `backdrop-filter: blur(4px)` | 对齐 dialog.module.css |

例外:2px 微指示条圆角可保留;`--selected` 蓝是正确语义,不改;pulse 动画的 `ease-in-out` 允许。

## 4. 设计整改配方(需要品味的部分)

**框线卡片 → 生产卡片**(InspirePanel `.card`/`.designSystemCard`、OutlinePanel `.pageCard`、ResearchWorkspacePanel `.round`/`.reportPreview`/`.reportSkeleton`):

```css
background: var(--bg-panel);            /* 卡在 subtle 底上时用 --bg-elevated */
border: 1px solid var(--border);
border-radius: var(--radius);
box-shadow: var(--shadow-xs);
transition: border-color var(--dur-quick) var(--ease-out),
            box-shadow var(--dur-quick) var(--ease-out),
            transform var(--dur-quick) var(--ease-out);
/* 可交互卡 hover: */
border-color: var(--border-strong); box-shadow: var(--shadow-sm); transform: translateY(-1px);
/* 选中: 抄 TemplateCardsQuestion — border-color: var(--selected); box-shadow: 0 0 0 3px var(--selected-soft); */
```

**虚线占位 / loading / empty → 柔和填充**:去掉 `1px dashed`,改 `background: var(--bg-subtle); border: none; border-radius: var(--radius); color: var(--text-muted);`。

**灰上灰 chip → 语义 chip**:中性 chip 保留 `--bg-subtle` 但补 `var(--radius-pill)` 与 `--text-muted`→`--text` hover;激活/分类 chip 用 `--accent-tint` 底 + `--accent` 字 + `color-mix(in srgb, var(--accent) 18%, transparent)` 边(抄 entry-layout.css 的 `.is-active`)。

**状态色语义**:running/live = `--green`(点 + pulse);succeeded = `--green`;failed = `--red`;stopped/canceled = `--text-faint`;needs-attention = `--amber`。

**PinnedTaskProgress 迷你缩略图**:6.5px/7px 文字不可读——9px 以下一律改为骨架条(`--bg-fill-secondary` 圆角条),不渲染真实文字。

**面板标题**:Computer 面板/侧栏分区等展示性标题遵循生产模式:serif 仅用于品牌名与 hero 级标题(sidebar `.brandName` 已正确用 serif);面板内功能标题保持 sans,不要新造 serif 用法。

## 5. 按钮策略(风险控制)

- 已用共享 `Button` 的文件(ProjectSidebar、InspirePanel、OutlinePanel、ResearchWorkspacePanel、ConversationUsage、ImageGenerationSettings、DeckModePicker)不动结构。
- 裸 `<button>` 未导入共享 Button 的(OdComputerPanel ×8、PinnedTaskProgress ×3、FlowProgressCard ×1)与 AssistantMessage(×21):**本轮不做组件迁移**(涉及 +720 行 tsx 与既有测试),改为让其 CSS 对齐 `button.module.css` 的配方:transparent/ghost 类按钮 hover `--bg-subtle`、focus-visible `outline: 2px solid var(--accent); outline-offset: 2px`、disabled `opacity: .5`。组件迁移列为后续 PR(见 §8)。

## 6. 按文件整改清单(4 个实施批次,互不重叠)

**批次 A — AssistantMessage.module.css + styles/chat.css**(最重):裸 `--danger`/`--success`(228/248/258)、`var(--success,#2e9e5b)`(28);越界圆角 9/8/7/5/16/10px;硬编码黑阴影(358-360/369-372);`.taskStepSummary`/`.taskStepGlyph` 灰 chip 补 hover 与 radius token;文档纸张预览内的 `#fff`/`#27272a`/`#18181b` 等(466-594)是"模拟白纸"允许保留,但加注释声明豁免;chat.css `.chat-conversation-actions-menu button.danger` → `var(--red)`。

**批次 B — Computer 集群**:OdComputerPanel(幽灵 token 全清、`--bg-hover`、14/9/7px 圆角、21 行硬阴影→`--shadow-lg`、`#f7f7f8`→token);OdComputerOverlay(backdrop 与侧板阴影对齐 §3);ComputerWorkspaceShell(16px→`--radius-lg`、frame 阴影→`--shadow-lg`、backdrop 统一);PinnedTaskProgress(17px→`--radius-lg`、幽灵 token、硬阴影、迷你缩略图骨架化)。FlowWorkspaceTransition 已达标,不动。

**批次 C — ProjectSidebar + ConversationUsage + FlowProgressCard**:Sidebar 状态点/脉冲的裸 `--success`/`--danger`(347-394/506-507)→ `--green`/`--red`,`--warning,#c47b2b`→`--amber`,9px 圆角(52/65/109/135/233/399)→`--radius`,字面缓动→token;ConversationUsage 阴影(22-24)→`--shadow-lg`、16px→`--radius-lg`、11px→`--radius-md`;FlowProgressCard 107/116 幽灵 token、168 `--font-mono`→`--mono`、6/5px→`--radius-sm`。

**批次 D — 面板三件套 + 全局零散**:InspirePanel(§4 卡片配方、虚线占位、`.category` chip、282 的 6px);OutlinePanel(`.empty`/`.loading` 虚线、`.pageCard` 配方);ResearchWorkspacePanel(`.round`/`.reportPreview`/`.reportSkeleton` 配方、71/75 幽灵 token、208 mono);home-hero.css `.home-hero__research-pill` 999px→`--radius-pill`;plus-menu.css 开关字面缓动→token、旋钮阴影→`--shadow-xs`;shell.css grid 过渡字面缓动→`var(--ease-out)`;TemplateCardsQuestion 17-19 字面缓动→token(仅此 nit);DeckModePicker `.option`、ImageGenerationSettings `.source` 补 hover 过渡。

**明确不动**:FlowDeliveryActions、FlowWorkspaceTransition、viewer/composio.css、viewer/routines.css、viewer/theater.css(其去框线改动是改进)。

## 7. 验收标准

1. `grep -rn "var(--success\|var(--danger\|var(--warning\|var(--font-mono\|var(--bg-hover"` 在**本分支新增/改动的样式文件**(16 个 module.css + chat.css/home-hero.css/plus-menu.css/shell.css 新增 hunk)内零命中。注:`design-system-flow.css`、`workspace/artifacts.css`、`new-project-modal.css`、`entry-layout.css` 等 main 既有文件里尚有约 120 处带 fallback 的同类漂移,属 §8 后续清理,不阻塞本轮;
2. 新增 16 个 module.css 内无字面 `cubic-bezier`、无 999px、无越界圆角(2px 指示条豁免)、无纯黑硬编码阴影(AssistantMessage 纸张预览豁免区需有注释);
3. `pnpm guard`、`pnpm typecheck`、`pnpm --filter @open-design/web test` 全绿(至少覆盖改动组件的既有测试 + tests/styles/*);
4. dark 主题无需额外改动即正确(全部走 var);
5. 视觉核查:sidebar 状态点显色、任务终态徽标显色、Inspire/Outline/Research 卡片有阴影层次与 hover 抬升、Computer 弹框 backdrop 与 SettingsDialog 一致。

## 8. 后续(不在本轮)

- OdComputerPanel/PinnedTaskProgress/FlowProgressCard/AssistantMessage 裸 button 迁移到 `@open-design/components` Button(独立 PR,配组件测试);
- 仓库存量文件的字面 easing 清理(≈180 处,属历史漂移);
- `.accordion-collapsible`(composio.css:720)的 Material 曲线与 `--ease-out` 规范不一致,需 core 决策后统一。
