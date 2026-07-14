import { useEffect, useMemo, useState } from 'react';
import type {
  ImageGenerationConfigResponse,
  ImageGenerationSource,
} from '@open-design/contracts';
import { Button, VisuallyHidden } from '@open-design/components';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import styles from './ImageGenerationSettings.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: ImageGenerationConfigResponse };

export function ImageGenerationSettings() {
  const { locale, t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const copy = locale === 'zh-CN'
    ? {
        title: '图片生成',
        hint: '图片项目与 Slides 图片模式共用这里的生图能力。',
        unavailable: '未配置',
        sourceError: '无法读取图片生成配置。',
      }
    : locale === 'zh-TW'
      ? {
          title: '圖片生成',
          hint: '圖片專案與 Slides 圖片模式共用這裡的生圖能力。',
          unavailable: '未設定',
          sourceError: '無法讀取圖片生成設定。',
        }
      : {
          title: 'Image generation',
          hint: 'Image projects and Slides Image mode share this generation capability.',
          unavailable: 'Not configured',
          sourceError: 'Could not load image generation settings.',
        };

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/media/image-generation')
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<ImageGenerationConfigResponse>;
      })
      .then((value) => {
        if (!cancelled) setState({ status: 'ready', value });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error && error.message ? error.message : copy.sourceError,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [copy.sourceError]);

  const selectedSource = state.status === 'ready'
    ? state.value.selected?.source ?? state.value.preference?.source ?? null
    : null;
  const selectedModel = state.status === 'ready'
    ? state.value.selected?.model ?? state.value.preference?.model ?? ''
    : '';
  const byokSource = state.status === 'ready'
    ? state.value.sources.find((source) => source.id === 'byok')
    : undefined;

  const save = async (source: ImageGenerationSource, model?: string) => {
    if (state.status !== 'ready' || saving) return;
    const sourceState = state.value.sources.find((item) => item.id === source);
    if (!sourceState?.available) return;
    const resolvedModel = model ?? sourceState.models[0]?.id;
    if (!resolvedModel) return;
    setSaving(true);
    try {
      const response = await fetch('/api/media/image-generation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, model: resolvedModel }),
      });
      if (!response.ok) throw new Error(await response.text());
      const value = await response.json() as ImageGenerationConfigResponse;
      setState({ status: 'ready', value });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error && error.message ? error.message : copy.sourceError,
      });
    } finally {
      setSaving(false);
    }
  };

  const sources = useMemo(
    () => state.status === 'ready' ? state.value.sources : [],
    [state],
  );

  return (
    <div className={styles.root} data-testid="image-generation-settings">
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden>
          <Icon name="image" size={15} />
        </span>
        <span>
          <strong>{copy.title}</strong>
          <small>{copy.hint}</small>
        </span>
      </div>

      {state.status === 'loading' ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : null}
      {state.status === 'error' ? (
        <div className={styles.error} role="alert">{copy.sourceError}</div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={styles.sources} role="radiogroup" aria-label={copy.title}>
          {sources.map((source) => {
            const active = selectedSource === source.id;
            return (
              <Button
                key={source.id}
                variant="subtle"
                className={styles.source}
                role="radio"
                aria-checked={active}
                aria-label={source.label}
                disabled={!source.available || saving}
                data-source={source.id}
                onClick={() => void save(source.id)}
              >
                <span className={styles.sourceMain}>
                  <strong>{source.label}</strong>
                  <span className={source.configured ? styles.configured : styles.unavailable}>
                    {source.configured
                      ? t('settings.mediaProviderConfigured')
                      : source.id === 'cloud'
                        ? t('tasks.comingSoon')
                        : copy.unavailable}
                  </span>
                </span>
                {active ? <Icon name="check" size={14} aria-hidden /> : null}
              </Button>
            );
          })}
        </div>
      ) : null}

      {state.status === 'ready' && selectedSource === 'byok' && byokSource && byokSource.models.length > 0 ? (
        <label className={styles.modelSelect}>
          <span>{t('settings.byokImageModel')}</span>
          <select
            value={selectedModel || byokSource.models[0]?.id}
            disabled={saving}
            onChange={(event) => void save('byok', event.target.value)}
          >
            {byokSource.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}{model.provider ? ` · ${model.provider}` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {saving ? <VisuallyHidden role="status">{t('settings.autosaveSaving')}</VisuallyHidden> : null}
    </div>
  );
}
