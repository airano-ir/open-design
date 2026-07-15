import { Button } from '@open-design/components';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../i18n';
import type { AgentEvent, ChatMessage } from '../types';
import { Icon } from './Icon';
import styles from './ConversationUsage.module.css';

type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;

export interface ConversationUsageSummary {
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  hasInputTokens: boolean;
  hasOutputTokens: boolean;
  hasCost: boolean;
  hasDuration: boolean;
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function latestUsage(message: ChatMessage): UsageEvent | undefined {
  const events = message.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === 'usage') return event;
  }
  return undefined;
}

function messageDurationMs(
  message: ChatMessage,
  usage: UsageEvent | undefined,
  now: number,
): number | null {
  const reported = finiteNonNegative(usage?.durationMs);
  const startedAt = finiteNonNegative(message.startedAt);
  const endedAt = finiteNonNegative(message.endedAt);

  if (startedAt !== null && endedAt !== null && endedAt >= startedAt) {
    return reported ?? endedAt - startedAt;
  }

  const stillRunning =
    message.runStatus === 'queued' ||
    message.runStatus === 'running' ||
    (!message.runStatus && startedAt !== null && endedAt === null);
  if (stillRunning && startedAt !== null && now >= startedAt) {
    return Math.max(reported ?? 0, now - startedAt);
  }

  return reported;
}

export function summarizeConversationUsage(
  messages: ChatMessage[],
  now = Date.now(),
): ConversationUsageSummary {
  const summary: ConversationUsageSummary = {
    rounds: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
    hasInputTokens: false,
    hasOutputTokens: false,
    hasCost: false,
    hasDuration: false,
  };

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    summary.rounds += 1;

    const usage = latestUsage(message);
    const inputTokens = finiteNonNegative(usage?.inputTokens);
    const outputTokens = finiteNonNegative(usage?.outputTokens);
    const costUsd = finiteNonNegative(usage?.costUsd);
    const durationMs = messageDurationMs(message, usage, now);

    if (inputTokens !== null) {
      summary.inputTokens += inputTokens;
      summary.hasInputTokens = true;
    }
    if (outputTokens !== null) {
      summary.outputTokens += outputTokens;
      summary.hasOutputTokens = true;
    }
    if (costUsd !== null) {
      summary.costUsd += costUsd;
      summary.hasCost = true;
    }
    if (durationMs !== null) {
      summary.durationMs += durationMs;
      summary.hasDuration = true;
    }
  }

  summary.totalTokens = summary.inputTokens + summary.outputTokens;
  return summary;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, '0')}m`;
}

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  onOpen?: () => void;
}

export function ConversationUsage({ messages, streaming, onOpen }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streaming) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const usage = useMemo(
    () => summarizeConversationUsage(messages, now),
    [messages, now],
  );
  const hasTokens = usage.hasInputTokens || usage.hasOutputTokens;

  return (
    <div className={styles.root} ref={rootRef}>
      <Button
        variant="ghost"
        size="icon"
        className={`chat-project-action-button ${styles.trigger}`}
        data-testid="conversation-usage-trigger"
        title={t('chat.usage.title')}
        aria-label={t('chat.usage.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            if (next) onOpen?.();
            return next;
          });
        }}
      >
        <Icon name="kanban" size={18} strokeWidth={1.75} />
      </Button>

      {open ? (
        <section
          className={styles.popover}
          role="dialog"
          aria-label={t('chat.usage.title')}
          data-testid="conversation-usage-popover"
        >
          <h2 className={styles.title}>{t('chat.usage.title')}</h2>

          <dl className={styles.summary}>
            <div className={styles.summaryRow}>
              <dt>
                <Icon name="sparkles" size={17} />
                <span>{t('chat.usage.tokensUsed')}</span>
              </dt>
              <dd>{hasTokens ? formatCount(usage.totalTokens) : '—'}</dd>
            </div>
            <div className={styles.summaryRow}>
              <dt>
                <Icon name="history" size={17} />
                <span>{t('chat.usage.timeWorked')}</span>
              </dt>
              <dd>{usage.hasDuration ? formatDuration(usage.durationMs) : '—'}</dd>
            </div>
          </dl>

          <dl className={styles.metricGrid}>
            <div className={styles.metric}>
              <dt>{t('chat.usage.inputTokens')}</dt>
              <dd>{usage.hasInputTokens ? formatCount(usage.inputTokens) : '—'}</dd>
            </div>
            <div className={styles.metric}>
              <dt>{t('chat.usage.outputTokens')}</dt>
              <dd>{usage.hasOutputTokens ? formatCount(usage.outputTokens) : '—'}</dd>
            </div>
            <div className={styles.metric}>
              <dt>{t('chat.usage.cost')}</dt>
              <dd>{usage.hasCost ? `$${usage.costUsd.toFixed(4)}` : '—'}</dd>
            </div>
            <div className={styles.metric}>
              <dt>{t('chat.usage.rounds')}</dt>
              <dd>{formatCount(usage.rounds)}</dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
