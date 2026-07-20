import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, VisuallyHidden } from '@open-design/components';
import type { BrandSummary } from '@open-design/contracts';

import type { DesignSystemGenerateSnapshot } from './DesignSystemFlow';
import { BrandPreviewCard } from './BrandPreviewCard';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { cancelBrandExtraction, fetchBrandsOrThrow } from '../runtime/brands';
import { BRAND_ARTIFACT_TILES } from '../runtime/design-kit';
import { useBrandExtract } from '../runtime/useBrandExtract';
import { projectRawUrl } from '../providers/registry';
import styles from './OnboardingBrandAhaFlow.module.css';

const BRAND_POLL_INTERVAL_MS = 2_000;
const BRAND_MISSING_POLL_LIMIT = 6;
const ONBOARDING_BRAND_ATTEMPT_KEY = 'od:onboarding-brand-attempt:v1';

interface PendingOnboardingBrandAttempt {
  brandId: string;
  projectId: string;
  url: string;
}

export interface OnboardingBrandAhaFlowProps {
  onBack: () => void;
  onSkip: () => Promise<void> | void;
  onGenerate: (snapshot: DesignSystemGenerateSnapshot) => void;
  onOpenProject: (projectId: string) => Promise<boolean> | boolean;
  onComplete: (
    projectId: string,
    fileName: string,
    snapshot: DesignSystemGenerateSnapshot,
  ) => Promise<boolean> | boolean;
}

function normalizeWebsiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function websiteSnapshot(): DesignSystemGenerateSnapshot {
  return {
    sourceCount: 1,
    hasBrandDescription: false,
    hasDesignMd: false,
    sourceUrlCount: 1,
    githubRepoCount: 0,
    localFolderCount: 0,
    figFileCount: 0,
    assetFileCount: 0,
  };
}

function readPendingAttempt(): PendingOnboardingBrandAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_BRAND_ATTEMPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingOnboardingBrandAttempt>;
    if (
      typeof value.brandId !== 'string'
      || typeof value.projectId !== 'string'
      || typeof value.url !== 'string'
    ) {
      window.sessionStorage.removeItem(ONBOARDING_BRAND_ATTEMPT_KEY);
      return null;
    }
    return {
      brandId: value.brandId,
      projectId: value.projectId,
      url: value.url,
    };
  } catch {
    return null;
  }
}

