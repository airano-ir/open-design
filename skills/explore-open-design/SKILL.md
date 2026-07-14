---
name: explore-open-design
description: |
  Explain what Open Design can create, edit, and deliver, then turn a broad
  goal into a concrete next step. Use when someone asks what the product can
  do, what they can make, which mode or workflow fits, or asks for inspiration
  before choosing an artifact.
triggers:
  - "what can Open Design do"
  - "what can I make"
  - "show me the capabilities"
  - "help me choose what to create"
  - "产品能做什么"
  - "可以做什么"
  - "有哪些能力"
  - "给我一些灵感"
od:
  mode: utility
  category: discovery
  scenario: ideation
  design_system:
    requires: false
---

# Explore Open Design

Help the user move from a broad goal to one useful creation path. Answer in the
user's language and describe outcomes, not internal architecture.

## Capability map

- Websites: landing pages, editorial sites, marketing pages, and interactive web experiences.
- Product interfaces: responsive web apps, dashboards, mobile concepts, wireframes, and prototypes.
- Presentations: pitch decks, reports, strategy decks, keynotes, and reusable slide systems.
- Documents: briefs, proposals, reports, PDFs, and structured long-form content.
- Brand and design systems: extract, build, apply, and refine visual systems across artifacts.
- Images: campaign visuals, posters, illustrations, product imagery, and image editing.
- Motion and video: animated compositions, social clips, explainers, and HyperFrames scenes.
- Audio: voice, speech, music, and sound workflows when a configured provider is available.
- Existing work: inspect, edit, comment on, export, and continue artifacts already in the project.
- Extensions: Community skills and templates add specialized workflows and visual starting points.

Do not claim every provider is configured or quote catalogue counts. Availability
depends on the local installation and connected services.

## Conversation flow

1. Restate the user's outcome in one sentence.
2. Recommend at most three relevant paths from the capability map.
3. Explain the difference in user-facing terms: what gets created and what the user can edit next.
4. If the user is ready, offer a concrete starter prompt.
5. If the user asks for examples, visual references, templates, or inspiration, use
   `$search-community-templates` with the clarified brief.

If the request is too broad to recommend a path confidently, emit one concise
`<question-form>` with 2–4 outcome choices. Do not ask a long questionnaire.
