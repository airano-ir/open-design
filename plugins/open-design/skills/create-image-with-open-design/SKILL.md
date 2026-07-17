---
name: create-image-with-open-design
description: Create or refine a static image artifact with Open Design, including campaign visuals, product imagery, editorial illustrations, posters, and social graphics. Use only when the user explicitly selects or names Open Design and wants an image rather than a website or motion artifact.
---

# Create Image with Open Design

Apply `$open-design-basics`, then execute this image contract.

## Brief and execution

- Use `artifactType: image` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable image presets:
  - Goal: **Campaign key visual**, **Product marketing image**, **Editorial illustration**, **Poster**, or **Social graphic**.
  - Audience: **Potential customers**, **Existing users**, **Business buyers**, **Community**, or **Internal team**.
  - Content, multi-select: **Primary subject**, **Product or UI**, **Environment**, **Text-safe area**, **Brand assets**, and **Variant set**.
  - Direction: **Photoreal**, **Editorial illustration**, **Graphic poster**, **Dimensional 3D**, or **Minimal product**.
  - Format: **Square 1:1**, **Landscape 16:9**, **Portrait 9:16**, **Landscape 4:3**, or **Portrait 3:4**.
- Keep supplied subject, copy, palette, reference assets, and aspect as preselected choices. Never request a free-text image prompt.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `image` to the Open Design image media-generation workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, at least one readable image file, and a real `previewUrl`. Verify the selected subject, direction, format, and requested variants. Open the exact Studio and preview URLs in separate in-app-browser tabs. A prompt, placeholder, or metadata record without an image file is incomplete.
