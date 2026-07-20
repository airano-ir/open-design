// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandSummary } from '@open-design/contracts';

import {
  hasPendingOnboardingBrandAhaAttempt,
  OnboardingBrandAhaFlow,
} from '../../src/components/OnboardingBrandAhaFlow';
import { I18nProvider } from '../../src/i18n';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const readyBrand: BrandSummary = {
  meta: {
    id: 'brand-acme',
    sourceUrl: 'https://acme.example',
    createdAt: 1,
    updatedAt: 2,
    status: 'ready',
    designSystemId: 'user:brand-acme',
    projectId: 'project-acme',
    systemFiles: [
      'artifacts/landing.html',
      'artifacts/deck.html',
    ],
  },
  brand: {
    name: 'Acme Signal',
    tagline: 'Make the important visible.',
    description: 'A focused operating system for modern teams.',
    sourceUrl: 'https://acme.example',
    logo: { primary: 'logos/acme.svg', alternates: [], notes: '' },
    colors: [
      {
        role: 'accent',
        hex: '#1463ff',
        oklch: '',
        name: 'Signal blue',
        usage: 'Primary actions',
      },
    ],
    typography: {
      display: { family: 'Signal Sans', fallbacks: ['sans-serif'], weights: [600, 700] },
      body: { family: 'Signal Sans', fallbacks: ['sans-serif'], weights: [400, 500] },
    },
    voice: {
      adjectives: ['clear', 'direct'],
      tone: 'Confident and concise',
      messagingPillars: [],
      vocabulary: { use: [], avoid: [] },
    },
    imagery: { style: '', subjects: [], treatment: '', avoid: [], samples: [] },
    layout: { radius: '8px', borderWeight: '1px', spacing: 'compact', postureRules: [] },
  },
};

