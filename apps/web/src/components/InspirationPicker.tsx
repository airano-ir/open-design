import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-design/components';
import type { DesignSystemSummary, SkillSummary } from '@open-design/contracts';
import { useI18n, useT } from '../i18n';
import { localizeSkillName } from '../i18n/content';
import {
  inspirationEntryForDesignSystem,
  inspirationEntryForTemplate,
  parseInspirationSelection,
  type InspirationSource,
} from '../artifacts/question-form';
import { fetchDesignSystems, fetchDesignTemplates } from '../providers/registry';
import {
  commercialCategoryLabel,
  isCommercialCategoryId,
} from './plugins-home/categoryLabel';
import { setPendingDesignSystemCreateEntry } from '../analytics/ds-create-entry';
import { requestInspirationBrowse } from '../runtime/inspiration-browse-intent';
import { navigate } from '../router';
import { DesignSystemKitPreview } from './DesignSystemKitPreview';
import { Icon } from './Icon';

/**
 * Host-data-driven picker behind the `inspiration` question type: templates
 * by category, design systems with their swatch rows, and the user's own
 * reference images. The model only emits the small question marker — every
 * catalog entry rendered here comes from the local registry endpoints, and
 * the picked references are serialized back through the standard
 * question-form answer channel (see inspirationEntryForTemplate /
 * parseInspirationSelection in artifacts/question-form.ts).
 *
 * Cards embed real previews: template cards iframe the template's own seed
 * (`/api/design-templates/:id/preview`), design-system cards iframe the
 * compact brand card (`/api/design-systems/:id/card`). Both keep the
 * wireframe/swatch fallback underneath for catalogs without a preview.
 */

// One structural reference (template) keeps the grounding signal clean; the
// visual language may blend a primary design system with up to two
// additional inspirations (the daemon's `inspirationDesignSystemIds`
// metadata channel), and a few user images set the mood.
export const INSPIRATION_MAX_TEMPLATES = 1;
export const INSPIRATION_MAX_DESIGN_SYSTEMS = 3;
export const INSPIRATION_MAX_UPLOADS = 3;

const INLINE_GRID_SIZE = 4;
const ALL_SOURCES: readonly InspirationSource[] = [
  'templates',
  'design-systems',
  'upload',
];

// Module-level catalog cache: every inspiration form in the conversation
// shares one fetch per surface instead of refetching on each mount.
let templatesCache: Promise<SkillSummary[]> | null = null;
let designSystemsCache: Promise<DesignSystemSummary[]> | null = null;
// Availability of per-template preview documents, probed lazily with HEAD
// so cards without a seed keep the wireframe instead of a 404 body.
const templatePreviewAvailability = new Map<string, Promise<boolean>>();

function loadTemplates(): Promise<SkillSummary[]> {
  templatesCache ??= fetchDesignTemplates().catch(() => {
    templatesCache = null;
    return [];
  });
  return templatesCache;
}

function loadDesignSystems(): Promise<DesignSystemSummary[]> {
  designSystemsCache ??= fetchDesignSystems().catch(() => {
    designSystemsCache = null;
    return [];
  });
  return designSystemsCache;
}

function templatePreviewUrl(id: string): string {
  return `/api/design-templates/${encodeURIComponent(id)}/preview`;
}

function designSystemCardUrl(id: string): string {
  return `/api/design-systems/${encodeURIComponent(id)}/card`;
}

function probeTemplatePreview(id: string): Promise<boolean> {
  let probe = templatePreviewAvailability.get(id);
  if (!probe) {
    probe = fetch(templatePreviewUrl(id), { method: 'HEAD' })
      .then((res) => res.ok)
      .catch(() => false);
    templatePreviewAvailability.set(id, probe);
  }
  return probe;
}

/** Test-only: drop the module-level catalog cache between cases. */
export function resetInspirationCatalogCacheForTests() {
  templatesCache = null;
  designSystemsCache = null;
  templatePreviewAvailability.clear();
}

