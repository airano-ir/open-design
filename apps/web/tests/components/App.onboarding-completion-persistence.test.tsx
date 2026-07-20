// @vitest-environment jsdom
//
// Acceptance #11 — "the onboarding page shows up on every login (it used to
// show once)". Two halves, both regressions of the same invariant:
//
//   1. Onboarding completion is a one-way ratchet. The boot merge folds the
//      daemon's `/api/app-config` copy over the local one; a daemon copy that
//      predates the completion (async PUT still in flight, or one that failed)
//      must not roll it back. The merged config is written straight back to
//      BOTH stores, so a single rollback is self-reinforcing — the user meets
//      onboarding on every launch from then on.
//   2. First-run routing is a boot decision. The bootstrap effect became
//      route-dependent on the workspace-team branch (`workspaceProjectView` is
//      derived from the route), so it re-runs — and re-decides the first-run
//      redirect — on ordinary navigation.

import { cleanup, act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App';
import type { AppConfig } from '../../src/types';
import { loadConfig, fetchDaemonConfig, syncConfigToDaemon } from '../../src/state/config';
import {
  daemonIsLive,
  fetchAgentsStream,
  fetchAppVersionInfo,
  fetchDesignSystems,
  fetchPromptTemplates,
  fetchSkills,
} from '../../src/providers/registry';
import { fetchAmrModels } from '../../src/providers/daemon';
import { listProjects, listTemplates } from '../../src/state/projects';

type TestRoute = Record<string, unknown>;

const routerState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    current: { kind: 'home', view: 'home' } as TestRoute,
    listeners,
    set(route: TestRoute) {
      routerState.current = route;
      listeners.forEach((listen) => listen());
    },
  };
});

vi.mock('../../src/router', async () => {
  const React = await import('react');
  return {
    navigate: vi.fn((route: TestRoute) => routerState.set(route)),
    goBack: vi.fn(),
    useRoute: () => {
      const [, force] = React.useReducer((count: number) => count + 1, 0);
      React.useEffect(() => {
        routerState.listeners.add(force);
        return () => {
          routerState.listeners.delete(force);
        };
      }, [force]);
      return routerState.current;
    },
  };
});

vi.mock('../../src/components/EntryView', () => ({
  EntryView: ({ config }: { config: AppConfig }) => (
    <div data-testid="onboarding-completed">{String(config.onboardingCompleted)}</div>
  ),
}));

vi.mock('../../src/components/ProjectView', () => ({
  ProjectView: () => <div>Project view</div>,
}));

vi.mock('../../src/components/pet/PetOverlay', () => ({
  PetOverlay: () => null,
}));

vi.mock('../../src/components/pet/pets', () => ({
  migrateCustomPetAtlas: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/components/SettingsDialog', () => ({
  SettingsDialog: () => null,
}));

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    daemonIsLive: vi.fn(),
    fetchAgentsStream: vi.fn(),
    fetchAppVersionInfo: vi.fn(),
    fetchDesignSystems: vi.fn(),
    fetchPromptTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

vi.mock('../../src/providers/daemon', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/daemon')>(
    '../../src/providers/daemon',
  );
  return {
    ...actual,
    fetchAmrModels: vi.fn(),
  };
});

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    listProjects: vi.fn(),
    listTemplates: vi.fn(),
  };
});

