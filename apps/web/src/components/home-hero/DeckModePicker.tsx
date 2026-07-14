import { useEffect, useRef, useState } from 'react';
import type { DeckGenerationMode } from '@open-design/contracts';
import { Button } from '@open-design/components';
import { useI18n } from '../../i18n';
import { Icon } from '../Icon';
import styles from './DeckModePicker.module.css';

interface Props {
  value: DeckGenerationMode;
  onChange: (value: DeckGenerationMode) => void;
}

export function DeckModePicker({ value, onChange }: Props) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const descriptions = locale === 'zh-CN'
    ? {
        standard: '生成可编辑 HTML，适合通用演示文稿。',
        image: '整页生图，适合高视觉冲击演示文稿。',
      }
    : locale === 'zh-TW'
      ? {
          standard: '產生可編輯 HTML，適合一般簡報。',
          image: '整頁生圖，適合高視覺衝擊簡報。',
        }
      : {
          standard: 'Editable HTML for versatile, general-purpose decks.',
          image: 'Full-slide images for high-impact visual decks.',
        };

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const label = value === 'image'
    ? t('homeHero.chip.image')
    : t('modelCapability.standard');

  return (
    <div ref={rootRef} className={styles.root} data-testid="home-hero-deck-mode-picker">
      <Button
        variant="subtle"
        className={styles.trigger}
        data-testid="home-hero-deck-mode-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={value === 'image' ? 'image' : 'slides'} size={13} aria-hidden />
        <span>{label}</span>
        <Icon name="chevron-down" size={11} aria-hidden />
      </Button>
      {open ? (
        <div className={styles.menu} role="listbox" aria-label="Slides mode">
          <ModeOption
            value="standard"
            active={value === 'standard'}
            label={t('modelCapability.standard')}
            description={descriptions.standard}
            icon="slides"
            onPick={() => {
              onChange('standard');
              setOpen(false);
            }}
          />
          <ModeOption
            value="image"
            active={value === 'image'}
            label={t('homeHero.chip.image')}
            description={descriptions.image}
            icon="image"
            onPick={() => {
              onChange('image');
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ModeOption({
  value,
  active,
  label,
  description,
  icon,
  onPick,
}: {
  value: DeckGenerationMode;
  active: boolean;
  label: string;
  description: string;
  icon: 'slides' | 'image';
  onPick: () => void;
}) {
  return (
    <Button
      variant="subtle"
      className={styles.option}
      role="option"
      aria-selected={active}
      data-testid={`home-hero-deck-mode-${value}`}
      onClick={onPick}
    >
      <span className={styles.optionIcon} aria-hidden>
        <Icon name={icon} size={15} />
      </span>
      <span className={styles.copy}>
        <strong>{label}</strong>
        <span>{description}</span>
      </span>
      {active ? <Icon name="check" size={14} aria-hidden /> : null}
    </Button>
  );
}
