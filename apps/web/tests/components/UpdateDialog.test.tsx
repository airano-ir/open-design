// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  OpenDesignHostUpdaterOpenDialogListener,
  OpenDesignHostUpdaterStatusListener,
  OpenDesignHostUpdaterStatusSnapshot,
} from '@open-design/host';
import { installMockOpenDesignHost } from '@open-design/host/testing';

import { UpdateDialog } from '../../src/components/UpdateDialog';
import { I18nProvider } from '../../src/i18n';

function idleStatus(overrides: Partial<OpenDesignHostUpdaterStatusSnapshot> = {}): OpenDesignHostUpdaterStatusSnapshot {
  return {
    arch: 'arm64',
    capabilities: {
      canApplyInPlace: true,
      canDownload: true,
      canOpenInstaller: false,
      requiresManualInstall: false,
    },
    channel: 'beta',
    currentVersion: '1.2.3',
    enabled: true,
    mode: 'js-incremental',
    platform: 'darwin',
    state: 'idle',
    supported: true,
    ...overrides,
  };
}

function payloadReadyStatus(overrides: Partial<OpenDesignHostUpdaterStatusSnapshot> = {}): OpenDesignHostUpdaterStatusSnapshot {
  return idleStatus({
    artifact: {
      name: 'open-design-1.2.4-payload.zip',
      platformKey: 'mac',
      type: 'payload',
      url: 'https://example.test/open-design-1.2.4-payload.zip',
    },
    availableVersion: '1.2.4',
    downloadPath: '/tmp/open-design-1.2.4-payload.zip',
    state: 'downloaded',
    ...overrides,
  });
}

describe('UpdateDialog', () => {
  let restoreHost: (() => void) | null = null;

  afterEach(() => {
    cleanup();
    restoreHost?.();
    restoreHost = null;
  });

  it('updates silently in the background and opens ready state only after the native menu request', async () => {
    let statusListener: OpenDesignHostUpdaterStatusListener | null = null;
    let openDialogListener: OpenDesignHostUpdaterOpenDialogListener | null = null;
    const ready = payloadReadyStatus();
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          status: vi.fn(async () => idleStatus()),
          subscribe: vi.fn((listener) => {
            statusListener = listener;
            return vi.fn();
          }),
          subscribeOpenDialog: vi.fn((listener) => {
            openDialogListener = listener;
            return vi.fn();
          }),
        },
      },
    });

    render(<I18nProvider initial="en"><UpdateDialog /></I18nProvider>);
    await act(async () => {
      statusListener?.(ready);
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      openDialogListener?.({ source: 'mac-app-menu' });
      await Promise.resolve();
    });
    expect(await screen.findByRole('dialog', { name: 'Check for updates' })).toBeTruthy();
    expect(screen.getByText('Open Design 1.2.4 is ready. Open Design will close and restart automatically.')).toBeTruthy();
  });

  it('starts an explicit auto-downloading check when opened from an idle menu state', async () => {
    let openDialogListener: OpenDesignHostUpdaterOpenDialogListener | null = null;
    const check = vi.fn(async () => idleStatus({ state: 'not-available' }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          check,
          status: vi.fn(async () => idleStatus()),
          subscribeOpenDialog: vi.fn((listener) => {
            openDialogListener = listener;
            return vi.fn();
          }),
        },
      },
    });

    render(<I18nProvider initial="en"><UpdateDialog /></I18nProvider>);
    await act(async () => {
      openDialogListener?.({ source: 'mac-app-menu' });
      await Promise.resolve();
    });

    await waitFor(() => expect(check).toHaveBeenCalledWith({
      payload: { autoDownload: true, source: 'mac-app-menu' },
    }));
    expect(await screen.findByText("You're already on the latest version.")).toBeTruthy();
  });

  it('defaults to Later when tasks are active and requires an explicit Restart anyway override', async () => {
    let openDialogListener: OpenDesignHostUpdaterOpenDialogListener | null = null;
    const ready = payloadReadyStatus();
    const blocked = payloadReadyStatus({
      error: {
        code: 'active-runs-blocked',
        details: { activeRunCount: 2 },
        message: 'tasks are active',
      },
    });
    const installed = payloadReadyStatus({
      installResult: {
        openedAt: '2026-07-16T12:00:00.000Z',
        path: '/tmp/open-design-1.2.4-payload.zip',
      },
      state: 'installing',
    });
    const install = vi.fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(installed);
    const quit = vi.fn(async () => ({ ok: true as const }));
    restoreHost = installMockOpenDesignHost({
      host: {
        updater: {
          install,
          quit,
          status: vi.fn(async () => ready),
          subscribeOpenDialog: vi.fn((listener) => {
            openDialogListener = listener;
            return vi.fn();
          }),
        },
      },
    });

    render(<I18nProvider initial="en"><UpdateDialog /></I18nProvider>);
    await act(async () => {
      openDialogListener?.({ source: 'mac-app-menu' });
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));

    expect(await screen.findByText('Open Design is still working')).toBeTruthy();
    expect(screen.getByText('2 active tasks are still running. Restarting now will interrupt them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Restart anyway' }));
    await waitFor(() => expect(install).toHaveBeenLastCalledWith({
      payload: { force: true, source: 'mac-app-menu' },
    }));
    await waitFor(() => expect(quit).toHaveBeenCalledWith({
      payload: { force: true, source: 'mac-app-menu' },
    }));
  });
});
