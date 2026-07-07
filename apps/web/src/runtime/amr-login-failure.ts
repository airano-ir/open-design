// Frontend mapping for a classified AMR (vela) sign-in failure (issue #426).
// The daemon emits a stable `AmrLoginFailure` code (see @open-design/contracts);
// here we map that code to a localized reason string and derive a failure from
// the frontend-observed paths (spawn error / poll timeout / poll stopped) so
// every sign-in surface shows a specific reason instead of a generic
// "Sign-in failed."

import type {
  AmrLoginFailure,
  AmrLoginFailureCode,
} from '@open-design/contracts';
import type { Dict } from '../i18n/types';
import type { StartVelaLoginResult, VelaLoginStatus } from '../providers/daemon';

type TranslateFn = (
  key: keyof Dict,
  vars?: Record<string, string | number>,
) => string;

// One i18n key per failure code. BROWSER_OPEN_FAILED reuses the existing
// activation copy; UNKNOWN reuses the generic compact string so an
// unclassifiable failure still reads sensibly.
const REASON_KEY: Record<AmrLoginFailureCode, keyof Dict> = {
  AMR_LOGIN_BINARY_MISSING: 'settings.amrLoginReasonBinaryMissing',
  AMR_LOGIN_SPAWN_FAILED: 'settings.amrLoginReasonSpawnFailed',
  AMR_LOGIN_NETWORK: 'settings.amrLoginReasonNetwork',
  AMR_LOGIN_PROXY_BLOCKED: 'settings.amrLoginReasonProxyBlocked',
  AMR_LOGIN_TIMEOUT: 'settings.amrLoginReasonTimeout',
  AMR_LOGIN_INTERRUPTED: 'settings.amrLoginReasonInterrupted',
  AMR_LOGIN_BROWSER_OPEN_FAILED: 'settings.amrActivationBrowserFailed',
  AMR_LOGIN_UNKNOWN: 'settings.amrLoginErrorCompact',
};

// Localized reason line for a failure. Falls back to the generic compact
// string when no failure is available.
export function amrLoginReasonText(
  t: TranslateFn,
  failure: AmrLoginFailure | null | undefined,
): string {
  if (!failure) return t('settings.amrLoginErrorCompact');
  return t(REASON_KEY[failure.code] ?? 'settings.amrLoginErrorCompact');
}

// Derive a failure from a `/login` spawn result: prefer the daemon's classified
// failure, else fall back to unknown while preserving the raw error as detail.
export function amrLoginFailureForSpawn(
  result: StartVelaLoginResult,
): AmrLoginFailure {
  if (result.failure) return result.failure;
  return {
    code: 'AMR_LOGIN_UNKNOWN',
    recovery: 'retry',
    ...(result.error ? { detail: result.error } : {}),
  };
}

// Derive a failure from a terminal poll outcome. A timeout is frontend-owned;
// a "stopped" login prefers the daemon's classified exit reason (network,
// proxy, …) and falls back to interrupted.
export function amrLoginFailureForOutcome(
  outcome: 'stopped' | 'timed-out',
  status: VelaLoginStatus | null | undefined,
): AmrLoginFailure {
  if (outcome === 'timed-out') {
    return { code: 'AMR_LOGIN_TIMEOUT', recovery: 'reauth' };
  }
  return (
    status?.lastLoginFailure ?? { code: 'AMR_LOGIN_INTERRUPTED', recovery: 'reauth' }
  );
}