function persistPendingAttempt(attempt: PendingOnboardingBrandAttempt): void {
  try {
    window.sessionStorage.setItem(ONBOARDING_BRAND_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Session storage is best-effort; the live component still owns the attempt.
  }
}

function clearPendingAttempt(): void {
  try {
    window.sessionStorage.removeItem(ONBOARDING_BRAND_ATTEMPT_KEY);
  } catch {
    // Session storage unavailable — there is no persisted attempt to clear.
  }
}

export function hasPendingOnboardingBrandAhaAttempt(): boolean {
  return readPendingAttempt() !== null;
}

function readyBrand(summary: BrandSummary | null): summary is BrandSummary & {
  brand: NonNullable<BrandSummary['brand']>;
} {
  return Boolean(
    summary?.meta.status === 'ready'
      && summary.meta.designSystemId
      && summary.meta.projectId
      && summary.brand,
  );
}

export function OnboardingBrandAhaFlow({
  onBack,
  onSkip,
  onGenerate,
  onOpenProject,
  onComplete,
}: OnboardingBrandAhaFlowProps) {
  const t = useT();
  const brandExtract = useBrandExtract();
  const [restoredAttempt] = useState(readPendingAttempt);
  const [url, setUrl] = useState(restoredAttempt?.url ?? '');
  const [brandId, setBrandId] = useState<string | null>(restoredAttempt?.brandId ?? null);
  const [projectId, setProjectId] = useState<string | null>(restoredAttempt?.projectId ?? null);
  const [summary, setSummary] = useState<BrandSummary | null>(null);
  const [snapshot, setSnapshot] = useState<DesignSystemGenerateSnapshot | null>(
    restoredAttempt ? websiteSnapshot() : null,
  );
  const [selectedArtifact, setSelectedArtifact] = useState('landing');
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const readyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!brandId) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let missingPolls = 0;

    const poll = async (): Promise<void> => {
      let brands: BrandSummary[];
      try {
        brands = await fetchBrandsOrThrow();
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => void poll(), BRAND_POLL_INTERVAL_MS);
        }
        return;
      }
      if (cancelled) return;
      const next = brands.find((candidate) => candidate.meta.id === brandId) ?? null;
      if (next) {
        missingPolls = 0;
        setSummary(next);
      } else {
        missingPolls += 1;
        if (missingPolls >= BRAND_MISSING_POLL_LIMIT) {
          clearPendingAttempt();
          setBrandId(null);
          setProjectId(null);
          setSummary(null);
          setSnapshot(null);
          setError(t('project.missing'));
          return;
        }
      }
      // A failed extraction can be retried from its backing project, so keep
      // watching for the same brand id to transition back through extracting
      // to ready instead of freezing this onboarding surface on stale failure.
      if (readyBrand(next)) return;
      timer = window.setTimeout(() => void poll(), BRAND_POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [brandId, t]);

  const availableArtifacts = useMemo(() => {
    const systemFiles = summary?.meta.systemFiles;
    if (!Array.isArray(systemFiles) || systemFiles.length === 0) {
      return BRAND_ARTIFACT_TILES;
    }
    const available = new Set(systemFiles);
    const filtered = BRAND_ARTIFACT_TILES.filter((artifact) => (
      available.has(artifact.file)
      || available.has(artifact.file.replace(/^system\//, ''))
    ));
    return filtered.length > 0 ? filtered : BRAND_ARTIFACT_TILES;
  }, [summary?.meta.systemFiles]);

  useEffect(() => {
    if (availableArtifacts.some((artifact) => artifact.kind === selectedArtifact)) return;
    setSelectedArtifact(availableArtifacts[0]?.kind ?? 'landing');
  }, [availableArtifacts, selectedArtifact]);

  const selected =
    availableArtifacts.find((artifact) => artifact.kind === selectedArtifact)
    ?? availableArtifacts[0]
    ?? null;
  const isReady = readyBrand(summary);
  const activeProjectId = summary?.meta.projectId ?? projectId;
  const needsInput = summary?.meta.status === 'needs_input' || summary?.meta.blocked === true;
  const failed = summary?.meta.status === 'failed';
  const extracting = Boolean(brandId) && !isReady && !failed;

  useEffect(() => {
    if (!isReady) return;
    readyRef.current?.focus({ preventScroll: true });
  }, [isReady]);

  async function startExtraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeWebsiteUrl(url);
    if (!normalized) {
      setError(t('newBrand.subtitle'));
      return;
    }
    const nextSnapshot = websiteSnapshot();
    setError(null);
    setSummary(null);
    setSnapshot(nextSnapshot);
    onGenerate(nextSnapshot);
    try {
      const result = await brandExtract.run(normalized, { throwOnError: true });
      if (!result) return;
      persistPendingAttempt({
        brandId: result.id,
        projectId: result.projectId,
        url: normalized,
      });
      setUrl(normalized);
      setBrandId(result.id);
      setProjectId(result.projectId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('brand.failed'));
    }
  }

  async function restart() {
    if (restarting) return;
    setRestarting(true);
    setError(null);
    try {
      if (brandId && extracting) {
        const outcome = await cancelBrandExtraction(brandId);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
      }
      clearPendingAttempt();
      brandExtract.reset();
      setBrandId(null);
      setProjectId(null);
      setSummary(null);
      setSnapshot(null);
      setSelectedArtifact('landing');
    } finally {
      setRestarting(false);
    }
  }

  async function openRecoveryProject() {
    if (!activeProjectId) return;
    setError(null);
    const opened = await onOpenProject(activeProjectId);
    if (!opened) setError(t('project.missing'));
  }

  async function skip() {
    clearPendingAttempt();
    await onSkip();
  }

  async function finish() {
    if (!isReady || !selected || !snapshot || finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const opened = await onComplete(summary.meta.projectId!, selected.file, snapshot);
      if (!opened) {
        setError(t('project.missing'));
      } else {
        clearPendingAttempt();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('project.missing'));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <section className={styles.flow} data-testid="onboarding-brand-aha-flow">
      <header className={styles.header}>
        <span className={styles.badge}>
          <Icon name="sparkles" size={13} aria-hidden />
          {t('settings.onboardingDesignTitle')}
        </span>
        <h2>{t('onboarding.buildTitle')}</h2>
        <p>{t('onboarding.buildBody')}</p>
      </header>

      {!brandId ? (
        <form className={styles.sourceForm} onSubmit={(event) => void startExtraction(event)}>
          <label className={styles.sourceField}>
            <span>{t('newBrand.urlLabel')}</span>
            <div className={styles.sourceControl}>
              <Icon name="globe" size={16} aria-hidden />
              <input
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder={t('newBrand.urlPlaceholder')}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={brandExtract.state.phase === 'starting'}
              />
            </div>
          </label>
          {error || brandExtract.state.error ? (
            <p className={styles.error} role="alert">
              {error ?? brandExtract.state.error}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={onBack}>
              {t('settings.onboardingBack')}
            </Button>
            <Button variant="ghost" onClick={() => void skip()}>
              {t('onboarding.buildHome')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={brandExtract.state.phase === 'starting'}
              aria-busy={brandExtract.state.phase === 'starting' ? true : undefined}
            >
              {t('dsCreate.generate')}
            </Button>
          </div>
        </form>
      ) : null}

      {extracting ? (
        <div
          className={`${styles.extracting}${needsInput ? ` ${styles.paused}` : ''}`}
          aria-live="polite"
        >
          <div className={styles.extractingVisual} aria-hidden>
            <span className={styles.scanLine} />
            <div className={styles.skeletonMark} />
            <div className={styles.skeletonLines}>
              <span />
              <span />
              <span />
            </div>
            <div className={styles.skeletonSwatches}>
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className={styles.extractingCopy}>
            <span className={styles.statusLine} role="status">
              <Icon name="refresh" size={14} aria-hidden />
              {needsInput ? t('brand.needsInput') : t('brand.extracting')}
            </span>
            <p>
              {needsInput
                ? t('brand.needsInputHint')
                : t('newBrand.stage1')}
            </p>
            {activeProjectId ? (
              <Button
                variant={needsInput ? 'primary' : 'ghost'}
                onClick={() => void openRecoveryProject()}
              >
                {t('brandDetail.openProject')}
              </Button>
            ) : null}
            <Button
              variant="primary-ghost"
              onClick={() => void restart()}
              disabled={restarting}
              aria-busy={restarting ? true : undefined}
            >
              <Icon name="refresh" size={14} aria-hidden />
              {t('promptTemplates.retry')}
            </Button>
            <Button variant="ghost" onClick={() => void skip()}>
              {t('onboarding.buildHome')}
            </Button>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className={styles.failure} role="alert">
          <strong>{t('brand.failed')}</strong>
          {summary?.meta.error ? <p>{summary.meta.error}</p> : null}
          <div className={styles.failureActions}>
            <Button variant="ghost" onClick={() => void skip()}>
              {t('onboarding.buildHome')}
            </Button>
            {activeProjectId ? (
              <Button variant="ghost" onClick={() => void openRecoveryProject()}>
                {t('brandDetail.openProject')}
              </Button>
            ) : null}
            <Button
              variant="primary-ghost"
              onClick={() => void restart()}
              disabled={restarting}
              aria-busy={restarting ? true : undefined}
            >
              <Icon name="refresh" size={14} aria-hidden />
              {t('dsCreate.generate')}
            </Button>
          </div>
        </div>
      ) : null}

      {isReady && selected ? (
        <div
          ref={readyRef}
          className={styles.ready}
          data-testid="onboarding-brand-ready"
          tabIndex={-1}
        >
          <VisuallyHidden role="status" aria-live="polite">
            {t('newBrand.done')}
          </VisuallyHidden>
          <div className={styles.brandSummary}>
            <BrandPreviewCard summary={summary} variant="compact" />
          </div>
          <div className={styles.artifactPane}>
            <div className={styles.artifactHeader}>
              <span className={styles.readyDot} aria-hidden />
              <strong>{t('brandDetail.designSystem')}</strong>
            </div>
            <div
              className={styles.artifactChoices}
              role="group"
              aria-label={t('onboarding.buildPreviewLabel')}
            >
              {availableArtifacts.map((artifact) => (
                <Button
                  key={artifact.kind}
                  variant={artifact.kind === selected.kind ? 'primary' : 'ghost'}
                  aria-pressed={artifact.kind === selected.kind}
                  onClick={() => setSelectedArtifact(artifact.kind)}
                >
                  {t(artifact.labelKey)}
                </Button>
              ))}
            </div>
            <div className={styles.previewFrame}>
              <iframe
                key={selected.file}
                data-testid="onboarding-brand-artifact-preview"
                title={`${summary.brand.name} — ${t(selected.labelKey)}`}
                src={projectRawUrl(summary.meta.projectId!, selected.file)}
                sandbox="allow-scripts"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <div className={styles.readyActions}>
            <Button
              variant="ghost"
              onClick={() => void restart()}
              disabled={finishing || restarting}
            >
              {t('settings.onboardingBack')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void finish()}
              disabled={finishing}
              aria-busy={finishing ? true : undefined}
            >
              {t('settings.onboardingFinish')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
