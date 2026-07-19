import type { ManualEditRect, ManualEditStyles } from './types';

/**
 * Pure geometry + style resolution for canvas drag gestures in manual edit
 * mode: free move, edge resize, and the alignment guides / snapping shown
 * while dragging. Everything here works on plain rects so it stays unit-
 * testable without an iframe.
 *
 * Coordinate contract: all rects are in the same coordinate space as
 * `ManualEditTarget.rect` (iframe CSS pixels). The host converts to/from
 * screen pixels with the preview scale before calling in.
 */

export type ManualEditGestureKind = 'move' | 'resize-left' | 'resize-right';

export interface ManualEditAlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  /** The guide line's cross-axis position (x for vertical, y for horizontal). */
  position: number;
  /** Extent of the line along its own axis, covering both aligned rects. */
  start: number;
  end: number;
}

export interface ManualEditGestureSnap {
  rect: ManualEditRect;
  guides: ManualEditAlignmentGuide[];
}

export const MANUAL_EDIT_MIN_GESTURE_SIZE = 24;
export const MANUAL_EDIT_SNAP_THRESHOLD = 5;

interface AxisSnap {
  delta: number;
  linePosition: number;
  candidate: ManualEditRect;
}

function axisEdges(rect: ManualEditRect, axis: 'x' | 'y'): number[] {
  return axis === 'x'
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

function bestAxisSnap(
  ownEdges: number[],
  candidates: ManualEditRect[],
  axis: 'x' | 'y',
  threshold: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const candidate of candidates) {
    for (const line of axisEdges(candidate, axis)) {
      for (const edge of ownEdges) {
        const delta = line - edge;
        if (Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, linePosition: line, candidate };
        }
      }
    }
  }
  return best;
}

function guideFor(
  orientation: ManualEditAlignmentGuide['orientation'],
  linePosition: number,
  moved: ManualEditRect,
  candidate: ManualEditRect,
): ManualEditAlignmentGuide {
  const start = orientation === 'vertical'
    ? Math.min(moved.y, candidate.y)
    : Math.min(moved.x, candidate.x);
  const end = orientation === 'vertical'
    ? Math.max(moved.y + moved.height, candidate.y + candidate.height)
    : Math.max(moved.x + moved.width, candidate.x + candidate.width);
  return { orientation, position: linePosition, start, end };
}

/**
 * Snap a dragged rect against candidate rects (siblings, containers, page
 * bounds). Move gestures snap both axes on any of left/center/right and
 * top/center/bottom; resize gestures snap only the actively dragged edge so
 * the anchored edge never drifts.
 */
export function snapManualEditGestureRect(
  kind: ManualEditGestureKind,
  rect: ManualEditRect,
  candidates: readonly ManualEditRect[],
  threshold: number = MANUAL_EDIT_SNAP_THRESHOLD,
): ManualEditGestureSnap {
  const usable = candidates.filter((candidate) => candidate.width > 0 || candidate.height > 0);
  const guides: ManualEditAlignmentGuide[] = [];
  const next: ManualEditRect = { ...rect };

  if (kind === 'move') {
    const snapX = bestAxisSnap(axisEdges(rect, 'x'), usable, 'x', threshold);
    if (snapX) {
      next.x = rect.x + snapX.delta;
      guides.push(guideFor('vertical', snapX.linePosition, next, snapX.candidate));
    }
    const snapY = bestAxisSnap(axisEdges(rect, 'y'), usable, 'y', threshold);
    if (snapY) {
      next.y = rect.y + snapY.delta;
      guides.push(guideFor('horizontal', snapY.linePosition, next, snapY.candidate));
    }
    return { rect: next, guides };
  }

  const movingEdge = kind === 'resize-left' ? rect.x : rect.x + rect.width;
  const snap = bestAxisSnap([movingEdge], usable, 'x', threshold);
  if (snap) {
    if (kind === 'resize-left') {
      const right = rect.x + rect.width;
      next.x = Math.min(rect.x + snap.delta, right - MANUAL_EDIT_MIN_GESTURE_SIZE);
      next.width = right - next.x;
    } else {
      next.width = Math.max(MANUAL_EDIT_MIN_GESTURE_SIZE, rect.width + snap.delta);
    }
    guides.push(guideFor('vertical', snap.linePosition, next, snap.candidate));
  }
  return { rect: next, guides };
}

/**
 * Clamp a floating bar's center-x so a `translateX(-50%)` positioned bar of
 * `width` stays fully inside the canvas with `margin` breathing room. When
 * the canvas is narrower than the bar, center it and let both sides overflow
 * symmetrically instead of clipping one edge.
 */
