---
name: create-presentation-with-open-design
description: Create or refine a browser-rendered presentation with Open Design, including pitches, strategy decks, progress reviews, and teaching decks. Use only when the user explicitly selects or names Open Design; clarify native PPTX requests before generation.
---

# Create Presentation with Open Design

Apply `$open-design-basics`, then execute this presentation contract.

## Brief and execution

- Use `artifactType: presentation` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable presentation presets:
  - Goal: **Pitch an idea**, **Share strategy**, **Report progress**, or **Teach a topic**.
  - Audience: **Leadership**, **Customers**, **Investors**, or **Internal team**.
  - Story, multi-select: **Clear story arc**, **Evidence and data**, **Recommendation**, **Product story**, **Roadmap**, and **Next steps**.
  - Direction: **Clean and focused**, **Bold and editorial**, **Warm and approachable**, **Modern tech**, or **Premium and restrained**.
- Infer the output as a browser presentation with a real rendered preview. Preserve supplied narrative, data, slide count, and brand constraints as preselected choices.
- If the user requires a real `.pptx`, confirm that requirement before starting. Do not describe the browser deck as a native PowerPoint file.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `presentation` to the Open Design `slides` workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a real deck entry file, and a real `previewUrl`. Verify a coherent narrative, readable slide frames, no clipped content, and the requested evidence or CTA. Open the exact Studio and preview URLs in separate in-app-browser tabs. A source-only deck with no rendered preview is incomplete.
