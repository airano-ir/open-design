/*
 * Copy for the /agent-plugin/ landing page — the ChatCut-style page that
 * markets AND operationally documents the Open Design agent plugin
 * (workflow skills + MCP installed into Codex / Claude Code / Cursor).
 *
 * The page is double-audience by design: humans skim the hero and cards,
 * while coding agents are sent here by the one-line install prompt and
 * read the per-host commands + the "if you are a coding agent" section
 * to self-install. Keep every command in this file real — an agent will
 * execute them verbatim.
 *
 * Localization model mirrors agent-guides: `en` and `zh` are complete;
 * every other landing locale falls back to English rather than shipping
 * partial translations.
 */

import type { LandingLocaleCode } from './i18n';

export interface AgentPluginHostCopy {
  name: string;
  browser: string;
  commands: string[];
  note: string;
}

export interface AgentPluginPageCopy {
  title: string;
  description: string;
  breadcrumb: string;
  heading: string;
  lead: string;
  installPromptLabel: string;
  installPrompt: string;
  installPromptHint: string;
  whyTitle: string;
  why: Array<{ title: string; body: string }>;
  makeTitle: string;
  makeLead: string;
  makeItems: Array<{ title: string; body: string }>;
  howTitle: string;
  howSteps: Array<{ label: string; body: string }>;
  hostsTitle: string;
  hostsLead: string;
  hosts: AgentPluginHostCopy[];
  agentSectionTitle: string;
  agentSectionBody: string[];
  faqTitle: string;
  faq: Array<{ name: string; text: string }>;
  ctaTitle: string;
  ctaBody: string;
  ctaPrimary: string;
  ctaSecondary: string;
  tocLabel: string;
  toc: Array<{ id: string; label: string }>;
}