function renderFlow(overrides: Partial<React.ComponentProps<typeof OnboardingBrandAhaFlow>> = {}) {
  const props: React.ComponentProps<typeof OnboardingBrandAhaFlow> = {
    onBack: vi.fn(),
    onSkip: vi.fn(),
    onGenerate: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(true),
    onComplete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  render(
    <I18nProvider initial="en">
      <OnboardingBrandAhaFlow {...props} />
    </I18nProvider>,
  );
  return props;
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('OnboardingBrandAhaFlow', () => {
  it('waits for the real ready brand before previewing and opening a generated artifact', async () => {
    let resolveBrandPoll: ((response: Response) => void) | null = null;
    const brandPoll = new Promise<Response>((resolve) => {
      resolveBrandPoll = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/brands' && init?.method === 'POST') {
        return jsonResponse({
          id: 'brand-acme',
          projectId: 'project-acme',
          conversationId: 'conversation-acme',
          status: 'extracting',
          sourceUrl: 'https://acme.example',
        });
      }
      if (url === '/api/brands' && !init?.method) return brandPoll;
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const props = renderFlow();

    fireEvent.change(screen.getByLabelText('Brand website'), {
      target: { value: 'https://acme.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Extracting…')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-brand-artifact-preview')).toBeNull();
    expect(props.onComplete).not.toHaveBeenCalled();

    await act(async () => {
      resolveBrandPoll?.(jsonResponse({ brands: [readyBrand] }));
    });

    expect(await screen.findByText('Acme Signal')).toBeTruthy();
    expect(screen.getByText('Signal blue')).toBeTruthy();
    expect(screen.getAllByText('Signal Sans').length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(screen.getByTestId('onboarding-brand-ready'));
    const preview = screen.getByTestId('onboarding-brand-artifact-preview');
    expect(preview.getAttribute('src')).toBe(
      '/api/projects/project-acme/raw/system/artifacts/landing.html',
    );
    expect(preview.getAttribute('title')).toBe('Acme Signal — Landing page');
    expect(preview.getAttribute('tabindex')).toBe('-1');
    expect(preview.getAttribute('sandbox')).toBe('allow-scripts');
    expect(screen.getByRole('group', { name: 'Brand system' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pitch deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    await waitFor(() => {
      expect(props.onComplete).toHaveBeenCalledWith(
        'project-acme',
        'system/artifacts/deck.html',
        expect.objectContaining({ sourceCount: 1, sourceUrlCount: 1 }),
      );
    });
    expect(props.onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCount: 1, sourceUrlCount: 1 }),
    );
  });

  it('keeps the standard artifact choices when a ready brand reports only unrelated files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/brands' && init?.method === 'POST') {
          return jsonResponse({
            id: 'brand-acme',
            projectId: 'project-acme',
            conversationId: 'conversation-acme',
            status: 'extracting',
            sourceUrl: 'https://acme.example',
          });
        }
        if (url === '/api/brands' && !init?.method) {
          return jsonResponse({
            brands: [{
              ...readyBrand,
              meta: { ...readyBrand.meta, systemFiles: ['system/index.html'] },
            }],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderFlow();

    fireEvent.change(screen.getByLabelText('Brand website'), {
      target: { value: 'https://acme.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    const preview = await screen.findByTestId('onboarding-brand-artifact-preview');
    expect(preview.getAttribute('src')).toBe(
      '/api/projects/project-acme/raw/system/artifacts/landing.html',
    );
    expect(screen.getByRole('button', { name: 'Pitch deck' })).toBeTruthy();
  });

  it('keeps a blocked extraction recoverable without completing onboarding', async () => {
    let currentBrand: BrandSummary = {
      meta: {
        id: 'brand-blocked',
        sourceUrl: 'https://blocked.example',
        createdAt: 1,
        updatedAt: 2,
        status: 'needs_input',
        blocked: true,
        blockedReason: 'Cloudflare',
        projectId: 'project-blocked',
      },
      brand: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/brands' && init?.method === 'POST') {
          return jsonResponse({
            id: 'brand-blocked',
            projectId: 'project-blocked',
            conversationId: 'conversation-blocked',
            status: 'extracting',
            sourceUrl: 'https://blocked.example',
          });
        }
        if (url === '/api/brands' && !init?.method) {
          return jsonResponse({ brands: [currentBrand] });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const props = renderFlow();

    fireEvent.change(screen.getByLabelText('Brand website'), {
      target: { value: 'https://blocked.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Needs input')).toBeTruthy();
    expect(screen.getByText(/open the project to finish verification/i)).toBeTruthy();
    expect(hasPendingOnboardingBrandAhaAttempt()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    expect(props.onOpenProject).toHaveBeenCalledWith('project-blocked');
    expect(props.onComplete).not.toHaveBeenCalled();

    cleanup();
    currentBrand = {
      ...readyBrand,
      meta: {
        ...readyBrand.meta,
        id: 'brand-blocked',
        designSystemId: 'user:brand-blocked',
        projectId: 'project-blocked',
      },
    };
    const resumedProps = renderFlow();

    expect(await screen.findByText('Acme Signal')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => {
      expect(resumedProps.onComplete).toHaveBeenCalledWith(
        'project-blocked',
        'system/artifacts/landing.html',
        expect.objectContaining({ sourceCount: 1 }),
      );
    });
    expect(hasPendingOnboardingBrandAhaAttempt()).toBe(false);
  });

  it('lets the user abandon an extraction that never appears in the brand catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/brands' && init?.method === 'POST') {
          return jsonResponse({
            id: 'brand-stale',
            projectId: 'project-stale',
            conversationId: 'conversation-stale',
            status: 'extracting',
            sourceUrl: 'https://stale.example',
          });
        }
        if (url === '/api/brands' && !init?.method) {
          return jsonResponse({ brands: [] });
        }
        if (url === '/api/brands/brand-stale/cancel-extraction' && init?.method === 'POST') {
          return jsonResponse({ ok: true, status: 'failed' });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderFlow();

    fireEvent.change(screen.getByLabelText('Brand website'), {
      target: { value: 'https://stale.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Extracting…')).toBeTruthy();
    expect(hasPendingOnboardingBrandAhaAttempt()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Brand website')).toBeTruthy();
      expect(hasPendingOnboardingBrandAhaAttempt()).toBe(false);
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/brands/brand-stale/cancel-extraction',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
