import type { ChatMessage } from '../types';
import type { RunFailureCategory, RunFailureDetail } from '@open-design/contracts';

export interface RunFailureClassificationFields {
  failureCategory?: RunFailureCategory | null;
  failureDetail?: RunFailureDetail | null;
}

/** Read the daemon failure classification the streaming layer stamped onto a
 *  surfaced run error (see markErrorRunFailure in providers/daemon.ts). Returns
 *  undefined when neither field is present so callers pass nothing through. */
export function runFailureFieldsFromError(
  err: unknown,
): RunFailureClassificationFields | undefined {
  const e = err as {
    failureCategory?: RunFailureCategory | null;
    failureDetail?: RunFailureDetail | null;
  } | null;
  if (!e || (!e.failureCategory && !e.failureDetail)) return undefined;
  return {
    ...(e.failureCategory ? { failureCategory: e.failureCategory } : {}),
    ...(e.failureDetail ? { failureDetail: e.failureDetail } : {}),
  };
}

export function appendErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
  failure?: RunFailureClassificationFields,
): ChatMessage {
  if (!detail) return message;
  const events = message.events ?? [];
  const last = events[events.length - 1];
  if (last?.kind === 'status' && last.label === 'error' && last.detail === detail) {
    return message;
  }
  if (!detail?.trim()) {
    return message;
  }
  return {
    ...message,
    events: [
      ...events,
      {
        kind: 'status',
        label: 'error',
        detail,
        ...(code ? { code } : {}),
        ...(failure?.failureCategory ? { failureCategory: failure.failureCategory } : {}),
        ...(failure?.failureDetail ? { failureDetail: failure.failureDetail } : {}),
      },
    ],
  };
}

export function removeErrorStatusEvent(
  message: ChatMessage,
  detail: string,
  code?: string,
): ChatMessage {
  if (!detail) return message;
  const events = message.events ?? [];
  const nextEvents = events.filter((event) => {
    if (event.kind !== 'status' || event.label !== 'error') return true;
    if (event.detail !== detail) return true;
    if (code !== undefined && event.code !== code) return true;
    return false;
  });
  if (nextEvents.length === events.length) return message;
  return {
    ...message,
    events: nextEvents,
  };
}
