import { useState, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon';
import styles from './UserActionCard.module.css';

export type UserActionCardTone = 'neutral' | 'danger' | 'warning' | 'brand';

interface UserActionCardProps {
  icon: IconName;
  title: ReactNode;
  actions?: ReactNode;
  details?: ReactNode;
  detailsLabel?: ReactNode;
  status?: ReactNode;
  tone?: UserActionCardTone;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  dataKind?: string;
  dataOdCard?: string;
  testId?: string;
}

/**
 * Shared shell for chat responses that need the user to decide or recover.
 * The default view stays intentionally small: one concrete problem and its
 * primary action. Explanations, diagnostics, and secondary choices live in a
 * disclosure so chat history remains scannable.
 */
export function UserActionCard({
  icon,
  title,
  actions,
  details,
  detailsLabel,
  status,
  tone = 'neutral',
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  dataKind,
  dataOdCard,
  testId,
}: UserActionCardProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const hasDetails = details != null;

  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      className={`${styles.card}${className ? ` ${className}` : ''}`}
      data-user-action-card={dataKind ?? 'true'}
      data-od-card={dataOdCard}
      data-testid={testId}
      data-tone={tone}
    >
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <div className={styles.title}>{title}</div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>

      {hasDetails ? (
        <>
          <button
            type="button"
            className={styles.detailsToggle}
            aria-expanded={isOpen}
            onClick={() => setOpen(!isOpen)}
          >
            <Icon
              name="chevron-down"
              size={14}
              className={`${styles.chevron}${isOpen ? ` ${styles.chevronOpen}` : ''}`}
            />
            <span>{detailsLabel}</span>
          </button>
          <div className={`accordion-collapsible${isOpen ? ' open' : ''}`}>
            <div
              className="accordion-collapsible-inner"
              aria-hidden={!isOpen}
              inert={!isOpen ? true : undefined}
            >
              <div className={styles.details}>{details}</div>
            </div>
          </div>
        </>
      ) : null}

      {status ? <div className={styles.status}>{status}</div> : null}
    </section>
  );
}
