---
name: board-decision-memo
en_name: "Write a Board Decision Memo like a Chief of Staff"
zh_name: "像 CEO 幕僚长一样写董事会决策备忘录"
description: |
  A board-ready pre-read for one consequential decision: recommendation,
  evidence, financial impact, alternatives, risks, owners, and the exact
  resolution requested. Use for board pre-reads, executive approvals,
  investment committees, and operating decisions.
tags:
  - "document-template"
  - "corporate-strategy"
  - "board-pre-read"
  - "executive-decision"
  - "decision-memo"
  - "chief-of-staff"
triggers:
  - "board pre-read"
  - "board memo"
  - "decision memo"
  - "executive approval"
  - "investment committee"
  - "董事会材料"
  - "决策备忘录"
od:
  mode: template
  platform: desktop
  category: "corporate-strategy"
  scenario: "board-decision"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [typography, typography-hierarchy, rtl-and-bidi]
  example_prompt: "Turn our expansion notes into a board pre-read that recommends entering Germany, quantifies the investment, compares alternatives, names risks and owners, and ends with a resolution the board can approve."
---

# Board Decision Memo

Write as a CEO chief of staff preparing a decision package, not as a generic
business writer. The memo exists to let directors reach one informed decision
before the meeting.

## Decision contract

- Audience: board directors, CEO, CFO, and accountable executives.
- Decision target: approve, reject, defer, or request a named condition.
- Core promise: the recommendation, evidence, economics, risks, and ownership
  are understandable in under eight minutes.

## Required structure

1. **Decision header** — recommendation, requested resolution, owner, date,
   confidentiality, and decision deadline.
2. **Executive answer** — the conclusion in three lines; no background-first
   opening.
3. **Why now** — trigger, cost of delay, and strategic fit.
4. **Evidence** — source-backed facts separated from assumptions.
5. **Economics** — investment, base/upside/downside impact, payback, and the
   metric that determines whether to continue.
6. **Alternatives considered** — at least three options including "do
   nothing", with explicit tradeoffs.
7. **Risks and mitigations** — likelihood, impact, early warning, owner.
8. **Execution plan** — milestones, accountable owner, decision gates.
9. **Resolution requested** — exact approval language and follow-up cadence.
10. **Appendix** — source notes, calculations, and unresolved questions.

## Hidden rubric

- Can a director state the decision and rationale after reading only page one?
- Are financial consequences legible to a CFO?
- Is every important claim sourced or labelled as an assumption?
- Is "do nothing" treated as a real alternative?
- Does every material risk have an owner and an early-warning signal?
- Is the requested resolution precise enough to enter meeting minutes?

## Visual grammar

Use a restrained board-paper system: warm paper, dark ink, one authority
accent, wide margins, answer-first headings, compact evidence tables, and
print-safe A4/Letter pagination. Avoid dashboard chrome, decorative gradients,
and marketing language.

## Critic gate

Do not emit the final artifact until decision clarity, evidence strength,
financial readability, risk ownership, and resolution precision each score at
least 8/10. Flag unsupported numbers instead of inventing them.

## Output contract

Produce one self-contained `index.html` with semantic sections, `data-od-id` on
every major section, and print CSS. Preserve citations and source labels.
