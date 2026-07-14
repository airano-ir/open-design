# Agent Plugin 体系：把 Open Design 装进 Codex / Claude Code / Cursor

状态：定稿（2026-07-14）。本文是「外部 coding agent 安装 Open Design 插件 → 用 od CLI 生成设计产物 → 用宿主 browser 视觉验证」这条链路的单一事实源。

## 0. 参考与动机

- **ChatCut agent-plugin**（github.com/ChatCut-Inc/agent-plugin + chatcut.io/chatgpt-plugin）：
  Codex 插件格式的现成范例 —— 仓库根 `.agents/plugins/marketplace.json`、插件目录
  `.codex-plugin/plugin.json`（声明 `skills: "./skills/"` + `mcpServers`）、
  `skills/<name>/SKILL.md` 工作流集（含专门的 `verification` skill）。落地页的安装 UX
  是一句可复制 prompt，让 agent 自己读页面完成安装。
- **nexu-io/codex-slides**（本仓库作者的前作，源码在 ppt-anything）：
  验证了「宿主插件系统托管安装 + 纯 Node CLI 与 MCP 双通道同打一个本地 HTTP API +
  browserHandoff 深链驱动宿主 Browser 视觉验证 + host 中立 SKILL.md」的完整闭环。
- **Open Design 现状**：od CLI 已完全 headless（`--json`、`--prompt-file`、结构化退出码），
  `od mcp install <agent>` 已覆盖 15 个宿主，`.claude-plugin/marketplace.json` 已存在但
  **只装 MCP、没有 skills 包**；`apps/landing-page` 已有 `/agents/` hub 但没有对标
  ChatCut 的插件专页。

## 1. 差距与目标

| # | 缺口 | 本 spec 的交付 |
|---|------|----------------|
| 1 | 没有 Codex 格式插件包 | 仓库根 `.agents/plugins/marketplace.json` + `plugins/open-design/.codex-plugin/plugin.json` |
| 2 | 插件包没有 skills 工作流 | `plugins/open-design/skills/` 六个 host 中立 SKILL.md（见 §3） |
| 3 | 没有统一的插件安装闭环 | `od agent-plugin` CLI + `/api/agent-plugin/*` + contracts DTO + IntegrationsView 新 tab（四位一体，同一 PR） |
| 4 | 落地页没有插件专页 | `apps/landing-page/app/pages/agent-plugin/index.astro`（对标 chatcut.io/chatgpt-plugin） |

北极星体验（以 Codex 为例）：

```text
codex plugin marketplace add nexu-io/open-design
codex plugin add open-design@open-design
# 然后在 codex 里说：
#   "Use Open Design to make a launch deck for my product, and show me
#    the result in the browser."
```

Agent 走 skills 工作流：`od project create` → `od run start --follow` →
打开 `http://127.0.0.1:7456/api/projects/<id>/raw/<file>` 到宿主 Browser →
视觉检查 → `od run continue` 迭代 → `od export`。

## 2. 分发包布局（单一 skills 源，多宿主消费）

```text
.agents/plugins/marketplace.json      # NEW  Codex marketplace 描述符
.claude-plugin/marketplace.json       # 已有 Claude marketplace（描述更新提 skills）
plugins/open-design/
  .codex-plugin/plugin.json           # NEW  Codex 清单：skills + mcpServers + interface
  .claude-plugin/plugin.json          # 已有 Claude 清单（版本升到 1.1.0）
  .mcp.json                           # 已有，两宿主共享（stdio od mcp）
  skills/                             # NEW  六个工作流 skill（见 §3）
```

原则：
- **SKILL.md 是 host 中立的**。正文说「your browser tool」；宿主差异（codex browser /
  cursor browser / claude browser）只出现在专门的对照小节，不分叉文件。
  未来需要宿主级 interface 元数据时，采用 codex-slides 的
  `skills/<name>/agents/<host>.yaml` sidecar 约定，不复制 SKILL.md。
