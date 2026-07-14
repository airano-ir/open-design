---
name: market-diligence-report
en_name: "Write a Market Diligence Report like a Strategy Partner"
zh_name: "像战略咨询合伙人一样写市场尽调报告"
description: |
  An evidence-led market and commercial diligence report for investment,
  expansion, or strategy decisions: market definition, demand, competition,
  economics, scenarios, risks, and a recommendation with confidence labels.
tags:
  - "report-template"
  - "consulting"
  - "fundraising-pitch"
  - "market-research"
  - "commercial-diligence"
  - "strategy-report"
triggers:
  - "market diligence"
  - "commercial diligence"
  - "market research report"
  - "market entry report"
  - "investment thesis"
  - "市场尽调"
  - "行业研究报告"
od:
  mode: template
  platform: desktop
  category: "consulting"
  scenario: "market-diligence"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Create a commercial diligence report on European warehouse robotics for an investment committee. Define the market, size demand, map competitors, test unit economics, show scenarios and risks, and end with an invest or pass recommendation."
---

# Market Diligence Report

Write as a strategy partner presenting to an investment committee or executive
team. The report must make evidence quality and uncertainty visible.

## Required structure

1. Executive thesis and recommendation with confidence level.
2. Market definition: included, excluded, geography, customer, use case.
3. Demand drivers and inhibitors with source-backed evidence.
4. Market size using top-down and bottom-up triangulation.
5. Customer segments, buying criteria, willingness to pay, and adoption stage.
6. Competitor map, differentiation, and likely strategic responses.
7. Business-model and unit-economics implications.
8. Base/upside/downside scenarios with assumption table.
9. Risks, disconfirming evidence, and diligence questions.
10. Recommendation, conditions, and 30/60/90-day next steps.
11. Source appendix with dates and confidence labels.

## Hidden rubric

- Is the market narrowly and operationally defined?
- Do two methods triangulate the size?
- Are primary facts, secondary research, and inference distinguishable?
- Does the competitor map use buyer-relevant axes?
- Are scenarios driven by explicit assumptions?
- Does the recommendation name what evidence would change it?

## Visual grammar

Use consulting-grade action headings, source footnotes, confidence chips,
market bridges, segment tables, competitive maps, scenario bands, and a
restrained editorial palette. Do not imply precision beyond the evidence.

## Critic gate

Require definition clarity, source integrity, sizing triangulation, competitive
insight, scenario auditability, and recommendation usefulness at 8/10 or
better. Unsupported market numbers must be removed or labelled as assumptions.

## Output contract

Produce one self-contained `index.html` with print CSS, citations, source dates,
and `data-od-id` on major sections.
