import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../i18n';
import {
  manualEditClampedCenter,
  manualEditGestureRect,
  manualEditMovePreviewTransform,
  manualEditMoveStyles,
  manualEditResizeStyles,
  snapManualEditGestureRect,
  type ManualEditAlignmentGuide,
  type ManualEditGestureKind,
} from '../edit-mode/gestures';
import { manualEditTooltip } from '../edit-mode/shortcuts';
import type { ManualEditPreviewStyles, ManualEditRect, ManualEditStyles, ManualEditTarget } from '../edit-mode/types';
import { Icon } from './Icon';
import styles from './ManualEditSelectionOverlay.module.css';

export interface ManualEditCropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragState {
  kind: ManualEditGestureKind;
  startRect: ManualEditRect;
  rect: ManualEditRect;
  guides: ManualEditAlignmentGuide[];
  moved: boolean;
}

interface CropHandleState {
  handle: string;
  startRect: ManualEditRect;
  startPointer: { x: number; y: number };
}

/**
 * Bridges the window between pointer-up and the upstream rect catching up
 * (optimistic commit / od-edit-targets refresh): the frame keeps showing the
 * gesture outcome instead of flashing back to the stale pre-drag rect.
 * `baseline` is the target rect at drop time — any upstream change to it
 * deactivates the hold automatically.
 */
interface HeldRect {
  id: string;
  rect: ManualEditRect;
  baseline: ManualEditRect;
}

