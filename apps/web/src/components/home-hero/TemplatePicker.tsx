// Composer-footer Template picker — the "template entry point" next to the
// Design system picker. The trigger shows the currently-selected project-type
// template (default "None"); clicking it opens a radial (pie) menu centered
// on the trigger: each template is a wedge on a frosted-glass ring, hovering a
// wedge previews it in the center disc (icon + name), clicking a wedge
// confirms it, and the center disc clears the selection (back to None).
//
// Selection is the existing `activeChipId`: picking a wedge calls `onPick(chip)`
// (the same handler the rail uses) and the trigger's reset calls `onClear()`.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HomeHeroChip } from './chips';
import { Icon } from '../Icon';
import { ScenarioArt } from './ScenarioArt';
import { useT } from '../../i18n';

interface Props {
  // Selectable templates, already ordered (the apply-scenario create chips).
  templates: HomeHeroChip[];
  activeChipId: string | null;
  // Hover-preview from the rail below: when set (and a known template), the
  // trigger previews that template instead of the committed value, so hovering
  // a rail card updates the pill. Cleared on rail-leave → reverts to None.
  previewChipId?: string | null;
  // Disables opening the dropdown (initial plugin load only). The dropdown
  // stays reachable during a pending apply so the user can still clear/switch.
  disabled?: boolean;
  // Disables picking a *new* template while an apply is in flight (mirrors the
  // rail's per-card guard); opening + close remain available.
  pickDisabled?: boolean;
  // Localized label / description for a chip id (reuses HomeHero's chip copy).
  labelFor: (chipId: string) => string;
  descriptionFor: (chipId: string) => string;
  onPick: (chip: HomeHeroChip) => void;
  onClear: () => void;
}

// Radial geometry in viewBox units. The ring is the wedge hit-area between
// R_IN and R_OUT; the center disc (clear button) fills the hole.
const RING = 400;
const R_OUT = 199;
const R_IN = 72;
const CENTER = RING / 2;
const R_ICON = (R_OUT + R_IN) / 2;
// Rendered diameter (see .home-hero__template-radial) — used to clamp the
// anchor so the whole ring stays inside the viewport.
const RADIAL_PX = 240;

