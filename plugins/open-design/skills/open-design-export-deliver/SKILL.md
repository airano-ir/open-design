---
name: open-design-export-deliver
description: "Use when the user wants a deliverable file out of an Open Design project — PDF, PPTX, or image — or asks where the generated files live. Covers od export, result packaging, and how to report deliverables."
---

# Export & Deliver

Prerequisite context: `open-design-basics`.

## Export formats

```bash
od export <relpath> --project <projectId> --format pdf   [--out <path>] [--json]
od export <relpath> --project <projectId> --format pptx  [--deck] [--out <path>] [--json]
od export <relpath> --project <projectId> --format image [--image-format png|jpeg] [--out <path>] [--json]
```

- `<relpath>` is the project file to export (usually the entry `.html`).
- `--deck` treats the artifact as a slide deck (one slide per page in the PPTX).
- All formats rasterize through the Open Design desktop runtime's Chromium. If no
  desktop/packaged runtime is reachable, export fails — fall back to handing the
  user the live preview URL and the on-disk file path, and say why the export was
  not produced.

## Result packaging

Before exporting, confirm what the run actually produced:

```bash
od run result-package <runId> --json   # artifacts with kinds and titles
od files list <projectId> --json
```

Export the artifact the user asked for, not the first file alphabetically.

## Delivery report

When you hand results back, include all of:

1. The exported file's absolute path (from `--out` or the export result JSON).
2. The live preview URL (`<daemonUrl>/api/projects/<id>/raw/<relpath>`) so the user
   can keep iterating in Open Design later.
3. The project id — it is the durable handle; the user can reopen it in the Open
   Design app or ask any od-equipped agent to continue it.

Verification discipline still applies: an export you did not open/inspect is
"produced", not "verified" — say which one it is (see `open-design-preview-verify`).
