---
name: create-audio-with-open-design
description: Create or refine an audio artifact with Open Design, including music, speech, narration, and sound effects. Use only when the user explicitly selects or names Open Design and wants a standalone audio result rather than video.
---

# Create Audio with Open Design

Apply `$open-design-basics`, then execute this audio contract.

## Brief and execution

- Use `artifactType: audio` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable audio presets:
  - Type and goal: **Background music**, **Theme or sting**, **Narration**, **Spoken announcement**, or **Sound effect**.
  - Use context: **Product experience**, **Presentation**, **Marketing**, **Social content**, **Podcast**, or **Internal communication**.
  - Content, multi-select: **Instrumental arc**, **Spoken script**, **Brand motif**, **Transition cue**, **Loopable ending**, and **Variant set**.
  - Sonic direction: **Warm and organic**, **Modern electronic**, **Cinematic**, **Minimal and ambient**, **Energetic**, or **Clear and neutral voice**.
  - Format: **Short cue**, **Standard clip**, or **Extended track**, with **Music**, **Speech**, or **SFX** output selected explicitly.
- Normalize the sonic-direction choice into the structured brief's creative-direction field. Keep supplied wording, pronunciation, mood, duration, and reference audio as preselected choices. Never request a free-text audio prompt.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `audio` to the Open Design audio media-generation workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a readable playable audio file, and a real `previewUrl`. Verify the chosen audio type, duration, content, and sonic direction. Open the exact Studio and preview URLs in separate in-app-browser tabs. A script or generation prompt without an audio file is incomplete.