vi.mock('../../src/state/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/config')>(
    '../../src/state/config',
  );
  return {
    ...actual,
    fetchComposioConfigFromDaemon: vi.fn().mockResolvedValue(null),
    loadConfig: vi.fn(),
    // Real merge: the ratchet under test lives inside it.
    saveConfig: vi.fn(),
    fetchDaemonConfig: vi.fn(),
    fetchMediaProvidersFromDaemon: vi.fn().mockResolvedValue({
      status: 'ok',
      providers: null,
    }),
    syncComposioConfigToDaemon: vi.fn().mockResolvedValue(true),
    syncConfigToDaemon: vi.fn().mockResolvedValue(undefined),
    syncMediaProvidersToDaemon: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedDaemonIsLive = vi.mocked(daemonIsLive);
const mockedFetchAgentsStream = vi.mocked(fetchAgentsStream);
const mockedFetchAppVersionInfo = vi.mocked(fetchAppVersionInfo);
const mockedFetchDesignSystems = vi.mocked(fetchDesignSystems);
const mockedFetchPromptTemplates = vi.mocked(fetchPromptTemplates);
const mockedFetchSkills = vi.mocked(fetchSkills);
const mockedFetchAmrModels = vi.mocked(fetchAmrModels);
const mockedListProjects = vi.mocked(listProjects);
const mockedListTemplates = vi.mocked(listTemplates);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedFetchDaemonConfig = vi.mocked(fetchDaemonConfig);
const mockedSyncConfigToDaemon = vi.mocked(syncConfigToDaemon);

function returningUserConfig(): AppConfig {
  return {
    mode: 'daemon',
    apiKey: '',
    apiProtocol: 'anthropic',
    apiVersion: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    apiProviderBaseUrl: 'https://api.anthropic.com',
    apiProtocolConfigs: {},
    agentId: 'amr',
    skillId: null,
    designSystemId: null,
    // The user already finished the first-run flow on this install.
    onboardingCompleted: true,
    mediaProviders: {},
    composio: {},
    agentModels: {},
    agentCliEnv: {},
  } as AppConfig;
}

async function navigatedToOnboarding(): Promise<boolean> {
  const { navigate } = await import('../../src/router');
  return vi
    .mocked(navigate)
    .mock.calls.some(
      ([route]) =>
        (route as { kind?: string; view?: string } | undefined)?.kind === 'home' &&
        (route as { kind?: string; view?: string } | undefined)?.view === 'onboarding',
    );
}

describe('App onboarding completion persistence', () => {
  beforeEach(() => {
    routerState.current = { kind: 'home', view: 'home' };
    mockedDaemonIsLive.mockResolvedValue(true);
    mockedFetchAgentsStream.mockResolvedValue([]);
    mockedFetchSkills.mockResolvedValue([]);
    mockedFetchDesignSystems.mockResolvedValue([]);
    mockedFetchPromptTemplates.mockResolvedValue([]);
    mockedFetchAppVersionInfo.mockResolvedValue(null);
    mockedListProjects.mockResolvedValue([]);
    mockedListTemplates.mockResolvedValue([]);
    mockedFetchAmrModels.mockResolvedValue({
      source: 'preset',
      refreshing: false,
      models: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps a completed user out of onboarding when the daemon copy still says false', async () => {
    mockedLoadConfig.mockReturnValue(returningUserConfig());
    // The completion PUT never reached the daemon last session (offline /
    // crash / a write that lost the race), so its copy still reads false.
    mockedFetchDaemonConfig.mockResolvedValue({ onboardingCompleted: false });

    render(<App />);

    await waitFor(() => {
      expect(mockedSyncConfigToDaemon).toHaveBeenCalled();
    });

    expect(await navigatedToOnboarding()).toBe(false);
    expect(screen.getByTestId('onboarding-completed').textContent).toBe('true');
    // And the rollback must not be written back — persisting it is what makes
    // the symptom recur on every subsequent launch.
    const wroteRollback = mockedSyncConfigToDaemon.mock.calls.some(
      ([cfg]) => (cfg as AppConfig | undefined)?.onboardingCompleted === false,
    );
    expect(wroteRollback).toBe(false);
  });

  it('resolves first-run onboarding routing once per boot, not on every navigation', async () => {
    mockedLoadConfig.mockReturnValue(returningUserConfig());
    mockedFetchDaemonConfig.mockResolvedValue({ onboardingCompleted: true });

    render(<App />);

    await waitFor(() => {
      expect(mockedFetchDaemonConfig).toHaveBeenCalledTimes(1);
    });

    // Opening a project switches the workspace project-list view, which the
    // bootstrap effect now depends on. Boot work — including the first-run
    // redirect decision — must not replay because the user navigated.
    act(() => {
      routerState.set({
        kind: 'project',
        projectId: 'project-1',
        conversationId: null,
        fileName: null,
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockedFetchDaemonConfig).toHaveBeenCalledTimes(1);
    expect(await navigatedToOnboarding()).toBe(false);
  });
});
