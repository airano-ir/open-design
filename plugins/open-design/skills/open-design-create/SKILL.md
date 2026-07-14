---
name: open-design-create
description: "Use when the user wants to generate a design artifact — a deck/slides, landing page, prototype, poster, brand page, data-viz page, or a redesign of an existing folder — through Open Design. Covers aligning the brief, choosing a skill and design system, creating the project, starting and following generation runs, and iterating."
---

# Create Design Artifacts with Open Design

Prerequisite context: `open-design-basics`.

## Role

Act as a design producer. The user thinks in outcomes ("a launch deck", "a landing
page that matches our brand"), not in projects and runs. Translate intent into one
well-briefed generation run, then verify and iterate.

## 1 · Align before generating

Generation runs cost real model budget, so align when the request is vague:

- Missing deliverable type (deck vs page vs poster) → ask.
- Missing audience/content source → ask, or gather from files the user attached.
- Clear, narrow request ("turn NOTES.md into a 6-slide deck, minimal style") →
  execute directly, no alignment round.

Keep alignment to one round of concrete options; do not interrogate.

## 2 · Choose the workflow and the style

```bash
od skills list --json           # workflows: decks, landing pages, posters, …
od design-systems list --json   # visual styles
```

Pick the closest skill by its description; pick a design system when the user named
a style or brand (route to `open-design-systems-brands` for brand extraction). Both
are optional — omitting them lets Open Design's agent choose.

## 3 · Create the project

```bash
od project create --name "<short human name>" --json
```

Read `project.id` and `conversationId` from the JSON and reuse them for every later
command in this effort. Seed input material the run should use:

```bash
od files upload <projectId> ./notes.md
od files write  <projectId> brief.md < brief.md
```

## 4 · Start the run and follow it

```bash
od run start \
  --project <projectId> \
  --conversation <conversationId> \
  --skill <skillId> \
  --design-system <designSystemId> \
  --prompt-file - --follow --json <<'EOF'
<the full brief: deliverable, audience, content source files, tone,
length/slide-count, constraints>
EOF
```

- `--follow` streams ND-JSON run events until the run ends; without it, poll
  `od run info <runId>` or stream later with `od run watch <runId>`.
- Runs take minutes, not seconds. Do not kill a run because it is quiet; watch the
  event stream.
- To redesign an existing local folder instead of starting fresh, use the one-shot
  `od run redesign --path <folder> --follow --json` (imports the folder as a project
  and starts a redesign run).

## 5 · Collect results

```bash
od run result-package <runId> --json   # artifacts + provenance
od files list <projectId> --json       # everything in the project
```

Identify the entry artifact (usually an `.html` file). Then hand off to
`open-design-preview-verify` — a finished run is NOT a verified result.

## 6 · Iterate

Feedback goes back through the same conversation so the design agent keeps context:

```bash
od run start --project <projectId> --conversation <conversationId> \
  --message "Slide 3: replace the bullet wall with a comparison table; keep the accent color" \
  --follow --json
```

Make feedback visual and specific (name the slide/section, say what to change and
what to keep). One run per coherent batch of feedback, not one run per nit.

## Multi-deliverable notes

- Standalone images/video/audio assets: `od media generate` (see `od media --help`)
  writes the asset into the project.
- Brand extraction from a URL: `open-design-systems-brands`.
- Final files for the user (PDF/PPTX/PNG): `open-design-export-deliver`.
