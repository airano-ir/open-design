import type { TemplateCard } from '../artifacts/question-form';
import { Icon } from './Icon';
import styles from './TemplateCardsQuestion.module.css';

interface Props {
  cards: readonly TemplateCard[];
  formId: string;
  questionId: string;
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

export function TemplateCardsQuestion({
  cards,
  formId,
  questionId,
  selected,
  disabled,
  onSelect,
}: Props) {
  return (
    <div className={styles.grid}>
      {cards.map((card) => {
        const active = selected === card.id || selected === card.label;
        return (
          <label
            key={`${card.source}:${card.id}`}
            className={`${styles.card}${active ? ` ${styles.active}` : ''}${disabled ? ` ${styles.disabled}` : ''}`}
          >
            <input
              className={styles.input}
              type="radio"
              name={`${formId}-${questionId}`}
              value={card.id}
              checked={active}
              disabled={disabled}
              aria-label={card.label}
              onChange={() => onSelect(card.id)}
            />
            <TemplatePreview card={card} />
            <span className={styles.copy}>
              <span className={styles.titleRow}>
                <strong>{card.label}</strong>
                {active ? (
                  <span className={styles.check} aria-hidden>
                    <Icon name="check" size={11} />
                  </span>
                ) : null}
              </span>
              {card.reason || card.description ? (
                <span className={styles.description}>{card.reason ?? card.description}</span>
              ) : null}
              {card.category || card.mode ? (
                <span className={styles.meta}>
                  {[card.category, card.mode].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function TemplatePreview({ card }: { card: TemplateCard }) {
  const preview = card.preview;
  if (preview.kind === 'image' && preview.url) {
    return <img className={styles.preview} src={preview.url} alt="" loading="lazy" />;
  }
  if (preview.kind === 'video' && preview.url) {
    return (
      <video
        className={styles.preview}
        src={preview.url}
        poster={preview.posterUrl}
        muted
        loop
        playsInline
        preload="metadata"
      />
    );
  }
  if (preview.kind === 'html' && preview.url) {
    return (
      <iframe
        className={styles.preview}
        src={preview.url}
        title={card.label}
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
      />
    );
  }
  return (
    <span className={`${styles.preview} ${styles.fallback}`} aria-hidden>
      <span>
        <Icon name="image" size={22} />
      </span>
    </span>
  );
}
