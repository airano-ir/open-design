---
name: create-video-with-open-design
description: Create or refine a video artifact with Open Design, including product demos, social promos, explainers, motion stories, and brand films. Use only when the user explicitly selects or names Open Design and wants a time-based visual result.
---

# Create Video with Open Design

Apply `$open-design-basics`, then execute this video contract.

## Brief and execution

- Use `artifactType: video` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable video presets:
  - Goal: **Product demo**, **Social promo**, **Explainer**, **Brand story**, or **Launch teaser**.
  - Audience: **Potential customers**, **Existing users**, **Business buyers**, **Social audience**, or **Internal team**.
  - Content, multi-select: **Opening hook**, **Key scenes**, **Product or UI**, **Captions**, **Call to action**, and **Music or voice**.
  - Direction: **Cinematic**, **Editorial motion**, **Clean product demo**, **Kinetic typography**, or **Playful social**.
  - Format: **Landscape 16:9**, **Portrait 9:16**, or **Square 1:1**, combined with **Short**, **Standard**, or **Extended** duration presets.
- Keep supplied storyboard beats, reference media, aspect, duration, caption, and audio requirements as preselected choices. Never request a free-text video prompt.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `video` to the Open Design video media-generation workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a readable playable video file, and a real `previewUrl`. Verify duration and aspect, the selected key scenes, and requested captions or audio. Open the exact Studio and preview URLs in separate in-app-browser tabs. Still frames or a storyboard without the requested video file are incomplete.