function isUserDesignSystem(system: DesignSystemSummary): boolean {
  return system.source === 'user' || system.isEditable === true;
}

// Reference-site shortcuts under the upload dropzone: copy an image on the
// site, come back, paste. Opened through the workspace's built-in Browser
// when a host listens (ProjectView), else a regular new tab.
const INSPIRATION_BROWSE_SITES: ReadonlyArray<{ id: string; label: string; url: string }> = [
  { id: 'dribbble', label: 'Dribbble', url: 'https://dribbble.com/shots/popular' },
  { id: 'mobbin', label: 'Mobbin', url: 'https://mobbin.com/discover/apps/web/latest' },
  { id: 'behance', label: 'Behance', url: 'https://www.behance.net/search/projects?field=ui%2Fux' },
  { id: 'awwwards', label: 'Awwwards', url: 'https://www.awwwards.com/websites/' },
];

export interface InspirationPickerProps {
  formId: string;
  questionId: string;
  /** Sections to offer; absent → all. */
  sources?: InspirationSource[];
  /** Short task summary shown as the picker's context line. */
  query?: string;
  /** Mixed answer entries: template/ds tokens plus uploaded file names. */
  value: string[];
  files: File[];
  disabled: boolean;
  onChange: (value: string[]) => void;
  onFilesChange: (files: File[]) => void;
  /** Form-language-aware translator from the owning QuestionFormView. */
  t: ReturnType<typeof useT>;
  onGalleryOpen?: () => void;
}

/** Scaled live-document thumb shared by template and design-system cards. */
function LiveDocThumb({
  src,
  available,
  fallback,
  className,
}: {
  src: string;
  available: boolean;
  fallback: React.ReactNode;
  className: string;
}) {
  if (!available) {
    return (
      <span className={className} aria-hidden>
        {fallback}
      </span>
    );
  }
  return (
    <span className={`${className} qf-insp-thumb-live`} aria-hidden>
      <iframe
        src={src}
        loading="lazy"
        sandbox="allow-scripts"
        tabIndex={-1}
        scrolling="no"
        title=""
      />
    </span>
  );
}

