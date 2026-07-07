import { describe, expect, it } from 'vitest';
import type { Dict } from '../../src/i18n/types';
import {
  amrLoginFailureForOutcome,
  amrLoginFailureForSpawn,
  amrLoginReasonText,
} from '../../src/runtime/amr-login-failure';

// Identity translator: returns the i18n key so we can assert the mapping
// without pulling in the full locale dictionaries.
const t = (key: keyof Dict) => key as string;

describe('amrLoginReasonText', () => {
  it('maps each failure code to a specific reason key', () => {
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_BINARY_MISSING', recovery: 'reinstall' })).toBe(
      'settings.amrLoginReasonBinaryMissing',
    );
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_SPAWN_FAILED', recovery: 'retry' })).toBe(
      'settings.amrLoginReasonSpawnFailed',
    );
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_NETWORK', recovery: 'retry' })).toBe(
      'settings.amrLoginReasonNetwork',
    );
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_PROXY_BLOCKED', recovery: 'retry' })).toBe(
      'settings.amrLoginReasonProxyBlocked',
    );
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_TIMEOUT', recovery: 'reauth' })).toBe(
      'settings.amrLoginReasonTimeout',
    );
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_INTERRUPTED', recovery: 'reauth' })).toBe(
      'settings.amrLoginReasonInterrupted',
    );
  });

  it('reuses existing copy for browser-open-failed and unknown', () => {
    expect(
      amrLoginReasonText(t, { code: 'AMR_LOGIN_BROWSER_OPEN_FAILED', recovery: 'manual-link' }),
    ).toBe('settings.amrActivationBrowserFailed');
    expect(amrLoginReasonText(t, { code: 'AMR_LOGIN_UNKNOWN', recovery: 'retry' })).toBe(
      'settings.amrLoginErrorCompact',
    );
  });

  it('falls back to the generic compact string when no failure is present', () => {
    expect(amrLoginReasonText(t, null)).toBe('settings.amrLoginErrorCompact');
    expect(amrLoginReasonText(t, undefined)).toBe('settings.amrLoginErrorCompact');
  });
});

describe('amrLoginFailureForSpawn', () => {
  it('prefers the daemon-classified failure', () => {
    expect(
      amrLoginFailureForSpawn({
        ok: false,
        status: 500,
        failure: { code: 'AMR_LOGIN_PROXY_BLOCKED', recovery: 'retry' },
      }),
    ).toMatchObject({ code: 'AMR_LOGIN_PROXY_BLOCKED' });
  });

  it('falls back to unknown but keeps the raw error as detail', () => {
    expect(
      amrLoginFailureForSpawn({ ok: false, status: 500, error: 'weird thing' }),
    ).toEqual({ code: 'AMR_LOGIN_UNKNOWN', recovery: 'retry', detail: 'weird thing' });
  });
});

describe('amrLoginFailureForOutcome', () => {
  it('maps a timeout regardless of status', () => {
    expect(amrLoginFailureForOutcome('timed-out', null)).toMatchObject({
      code: 'AMR_LOGIN_TIMEOUT',
    });
  });

  it('prefers the daemon exit reason for a stopped login', () => {
    expect(
      amrLoginFailureForOutcome('stopped', {
        loggedIn: false,
        profile: 'default',
        user: null,
        configPath: '',
        lastLoginFailure: { code: 'AMR_LOGIN_NETWORK', recovery: 'retry' },
      }),
    ).toMatchObject({ code: 'AMR_LOGIN_NETWORK' });
  });

  it('falls back to interrupted when the daemon gave no reason', () => {
    expect(
      amrLoginFailureForOutcome('stopped', {
        loggedIn: false,
        profile: 'default',
        user: null,
        configPath: '',
      }),
    ).toMatchObject({ code: 'AMR_LOGIN_INTERRUPTED' });
  });
});
