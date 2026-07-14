---
name: policy-impact-brief
en_name: "Write a Policy Impact Brief like a Regulatory Affairs Director"
zh_name: "像监管事务负责人一样写政策影响简报"
description: |
  A decision-grade policy, regulatory, or institutional review report with
  statutory context, stakeholder impact, evidence, options, implementation,
  accountability, and explicit approval language.
tags:
  - "report-template"
  - "government-policy"
  - "policy-brief"
  - "regulatory-impact"
  - "institutional-review"
  - "compliance"
triggers:
  - "policy brief"
  - "regulatory impact"
  - "institutional review"
  - "compliance report"
  - "public consultation"
  - "政策简报"
  - "监管影响报告"
od:
  mode: template
  platform: desktop
  category: "government-policy"
  scenario: "policy-review"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  example_prompt: "Write a policy impact brief for a city considering mandatory building-energy disclosure. Summarize the decision, legal basis, evidence, stakeholder impact, options, implementation, risks, accountability, and recommended resolution."
---

# Policy Impact Brief

Write as a regulatory affairs director preparing an accountable institutional
decision. Neutrality, traceability, implementation realism, and legal precision
matter more than persuasive flourish.

## Required structure

1. Decision in one page: authority, recommendation, affected population,
   implementation date, and resolution requested.
2. Statutory or policy context with source references.
3. Problem definition and evidence quality.
4. Stakeholder impact: benefits, costs, equity, operational burden.
5. Options including status quo, with evaluation criteria.
6. Preferred option and proportionality rationale.
7. Implementation plan: phases, owners, controls, and budget.
8. Risk register: legal, operational, political, data, and compliance risks.
9. Monitoring and accountability: measures, reporting cadence, review date.
10. Consultation record, dissenting evidence, and source appendix.

## Hidden rubric

- Is the decision within the named authority?
- Are evidence, interpretation, and policy preference separated?
- Are affected groups and distributional impacts visible?
- Is the preferred option proportionate to the problem?
- Can the institution implement and audit the policy?
- Are review, appeal, and sunset mechanisms explicit?

## Visual grammar

Use an institutional paper system: high legibility, restrained navy and civic
accent, numbered findings, policy-option table, impact matrix, implementation
timeline, source notes, and accessible print styling.

## Critic gate

Require legal traceability, evidence integrity, stakeholder completeness,
proportionality, implementation readiness, and accountability at 8.5/10 or
better. Never fabricate statutory citations or consultation findings.

## Output contract

Produce one self-contained `index.html` with print CSS, citations, and
`data-od-id` on every major section.