export function InspirationPicker({
  formId,
  questionId,
  sources,
  query,
  value,
  files,
  disabled,
  onChange,
  onFilesChange,
  t,
  onGalleryOpen,
}: InspirationPickerProps) {
  const { locale } = useI18n();
  const enabled = useMemo(() => {
    const requested = sources && sources.length > 0 ? sources : ALL_SOURCES;
    return ALL_SOURCES.filter((source) => requested.includes(source));
  }, [sources]);
  const [tab, setTab] = useState<InspirationSource>(enabled[0] ?? 'templates');
  const [templates, setTemplates] = useState<SkillSummary[] | null>(null);
  const [designSystems, setDesignSystems] = useState<DesignSystemSummary[] | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [dsSearch, setDsSearch] = useState('');
  const [dsMulti, setDsMulti] = useState(false);
  const [dsPreviewId, setDsPreviewId] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState<Record<string, boolean>>({});
  const [browseTipSite, setBrowseTipSite] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!enabled.includes(tab)) setTab(enabled[0] ?? 'templates');
  }, [enabled, tab]);

  useEffect(() => {
    let alive = true;
    if (enabled.includes('templates')) {
      void loadTemplates().then((list) => {
        if (alive) setTemplates(list);
      });
    }
    if (enabled.includes('design-systems')) {
      void loadDesignSystems().then((list) => {
        if (alive) setDesignSystems(list);
      });
    }
    return () => {
      alive = false;
    };
  }, [enabled]);

  const selection = useMemo(() => parseInspirationSelection(value), [value]);
  // Upload entries in the answer are the non-token file names. In the live
  // form they mirror `files`; in the locked (answered) state File objects are
  // gone, so these names are the only record of what was attached.
  const uploadNames = useMemo(
    () =>
      value.filter((entry) => {
        const parsed = parseInspirationSelection([entry]);
        return parsed.templates.length === 0 && parsed.designSystems.length === 0;
      }),
    [value],
  );
  const selectedTemplateIds = useMemo(
    () => new Set(selection.templates.map((entry) => entry.id)),
    [selection],
  );
  const selectedDesignSystemIds = useMemo(
    () => new Set(selection.designSystems.map((entry) => entry.id)),
    [selection],
  );

  // Visual grounding surfaces only — a design-system template is picked
  // through the design-systems section, and audio has no visual reference
  // value here.
  const visualTemplates = useMemo(
    () =>
      (templates ?? []).filter(
        (skill) => skill.mode !== 'design-system' && skill.mode !== 'audio',
      ),
    [templates],
  );
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of visualTemplates) {
      const id = skill.category?.trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }, [visualTemplates]);
  const filteredTemplates = useMemo(
    () =>
      category === 'all'
        ? visualTemplates
        : visualTemplates.filter((skill) => skill.category === category),
    [category, visualTemplates],
  );
  // Gallery-only text filter over the category-filtered list: localized
  // name, id, and category label all match.
  const tplQuery = templateSearch.trim().toLowerCase();
  const searchedTemplates = useMemo(() => {
    if (tplQuery.length === 0) return filteredTemplates;
    return filteredTemplates.filter((skill) => {
      const name = localizeSkillName(locale, skill).toLowerCase();
      const cat = (skill.category ?? '').toLowerCase();
      return (
        name.includes(tplQuery) ||
        skill.id.toLowerCase().includes(tplQuery) ||
        cat.includes(tplQuery)
      );
    });
  }, [filteredTemplates, tplQuery, locale]);

  // Probe preview availability for the templates currently on screen; the
  // module-level cache makes repeat mounts free.
  useEffect(() => {
    let alive = true;
    for (const skill of visualTemplates) {
      void probeTemplatePreview(skill.id).then((ok) => {
        if (!alive || !ok) return;
        setPreviewReady((prev) => (prev[skill.id] ? prev : { ...prev, [skill.id]: true }));
      });
    }
    return () => {
      alive = false;
    };
  }, [visualTemplates]);

  const uploadUrls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(
    () => () => {
      for (const url of uploadUrls) URL.revokeObjectURL(url);
    },
    [uploadUrls],
  );

  function categoryLabel(id: string): string {
    if (isCommercialCategoryId(id)) return commercialCategoryLabel(id, t);
    return id
      .split('-')
      .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
      .join(' ');
  }

  // Non-token entries in the answer are upload file names; template/ds picks
  // are the bracket-token entries. Clicking a selected card deselects it.
  function entriesWithout(kind: 'template' | 'ds'): string[] {
    return value.filter((entry) => {
      const parsed = parseInspirationSelection([entry]);
      if (kind === 'template') return parsed.templates.length === 0;
      return parsed.designSystems.length === 0;
    });
  }

  function toggleTemplate(skill: SkillSummary) {
    if (disabled) return;
    const rest = entriesWithout('template');
    if (selectedTemplateIds.has(skill.id)) {
      onChange(rest);
      return;
    }
    onChange([...rest, inspirationEntryForTemplate(skill.id, localizeSkillName(locale, skill))]);
  }

  // Single mode replaces the pick; multi mode (gallery "select multiple")
  // accumulates up to the cap — the first pick stays the primary system.
  function toggleDesignSystem(system: DesignSystemSummary, multi = dsMulti) {
    if (disabled) return;
    const rest = entriesWithout('ds');
    if (selectedDesignSystemIds.has(system.id)) {
      const kept = selection.designSystems.filter((entry) => entry.id !== system.id);
      onChange([...rest, ...kept.map((entry) => inspirationEntryForDesignSystem(entry.id, entry.label))]);
      return;
    }
    const current = multi ? selection.designSystems : [];
    if (multi && current.length >= INSPIRATION_MAX_DESIGN_SYSTEMS) return;
    onChange([
      ...rest,
      ...current.map((entry) => inspirationEntryForDesignSystem(entry.id, entry.label)),
      inspirationEntryForDesignSystem(system.id, system.title),
    ]);
  }

  function clearDesignSystems() {
    if (disabled) return;
    onChange(entriesWithout('ds'));
  }

  function removePick(kind: 'template' | 'ds', id: string) {
    if (disabled) return;
    onChange(
      value.filter((entry) => {
        const parsed = parseInspirationSelection([entry]);
        const match = kind === 'template' ? parsed.templates[0] : parsed.designSystems[0];
        return match?.id !== id;
      }),
    );
  }

  function applyFiles(next: File[]) {
    if (disabled) return;
    const capped = next.slice(0, INSPIRATION_MAX_UPLOADS);
    onFilesChange(capped);
    const tokens = value.filter((entry) => {
      const parsed = parseInspirationSelection([entry]);
      return parsed.templates.length > 0 || parsed.designSystems.length > 0;
    });
    onChange([...tokens, ...capped.map((file) => file.name)]);
  }

  function addFiles(added: FileList | File[]) {
    const images = Array.from(added).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return false;
    const merged = [...files];
    for (const file of images) {
      if (merged.some((existing) => existing.name === file.name && existing.size === file.size)) {
        continue;
      }
      merged.push(file);
    }
    applyFiles(merged);
    return true;
  }

  function removeFile(index: number) {
    applyFiles(files.filter((_, i) => i !== index));
  }

  const selectionCount = (source: InspirationSource): number => {
    if (source === 'templates') return selection.templates.length;
    if (source === 'design-systems') return selection.designSystems.length;
    return files.length;
  };

  const tabLabel = (source: InspirationSource): string => {
    if (source === 'templates') return t('qf.inspTabTemplates');
    if (source === 'design-systems') return t('qf.inspTabDesignSystems');
    return t('qf.inspTabUpload');
  };

  const tabIcon = (source: InspirationSource) =>
    source === 'templates' ? 'slides' : source === 'design-systems' ? 'grid' : 'image';

  const inlineTemplates = filteredTemplates.slice(0, INLINE_GRID_SIZE);
  const inlineDesignSystems = (designSystems ?? []).slice(0, INLINE_GRID_SIZE);
  const remainingTemplates = Math.max(0, filteredTemplates.length - inlineTemplates.length);
  const remainingDesignSystems = Math.max(
    0,
    (designSystems ?? []).length - inlineDesignSystems.length,
  );

  function openGallery() {
    setGalleryOpen(true);
    onGalleryOpen?.();
  }

  function createDesignSystem() {
    setPendingDesignSystemCreateEntry('inspiration_picker');
    setGalleryOpen(false);
    navigate({ kind: 'design-system-create' });
  }

  const wireframeThumb = (mode: SkillSummary['mode']) =>
    mode === 'deck' ? (
      <span className="qf-preview-slide qf-preview-slide-hero">
        <span className="qf-preview-kicker" />
        <span className="qf-preview-title" />
        <span className="qf-preview-title qf-preview-title-short" />
        <span className="qf-preview-accent" />
      </span>
    ) : (
      <span className="qf-preview-app">
        <span className="qf-preview-appbar">
          <i />
          <i />
          <i />
        </span>
        <span className="qf-preview-app-body">
          <span className="qf-preview-content">
            <span className="qf-preview-content-head" />
            <span className="qf-preview-content-grid">
              <i />
              <i />
              <i />
            </span>
          </span>
        </span>
      </span>
    );

  const renderTemplateCard = (skill: SkillSummary, source: 'inline' | 'gallery') => {
    const selected = selectedTemplateIds.has(skill.id);
    const name = localizeSkillName(locale, skill);
    return (
      <label
        key={`${source}-${skill.id}`}
        className={`qf-insp-card${selected ? ' qf-insp-card-on' : ''}${disabled ? ' qf-insp-card-disabled' : ''}`}
        title={name}
      >
        <input
          type="checkbox"
          name={`${formId}-${questionId}-template`}
          checked={selected}
          disabled={disabled}
          aria-label={name}
          onChange={() => toggleTemplate(skill)}
        />
        <LiveDocThumb
          src={templatePreviewUrl(skill.id)}
          available={previewReady[skill.id] === true}
          fallback={wireframeThumb(skill.mode)}
          className="qf-insp-thumb"
        />
        {selected ? (
          <span className="qf-insp-card-check" aria-hidden>
            <Icon name="check" size={12} />
          </span>
        ) : null}
        <span className="qf-insp-card-name">{name}</span>
        {skill.category ? (
          <span className="qf-insp-card-meta">{categoryLabel(skill.category)}</span>
        ) : null}
      </label>
    );
  };

  const dsSwatchFallback = (system: DesignSystemSummary) => (
    <span className="qf-dsx-fallback">
      {(system.swatches && system.swatches.length > 0 ? system.swatches : ['transparent'])
        .slice(0, 6)
        .map((swatch, index) => (
          <span key={index} className="qf-card-swatch" style={{ background: swatch }} />
        ))}
    </span>
  );

  const renderDesignSystemCard = (
    system: DesignSystemSummary,
    source: 'inline' | 'gallery',
  ) => {
    const selected = selectedDesignSystemIds.has(system.id);
    return (
      <label
        key={`${source}-${system.id}`}
        className={`qf-insp-card qf-dsx-card${selected ? ' qf-insp-card-on' : ''}${disabled ? ' qf-insp-card-disabled' : ''}`}
        title={system.title}
        onMouseEnter={source === 'gallery' ? () => setDsPreviewId(system.id) : undefined}
      >
        <input
          type="checkbox"
          name={`${formId}-${questionId}-ds`}
          checked={selected}
          disabled={disabled}
          aria-label={system.title}
          onChange={() => toggleDesignSystem(system, source === 'gallery' ? dsMulti : false)}
        />
        <LiveDocThumb
          src={designSystemCardUrl(system.id)}
          available
          fallback={dsSwatchFallback(system)}
          className="qf-insp-thumb qf-dsx-thumb"
        />
        {selected ? (
          <span className="qf-insp-card-check" aria-hidden>
            <Icon name="check" size={12} />
          </span>
        ) : null}
        <span className="qf-insp-card-name">{system.title}</span>
      </label>
    );
  };

  // Selections made in the gallery may not be among the four inline cards,
  // so the picker always lists what is currently picked as removable chips —
  // across all three families — right under the tab bar.
  const renderSelectionChips = () => {
    const uploads: Array<{ name: string; remove?: () => void }> = disabled
      ? uploadNames.map((name) => ({ name }))
      : files.map((file, index) => ({ name: file.name, remove: () => removeFile(index) }));
    const total = selection.templates.length + selection.designSystems.length + uploads.length;
    if (total === 0) return null;
    const chip = (
      key: string,
      icon: Parameters<typeof Icon>[0]['name'],
      label: string,
      onRemove: () => void,
    ) => (
      <span key={key} className="qf-insp-pick" title={label}>
        <Icon name={icon} size={11} />
        <span className="qf-insp-pick-label">{label}</span>
        {!disabled ? (
          <button
            type="button"
            className="qf-insp-pick-remove"
            aria-label={`${t('qf.inspRemove')}: ${label}`}
            title={t('qf.inspRemove')}
            onClick={onRemove}
          >
            <Icon name="close" size={9} />
          </button>
        ) : null}
      </span>
    );
    return (
      <div className="qf-insp-picked" data-testid="inspiration-picked">
        {selection.templates.map((entry) =>
          chip(`tpl-${entry.id}`, 'slides', entry.label, () => removePick('template', entry.id)),
        )}
        {selection.designSystems.map((entry) =>
          chip(`ds-${entry.id}`, 'grid', entry.label, () => removePick('ds', entry.id)),
        )}
        {uploads.map((upload, index) =>
          chip(`img-${upload.name}-${index}`, 'image', upload.name, upload.remove ?? (() => {})),
        )}
      </div>
    );
  };

  const renderCategoryTabs = (idPrefix: string) =>
    categories.length > 0 ? (
      <div className="qf-insp-cats" role="tablist" aria-label={t('qf.inspTabTemplates')}>
        <button
          type="button"
          role="tab"
          aria-selected={category === 'all'}
          className={`qf-chip qf-insp-cat${category === 'all' ? ' qf-chip-on' : ''}`}
          disabled={disabled}
          onClick={() => setCategory('all')}
        >
          <span className="qf-chip-copy">
            <span>{t('qf.inspAll')}</span>
          </span>
        </button>
        {categories.map((id) => (
          <button
            key={`${idPrefix}-${id}`}
            type="button"
            role="tab"
            aria-selected={category === id}
            className={`qf-chip qf-insp-cat${category === id ? ' qf-chip-on' : ''}`}
            disabled={disabled}
            onClick={() => setCategory(id)}
          >
            <span className="qf-chip-copy">
              <span>{categoryLabel(id)}</span>
            </span>
          </button>
        ))}
      </div>
    ) : null;

  const renderUploadSection = () => (
    <div className="qf-insp-upload">
      <button
        type="button"
        className={`qf-insp-dropzone${dragOver ? ' qf-insp-dropzone-over' : ''}`}
        disabled={disabled || files.length >= INSPIRATION_MAX_UPLOADS}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          if (!disabled) addFiles(event.dataTransfer.files);
        }}
      >
        <Icon name="image" size={16} />
        <span className="qf-insp-dropzone-cta">{t('qf.inspUploadCta')}</span>
        <span className="qf-insp-dropzone-limit">
          {t('qf.inspUploadLimit', { max: INSPIRATION_MAX_UPLOADS })}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {files.length > 0 ? (
        <div className="qf-insp-upload-grid">
          {files.map((file, index) => (
            <figure key={`${file.name}-${index}`} className="qf-insp-upload-item">
              <img src={uploadUrls[index]} alt={file.name} />
              {!disabled ? (
                <button
                  type="button"
                  className="qf-insp-upload-remove"
                  aria-label={t('qf.inspRemove')}
                  title={t('qf.inspRemove')}
                  onClick={() => removeFile(index)}
                >
                  <Icon name="close" size={10} />
                </button>
              ) : null}
              <figcaption>{file.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <div className="qf-insp-sources">
        <span className="qf-insp-sources-label">{t('qf.inspSources')}</span>
        {INSPIRATION_BROWSE_SITES.map((site) => (
          <button
            key={site.id}
            type="button"
            className="qf-insp-source"
            disabled={disabled}
            onClick={() => {
              const handled = requestInspirationBrowse({ siteId: site.id, url: site.url });
              if (!handled && typeof window !== 'undefined') {
                window.open(site.url, '_blank', 'noopener');
              }
              setBrowseTipSite(site.label);
            }}
          >
            <span>{site.label}</span>
            <span aria-hidden>↗</span>
          </button>
        ))}
      </div>
      {browseTipSite ? (
        <div className="qf-insp-source-tip" role="status">
          <Icon name="image" size={12} />
          <span>{t('qf.inspSourceTip', { site: browseTipSite })}</span>
        </div>
      ) : null}
    </div>
  );

  const renderCatalogGrid = (
    items: Array<SkillSummary | DesignSystemSummary>,
    kind: 'templates' | 'design-systems',
    source: 'inline' | 'gallery',
    remaining: number,
  ) => {
    const loading = kind === 'templates' ? templates === null : designSystems === null;
    if (loading) {
      return <div className="qf-insp-status">{t('qf.inspLoading')}</div>;
    }
    if (items.length === 0) {
      return <div className="qf-insp-status">{t('qf.inspEmpty')}</div>;
    }
    return (
      <div className={source === 'inline' ? 'qf-insp-grid' : 'qf-insp-grid qf-insp-grid-gallery'}>
        {items.map((item) =>
          kind === 'templates'
            ? renderTemplateCard(item as SkillSummary, source)
            : renderDesignSystemCard(item as DesignSystemSummary, source),
        )}
        {source === 'inline' && remaining > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="qf-insp-more"
            disabled={disabled}
            aria-label={t('qf.inspBrowseAll')}
            title={t('qf.inspBrowseAll')}
            onClick={openGallery}
          >
            +{remaining}
          </Button>
        ) : null}
      </div>
    );
  };

  // --- Design-system gallery (the "+N" dialog) -----------------------------
  const dsQuery = dsSearch.trim().toLowerCase();
  const matchesDsQuery = (system: DesignSystemSummary) =>
    dsQuery.length === 0 || system.title.toLowerCase().includes(dsQuery);
  const userSystems = (designSystems ?? []).filter(
    (system) => isUserDesignSystem(system) && matchesDsQuery(system),
  );
  const includedSystems = (designSystems ?? []).filter(
    (system) => !isUserDesignSystem(system) && matchesDsQuery(system),
  );
  const previewSystem =
    (designSystems ?? []).find((system) => system.id === dsPreviewId)
    ?? (designSystems ?? []).find((system) => selectedDesignSystemIds.has(system.id))
    ?? (designSystems ?? [])[0]
    ?? null;

  const renderDesignSystemGallery = () => (
    <>
      <div className="qf-dsx-toolbar">
        <div className="qf-dsx-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={dsSearch}
            placeholder={t('qf.inspSearchDs')}
            aria-label={t('qf.inspSearchDs')}
            onChange={(event) => setDsSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`qf-dsx-tool${dsMulti ? ' qf-dsx-tool-on' : ''}`}
          aria-pressed={dsMulti}
          onClick={() => setDsMulti((prev) => !prev)}
        >
          <Icon name="check" size={12} />
          <span>{t('qf.inspSelectMultiple')}</span>
        </button>
        <button
          type="button"
          className="qf-dsx-tool"
          disabled={selection.designSystems.length === 0}
          onClick={clearDesignSystems}
        >
          <Icon name="close" size={12} />
          <span>{t('qf.inspClearSelection')}</span>
        </button>
        <span className="qf-dsx-toolbar-spacer" />
        <Button type="button" variant="ghost" onClick={createDesignSystem}>
          {t('qf.inspCreateDs')}
        </Button>
        <Button type="button" variant="primary" onClick={() => setGalleryOpen(false)}>
          {t('tool.done')}
        </Button>
      </div>
      <div className="qf-dsx-body">
        <div className="qf-dsx-list">
          {userSystems.length > 0 ? (
            <>
              <div className="qf-dsx-section">{t('qf.inspYourDs')}</div>
              <div className="qf-dsx-rows">
                {userSystems.map((system) => {
                  const selected = selectedDesignSystemIds.has(system.id);
                  return (
                    <button
                      key={`user-${system.id}`}
                      type="button"
                      className={`qf-dsx-row${selected ? ' qf-dsx-row-on' : ''}`}
                      onClick={() => toggleDesignSystem(system, dsMulti)}
                      onMouseEnter={() => setDsPreviewId(system.id)}
                    >
                      <span className="qf-dsx-row-avatar" aria-hidden>
                        {(system.swatches ?? []).slice(0, 3).map((swatch, index) => (
                          <i key={index} style={{ background: swatch }} />
                        ))}
                      </span>
                      <span className="qf-dsx-row-title">{system.title}</span>
                      {selected ? <Icon name="check" size={13} /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          <div className="qf-dsx-section">{t('qf.inspIncludedDs')}</div>
          {renderCatalogGrid(includedSystems, 'design-systems', 'gallery', 0)}
        </div>
        <div className="qf-dsx-preview">
          {previewSystem ? (
            <DesignSystemKitPreview
              key={previewSystem.id}
              system={previewSystem}
              variant="compact"
              showCover={false}
            />
          ) : null}
        </div>
      </div>
    </>
  );

  // Locked (answered) forms render as a compact read-only record of the
  // picks — the full catalog would be noise once the choice is made, but the
  // user must still see WHAT was chosen (template / systems / images).
  const lockedPickTotal =
    selection.templates.length + selection.designSystems.length + uploadNames.length;
  if (disabled && lockedPickTotal > 0) {
    return (
      <div className="qf-insp qf-insp-summary" data-testid="inspiration-picker">
        {query ? <div className="qf-insp-query">{query}</div> : null}
        {renderSelectionChips()}
      </div>
    );
  }

  return (
    <div
      className="qf-insp"
      data-testid="inspiration-picker"
      onPaste={(event) => {
        if (disabled || !enabled.includes('upload')) return;
        const pasted = Array.from(event.clipboardData?.files ?? []);
        if (pasted.length === 0) return;
        if (addFiles(pasted)) {
          event.preventDefault();
          setTab('upload');
        }
      }}
    >
      {query ? <div className="qf-insp-query">{query}</div> : null}
      {enabled.length > 1 ? (
        <div className="qf-insp-tabs" role="tablist">
          {enabled.map((source) => {
            const active = tab === source;
            const count = selectionCount(source);
            return (
              <button
                key={source}
                type="button"
                role="tab"
                aria-selected={active}
                className={`qf-insp-tab${active ? ' qf-insp-tab-active' : ''}`}
                onClick={() => setTab(source)}
              >
                <Icon name={tabIcon(source)} size={13} />
                <span>{tabLabel(source)}</span>
                {count > 0 ? <span className="qf-insp-tab-count">{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {renderSelectionChips()}
      {tab === 'templates' && enabled.includes('templates') ? (
        <>
          {renderCategoryTabs('inline')}
          {renderCatalogGrid(inlineTemplates, 'templates', 'inline', remainingTemplates)}
        </>
      ) : null}
      {tab === 'design-systems' && enabled.includes('design-systems') ? (
        renderCatalogGrid(inlineDesignSystems, 'design-systems', 'inline', remainingDesignSystems)
      ) : null}
      {tab === 'upload' && enabled.includes('upload') ? renderUploadSection() : null}
      <div className="qf-insp-hint">
        <Icon name="image" size={12} />
        <span>{t('qf.inspUploadHint')}</span>
      </div>
      {galleryOpen
        ? createPortal(
            <Dialog
              className={`qf-visual-dialog${tab === 'design-systems' ? ' qf-dsx-dialog' : ''}`}
              backdropClassName="qf-visual-dialog-backdrop"
              layout="sectioned"
              ariaLabel={t('qf.inspBrowseAll')}
              onClose={() => setGalleryOpen(false)}
              closeOnEscape
            >
              <DialogHeader className="qf-visual-dialog-head">
                <DialogTitle className="qf-visual-dialog-title">
                  {tab === 'design-systems'
                    ? t('qf.inspTabDesignSystems')
                    : t('qf.inspTabTemplates')}
                </DialogTitle>
                <Button
                  type="button"
                  variant="ghost"
                  className="qf-visual-dialog-close"
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  onClick={() => setGalleryOpen(false)}
                >
                  <Icon name="close" size={16} />
                </Button>
              </DialogHeader>
              <DialogBody className="qf-visual-dialog-body">
                {tab === 'design-systems' ? (
                  renderDesignSystemGallery()
                ) : (
                  <>
                    <div className="qf-tplx-head">
                      <div className="qf-dsx-search">
                        <Icon name="search" size={13} />
                        <input
                          type="search"
                          value={templateSearch}
                          placeholder={t('qf.inspSearchTpl')}
                          aria-label={t('qf.inspSearchTpl')}
                          onChange={(event) => setTemplateSearch(event.target.value)}
                        />
                      </div>
                      {renderCategoryTabs('gallery')}
                    </div>
                    {renderCatalogGrid(searchedTemplates, 'templates', 'gallery', 0)}
                  </>
                )}
              </DialogBody>
              {tab === 'design-systems' ? null : (
                <DialogFooter className="qf-visual-dialog-foot">
                  <Button type="button" variant="primary" onClick={() => setGalleryOpen(false)}>
                    {t('tool.done')}
                  </Button>
                </DialogFooter>
              )}
            </Dialog>,
            document.body,
          )
        : null}
    </div>
  );
}
