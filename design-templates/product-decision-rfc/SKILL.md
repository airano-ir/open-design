---
name: product-decision-rfc
en_name: "Write a Product Decision RFC like a Principal PM"
zh_name: "像资深产品负责人一样写产品决策 RFC"
description: |
  A reviewer-ready product or technical decision document that turns a PRD,
  roadmap debate, or architecture proposal into a clear recommendation,
  options matrix, evidence, tradeoffs, rollout, and reversible decision gates.
tags:
  - "document-template"
  - "product-management"
  - "product-rfc"
  - "technical-proposal"
  - "feature-business-case"
  - "decision-document"
triggers:
  - "product rfc"
  - "technical rfc"
  - "feature business case"
  - "architecture decision"
  - "product decision"
  - "产品决策文档"
  - "技术方案评审"
od:
  mode: template
  platform: desktop
  category: "product-management"
  scenario: "product-review"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Write a decision RFC for adding collaborative approvals to our workflow product. Compare build, integrate, and defer; recommend one option; define success metrics, risks, rollout gates, and the exact reviewer decision."
---

# Product Decision RFC

Write as a principal product manager paired with a staff engineer. The document
must help 4–8 reviewers say yes, no, or yes-with-conditions without reopening
the whole problem.

## Required structure

1. Decision summary: recommendation, status, owners, reviewers, deadline.
2. User and business problem with evidence and current baseline.
3. Decision principles and non-negotiable constraints.
4. Options: build, buy/integrate, defer/do nothing, plus any credible hybrid.
5. Tradeoff matrix: user value, time, risk, cost, reversibility, operations.
6. Recommendation and why alternatives lose.
7. Experience or architecture flow with system boundaries.
8. Success metrics, guardrails, and instrumentation.
9. Rollout: smallest test, migration, kill switch, and expansion gates.
10. Risks, open questions, and explicit reviewer checklist.

## Hidden rubric

- Is the problem specific enough to falsify?
- Can reviewers trace the recommendation to evidence and constraints?
- Are alternatives represented fairly?
- Is the decision reversible, and is that reflected in rollout scope?
- Do metrics include both value and harm guardrails?
- Is the requested decision yes/no capable?

## Visual grammar

Use a clean RFC layout with a narrow metadata rail, readable body measure,
decision callouts, comparison tables, lightweight flow diagrams, status chips,
and print-safe code/architecture blocks. Answer headings should carry the
argument.

## Critic gate

Score problem specificity, alternative quality, tradeoff honesty, metric
testability, rollout safety, and reviewer clarity. Any dimension below 8/10
requires revision. Never invent research findings or technical constraints.

## Output contract

Produce one self-contained `index.html`, semantic and print-ready, with
`data-od-id` on all decision sections.