const EN: AgentPluginPageCopy = {
  title: 'Open Design plugin for Codex, Claude Code & Cursor',
  description:
    'Install the Open Design agent plugin and your coding agent generates decks, landing pages, and brand-true design artifacts through a local daemon — previewing and visually verifying results in its own browser.',
  breadcrumb: 'Agent plugin',
  heading: 'The Open Design plugin for your coding agent',
  lead:
    'One install teaches Codex, Claude Code, or Cursor to design: workflow skills drive the local Open Design daemon, results render as live previews, and your agent checks its own work in the browser it already has.',
  installPromptLabel: 'Paste this into your agent to install:',
  installPrompt:
    'Read https://open-design.ai/chatgpt to install the Open Design plugin and set up a new design task for me.',
  installPromptHint:
    'Your agent reads the machine runbook at open-design.ai/chatgpt, runs the matching install commands itself, renders a first preview in its browser, and asks what to make — no manual configuration.',
  whyTitle: 'Why Open Design in your agent',
  why: [
    {
      title: 'Install once, design anywhere',
      body:
        'Add the plugin through your agent’s own plugin system — no API keys to mint, no new app to learn. The agent you already use gains 139 design workflows and 150 design systems.',
    },
    {
      title: 'Local-first, your files stay yours',
      body:
        'Everything runs against the od daemon on your machine: generation, project files, previews, exports. Nothing round-trips a cloud service you didn’t choose.',
    },
    {
      title: 'Browser-verified results',
      body:
        'Skills enforce a two-signal discipline: structural state from the CLI plus a real look at the rendered artifact in your agent’s browser. No “trust me, the JSON said done”.',
    },
  ],
  makeTitle: 'What your agent can make',
  makeLead:
    'Describe the outcome; the plugin routes it through Open Design’s generation runs and hands back a live preview URL plus exportable files.',
  makeItems: [
    { title: 'Launch decks', body: 'Slides from notes or a repo README, exportable to PPTX/PDF.' },
    { title: 'Landing pages', body: 'Polished pages from a brief, a folder, or an existing site.' },
    { title: 'Brand extraction', body: 'Point at a URL, get a reusable DESIGN.md brand system.' },
    { title: 'Redesigns', body: 'Audit and re-skin an existing local project without breaking it.' },
    { title: 'Posters & social', body: 'Single-artifact visuals driven by design-system tokens.' },
    { title: 'Data-viz pages', body: 'Readable chart pages generated against craft rules.' },
  ],
  howTitle: 'How it works',
  howSteps: [
    { label: 'Install', body: 'Your agent’s plugin system pulls skills + MCP config from the Open Design repo.' },
    { label: 'Brief', body: 'You describe the deliverable; the create skill aligns and picks a workflow + design system.' },
    { label: 'Generate', body: 'The agent runs `od project create` and `od run start --follow` against the local daemon.' },
    { label: 'Verify', body: 'It opens the live preview URL in its own browser and checks the result against your brief.' },
    { label: 'Deliver', body: 'Iterations go through the same conversation; `od export` produces PDF / PPTX / images.' },
  ],
  hostsTitle: 'Install per host',
  hostsLead:
    'Prerequisite for all hosts: the Open Design app or `od` CLI on this machine (desktop app bundles the daemon; or `curl -fsSL https://open-design.ai/install.sh | sh`).',
  hosts: [
    {
      name: 'Codex',
      browser: 'Codex browser',
      commands: [
        'codex plugin marketplace add nexu-io/open-design',
        'codex plugin add open-design@open-design',
      ],
      note: 'Skills and the MCP server install together through Codex’s plugin system.',
    },
    {
      name: 'Claude Code',
      browser: 'Claude browser',
      commands: [
        'claude plugin marketplace add nexu-io/open-design',
        'claude plugin install open-design@open-design',
      ],
      note: 'Ships as a Claude Code plugin marketplace; skills load automatically.',
    },
    {
      name: 'Cursor',
      browser: 'Cursor browser',
      commands: ['od agent-plugin install cursor'],
      note: 'Copies the skills into ~/.cursor/skills and registers the MCP server in ~/.cursor/mcp.json.',
    },
  ],
  agentSectionTitle: 'If you are a coding agent reading this page',
  agentSectionBody: [
    'The complete step-by-step runbook lives at https://open-design.ai/chatgpt (raw markdown: /chatgpt.md; canonical source: plugins/open-design/INSTALL.md in the GitHub repo). Read it and execute it top to bottom — host detection, od CLI probe, daemon start, plugin install, a first browser-rendered preview, then ask your user what to make.',
    'Short version: detect your host (codex / claude / cursor), confirm the `od` CLI exists (ask your user before installing anything), run the matching install commands above, verify the six open-design-* skills landed, and follow the open-design-create workflow: project → run → preview → visual check in your browser surface.',
    'If your session has no plugin system and no `od agent-plugin` available, fall back to `od mcp install <your-host>` for MCP-only access and say so explicitly.',
  ],
  faqTitle: 'Frequently asked questions',
  faq: [
    {
      name: 'What exactly gets installed?',
      text:
        'A skills bundle (six SKILL.md workflows: basics, create, preview & verify, design systems & brands, export, known errors) plus a stdio MCP server entry that proxies to your local od daemon. Source: github.com/nexu-io/open-design under plugins/open-design.',
    },
    {
      name: 'Which agents are supported?',
      text:
        'Codex and Claude Code install natively through their plugin systems; Cursor gets skills copied into ~/.cursor/skills plus an MCP entry. Twelve more agents (Copilot, OpenCode, Gemini, Kimi, …) can attach MCP-only via `od mcp install <agent>`.',
    },
    {
      name: 'Does my content leave my machine?',
      text:
        'No. Open Design is local-first: the daemon, project files, previews, and exports all live on your machine. Model calls use the providers you configured in Open Design (BYOK), not a middleman service.',
    },
    {
      name: 'What does the browser have to do with it?',
      text:
        'Every generated artifact is served live at http://127.0.0.1:7456/api/projects/<id>/raw/<file>. The verification skill makes your agent open that URL in its own browser surface — Codex browser, Claude browser, or Cursor browser — and visually check the result before calling it done.',
    },
    {
      name: 'How is this different from `od mcp install`?',
      text:
        '`od mcp install` registers only the MCP tool server. The agent plugin additionally ships the workflow skills — the operating knowledge that turns raw tools into a reliable brief → generate → verify → export loop.',
    },
    {
      name: 'What does it cost?',
      text:
        'The plugin and Open Design are Apache-2.0 open source. Generation runs on your own model keys or the providers you configure — there is no separate plugin fee.',
    },
  ],
  ctaTitle: 'Give your agent a design tool it can see',
  ctaBody:
    'Install the plugin, ask for a deck, and watch your agent check its own work in the browser.',
  ctaPrimary: 'Download Open Design',
  ctaSecondary: 'Star on GitHub',
  tocLabel: 'On this page',
  toc: [
    { id: 'why', label: 'Why' },
    { id: 'make', label: 'What it makes' },
    { id: 'how', label: 'How it works' },
    { id: 'install', label: 'Install' },
    { id: 'for-agents', label: 'For agents' },
    { id: 'faq', label: 'FAQ' },
  ],
};

