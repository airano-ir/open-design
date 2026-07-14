---
name: b2b-renewal-business-case
en_name: "Build a Renewal Business Case like a Strategic Account Director"
zh_name: "像战略客户总监一样写续约商业论证"
description: |
  A buyer-forwardable renewal or expansion document that proves realized
  value, quantifies future ROI, handles alternatives and risk, maps the buying
  committee, and gives procurement a clean path to signature.
tags:
  - "document-template"
  - "b2b-sales"
  - "renewal"
  - "sales-proposal"
  - "roi-business-case"
  - "procurement"
triggers:
  - "renewal proposal"
  - "renewal business case"
  - "sales proposal"
  - "expansion proposal"
  - "customer qbr follow-up"
  - "续约方案"
  - "销售商业论证"
od:
  mode: template
  platform: desktop
  category: "b2b-sales"
  scenario: "renewal-decision"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Create a renewal business case for a global retailer that reduced campaign production time by 42%. Quantify realized value, next-year expansion ROI, procurement options, risks, and the exact signing path."
---

# B2B Renewal Business Case

Write as a strategic account director whose document must survive internal
forwarding from champion to finance, procurement, security, and the economic
buyer.

## Required structure

1. Buyer-specific headline and renewal recommendation.
2. Shared objectives and baseline before adoption.
3. Realized value with source labels and calculation notes.
4. Adoption evidence by team, workflow, and business outcome.
5. Next-period opportunity and quantified value model.
6. Recommended package, alternatives, and commercial assumptions.
7. Risk, security, implementation, and change-management responses.
8. Buying committee map with concerns and required proof.
9. Mutual action plan from validation to signature and launch.
10. Decision summary with price, term, owner, and next meeting.

## Hidden rubric

- Does buyer pain appear before product capability?
- Can finance reproduce the ROI calculation?
- Is realized value separated from projected value?
- Are alternatives, including status quo, handled honestly?
- Can the champion forward the document without adding context?
- Is the path to signature explicit?

## Visual grammar

Use confident buyer language, clean value tables, calculation cards, proof
quotes, restrained customer-brand accents, and a mutual-action timeline.
Avoid feature grids without business consequence.

## Critic gate

Require buyer relevance, proof quality, ROI auditability, competitor handling,
and signing clarity to score at least 8/10. Mark customer-provided, observed,
and estimated numbers separately.

## Output contract

Produce one self-contained `index.html` with print CSS and `data-od-id` on all
major sections.
