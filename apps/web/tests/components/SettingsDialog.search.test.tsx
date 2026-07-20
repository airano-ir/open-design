// @vitest-environment jsdom
//
// Acceptance #33 — "the settings search box can't be clicked / does nothing".
//
// The input itself was never broken: it is focusable, typeable, and correctly
// drives the `hidden` attribute (covered below so a regression there is caught).
// What made it *read* as dead is that matching ran against the eight nav labels
// only, so every realistic query — people type the control they want to change,
// not the section that owns it — hid the whole rail and left a blank sidebar
// with no explanation.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../../src/components/SettingsDialog';
import { DEFAULT_CONFIG } from '../../src/state/config';
import type { AgentInfo, AppConfig } from '../../src/types';

const AGENTS: AgentInfo[] = [{ id: 'codex', name: 'Codex', bin: 'codex', available: true }];

function renderSettingsPage(initial: Partial<AppConfig> = {}) {
  return render(
    <SettingsDialog
      presentation="page"
      initial={{ ...DEFAULT_CONFIG, ...initial }}
      agents={AGENTS}
      daemonLive
      appVersionInfo={null}
      initialSection="general"
      onPersist={vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
    />,
  );
}

const searchInput = () => screen.getByPlaceholderText('Search settings...') as HTMLInputElement;

const navByLabel = (label: string) =>
  screen
    .getAllByRole('button', { hidden: true })
    .find((el) => el.querySelector('strong')?.textContent === label);

const isHidden = (label: string) => navByLabel(label)?.hasAttribute('hidden') ?? true;

describe('SettingsDialog settings-nav search', () => {
  afterEach(cleanup);

  it('renders an interactive search box that accepts focus and keystrokes', () => {
    renderSettingsPage();
    const input = searchInput();

    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);

    fireEvent.click(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'mem' } });
    expect(input.value).toBe('mem');
    expect(document.activeElement).toBe(input);
  });

  it('filters the nav down to sections whose own label matches', () => {
    renderSettingsPage();
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(false);

    fireEvent.change(searchInput(), { target: { value: 'memory' } });

    expect(isHidden('Memory')).toBe(false);
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(true);
  });

  it('finds the section that owns a control, not just sections named after it', () => {
    renderSettingsPage();

    // "Language" is a control inside General, never a nav label. Before the
    // fix this hid all eight entries.
    fireEvent.change(searchInput(), { target: { value: 'language' } });
    expect(isHidden('General')).toBe(false);

    // Same shape for a control that lives under Execution mode.
    fireEvent.change(searchInput(), { target: { value: 'api key' } });
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(false);
  });

  it('explains an empty result instead of silently blanking the rail', () => {
    renderSettingsPage();

    fireEvent.change(searchInput(), { target: { value: 'zzzznotasetting' } });

    expect(screen.getByTestId('settings-nav-search-empty').textContent).toContain(
      'zzzznotasetting',
    );
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(true);
  });

  it('restores the full nav when the query is cleared', () => {
    renderSettingsPage();
    const input = searchInput();

    fireEvent.change(input, { target: { value: 'memory' } });
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(true);

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('settings-nav-execution').hasAttribute('hidden')).toBe(false);
    expect(screen.queryByTestId('settings-nav-search-empty')).toBeNull();
  });
});
