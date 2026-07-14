---
name: open-design-systems-brands
description: "Use when the user names a visual style, wants results to match an existing brand or website, or asks what styles Open Design offers. Covers browsing/applying DESIGN.md design systems and extracting a brand from a URL into a reusable design system."
---

# Design Systems & Brands

Prerequisite context: `open-design-basics`.

## Design systems

A design system is a `DESIGN.md` spec (tokens, type, color, layout rules) that Open
Design's agent applies during generation. Open Design ships ~150 of them.

```bash
od design-systems list --json     # id + title + description per system
od design-systems show <id>       # full DESIGN.md
```

Apply one by passing `--design-system <id>` to `od project create` or
`od run start` (see `open-design-create`). Match by the user's words — "minimal",
"editorial", "brutalist", a brand-name-alike — against the list descriptions, and
offer 2–3 candidates when the user is choosing style interactively.

## Brand extraction (URL → design system)

When the user wants output that matches *their* brand or any existing website:

```bash
od brand create <url> --json
```

This starts an extraction that measures the site (colors, type, spacing, imagery)
and synthesizes a brand design system. It self-finalizes; check progress and list
results with:

```bash
od brand list --json
od brand continue <id> --json    # nudge a stalled extraction
```

Once the brand exists, use its design-system id like any other `--design-system`
value. Preview what got extracted before generating with it — a wrong accent color
poisons every downstream artifact:

```bash
od design-systems show <brandDesignSystemId>
```

## Choosing between them

- User has a live site / brand assets → extract a brand.
- User names an aesthetic, or has no brand → pick a shipped design system.
- User says nothing about style → omit `--design-system`; Open Design's agent
  picks a defensible default. Mention which style got used when you report results.
