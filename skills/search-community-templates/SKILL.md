---
name: search-community-templates
description: |
  Semantically search installed Community skills and templates, present the
  best matches as visual cards, and let the user choose one to apply to the
  next agent turn. Use for template search, visual inspiration, reference
  matching, style examples, or requests to browse Community by meaning.
triggers:
  - "search community templates"
  - "find a matching template"
  - "show visual inspiration"
  - "find examples like this"
  - "搜索模板"
  - "匹配模板"
  - "找一些视觉参考"
  - "从 Community 里找"
od:
  mode: utility
  category: discovery
  scenario: ideation
  design_system:
    requires: false
---

# Search Community Templates

Search the local Community catalogue by intent, artifact type, industry, and
visual tone. The result is a choice surface, not a prose recommendation list.

## Workflow

1. Turn the user's message into a compact semantic query that preserves artifact
   type, audience, subject, and style. Do not invent preferences.
2. Run:

   ```bash
   od inspire search --query "<query>" --source community --limit 12 --locale "<locale>" --json
   ```

   For a long or piped brief, use `--prompt-file <path|->` instead of `--query`.
3. Use only the returned results. Never invent a plugin id, preview URL, score,
   reason, prompt, or title.
4. Emit one `<question-form>` and stop the turn immediately after it. The form
   must contain one required `template-cards` question with `allowCustom: false`.
5. Put the first result id in `defaultValue`. Map each result to a template card:

   ```json
   {
     "id": "<result.id>",
     "label": "<result.title>",
     "source": "community",
     "description": "<result.description>",
     "reason": "<result.reason>",
     "category": "<result.category>",
     "mode": "<result.mode>",
     "prompt": "<result.prompt>",
     "preview": "<result.preview>"
   }
   ```

   Example wrapper:

   ```xml
   <question-form id="community-template-search" title="Choose a visual starting point">
   {"description":"Select one Community example to guide the next turn.","questions":[{"id":"template","label":"Best matches","type":"template-cards","required":true,"allowCustom":false,"defaultValue":"plugin-id","templates":[]}],"submitLabel":"Use template"}
   </question-form>
   ```

When the user submits, the host applies that Community plugin's immutable
snapshot and includes it in the next agent turn. Do not ask the user to copy an
id or manually invoke the plugin.

If no result is returned, broaden the wording once while preserving artifact
type. If the second search is empty, explain that no installed Community entry
matched and offer to continue without a template.
