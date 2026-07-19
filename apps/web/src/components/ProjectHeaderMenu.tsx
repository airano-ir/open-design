import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@open-design/components';
import { useT } from '../i18n';
import { Icon } from './Icon';
import styles from './ProjectHeaderMenu.module.css';

interface ProjectHeaderMenuProps {
  projectName: string;
  /** Persist a new project name. Called only when the value actually changed. */
  onRename: (newName: string) => void;
  /** Duplicate the project. Omit to hide the entry. */
  onDuplicate?: () => void;
  /** Disables the Duplicate entry while a duplicate is already in flight. */
  duplicateBusy?: boolean;
  /** Delete the project. Omit to hide the entry. */
  onDelete?: () => void;
}

const MENU_WIDTH = 208;
const VIEWPORT_MARGIN = 12;

/**
 * The chevron dropdown that sits next to the editable project title in the
 * project view header. Mirrors the Rename / Duplicate / Delete actions the
 * projects list already exposes (DesignsTab + RecentProjectsStrip), reusing
 * the same `designs.*` strings and the shared rename / confirm dialogs so the
 * three surfaces stay in lockstep.
 *
 * The popover is positioned `fixed` against the trigger's bounding box because
 * the header title row clips overflow (`.chat-project-title-line` /
 * `.chat-project-header-title`), which would otherwise shear the menu.
 */
export function ProjectHeaderMenu({
  projectName,
  onRename,
  onDuplicate,
  duplicateBusy,
  onDelete,
}: ProjectHeaderMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(projectName);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameTitleId = useId();
  const confirmTitleId = useId();

  // Anchor the fixed popover under the trigger when it opens, clamping to the
  // viewport so a title near the right edge doesn't push the menu off-screen.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.min(
      rect.left,
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
    setPos({ top: rect.bottom + 6, left: Math.max(VIEWPORT_MARGIN, left) });
  }, [open]);

  // Dismiss on outside pointer, Escape, or any scroll/resize that would drift
  // the fixed popover away from its anchor.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const openRename = useCallback(() => {
    setRenameValue(projectName);
    setRenameOpen(true);
    setOpen(false);
  }, [projectName]);

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== projectName) onRename(trimmed);
    setRenameOpen(false);
  }, [renameValue, projectName, onRename]);

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={t('designs.menuMore')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="project-header-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="chevron-down" size={14} />
      </button>
      {open && pos ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          data-testid="project-header-menu"
          style={{ top: pos.top, left: pos.left }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={openRename}
          >
            <Icon name="pencil" size={14} />
            <span>{t('designs.menuRename')}</span>
          </button>
          {onDuplicate ? (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={duplicateBusy}
              onClick={() => {
                setOpen(false);
                onDuplicate();
              }}
            >
              <Icon name="copy" size={14} />
              <span>{t('designs.menuDuplicate')}</span>
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              className={`${styles.item} ${styles.danger}`}
              onClick={() => {
                setOpen(false);
                setConfirmOpen(true);
              }}
            >
              <Icon name="trash" size={14} />
              <span>{t('designs.menuDelete')}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {renameOpen ? (
        <Dialog
          as="form"
          className="modal-rename"
          onClose={() => setRenameOpen(false)}
          closeOnEscape
          ariaLabelledBy={renameTitleId}
          onSubmit={(e) => {
            e.preventDefault();
            commitRename();
          }}
        >
          <DialogTitle id={renameTitleId}>{t('designs.renameTitle')}</DialogTitle>
          <label>
            {t('designs.renamePrompt', { name: projectName })}
            <input
              type="text"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </label>
          <DialogFooter className="row">
            <button type="button" onClick={() => setRenameOpen(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!renameValue.trim() || renameValue.trim() === projectName}
            >
              {t('designs.renameSave')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {confirmOpen ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmOpen(false)}
          ariaLabelledBy={confirmTitleId}
        >
          <DialogTitle id={confirmTitleId}>{t('designs.deleteTitle')}</DialogTitle>
          <DialogDescription className="modal-confirm-message">
            {t('designs.deleteConfirm', { name: projectName })}
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmOpen(false)}>
              {t('designs.renameCancel')}
            </button>
            <button
              type="button"
              className="primary danger"
              autoFocus
              onClick={() => {
                setConfirmOpen(false);
                onDelete?.();
              }}
            >
              {t('designs.menuDelete')}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}
    </div>
  );
}