export function manualEditClampedCenter(
  desiredCenter: number,
  width: number,
  canvasWidth: number | undefined,
  margin = 6,
): number {
  const half = Math.max(0, width) / 2;
  if (!canvasWidth || canvasWidth <= 0) return Math.max(desiredCenter, margin + half);
  const min = margin + half;
  const max = canvasWidth - margin - half;
  if (max < min) return canvasWidth / 2;
  return Math.min(Math.max(desiredCenter, min), max);
}

/** Apply raw pointer deltas to the gesture's starting rect (pre-snap). */
export function manualEditGestureRect(
  kind: ManualEditGestureKind,
  start: ManualEditRect,
  dx: number,
  dy: number,
): ManualEditRect {
  if (kind === 'move') {
    return { ...start, x: start.x + dx, y: start.y + dy };
  }
  if (kind === 'resize-right') {
    return { ...start, width: Math.max(MANUAL_EDIT_MIN_GESTURE_SIZE, start.width + dx) };
  }
  const right = start.x + start.width;
  const x = Math.min(start.x + dx, right - MANUAL_EDIT_MIN_GESTURE_SIZE);
  return { ...start, x, width: right - x };
}

/**
 * Compose the move-gesture preview transform. The drag offset must PREPEND
 * the element's own (computed) transform — an inline `translate(dx,dy)` alone
 * would override an authored transform such as `translate(-50%, -50%)`
 * centering, making the element jump at drag start and again on release when
 * the authored transform comes back.
 */
export function manualEditMovePreviewTransform(
  dx: number,
  dy: number,
  authoredTransform: string | undefined,
): string {
  const authored = (authoredTransform ?? '').trim();
  const suffix = authored && authored !== 'none' ? ` ${authored}` : '';
  return `translate(${dx}px, ${dy}px)${suffix}`;
}

function parseCssPx(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundPx(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}

function isOutOfFlow(position: string): boolean {
  return position === 'absolute' || position === 'fixed';
}

/**
 * Resolve the inline styles that persist a move gesture.
 *
 * - Absolutely/fixed positioned elements move by adjusting `left`/`top`
 *   (pinning `right`/`bottom` to auto so stylesheet constraints don't fight
 *   the new offsets). When `startWidth` is given the element's width is
 *   pinned too: an auto-width absolute element shrinks to fit the space
 *   right of `left`, so committing a larger `left` would otherwise reflow
 *   it narrower and the element would visibly jump on release (the drag
 *   preview is a transform and never reflows).
 * - Flow elements become `position: relative` with accumulated `left`/`top`
 *   offsets, so they keep their layout slot while moving visually — dragging
 *   never reflows the rest of the document.
 */
export function manualEditMoveStyles(
  styles: Pick<ManualEditStyles, 'position' | 'left' | 'top'>,
  dx: number,
  dy: number,
  startWidth?: number,
): Partial<ManualEditStyles> {
  if (isOutOfFlow(styles.position)) {
    return {
      left: roundPx(parseCssPx(styles.left) + dx),
      top: roundPx(parseCssPx(styles.top) + dy),
      right: 'auto',
      bottom: 'auto',
      ...(startWidth != null && startWidth > 0 ? { width: roundPx(startWidth) } : {}),
    };
  }
  const baseLeft = styles.position === 'relative' ? parseCssPx(styles.left) : 0;
  const baseTop = styles.position === 'relative' ? parseCssPx(styles.top) : 0;
  return {
    position: 'relative',
    left: roundPx(baseLeft + dx),
    top: roundPx(baseTop + dy),
  };
}

/**
 * Resolve the inline styles that persist an edge resize. The right handle
 * only changes `width`; the left handle keeps the right edge fixed, so it
 * pairs the width change with a horizontal offset using the same
 * positioning rules as `manualEditMoveStyles`.
 *
 * `display: inline` elements (spans, links) ignore `width` entirely, so a
 * resize gesture on one must also upgrade it to `inline-block` — otherwise
 * the committed width persists to source but never changes what the user
 * sees.
 */
export function manualEditResizeStyles(
  kind: Extract<ManualEditGestureKind, 'resize-left' | 'resize-right'>,
  styles: Pick<ManualEditStyles, 'position' | 'left' | 'top' | 'display'>,
  startRect: ManualEditRect,
  nextRect: ManualEditRect,
): Partial<ManualEditStyles> {
  const width: Partial<ManualEditStyles> = {
    width: roundPx(Math.max(MANUAL_EDIT_MIN_GESTURE_SIZE, nextRect.width)),
  };
  if (styles.display === 'inline') width.display = 'inline-block';
  if (kind === 'resize-right') return width;
  const dx = nextRect.x - startRect.x;
  if (dx === 0) return width;
  const move = manualEditMoveStyles(styles, dx, 0);
  // A left-edge resize only shifts horizontally — never emit a vertical
  // offset, which would visibly jump flow elements that had no inline top.
  delete move.top;
  delete move.bottom;
  return { ...move, ...width };
}
