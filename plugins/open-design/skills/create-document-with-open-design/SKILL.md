---
name: create-document-with-open-design
description: Create or refine a web-first document with Open Design, including reports, proposals, briefs, guides, and editorial documents. Use only when the user explicitly selects or names Open Design and accepts Markdown source plus a print-ready HTML or PDF-ready preview; do not promise native DOCX output.
---

# Create Document with Open Design

Apply `$open-design-basics`, then execute this document contract.

## Brief and execution

- Use `artifactType: document` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable document presets:
  - Goal: **Report findings**, **Make a proposal**, **Write a brief**, **Create a guide**, or **Publish an editorial piece**.
  - Audience: **Leadership**, **Customers**, **Internal team**, **Partners**, or **General readers**.
  - Sections, multi-select: **Executive summary**, **Context**, **Evidence and data**, **Analysis**, **Recommendation**, **Next steps**, and **Appendix**.
  - Direction: **Clean report**, **Editorial publication**, **Formal proposal**, **Modern technical**, or **Premium restrained**.
  - Format: **Markdown source and print-ready HTML** or **Markdown source and PDF-ready HTML preview**.
- Preserve supplied outline, evidence, copy, citations, and brand constraints as preselected choices. Never request a free-text document brief.
- If the user requires a native `.docx`, explain before starting that this Open Design workflow does not produce one. Do not label HTML, Markdown, or PDF-ready output as DOCX.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `document` to the Open Design document/new-generation workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a readable Markdown source file, a print-ready HTML entry file, and a real `previewUrl`. Verify the selected sections, hierarchy, evidence, and print layout. Open the exact Studio and preview URLs in separate in-app-browser tabs. A Markdown-only result without the promised print-ready preview is incomplete; native DOCX is outside this contract.
