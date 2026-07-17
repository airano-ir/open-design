---
name: create-design-system-with-open-design
description: Create, extract, or refine a reusable design system with Open Design from a product, brand, reference, or existing Open Design project. Use only when the user explicitly selects or names Open Design and wants reusable foundations, components, patterns, or governance.
---

# Create Design System with Open Design

Apply `$open-design-basics`, then execute this design-system contract.

## Brief and execution

- Use `artifactType: design-system` for `collect_brief`, `create_project`, and `start_run`.
- Offer only selectable design-system presets:
  - Goal: **Unify a product**, **Start a new product**, **Refresh the brand**, or **Scale delivery**.
  - Audience: **Product teams**, **Designers**, **Developers**, or **Brand teams**.
  - Scope, multi-select: **Foundations**, **Core components**, **Usage guidance**, **Accessibility**, **Product patterns**, and **Governance**.
  - Direction: **Extract from the supplied reference**, **Evolve the existing system**, **Clean and focused**, **Expressive and editorial**, or **Premium and restrained**.
- Infer the output as a reusable `DESIGN.md`. Preserve known design-system ids and source references as preselected choices; pass an existing `designSystem` when applying one.
- Call `create_project`, then `start_run` with the confirmed structured brief. The server maps `design-system` to the Open Design `design-md` workflow.

## Delivery standard

Require a successful terminal run, `artifactCount > 0`, and a readable generated `DESIGN.md` containing the selected foundations and guidance. Confirm that the file is registered in the project before claiming success. A preview URL is optional; open the exact `studioUrl` in the in-app browser for review.