- **Codex 与 Claude Code 原生消费同一个 `skills/` 目录**（两家插件系统都自动发现
  plugin 根下的 skills/）。Cursor 无插件系统，由安装器把 skills 拷到
  `~/.cursor/skills/`（strategy=skills-dir，见 §4）。
- MCP 是可选增强，不是前置依赖：skills 全部以 `od` CLI 为第一通道（嵌入契约，
  见根 AGENTS.md「Capability exposure」），MCP 工具在可用时作为等价替代。

## 3. Skills 工作流集（plugins/open-design/skills/）

| Skill | 职责 | 关键内容 |
|---|---|---|
| `open-design-basics` | 基座操作语境（其余 skill 的前置） | 本地 daemon 模型、od CLI 契约（--json / --prompt-file / 退出码 64=daemon-not-running 等）、project→conversation→run→files 数据模型、预览 URL 形态 `/api/projects/<id>/raw/<path>`、MCP 等价面、路由到其余 skill |
| `open-design-create` | 从意图到产物的主工作流 | 对齐 brief → `od skills list` / `od design-systems list` 选工作流与风格 → `od project create --json` → `od run start --message … --follow --json` → 读产物清单 → 交给 preview-verify |
| `open-design-preview-verify` | Browser-first 视觉验证 | 双信号纪律（结构信号 = files/result-package；视觉信号 = 宿主 browser 打开 raw URL 实检）；不许拿 JSON 返回冒充视觉验证；无 browser 时的降级话术；迭代经 `od run continue` |
| `open-design-systems-brands` | 风格与品牌 | `od design-systems list/show/download`、run 上 `--design-system`、`od brand` 提取品牌 |
| `open-design-export-deliver` | 交付 | `od export <file> --project <id> --format pdf/pptx/image`、`od run result-package --json`、交付物路径回报规范 |
| `open-design-known-errors` | 失败分类与自修复 | od 不在 PATH（install.sh / brew / npm）、退出码 64→`od daemon start`、68/69 project/run not found、run 卡住→`od run watch/cancel`、端口/权限 |

frontmatter 只用 `name` + `description`（与 Claude/Codex skills 协议交集），description
写触发语境（"Use when …"），参照 ChatCut 的写法让宿主在相关任务时自动加载。

## 4. 安装器：宿主适配注册表（数据导向）

新模块 `apps/daemon/src/agent-plugin-install.ts`，镜像 `mcp-agent-install.ts` 的
纯 planner + 薄执行器架构（planner 无 IO，注入 home/platform 可单测）：

```ts
AGENT_PLUGIN_HOST_SLUGS = ['codex', 'claude', 'cursor'] as const
```

| 宿主 | strategy | 安装动作 | 卸载动作 |
|---|---|---|---|
| codex | `native-plugin` | `codex plugin marketplace add <source>` → `codex plugin add open-design@open-design` | `codex plugin remove open-design` |
| claude | `native-plugin` | `claude plugin marketplace add <source>` → `claude plugin install open-design@open-design` | `claude plugin uninstall open-design` |
| cursor | `skills-dir` | 拷贝 `plugins/open-design/skills/*` → `~/.cursor/skills/`；复用 `planAgentInstall('cursor')` 合并 `~/.cursor/mcp.json` | 删除拷贝的 skill 目录 + `removeJsonInstall` |

- `<source>` 默认 `nexu-io/open-design`（GitHub），`--source local` 用本地 checkout
  （开发验证路径，等价 codex-slides 的 `codex plugin marketplace add "$PWD"`）。
- skills-dir 策略的源目录解析：从模块目录向上找 `plugins/open-design/skills`；
  找不到（如未来精简的打包产物）→ 降级为 manual 计划，打印 GitHub 安装指引，
  绝不写猜测路径（沿用 mcp-agent-install 的 manual 哲学）。