function rectsEqual(a: ManualEditRect, b: ManualEditRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

const ACTION_BAR_HEIGHT = 34;
const CROP_MIN_SIZE = 16;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function guidesSignature(guides: ManualEditAlignmentGuide[]): string {
  return guides
    .map((guide) => `${guide.orientation}:${Math.round(guide.position)}:${Math.round(guide.start)}:${Math.round(guide.end)}`)
    .join('|');
}

/**
 * Host-side selection chrome for manual edit mode: the Manus-style frame
 * around the selected element with an action bar (edit params / duplicate /
 * delete, plus replace & crop for images), side handles that resize width,
 * and a top handle that freely moves the element with live alignment guides.
 *
 * Gesture engine: pointermove only records the latest pointer; one rAF tick
 * per frame computes snap geometry, writes the frame position imperatively
 * (no per-move React render), and posts one preview message. Move gestures
 * preview through `transform: translate(...)` so the iframe never re-layouts
 * mid-drag — the final left/top styles are applied once, on release. All
 * geometry flows through the pure helpers in `edit-mode/gestures.ts`; style
 * persistence goes through the same preview/commit pipeline as the inspector
 * panel, so every gesture is undoable.
 */
export function ManualEditSelectionOverlay({
  target,
  targets,
  scale,
  canvasSize,
  busy = false,
  cropActive = false,
  actionBarHidden = false,
  onGesturePreview,
  onGestureCommit,
  onGestureCancel,
  onGestureActiveChange,
  onOpenInspector,
  onDuplicate,
  onDelete,
  onReplaceImage,
  onCropStart,
  onCropCancel,
  onCropApply,
}: {
  target: ManualEditTarget;
  targets: ManualEditTarget[];
  scale: number;
  canvasSize?: { width: number; height: number };
  busy?: boolean;
  cropActive?: boolean;
  /** One toolbar layer at a time: hides the action bar while the text
   * toolbar owns the selection (an active text range inside the element). */
  actionBarHidden?: boolean;
  onGesturePreview: (partial: ManualEditPreviewStyles) => void;
  onGestureCommit: (partial: Partial<ManualEditStyles>, nextRect: ManualEditRect, gesture: 'move' | 'resize') => void;
  onGestureCancel: (touchedKeys: Array<keyof ManualEditStyles>) => void;
  onGestureActiveChange?: (active: boolean) => void;
  onOpenInspector?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReplaceImage?: (file: File) => void;
  onCropStart?: () => void;
  onCropCancel?: () => void;
  onCropApply?: (region: ManualEditCropRegion) => void;
}) {
  const t = useT();
  const [dragKind, setDragKind] = useState<ManualEditGestureKind | null>(null);
  const [guides, setGuides] = useState<ManualEditAlignmentGuide[]>([]);
  const [cropRect, setCropRect] = useState<ManualEditRect | null>(null);
  const [actionBarWidth, setActionBarWidth] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const heldRectRef = useRef<HeldRect | null>(null);
  const guidesSignatureRef = useRef('');
  const frameRef = useRef<HTMLDivElement | null>(null);
  const actionBarRef = useRef<HTMLDivElement | null>(null);
  const previewFrameRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const effectiveScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  useEffect(() => {
    if (!cropActive) setCropRect(null);
    else setCropRect({ ...target.rect });
    // Re-arm only when crop mode toggles or the selection moves elsewhere —
    // live rect updates during crop should not reset the user's region.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropActive, target.id]);

  useEffect(() => () => {
    if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
  }, []);

  // The bar's button set varies (image targets add replace/crop), so measure
  // it after every render; the equality guard keeps this from looping.
  useLayoutEffect(() => {
    const width = actionBarRef.current?.offsetWidth ?? 0;
    setActionBarWidth((current) => (current === width ? current : width));
  });

  const held = heldRectRef.current;
  const holdActive = !dragRef.current
    && held !== null
    && held.id === target.id
    && rectsEqual(held.baseline, target.rect);
  if (held && !holdActive && !dragRef.current) heldRectRef.current = null;
  const liveRect = dragRef.current ? dragRef.current.rect : holdActive ? held.rect : target.rect;
  const frame = {
    left: liveRect.x * effectiveScale,
    top: liveRect.y * effectiveScale,
    width: liveRect.width * effectiveScale,
    height: liveRect.height * effectiveScale,
  };

  const commitStylesForGesture = (state: DragState): Partial<ManualEditStyles> => {
    if (state.kind === 'move') {
      return manualEditMoveStyles(
        target.styles,
        state.rect.x - state.startRect.x,
        state.rect.y - state.startRect.y,
        state.startRect.width,
      );
    }
    return manualEditResizeStyles(state.kind, target.styles, state.startRect, state.rect);
  };

  // Move previews are pure compositor work (translate) — the expensive
  // left/top layout styles land exactly once, on commit. The drag offset is
  // composed IN FRONT of the element's own transform so authored centering
  // (translate(-50%,-50%)) survives the preview and release never jumps.
  const previewStylesForGesture = (state: DragState): ManualEditPreviewStyles => {
    if (state.kind === 'move') {
      const dx = round1(state.rect.x - state.startRect.x);
      const dy = round1(state.rect.y - state.startRect.y);
      return { transform: manualEditMovePreviewTransform(dx, dy, target.styles.transform) };
    }
    return manualEditResizeStyles(state.kind, target.styles, state.startRect, state.rect);
  };

  const applyFrameGeometry = (rect: ManualEditRect) => {
    const node = frameRef.current;
    if (!node) return;
    node.style.left = `${rect.x * effectiveScale}px`;
    node.style.top = `${rect.y * effectiveScale}px`;
    node.style.width = `${rect.width * effectiveScale}px`;
    node.style.height = `${rect.height * effectiveScale}px`;
  };

  const syncGuides = (next: ManualEditAlignmentGuide[]) => {
    const signature = guidesSignature(next);
    if (signature === guidesSignatureRef.current) return;
    guidesSignatureRef.current = signature;
    setGuides(next);
  };

  const startGesture = (kind: ManualEditGestureKind) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy || cropActive || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const startPointer = { x: event.clientX, y: event.clientY };
    const lastPointer = { x: event.clientX, y: event.clientY };
    const startRect = { ...target.rect };
    const candidates = targets
      .filter((candidate) => candidate.id !== target.id && !candidate.isHidden)
      .filter((candidate) => candidate.rect.width >= 8 && candidate.rect.height >= 8)
      .slice(0, 400)
      .map((candidate) => candidate.rect);
    if (canvasSize && canvasSize.width > 0) {
      candidates.push({
        x: 0,
        y: 0,
        width: canvasSize.width / effectiveScale,
        height: canvasSize.height / effectiveScale,
      });
    }
    dragRef.current = { kind, startRect, rect: startRect, guides: [], moved: false };
    setDragKind(kind);
    onGestureActiveChange?.(true);
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);

    const tick = () => {
      previewFrameRef.current = 0;
      const state = dragRef.current;
      if (!state) return;
      const dx = (lastPointer.x - startPointer.x) / effectiveScale;
      const dy = (lastPointer.y - startPointer.y) / effectiveScale;
      const raw = manualEditGestureRect(kind, startRect, dx, dy);
      const snapped = snapManualEditGestureRect(kind, raw, candidates);
      // Coalesced pointer bursts often resolve to the same snapped rect —
      // skip the frame write and the iframe preview message entirely then,
      // so drag cost tracks actual motion instead of pointer frequency.
      if (state.moved && rectsEqual(snapped.rect, state.rect)) {
        syncGuides(snapped.guides);
        return;
      }
      state.rect = snapped.rect;
      state.guides = snapped.guides;
      state.moved = true;
      applyFrameGeometry(snapped.rect);
      syncGuides(snapped.guides);
      onGesturePreview(previewStylesForGesture(state));
    };
    const schedule = () => {
      if (previewFrameRef.current) return;
      previewFrameRef.current = requestAnimationFrame(tick);
    };

    const finish = (commit: boolean) => {
      node.releasePointerCapture(event.pointerId);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      const state = dragRef.current;
      dragRef.current = null;
      setDragKind(null);
      syncGuides([]);
      onGestureActiveChange?.(false);
      if (previewFrameRef.current) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = 0;
      }
      if (!state || !state.moved) {
        applyFrameGeometry(target.rect);
        return;
      }
      // Hold the frame at the outcome position until the upstream rect
      // catches up (optimistic commit / refresh); cancel snaps straight back.
      applyFrameGeometry(commit ? state.rect : state.startRect);
      heldRectRef.current = commit
        ? { id: target.id, rect: state.rect, baseline: { ...target.rect } }
        : null;
      const partial = commitStylesForGesture(state);
      if (commit) {
        onGestureCommit(partial, state.rect, state.kind === 'move' ? 'move' : 'resize');
      } else {
        onGestureCancel(Object.keys(partial) as Array<keyof ManualEditStyles>);
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      lastPointer.x = moveEvent.clientX;
      lastPointer.y = moveEvent.clientY;
      schedule();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  };

  const startCropGesture = (handle: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropRect) return;
    event.preventDefault();
    event.stopPropagation();
    const start: CropHandleState = {
      handle,
      startRect: { ...cropRect },
      startPointer: { x: event.clientX, y: event.clientY },
    };
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const bounds = target.rect;
    const onMove = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.startPointer.x) / effectiveScale;
      const dy = (moveEvent.clientY - start.startPointer.y) / effectiveScale;
      setCropRect(applyCropHandleDelta(start.startRect, bounds, start.handle, dx, dy));
    };
    const onUp = () => {
      node.releasePointerCapture(event.pointerId);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  };

  const isImage = target.kind === 'image';
  const barTop = Math.max(4, frame.top - ACTION_BAR_HEIGHT - 8);
  const barLeft = manualEditClampedCenter(
    frame.left + frame.width / 2,
    actionBarWidth || 120,
    canvasSize?.width,
    4,
  );

  if (cropActive && isImage && cropRect) {
    const crop = {
      left: cropRect.x * effectiveScale,
      top: cropRect.y * effectiveScale,
      width: cropRect.width * effectiveScale,
      height: cropRect.height * effectiveScale,
    };
    return (
      <div className={styles.layer} data-testid="manual-edit-crop-overlay">
        <div className={styles.cropMask} style={{ left: frame.left, top: frame.top, width: frame.width, height: crop.top - frame.top }} />
        <div className={styles.cropMask} style={{ left: frame.left, top: crop.top + crop.height, width: frame.width, height: Math.max(0, frame.top + frame.height - crop.top - crop.height) }} />
        <div className={styles.cropMask} style={{ left: frame.left, top: crop.top, width: crop.left - frame.left, height: crop.height }} />
        <div className={styles.cropMask} style={{ left: crop.left + crop.width, top: crop.top, width: Math.max(0, frame.left + frame.width - crop.left - crop.width), height: crop.height }} />
        <div
          className={styles.cropWindow}
          style={{ left: crop.left, top: crop.top, width: crop.width, height: crop.height }}
          onPointerDown={startCropGesture('move')}
        >
          {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
            <div
              key={handle}
              className={`${styles.cropHandle} ${styles[`cropHandle-${handle}`] ?? ''}`}
              onPointerDown={startCropGesture(handle)}
            />
          ))}
        </div>
        <div
          className={styles.cropActions}
          style={{
            left: manualEditClampedCenter(crop.left + crop.width / 2, 150, canvasSize?.width, 4),
            top: Math.min((canvasSize?.height ?? Infinity) - 44, crop.top + crop.height + 10),
          }}
        >
          <button
            type="button"
            className={styles.cropButton}
            data-testid="manual-edit-crop-cancel"
            onClick={() => onCropCancel?.()}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.cropButton} ${styles.cropButtonPrimary}`}
            data-testid="manual-edit-crop-apply"
            disabled={busy}
            onClick={() => {
              if (!cropRect || target.rect.width <= 0 || target.rect.height <= 0) return;
              onCropApply?.({
                x: (cropRect.x - target.rect.x) / target.rect.width,
                y: (cropRect.y - target.rect.y) / target.rect.height,
                width: cropRect.width / target.rect.width,
                height: cropRect.height / target.rect.height,
              });
            }}
          >
            {t('manualEdit.applyCrop')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.layer}>
      {guides.map((guide, index) => (
        <div
          key={`${guide.orientation}-${index}`}
          className={guide.orientation === 'vertical' ? styles.guideVertical : styles.guideHorizontal}
          style={
            guide.orientation === 'vertical'
              ? {
                  left: guide.position * effectiveScale,
                  top: guide.start * effectiveScale,
                  height: (guide.end - guide.start) * effectiveScale,
                }
              : {
                  top: guide.position * effectiveScale,
                  left: guide.start * effectiveScale,
                  width: (guide.end - guide.start) * effectiveScale,
                }
          }
        />
      ))}
      <div
        ref={frameRef}
        className={`${styles.frame}${dragKind ? ` ${styles.frameDragging}` : ''}`}
        data-testid="manual-edit-selection-frame"
        style={frame}
      >
        <div
          className={styles.moveHandle}
          data-testid="manual-edit-move-handle"
          title={t('manualEdit.moveElement')}
          onPointerDown={startGesture('move')}
        />
        <div
          className={`${styles.sideHandle} ${styles.sideHandleLeft}`}
          data-testid="manual-edit-resize-left"
          onPointerDown={startGesture('resize-left')}
        />
        <div
          className={`${styles.sideHandle} ${styles.sideHandleRight}`}
          data-testid="manual-edit-resize-right"
          onPointerDown={startGesture('resize-right')}
        />
      </div>
      {!dragKind && !actionBarHidden ? (
        <div
          ref={actionBarRef}
          className={styles.actionBar}
          data-testid="manual-edit-action-bar"
          style={{ left: barLeft, top: barTop }}
        >
          {isImage && onReplaceImage ? (
            <>
              <button
                type="button"
                className={`${styles.actionButton} od-tooltip`}
                data-tooltip={t('manualEdit.replaceImage')}
                data-tooltip-placement="bottom"
                aria-label={t('manualEdit.replaceImage')}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon name="image" size={15} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) onReplaceImage(file);
                }}
              />
            </>
          ) : null}
          {isImage && onCropStart ? (
            <button
              type="button"
              className={`${styles.actionButton} od-tooltip`}
              data-testid="manual-edit-crop-start"
              data-tooltip={t('manualEdit.cropImage')}
              data-tooltip-placement="bottom"
              aria-label={t('manualEdit.cropImage')}
              disabled={busy}
              onClick={onCropStart}
            >
              <Icon name="crop" size={15} />
            </button>
          ) : null}
          {onOpenInspector ? (
            <button
              type="button"
              className={`${styles.actionButton} od-tooltip`}
              data-testid="manual-edit-open-inspector"
              data-tooltip={t('manualEdit.editParams')}
              data-tooltip-placement="bottom"
              aria-label={t('manualEdit.editParams')}
              onClick={onOpenInspector}
            >
              <Icon name="sliders" size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.actionButton} od-tooltip`}
            data-testid="manual-edit-duplicate"
            data-tooltip={manualEditTooltip(t('manualEdit.duplicateElement'), 'duplicate')}
            data-tooltip-placement="bottom"
            aria-label={t('manualEdit.duplicateElement')}
            disabled={busy}
            onClick={onDuplicate}
          >
            <Icon name="copy" size={15} />
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonDanger} od-tooltip`}
            data-testid="manual-edit-delete"
            data-tooltip={manualEditTooltip(t('manualEdit.deleteElement'), 'delete')}
            data-tooltip-placement="bottom"
            aria-label={t('manualEdit.deleteElement')}
            disabled={busy}
            onClick={onDelete}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function applyCropHandleDelta(
  start: ManualEditRect,
  bounds: ManualEditRect,
  handle: string,
  dx: number,
  dy: number,
): ManualEditRect {
  const clampX = (value: number) => Math.min(Math.max(value, bounds.x), bounds.x + bounds.width);
  const clampY = (value: number) => Math.min(Math.max(value, bounds.y), bounds.y + bounds.height);
  if (handle === 'move') {
    const x = Math.min(Math.max(start.x + dx, bounds.x), bounds.x + bounds.width - start.width);
    const y = Math.min(Math.max(start.y + dy, bounds.y), bounds.y + bounds.height - start.height);
    return { ...start, x, y };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clampX(Math.min(start.x + dx, right - CROP_MIN_SIZE));
  if (handle.includes('e')) right = clampX(Math.max(right + dx, left + CROP_MIN_SIZE));
  if (handle.includes('n')) top = clampY(Math.min(start.y + dy, bottom - CROP_MIN_SIZE));
  if (handle.includes('s')) bottom = clampY(Math.max(bottom + dy, top + CROP_MIN_SIZE));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
