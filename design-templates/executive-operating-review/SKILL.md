---
name: executive-operating-review
en_name: "Run an Executive Operating Review like a COO"
zh_name: "像 COO 一样写经营复盘报告"
description: |
  A monthly or quarterly operating review that puts the answer above every
  chart: performance versus plan, drivers, forecast, risks, owners, and the
  few decisions leadership must make.
tags:
  - "report-template"
  - "corporate-strategy"
  - "data-finance"
  - "operating-review"
  - "qbr"
  - "executive-report"
triggers:
  - "operating review"
  - "business review"
  - "monthly business review"
  - "executive qbr"
  - "quarterly operating report"
  - "经营复盘"
  - "季度经营报告"
od:
  mode: template
  platform: desktop
  category: "corporate-strategy"
  scenario: "operating-review"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Produce a Q2 operating review for a B2B SaaS company. Compare actuals to plan, explain ARR and retention drivers, update the forecast, rank risks, assign owners, and surface the three leadership decisions."
---

# Executive Operating Review

Write as a COO preparing the operating truth for the executive team. The
report must convert metrics into decisions rather than restating a dashboard.

## Required structure

1. Executive answer: what changed, why, and what leadership must decide.
2. Scorecard: actual versus plan versus prior period.
3. Driver tree: which input metrics explain the outcome.
4. Segment or function performance with material variances only.
5. Forecast: base, upside, downside, confidence, and changed assumptions.
6. Risks: impact, likelihood, early signal, mitigation, accountable owner.
7. Resource tradeoffs and decisions required.
8. Commitments: owner, date, measurable outcome.
9. Appendix: metric definitions, source dates, and detailed tables.

## Hidden rubric

- Does every chart have a conclusion above it?
- Are actual, plan, forecast, and prior period clearly separated?
- Are variances explained by controllable drivers?
- Are risks tied to forecast impact?
- Does every action have one accountable owner?
- Can leadership identify the three decisions without reading the appendix?

## Visual grammar

Use dense but scan-friendly report pages: a strong executive banner, KPI
variance cards, restrained charts, driver annotations, risk heatmap, and
owner/date tables. Color encodes status consistently; it never decorates.

## Critic gate

Require metric integrity, variance explanation, forecast honesty, decision
clarity, and owner accountability at 8/10 or better. Never manufacture actuals;
use clearly labelled sample or assumed values when source data is absent.

## Output contract

Produce one self-contained `index.html`, print-ready with `data-od-id` on every
major report block.