- 新宿主（cursor browser 之外的下一个）只需在注册表加一行 def，不改执行器。

## 5. 四位一体闭环（根 AGENTS.md「Capability exposure」）

- **contracts**：`packages/contracts/src/api/agent-plugin.ts` —
  `AgentPluginHostSlug`、`AgentPluginHostInfo`、`AgentPluginHostsResponse`、
  `AgentPluginInstallRequest/Result`。
- **daemon 路由**：`apps/daemon/src/agent-plugin-routes.ts`（isLocalSameOrigin 门禁，
  镜像 mcp-routes 的 codex 一键安装）：
  - `GET  /api/agent-plugin/hosts` — bundle 元数据 + 各宿主检测（bin 是否在 PATH、
    安装命令预览、cursor 的 skills 目录现状）
  - `POST /api/agent-plugin/install`、`POST /api/agent-plugin/uninstall` —
    `{ host, source? }`，服务端执行计划（与 CLI 同一 planner）
- **CLI**：`od agent-plugin list|status|install <host>|uninstall <host>`，支持
  `--json`、`--print/--dry-run`、`--source github|local`。CLI 本地执行 planner
  产出的计划（与 `od mcp install` 同构 —— 写的是用户 home，天然本机）。
- **Web UI**：`IntegrationsView` 新 tab `agent-plugin`（`AgentPluginSection.tsx`）：
  ChatCut 式一句安装 prompt 复制框 + 每宿主卡片（检测状态、一键安装、命令复制）。
  i18n 键进 `types.ts` + 全部 19 locale。

## 6. 落地页模块（apps/landing-page）

- 路由 `app/pages/agent-plugin/index.astro`（营销归 landing-page，不进 apps/web —
  见 apps/landing-page/AGENTS.md 的边界）。复用 sub-page-layout + 现有
  `info-page / agent-rich / agent-code / faq-list` 样式类，不新增全局 CSS。
- 结构对标 chatcut.io/chatgpt-plugin：
  1. Hero：标题 + 一句可复制安装 prompt（"Read open-design.ai/agent-plugin to
     install the Open Design plugin and make something with me."）
  2. Why ×3 卡（Install once / Every surface one connection / Runs on your agent）
  3. What can it make（deck / prototype / poster / brand page / data-viz / media）
  4. How it works（agent → od CLI → local daemon → raw preview → browser verify）
  5. Per-host 安装块（Codex / Claude Code / Cursor 命令 + 说明）
  6. FAQ + 底部 CTA
- 文案在新 `app/agent-plugin-i18n.ts`（en 全量 + zh 全量，其余 locale 回退 en，
  沿用 agent-guides 的回退模式）。header 导航在 Product/Resources 菜单加入口。

## 7. 验证与测试

- `apps/daemon/tests/agent-plugin-install.test.ts`：planner 纯函数单测
  （三宿主 install/uninstall 计划、假 home、bundle 源目录解析、manual 降级）。
- `pnpm guard` + `pnpm typecheck` + `pnpm --filter @open-design/daemon test`。
- 手动闭环：`od agent-plugin install claude --print` / `install cursor --dry-run`
  的计划输出；本地 `--source local` 真装进 codex/claude 验证 skills 被宿主发现。

## 8. 明确不做（本期）

- 不为 cursor 之外的 12 个 MCP 宿主做 skills 安装（MCP 通道已覆盖它们；
  注册表留好扩展缝）。
- 不做托管 HTTP MCP（ChatCut 的 oauth_resource 模式）—— Open Design 是 local-first，
  stdio 即可；云端 Hub 属于 workspace-collaboration spec 的范围。
- 不把 landing 页文案翻满全部 locale（en/zh 全量，其余回退）。
- 不动 `od plugin`（OD 内部设计工作流插件）的任何语义；两个体系名字上以
  「agent plugin」vs「plugin」区分，文档里显式对照。