const ZH: AgentPluginPageCopy = {
  title: 'Open Design 插件：装进 Codex、Claude Code 和 Cursor',
  description:
    '安装 Open Design 智能体插件，你的编码智能体就能通过本地守护进程生成幻灯片、落地页和品牌一致的设计产物——并在它自己的浏览器里实时预览、视觉验证。',
  breadcrumb: '智能体插件',
  heading: '给你的编码智能体装上 Open Design',
  lead:
    '一次安装，Codex、Claude Code 或 Cursor 就学会做设计：工作流技能驱动本地 Open Design 守护进程，结果以实时预览呈现，智能体用它已有的浏览器亲自检查自己的工作。',
  installPromptLabel: '把这句话粘贴给你的智能体即可安装：',
  installPrompt:
    'Read https://open-design.ai/chatgpt to install the Open Design plugin and set up a new design task for me.',
  installPromptHint:
    '智能体会读取 open-design.ai/chatgpt 的机器 runbook，自己执行安装命令，在它的浏览器里渲染首个预览，然后问你要做什么——全程无需手动配置。',
  whyTitle: '为什么在智能体里用 Open Design',
  why: [
    {
      title: '一次安装，处处设计',
      body: '通过智能体自己的插件系统安装——不用申请 API key，不用学新应用。你正在用的智能体直接获得 139 个设计工作流和 150 套设计系统。',
    },
    {
      title: '本地优先，文件归你',
      body: '一切都跑在你机器上的 od 守护进程里：生成、项目文件、预览、导出。不会经过任何你没选择的云服务。',
    },
    {
      title: '浏览器验证的结果',
      body: '技能强制执行双信号纪律：CLI 的结构化状态 + 在智能体浏览器里真实查看渲染产物。拒绝"JSON 说完成了就算完成"。',
    },
  ],
  makeTitle: '你的智能体能做什么',
  makeLead: '描述目标即可；插件把它路由到 Open Design 的生成 run，返回实时预览 URL 和可导出文件。',
  makeItems: [
    { title: '发布演示稿', body: '从笔记或 README 生成幻灯片，可导出 PPTX/PDF。' },
    { title: '落地页', body: '从 brief、文件夹或现有网站生成成品页面。' },
    { title: '品牌提取', body: '指向一个 URL，得到可复用的 DESIGN.md 品牌系统。' },
    { title: '重设计', body: '审计并翻新现有本地项目，不破坏功能。' },
    { title: '海报与社交图', body: '由设计系统 token 驱动的单幅视觉产物。' },
    { title: '数据可视化页面', body: '按 craft 规则生成的可读图表页。' },
  ],
  howTitle: '工作原理',
  howSteps: [
    { label: '安装', body: '智能体的插件系统从 Open Design 仓库拉取技能 + MCP 配置。' },
    { label: 'Brief', body: '你描述交付物；create 技能对齐意图并选定工作流与设计系统。' },
    { label: '生成', body: '智能体对本地守护进程执行 `od project create` 和 `od run start --follow`。' },
    { label: '验证', body: '它在自己的浏览器里打开实时预览 URL，对照 brief 检查结果。' },
    { label: '交付', body: '迭代走同一会话；`od export` 产出 PDF / PPTX / 图片。' },
  ],
  hostsTitle: '按宿主安装',
  hostsLead:
    '所有宿主的前置条件：本机装有 Open Design 应用或 `od` CLI（桌面应用自带守护进程；或 `curl -fsSL https://open-design.ai/install.sh | sh`）。',
  hosts: [
    {
      name: 'Codex',
      browser: 'Codex browser',
      commands: [
        'codex plugin marketplace add nexu-io/open-design',
        'codex plugin add open-design@open-design',
      ],
      note: '技能与 MCP 服务器通过 Codex 插件系统一并安装。',
    },
    {
      name: 'Claude Code',
      browser: 'Claude browser',
      commands: [
        'claude plugin marketplace add nexu-io/open-design',
        'claude plugin install open-design@open-design',
      ],
      note: '以 Claude Code 插件市场形式分发；技能自动加载。',
    },
    {
      name: 'Cursor',
      browser: 'Cursor browser',
      commands: ['od agent-plugin install cursor'],
      note: '把技能拷贝到 ~/.cursor/skills，并在 ~/.cursor/mcp.json 注册 MCP 服务器。',
    },
  ],
  agentSectionTitle: '如果你是正在读这页的编码智能体',
  agentSectionBody: [
    '完整分步 runbook 在 https://open-design.ai/chatgpt（纯 markdown：/chatgpt.md；权威源：GitHub 仓库的 plugins/open-design/INSTALL.md）。读取并从头到尾执行——宿主判定、od CLI 探针、启动守护进程、安装插件、在浏览器渲染首个预览，然后问用户要做什么。',
    '速览版：判断宿主（codex / claude / cursor），确认 `od` CLI 存在（缺失时先征得用户同意再安装），执行上方对应安装命令，核对六个 open-design-* 技能已就位，然后按 open-design-create 工作流执行：project → run → 预览 → 在你的浏览器里视觉检查。',
    '如果当前会话既没有插件系统也没有 `od agent-plugin`，退回 `od mcp install <你的宿主>` 仅接入 MCP，并明确告知用户。',
  ],
  faqTitle: '常见问题',
  faq: [
    {
      name: '究竟会安装什么？',
      text: '一个技能包（六个 SKILL.md 工作流：basics、create、preview & verify、design systems & brands、export、known errors）加一条 stdio MCP 服务器配置，代理到你本地的 od 守护进程。源码在 github.com/nexu-io/open-design 的 plugins/open-design。',
    },
    {
      name: '支持哪些智能体？',
      text: 'Codex 和 Claude Code 通过各自插件系统原生安装；Cursor 由安装器把技能拷入 ~/.cursor/skills 并注册 MCP。另有 12 个智能体（Copilot、OpenCode、Gemini、Kimi 等）可用 `od mcp install <agent>` 仅接入 MCP。',
    },
    {
      name: '我的内容会离开本机吗？',
      text: '不会。Open Design 是本地优先的：守护进程、项目文件、预览、导出都在你的机器上。模型调用走你在 Open Design 里配置的供应商（BYOK），没有中间商服务。',
    },
    {
      name: '浏览器在里面扮演什么角色？',
      text: '每个生成产物都由 http://127.0.0.1:7456/api/projects/<id>/raw/<file> 实时供给。验证技能要求智能体在自己的浏览器面（Codex browser、Claude browser 或 Cursor browser）打开该 URL，视觉确认后才算完成。',
    },
    {
      name: '和 `od mcp install` 有什么区别？',
      text: '`od mcp install` 只注册 MCP 工具服务器。智能体插件额外携带工作流技能——把裸工具变成可靠的 brief → 生成 → 验证 → 导出闭环的操作知识。',
    },
    {
      name: '收费吗？',
      text: '插件和 Open Design 都是 Apache-2.0 开源。生成消耗你自己的模型 key 或所配置的供应商——插件本身不另外收费。',
    },
  ],
  ctaTitle: '给你的智能体一个"看得见"的设计工具',
  ctaBody: '装上插件，要一份演示稿，看你的智能体在浏览器里检查自己的工作。',
  ctaPrimary: '下载 Open Design',
  ctaSecondary: '在 GitHub 加星',
  tocLabel: '本页目录',
  toc: [
    { id: 'why', label: '为什么' },
    { id: 'make', label: '能做什么' },
    { id: 'how', label: '工作原理' },
    { id: 'install', label: '安装' },
    { id: 'for-agents', label: '给智能体' },
    { id: 'faq', label: '常见问题' },
  ],
};

export function getAgentPluginCopy(locale: LandingLocaleCode): AgentPluginPageCopy {
  if (locale === 'zh') return ZH;
  return EN;
}
