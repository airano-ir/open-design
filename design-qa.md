# Design QA — Community template search cards

## Evidence

- Source visual truth:
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-uNJLat.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-T2iJu2.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-6K3Jcj.png`
  - `/var/folders/5j/fb63hyxj11nblszkmd3vfcjm0000gn/T/codex-clipboard-aaqbsT.png`
- Implementation URL: `http://127.0.0.1:4367`
- Implementation screenshot: unavailable — the in-app Browser runtime reported no available browser instances.
- Intended viewport/state: desktop; compact chat result strip and expanded Questions-tab single-selection grid.
- Primary interactions covered by automated tests: default selection, alternate card selection, answer serialization, compact banner opening, safe preview URL handling, and selected Community plugin id extraction.
- Console errors checked: blocked because no browser instance was available.

## Full-view comparison evidence

Blocked. The four source images were opened at original resolution, but a browser-rendered implementation capture could not be produced, so a valid combined source/implementation comparison was not possible.

## Focused region comparison evidence

Blocked for the same reason. The intended focused regions are the compact preview strip, the selected-card border/check state, and the expanded two-column card grid.

## Findings

- [P1] Browser-rendered visual evidence is missing.
  - Location: compact Community result banner and Questions-tab template picker.
  - Evidence: source screenshots are available, but the Browser runtime returned an empty browser list.
  - Impact: typography, live iframe crops, spacing, overflow, and dark-theme behavior cannot be accepted from code/tests alone.
  - Fix: rerun the local URL in an available in-app browser, capture the compact and expanded states at matching viewports, compare them together with the source images, and fix any P0/P1/P2 drift.

## Required fidelity surfaces

- Fonts and typography: implemented with existing Open Design tokens and component typography; browser comparison blocked.
- Spacing and layout rhythm: compact five-slot strip and responsive two-column expanded grid implemented; browser comparison blocked.
- Colors and visual tokens: uses existing background, border, text, selected, radius, and shadow tokens; browser comparison blocked.
- Image quality and asset fidelity: renders real same-origin Community HTML/image/video previews; external preview URLs are rejected; live crop/sharpness comparison blocked.
- Copy and content: titles, descriptions, reasons, category, and mode come from semantic search results; browser truncation comparison blocked.

## Comparison history

- Initial pass: blocked before visual comparison because no browser instance was available. No source-to-implementation visual fixes were made.

## Implementation checklist

- Capture the compact chat banner.
- Open the Questions tab and capture the expanded card grid.
- Select a second result and verify the selected state and submit action.
- Check console and framework overlays.
- Compare source and implementation at the same viewport, then update this report.

final result: blocked
