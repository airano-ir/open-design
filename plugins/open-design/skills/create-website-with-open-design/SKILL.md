---
name: create-website-with-open-design
description: Create or refine a content-led website with Open Design, including landing pages, product or company sites, campaign pages, portfolios, and ecommerce marketing surfaces. Use only when the user explicitly selects or names Open Design; use the prototype skill for app-like task flows.
---

# Create Website with Open Design

Apply `$open-design-basics`, then execute this website contract.

## Brief and execution

- Use `artifactType: website` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable website presets:
  - Goal: **Explain and convert**, **Launch something**, **Build trust**, or **Sell online**.
  - Audience: **Potential customers**, **Existing users**, **Business buyers**, or **General audience**.
  - Content, multi-select: **Hero and CTA**, **Key benefits**, **Social proof**, **How it works**, **Pricing**, and **FAQ and contact**.
  - Direction: **Clean and focused**, **Bold and editorial**, **Warm and approachable**, **Modern tech**, or **Premium and restrained**.
- Infer the output as a responsive browser website with a real HTML entry file. Preserve supplied copy or requirements as preselected choices.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `website` to the Open Design `frontend-design` workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a readable HTML entry file, and a real `previewUrl`. Verify the page renders at desktop and mobile widths and includes the selected content and primary CTA. Open the exact Studio and preview URLs in separate in-app-browser tabs. Zero files, a missing entry, or an unrenderable preview is not a delivered website.
