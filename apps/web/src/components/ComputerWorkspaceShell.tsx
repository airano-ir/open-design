import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '@open-design/components';

import { Icon } from './Icon';
import styles from './ComputerWorkspaceShell.module.css';

interface Props {
  open: boolean;
  focused: boolean;
  title: string;
  detail?: string | null;
  expandLabel: string;
  restoreLabel: string;
  closeLabel: string;
  onToggleFocus: () => void;
  onClose: () => void;
  children: ReactNode;
}

const COMPUTER_WORKSPACE_EXIT_MS = 140;
const COMPUTER_WORKSPACE_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)';
const COMPUTER_HEADER_ICON_SIZE = 18;

interface FrameLayout {
  focused: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

function reducedMotionRequested(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function frameLayout(frame: HTMLElement, focused: boolean): FrameLayout {
  const rect = frame.getBoundingClientRect();
  return {
    focused,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function containsCompositedPreview(frame: HTMLElement): boolean {
  // Scaling a mounted preview layer can leave Chromium/Electron with black
  // compositor tiles after the modal transition. Keep those previews mounted,
  // but let the backdrop carry the transition instead of transforming them.
  return Boolean(frame.querySelector('iframe, video, canvas, webview'));
}

function refreshDocumentPaint(): void {
  // Electron can retain damaged tiles when a live preview moves between a
  // fixed dialog and the split grid. A synchronous, pre-paint reflow clears
  // those tiles without exposing a hidden frame or remounting any preview.
  const previousDisplay = document.body.style.display;
  document.body.style.display = 'none';
  void document.body.offsetHeight;
  document.body.style.display = previousDisplay;
}

function animateFrameLayout(
  frame: HTMLElement,
  previous: FrameLayout,
  current: FrameLayout,
): Animation | null {
  if (
    typeof frame.animate !== 'function'
    || previous.width <= 0
    || previous.height <= 0
    || current.width <= 0
    || current.height <= 0
  ) {
    return null;
  }
  const deltaX = previous.left - current.left;
  const deltaY = previous.top - current.top;
  const scaleX = previous.width / current.width;
  const scaleY = previous.height / current.height;
  return frame.animate(
    [
      {
        opacity: 0.94,
        borderRadius: previous.focused ? '16px' : '0px',
        transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
        transformOrigin: 'top left',
      },
      {
        opacity: 1,
        borderRadius: current.focused ? '16px' : '0px',
        transform: 'translate(0, 0) scale(1, 1)',
        transformOrigin: 'top left',
      },
    ],
    {
      duration: current.focused ? 240 : 200,
      easing: COMPUTER_WORKSPACE_EASING,
      fill: 'both',
    },
  );
}

/**
 * Computer stays mounted while moving between its right-hand workspace and a
 * centered modal. That preserves live previews and in-progress editing state
 * instead of rebuilding the active workspace when the user expands it.
 */
export function ComputerWorkspaceShell({
  open,
  focused,
  title,
  detail,
  expandLabel,
  restoreLabel,
  closeLabel,
  onToggleFocus,
  onClose,
  children,
}: Props) {
  const titleId = useId();
  const shellRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const focusToggleRef = useRef<HTMLButtonElement | null>(null);
  const previousFrameLayoutRef = useRef<FrameLayout | null>(null);
  const frameAnimationRef = useRef<Animation | null>(null);
  const previousOpenRef = useRef(open);
  const [exitPresent, setExitPresent] = useState(open);
  const [focusPresent, setFocusPresent] = useState(focused);
  const [opening, setOpening] = useState(false);
  const present = open || exitPresent;
  const backdropPresent = focused || focusPresent;

  useEffect(() => {
    if (open) {
      setExitPresent(true);
      return undefined;
    }
    if (!exitPresent) return undefined;
    if (shellRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (reducedMotionRequested()) {
      setExitPresent(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setExitPresent(false), COMPUTER_WORKSPACE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exitPresent, open]);

  useEffect(() => {
    const openingNow = open && !previousOpenRef.current;
    previousOpenRef.current = open;
    if (!openingNow || reducedMotionRequested()) {
      if (!open) setOpening(false);
      return undefined;
    }
    setOpening(true);
    const timer = window.setTimeout(() => setOpening(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (focused) {
      setFocusPresent(true);
      return undefined;
    }
    if (!focusPresent) return undefined;
    if (reducedMotionRequested()) {
      setFocusPresent(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setFocusPresent(false), COMPUTER_WORKSPACE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [focusPresent, focused]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !present) {
      frameAnimationRef.current?.cancel();
      frameAnimationRef.current = null;
      previousFrameLayoutRef.current = null;
      return;
    }

    const current = frameLayout(frame, focused);
    const previous = previousFrameLayoutRef.current;
    const movingBetweenLayouts = (
      open
      && previous
      && previous.focused !== current.focused
      && !reducedMotionRequested()
    );
    if (movingBetweenLayouts && containsCompositedPreview(frame)) {
      frameAnimationRef.current?.cancel();
      frameAnimationRef.current = null;
      refreshDocumentPaint();
    } else if (movingBetweenLayouts) {
      frameAnimationRef.current?.cancel();
      const animation = animateFrameLayout(frame, previous, current);
      frameAnimationRef.current = animation;
      if (animation) {
        animation.onfinish = () => {
          if (frameAnimationRef.current !== animation) return;
          frameAnimationRef.current = null;
          animation.cancel();
        };
      }
    }
    previousFrameLayoutRef.current = current;
  }, [focused, open, present]);

  useEffect(() => () => frameAnimationRef.current?.cancel(), []);

  useEffect(() => {
    if (!focused) return undefined;

    focusToggleRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onToggleFocus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focused, onToggleFocus]);

  return (
    <section
      ref={shellRef}
      className={styles.shell}
      data-testid="computer-workspace-shell"
      data-focused={focused ? 'true' : 'false'}
      data-focus-present={backdropPresent ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      data-opening={opening ? 'true' : 'false'}
      aria-hidden={open ? undefined : true}
      hidden={!present}
    >
      {backdropPresent ? (
        <button
          type="button"
          className={`${styles.backdrop} modal-backdrop`}
          data-testid="computer-workspace-backdrop"
          data-state={focused ? 'open' : 'closing'}
          aria-hidden
          tabIndex={-1}
          onClick={focused ? onToggleFocus : undefined}
        />
      ) : null}
      <div
        ref={frameRef}
        className={styles.frame}
        role={focused ? 'dialog' : 'region'}
        aria-modal={focused ? 'true' : undefined}
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <span className={styles.iconBadge} aria-hidden>
            <Icon name="present" size={COMPUTER_HEADER_ICON_SIZE} />
          </span>
          <span className={styles.identity}>
            <strong id={titleId}>{title}</strong>
            {detail ? <span title={detail}>{detail}</span> : null}
          </span>
          <span className={styles.actions}>
            <Button
              ref={focusToggleRef}
              variant="ghost"
              size="icon"
              className={styles.action}
              data-testid="computer-workspace-focus-toggle"
              aria-pressed={focused}
              aria-label={focused ? restoreLabel : expandLabel}
              title={focused ? restoreLabel : expandLabel}
              onClick={onToggleFocus}
            >
              <Icon
                name={focused ? 'minimize' : 'maximize'}
                size={COMPUTER_HEADER_ICON_SIZE}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={styles.action}
              data-testid="computer-workspace-close"
              aria-label={closeLabel}
              title={closeLabel}
              onClick={onClose}
            >
              <Icon name="close" size={COMPUTER_HEADER_ICON_SIZE} />
            </Button>
          </span>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </section>
  );
}