function polar(radius: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function wedgePath(index: number, count: number): string {
  const step = 360 / count;
  const a0 = index * step;
  const a1 = a0 + step;
  const [ox0, oy0] = polar(R_OUT, a0);
  const [ox1, oy1] = polar(R_OUT, a1);
  const [ix1, iy1] = polar(R_IN, a1);
  const [ix0, iy0] = polar(R_IN, a0);
  const large = step > 180 ? 1 : 0;
  return [
    `M ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export function TemplatePicker({
  templates,
  activeChipId,
  previewChipId = null,
  disabled = false,
  pickDisabled = false,
  labelFor,
  descriptionFor,
  onPick,
  onClear,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Viewport anchor captured once at open time, clamped so the whole ring
  // stays on screen. The radial is portaled to <body> and position:fixed at
  // these coords instead of tracking the trigger: the composer around the
  // trigger reflows asynchronously (template apply, placeholder animation) and
  // sits inside transformed ancestors that would both drift an anchored menu
  // mid-gesture and degrade fixed positioning.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const radialRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = () => {
    setOpen((v) => {
      if (v) return false;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) {
        const half = RADIAL_PX / 2 + 8;
        setAnchor({
          x: Math.min(Math.max(rect.x + rect.width / 2, half), window.innerWidth - half),
          y: Math.min(Math.max(rect.y + rect.height / 2, half), window.innerHeight - half),
        });
      } else {
        setAnchor(null);
      }
      return true;
    });
  };

  const active = useMemo(
    () => templates.find((chip) => chip.id === activeChipId) ?? null,
    [templates, activeChipId],
  );

  useEffect(() => {
    if (!open) setHoverId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event: MouseEvent) {
      if (wrapRef.current?.contains(event.target as Node)) return;
      if (radialRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Hover-preview wins over the committed value so pointing at a rail card
  // updates the pill; falls back to the committed template, then "None".
  const previewChip = previewChipId
    ? templates.find((chip) => chip.id === previewChipId) ?? null
    : null;
  const shown = previewChip ?? active;
  const isPreviewing = Boolean(previewChip) && previewChip !== active;
  const hasSelection = Boolean(active);
  const valueLabel = shown ? labelFor(shown.id) : t('common.none');

  // Center disc: hovering a wedge previews that template (icon + name, like a
  // radial OS menu); at rest it reads as the close control.
  const hovered = hoverId ? templates.find((chip) => chip.id === hoverId) ?? null : null;
  const wedgeStep = templates.length > 0 ? 360 / templates.length : 360;

  return (
    <div
      ref={wrapRef}
      className={`home-hero__footer-option home-hero__footer-option--select home-hero__template-option${open ? ' is-open' : ''}${hasSelection ? ' has-selection' : ''}`}
      data-field-name="template"
      data-testid="home-hero-template-picker"
    >
      <button
        type="button"
        className="home-hero__footer-select-trigger home-hero__template-trigger"
        data-testid="home-hero-template-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={t('homeHero.templatePicker.label')}
        onClick={toggleOpen}
      >
        {/* With a selection the pill reads as `[template icon] Wireframe`:
            the leading icon IS the selected template's own icon and the gray
            "Template" kicker drops away. At rest it stays `[grid] Template
            None`. */}
        <span
          className="home-hero__footer-option-icon home-hero__footer-option-icon--compact"
          aria-hidden
        >
          <Icon name={shown ? shown.icon : 'grid'} size={14} />
        </span>
        {shown ? null : (
          <span className="home-hero__template-kicker">{t('homeHero.templatePicker.label')}</span>
        )}
        <span
          className={`home-hero__footer-select-label${isPreviewing ? ' is-preview' : ''}`}
        >
          {valueLabel}
        </span>
        <Icon name="chevron-down" size={14} aria-hidden />
      </button>
      {hasSelection ? (
        <button
          type="button"
          className="home-hero__template-reset od-tooltip"
          data-testid="home-hero-template-reset"
          aria-label={t('common.clear')}
          title={t('common.clear')}
          data-tooltip={t('common.clear')}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
            onClear();
          }}
        >
          <Icon name="close" size={14} strokeWidth={2.2} />
        </button>
      ) : null}
      {open ? createPortal(
        <div
          ref={radialRef}
          className="home-hero__template-radial"
          role="listbox"
          aria-label={t('homeHero.templatePicker.label')}
          data-testid="home-hero-template-menu"
          style={anchor ? { left: anchor.x, top: anchor.y } : undefined}
        >
          <svg
            className="home-hero__template-radial-ring"
            viewBox={`0 0 ${RING} ${RING}`}
            aria-hidden={templates.length === 0}
          >
            {templates.map((chip, index) => {
              const isActive = chip.id === activeChipId;
              const isHover = chip.id === hoverId;
              return (
                <path
                  key={chip.id}
                  d={wedgePath(index, templates.length)}
                  className={`home-hero__template-radial-wedge${isActive ? ' is-active' : ''}${isHover ? ' is-hover' : ''}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={pickDisabled || undefined}
                  aria-label={labelFor(chip.id)}
                  data-chip-id={chip.id}
                  data-testid={`home-hero-template-wedge-${chip.id}`}
                  onMouseEnter={() => setHoverId(chip.id)}
                  onMouseLeave={() => setHoverId((v) => (v === chip.id ? null : v))}
                  onClick={() => {
                    if (pickDisabled) return;
                    onPick(chip);
                    setOpen(false);
                  }}
                />
              );
            })}
          </svg>
          {templates.map((chip, index) => {
            const [x, y] = polar(R_ICON, (index + 0.5) * wedgeStep);
            const isActive = chip.id === activeChipId;
            const isHover = chip.id === hoverId;
            return (
              <span
                key={chip.id}
                className={`home-hero__template-radial-icon${isActive ? ' is-active' : ''}${isHover ? ' is-hover' : ''}`}
                style={{ left: `${(x / RING) * 100}%`, top: `${(y / RING) * 100}%` }}
                aria-hidden
              >
                <Icon name={chip.icon} size={15} />
              </span>
            );
          })}
          <button
            type="button"
            className="home-hero__template-radial-center"
            data-testid="home-hero-template-radial-clear"
            aria-label={t('common.clear')}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            {hovered ? (
              <>
                <span className="home-hero__template-radial-center-icon" aria-hidden>
                  <Icon name={hovered.icon} size={20} />
                </span>
                <span className="home-hero__template-radial-center-label">
                  {labelFor(hovered.id)}
                </span>
              </>
            ) : (
              <>
                <span className="home-hero__template-radial-center-icon" aria-hidden>
                  <Icon name="close" size={16} strokeWidth={2} />
                </span>
                <span className="home-hero__template-radial-center-label">
                  {t('common.clear')}
                </span>
              </>
            )}
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
