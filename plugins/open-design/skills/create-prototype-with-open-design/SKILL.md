---
name: create-prototype-with-open-design
description: Create or refine an interactive product prototype with Open Design, including web apps, dashboards, mobile concepts, onboarding, and task flows. Use only when the user explicitly selects or names Open Design; use the website skill for content-led marketing pages.
---

# Create Prototype with Open Design

Apply `$open-design-basics`, then execute this prototype contract.

## Brief and execution

- Use `artifactType: product-prototype` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable prototype presets:
  - Goal: **Validate an idea**, **Demo the core flow**, **Run a user test**, or **Support a review**.
  - Audience: **New users**, **Power users**, **Internal teams**, or **Decision-makers**.
  - Flows, multi-select: **Core workflow**, **Navigation and states**, **Dashboard and data**, **Search and discovery**, **Create and edit**, and **Settings**.
  - Direction: **Clean and focused**, **Bold and editorial**, **Warm and approachable**, **Modern tech**, or **Premium and restrained**.
- Infer the output as an interactive responsive product prototype. Keep requested platforms, screens, flows, and states as preselected choices.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `product-prototype` to `frontend-design` with explicit interaction and state requirements.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, a readable HTML entry file, and a real `previewUrl`. Verify the primary end-to-end flow is operable and selected loading, empty, success, error, navigation, and responsive states are represented. Open the exact Studio and preview URLs in separate in-app-browser tabs. A static screen with no requested interaction is incomplete.
