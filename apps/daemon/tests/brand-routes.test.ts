import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerBrandRoutes, type BrandRoutesDeps } from '../src/brand-routes.js';
import { closeDatabase, insertConversation, insertProject, listMessages, openDatabase, upsertMessage } from '../src/db.js';
import type { PrefetchResult } from '../src/brands/prefetch.js';

const NO_LOGO_FALLBACK = async () => ({ changed: false });
const NO_IMAGERY_FALLBACK = async () => ({ changed: false });

describe('brand routes', () => {
  let tempDir: string;
  let brandsRoot: string;
  let projectsRoot: string;
  let userDesignSystemsRoot: string;
  let skillsRoot: string;
  let dataDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-brand-routes-'));
    dataDir = path.join(tempDir, '.od');
    brandsRoot = path.join(dataDir, 'brands');
    projectsRoot = path.join(dataDir, 'projects');
    userDesignSystemsRoot = path.join(dataDir, 'design-systems');
    skillsRoot = path.join(tempDir, 'skills');
    mkdirSync(brandsRoot, { recursive: true });
    mkdirSync(projectsRoot, { recursive: true });
    mkdirSync(userDesignSystemsRoot, { recursive: true });
    mkdirSync(skillsRoot, { recursive: true });
    db = openDatabase(projectsRoot, { dataDir });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('serves brand logos from a dot-prefixed data root', async () => {
    writeBrandFixture('brand-dot', {
      logoPrimary: 'logos/header.svg',
      logoBody: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
    });

    const response = await requestBrandLogo('brand-dot');

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('image/svg+xml');
    expect(response.body).toContain('<svg');
  });

  it('keeps logo 404 responses as JSON when no logo can be resolved', async () => {
    writeBrandFixture('brand-missing', { logoPrimary: 'logos/missing.svg' });

    const response = await requestBrandLogo('brand-missing');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('application/json');
    expect(JSON.parse(response.body)).toEqual({ error: 'logo not found' });
  });

  it('falls back to the backing project logo when the brand copy is missing', async () => {
    writeBrandFixture('brand-project', {
      projectId: 'project-brand',
      logoPrimary: 'logos/header.svg',
    });
    const logoDir = path.join(projectsRoot, 'project-brand', 'logos');
    mkdirSync(logoDir, { recursive: true });
    writeFileSync(
      path.join(logoDir, 'header.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>',
    );
    insertProject(db, {
      id: 'project-brand',
      name: 'Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-project' },
    });

    const response = await requestBrandLogo('brand-project');

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('image/svg+xml');
    expect(response.body).toContain('<circle');
  });

  it('reconciles extracting brands to failed when the backing project run failed', async () => {
    writeBrandFixture('brand-failed', {
      projectId: 'project-failed',
      logoPrimary: 'logos/missing.svg',
      status: 'extracting',
    });
    insertProject(db, {
      id: 'project-failed',
      name: 'Failed Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-failed' },
    });
    insertConversation(db, {
      id: 'conversation-failed',
      projectId: 'project-failed',
      title: 'Extract brand',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conversation-failed', {
      id: 'message-failed',
      role: 'assistant',
      content: 'Extraction failed.',
      runId: 'run-failed',
      runStatus: 'failed',
      startedAt: 1,
      endedAt: 2,
    });

    const detail = await requestJson('/api/brands/brand-failed');
    const list = await requestJson('/api/brands');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('failed');
    expect(detail.body.meta.error).toBe('Brand extraction failed in the backing project.');
    expect(list.status).toBe(200);
    expect(list.body.brands.find((brand: any) => brand.meta.id === 'brand-failed')?.meta.status).toBe('failed');

    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-failed', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('failed');
    expect(storedMeta.error).toBe('Brand extraction failed in the backing project.');
  });

  it('reconciles extracting brands to failed when the backing run was canceled by the user', async () => {
    writeBrandFixture('brand-canceled', {
      projectId: 'project-canceled',
      logoPrimary: 'logos/missing.svg',
      status: 'extracting',
    });
    insertProject(db, {
      id: 'project-canceled',
      name: 'Canceled Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-canceled' },
    });
    insertConversation(db, {
      id: 'conversation-canceled',
      projectId: 'project-canceled',
      title: 'Extract brand',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conversation-canceled', {
      id: 'message-canceled',
      role: 'assistant',
      content: 'Stopped.',
      runId: 'run-canceled',
      runStatus: 'canceled',
      startedAt: 1,
      endedAt: 2,
    });

    const detail = await requestJson('/api/brands/brand-canceled');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('failed');
    expect(detail.body.meta.error).toBe('Brand extraction was canceled.');

    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-canceled', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('failed');
  });

  it('keeps terminal backing run failure visible when a stale finalize left the terminal error', async () => {
    const providerError = 'Provider timed out while reading the target site.';
    writeBrandFixture('brand-stale-ready', {
      projectId: 'project-stale-ready',
      logoPrimary: 'logos/missing.svg',
      status: 'ready',
      error: providerError,
      extractionTerminalRunId: 'run-stale-ready',
      extractionTerminalError: providerError,
    });
    insertProject(db, {
      id: 'project-stale-ready',
      name: 'Stale Ready Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-stale-ready' },
    });
    insertConversation(db, {
      id: 'conversation-stale-ready',
      projectId: 'project-stale-ready',
      title: 'Extract brand',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conversation-stale-ready', {
      id: 'message-stale-ready',
      role: 'assistant',
      content: 'Timed out.',
      runId: 'run-stale-ready',
      runStatus: 'failed',
      startedAt: 1,
      endedAt: 2,
    });

    const detail = await requestJson('/api/brands/brand-stale-ready');
    const list = await requestJson('/api/brands');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('failed');
    expect(detail.body.meta.error).toBe(providerError);
    expect(list.body.brands.find((brand: any) => brand.meta.id === 'brand-stale-ready')?.meta.status).toBe(
      'failed',
    );

    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-stale-ready', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('failed');
    expect(storedMeta.error).toBe(providerError);
    expect(storedMeta.extractionTerminalRunId).toBe('run-stale-ready');
    expect(storedMeta.extractionTerminalError).toBe(providerError);
  });

  it('does not regress a successful retry when the old failed run remains the latest status', async () => {
    writeBrandFixture('brand-retry-ready', {
      projectId: 'project-retry-ready',
      logoPrimary: 'logos/missing.svg',
      status: 'ready',
    });
    insertProject(db, {
      id: 'project-retry-ready',
      name: 'Retry Ready Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-retry-ready' },
    });
    insertConversation(db, {
      id: 'conversation-retry-ready',
      projectId: 'project-retry-ready',
      title: 'Extract brand',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conversation-retry-ready', {
      id: 'message-retry-ready-failed',
      role: 'assistant',
      content: 'Old extraction failed.',
      runId: 'run-retry-ready-failed',
      runStatus: 'failed',
      startedAt: 1,
      endedAt: 2,
    });

    const detail = await requestJson('/api/brands/brand-retry-ready');
    const list = await requestJson('/api/brands');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('ready');
    expect(detail.body.meta.error).toBeUndefined();
    expect(list.body.brands.find((brand: any) => brand.meta.id === 'brand-retry-ready')?.meta.status).toBe(
      'ready',
    );

    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-retry-ready', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('ready');
    expect(storedMeta.error).toBeUndefined();
    expect(storedMeta.extractionTerminalRunId).toBeUndefined();
    expect(storedMeta.extractionTerminalError).toBeUndefined();
  });

  it('does not regress ready brands after a later backing project run is canceled', async () => {
    writeBrandFixture('brand-ready', {
      projectId: 'project-ready',
      logoPrimary: 'logos/missing.svg',
      status: 'ready',
    });
    insertProject(db, {
      id: 'project-ready',
      name: 'Ready Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-ready' },
    });
    insertConversation(db, {
      id: 'conversation-ready',
      projectId: 'project-ready',
      title: 'Iterate ready brand',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conversation-ready', {
      id: 'message-ready-canceled',
      role: 'assistant',
      content: 'Stopped unrelated follow-up.',
      runId: 'run-ready-canceled',
      runStatus: 'canceled',
      startedAt: 1,
      endedAt: 2,
    });

    const detail = await requestJson('/api/brands/brand-ready');
    const list = await requestJson('/api/brands');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('ready');
    expect(detail.body.meta.error).toBeUndefined();
    expect(list.body.brands.find((brand: any) => brand.meta.id === 'brand-ready')?.meta.status).toBe('ready');

    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-ready', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('ready');
    expect(storedMeta.error).toBeUndefined();
  });

  it('surfaces needs_input when the backing project is awaiting user input', async () => {
    writeBrandFixture('brand-blocked', {
      projectId: 'project-blocked',
      logoPrimary: 'logos/missing.svg',
      status: 'extracting',
    });
    insertProject(db, {
      id: 'project-blocked',
      name: 'Blocked Brand Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'brand', brandId: 'brand-blocked' },
    });
    insertConversation(db, {
      id: 'conversation-blocked',
      projectId: 'project-blocked',
      title: 'Extract brand',
      createdAt: 1,
      updatedAt: 1,
    });
    // The agent paused on an anti-bot wall and asked the user via a question form.
    upsertMessage(db, 'conversation-blocked', {
      id: 'message-blocked',
      role: 'assistant',
      content: 'Please complete the Cloudflare check. <question-form><question>Done?</question></question-form>',
      runId: 'run-blocked',
      runStatus: 'running',
      startedAt: 1,
      endedAt: null,
    });

    const detail = await requestJson('/api/brands/brand-blocked');
    const list = await requestJson('/api/brands');

    expect(detail.status).toBe(200);
    expect(detail.body.meta.status).toBe('needs_input');
    expect(list.body.brands.find((brand: any) => brand.meta.id === 'brand-blocked')?.meta.status).toBe(
      'needs_input',
    );

    // needs_input is reversible — it must NOT be persisted (the user can still
    // answer and resume extraction), unlike the terminal failed reconcile.
    const storedMeta = JSON.parse(readFileSync(path.join(brandsRoot, 'brand-blocked', 'meta.json'), 'utf8'));
    expect(storedMeta.status).toBe('extracting');
  });

  it('continues deterministic extraction through the HTTP route', async () => {
    const prefetch = vi.fn(async (): Promise<PrefetchResult | null> => null);
    const server = await startBrandServer({
      prefetch,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
    });
    try {
      const started = await server.requestJson('/api/brands', {
        method: 'POST',
        body: { url: 'https://example.com' },
      });

      const continued = await server.requestJson(`/api/brands/${started.body.id}/continue-extraction`, {
        method: 'POST',
        body: {},
      });

      expect(continued.status).toBe(200);
      expect(continued.body).toMatchObject({
        id: started.body.id,
        projectId: started.body.projectId,
        status: 'extracting',
      });
      expect(continued.body.conversationId).toEqual(expect.any(String));
    } finally {
      await server.close();
    }
  });

  it('aborts an active programmatic pass before extracting from browser HTML', async () => {
    let prefetchStarted!: () => void;
    const prefetchStartedPromise = new Promise<void>((resolve) => {
      prefetchStarted = resolve;
    });
    let observedSignal: AbortSignal | null = null;
    const prefetch = vi.fn((_url: string, _brandDir: string, opts?: { signal?: AbortSignal }) => {
      observedSignal = opts?.signal ?? null;
      prefetchStarted();
      return new Promise<PrefetchResult | null>((resolve) => {
        observedSignal?.addEventListener('abort', () => resolve(null), { once: true });
      });
    });
    const getObservedSignal = () => {
      if (!observedSignal) throw new Error('expected prefetch abort signal');
      return observedSignal;
    };
    const server = await startBrandServer({
      prefetch,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
    });
    try {
      const started = await server.requestJson('/api/brands', {
        method: 'POST',
        body: { url: 'acme.com' },
      });
      expect(started.status).toBe(200);
      await prefetchStartedPromise;
      expect(getObservedSignal().aborted).toBe(false);

      const extracted = await server.requestJson(`/api/brands/${started.body.id}/extract-from-html`, {
        method: 'POST',
        body: {
          html: [
            '<!doctype html><html><head>',
            '<title>Acme Inc</title>',
            '<meta name="description" content="We build delightful developer tools.">',
            '</head><body>',
            '<h1>Welcome to Acme</h1><h2>Fast, friendly software</h2>',
            `<p>${'Acme builds delightful developer tools teams enjoy using every day. '.repeat(2)}</p>`,
            '</body></html>',
          ].join(''),
          css: [
            ':root{--brand:#3b5bdb}',
            'h1{color:#3b5bdb;font-family:"Inter",sans-serif}',
            'body{background:#ffffff;color:#1f2933}',
            'a{color:#e8590c}.accent{color:#0ca678}.cta{background:#3b5bdb}',
          ].join(''),
          baseUrl: 'https://acme.com/',
        },
      });

      expect(getObservedSignal().aborted).toBe(true);
      expect(extracted.status).toBe(200);
      expect(extracted.body.id).toBe(started.body.id);
    } finally {
      await server.close();
    }
  });

  it('marks browser HTML retry failure terminal after aborting an active programmatic pass', async () => {
    let prefetchStarted!: () => void;
    const prefetchStartedPromise = new Promise<void>((resolve) => {
      prefetchStarted = resolve;
    });
    let observedSignal: AbortSignal | null = null;
    const prefetch = vi.fn((_url: string, _brandDir: string, opts?: { signal?: AbortSignal }) => {
      observedSignal = opts?.signal ?? null;
      prefetchStarted();
      return new Promise<PrefetchResult | null>((resolve) => {
        observedSignal?.addEventListener('abort', () => resolve(null), { once: true });
      });
    });
    const getObservedSignal = () => {
      if (!observedSignal) throw new Error('expected prefetch abort signal');
      return observedSignal;
    };
    const server = await startBrandServer({
      prefetch,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
    });
    try {
      const started = await server.requestJson('/api/brands', {
        method: 'POST',
        body: { url: 'acme.com' },
      });
      expect(started.status).toBe(200);
      await prefetchStartedPromise;
      expect(getObservedSignal().aborted).toBe(false);

      const extracted = await server.requestJson(`/api/brands/${started.body.id}/extract-from-html`, {
        method: 'POST',
        body: {
          html: '<!doctype html><html><head><title>Loading</title></head><body>Still loading</body></html>',
          baseUrl: 'https://acme.com/',
        },
      });

      expect(getObservedSignal().aborted).toBe(true);
      expect(extracted.status).toBe(422);
      expect(extracted.body).toEqual({
        error: 'Could not extract a design system from the provided page.',
      });

      const meta = JSON.parse(
        readFileSync(path.join(brandsRoot, started.body.id, 'meta.json'), 'utf8'),
      );
      expect(meta.status).toBe('failed');
      expect(meta.error).toBe('Could not extract a design system from the provided page.');
      expect(meta.extractionTerminalError).toBe(
        'Could not extract a design system from the provided page.',
      );

      const assistantMessage = listMessages(db, started.body.conversationId).find(
        (message) => message.id === meta.extractionTranscriptMessageId,
      );
      expect(assistantMessage?.runStatus).toBe('failed');
    } finally {
      await server.close();
    }
  });

  it('does not downgrade a brand that finalizes while cancel aborts active extraction', async () => {
    let prefetchStarted!: () => void;
    const prefetchStartedPromise = new Promise<void>((resolve) => {
      prefetchStarted = resolve;
    });
    let observedSignal: AbortSignal | null = null;
    const prefetch = vi.fn((_url: string, brandDir: string, opts?: { signal?: AbortSignal }) => {
      observedSignal = opts?.signal ?? null;
      prefetchStarted();
      return new Promise<PrefetchResult | null>((resolve) => {
        observedSignal?.addEventListener(
          'abort',
          () => {
            const metaPath = path.join(brandDir, 'meta.json');
            const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
            writeFileSync(
              metaPath,
              JSON.stringify({
                ...meta,
                status: 'ready',
                error: undefined,
                extractionTerminalError: undefined,
                extractionTerminalRunId: undefined,
              }),
            );
            resolve(null);
          },
          { once: true },
        );
      });
    });
    const getObservedSignal = () => {
      if (!observedSignal) throw new Error('expected prefetch abort signal');
      return observedSignal;
    };
    const server = await startBrandServer({
      prefetch,
      logoFallback: NO_LOGO_FALLBACK,
      imageryFallback: NO_IMAGERY_FALLBACK,
    });
    try {
      const started = await server.requestJson('/api/brands', {
        method: 'POST',
        body: { url: 'acme.com' },
      });
      expect(started.status).toBe(200);
      await prefetchStartedPromise;
      expect(getObservedSignal().aborted).toBe(false);

      const cancel = await server.requestJson(`/api/brands/${started.body.id}/cancel-extraction`, {
        method: 'POST',
      });

      expect(getObservedSignal().aborted).toBe(true);
      expect(cancel.status).toBe(200);
      expect(cancel.body).toEqual({ ok: true, status: 'ready' });
      const meta = JSON.parse(readFileSync(path.join(brandsRoot, started.body.id, 'meta.json'), 'utf8'));
      expect(meta.status).toBe('ready');
      expect(meta.error).toBeUndefined();
      expect(meta.extractionTerminalError).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('keeps cancel terminal when browser HTML extraction is in flight', async () => {
    let prefetchStarted!: () => void;
    const prefetchStartedPromise = new Promise<void>((resolve) => {
      prefetchStarted = resolve;
    });
    let observedSignal: AbortSignal | null = null;
    const prefetch = vi.fn((_url: string, _brandDir: string, opts?: { signal?: AbortSignal }) => {
      observedSignal = opts?.signal ?? null;
      prefetchStarted();
      return new Promise<PrefetchResult | null>((resolve) => {
        observedSignal?.addEventListener('abort', () => resolve(null), { once: true });
      });
    });
    let logoFallbackStarted!: () => void;
    const logoFallbackStartedPromise = new Promise<void>((resolve) => {
      logoFallbackStarted = resolve;
    });
    let releaseLogoFallback!: () => void;
    const logoFallbackGate = new Promise<void>((resolve) => {
      releaseLogoFallback = resolve;
    });
    const logoFallback = vi.fn(async () => {
      logoFallbackStarted();
      await logoFallbackGate;
      return { changed: false };
    });
    const getObservedSignal = () => {
      if (!observedSignal) throw new Error('expected prefetch abort signal');
      return observedSignal;
    };
    const server = await startBrandServer({
      prefetch,
      logoFallback,
      imageryFallback: NO_IMAGERY_FALLBACK,
    });
    try {
      const started = await server.requestJson('/api/brands', {
        method: 'POST',
        body: { url: 'acme.com' },
      });
      expect(started.status).toBe(200);
      await prefetchStartedPromise;
      expect(getObservedSignal().aborted).toBe(false);

      const extraction = server.requestJson(`/api/brands/${started.body.id}/extract-from-html`, {
        method: 'POST',
        body: {
          html: [
            '<!doctype html><html><head>',
            '<title>Acme Inc</title>',
            '<meta name="description" content="We build delightful developer tools.">',
            '</head><body>',
            '<h1>Welcome to Acme</h1><h2>Fast, friendly software</h2>',
            `<p>${'Acme builds delightful developer tools teams enjoy using every day. '.repeat(2)}</p>`,
            '</body></html>',
          ].join(''),
          css: [
            ':root{--brand:#3b5bdb}',
            'h1{color:#3b5bdb;font-family:"Inter",sans-serif}',
            'body{background:#ffffff;color:#1f2933}',
            'a{color:#e8590c}.accent{color:#0ca678}.cta{background:#3b5bdb}',
          ].join(''),
          baseUrl: 'https://acme.com/',
        },
      });
      await logoFallbackStartedPromise;
      const extractingMeta = JSON.parse(
        readFileSync(path.join(brandsRoot, started.body.id, 'meta.json'), 'utf8'),
      );

      const cancel = await server.requestJson(`/api/brands/${started.body.id}/cancel-extraction`, {
        method: 'POST',
      });
      expect(cancel.status).toBe(200);
      const canceledMeta = JSON.parse(
        readFileSync(path.join(brandsRoot, started.body.id, 'meta.json'), 'utf8'),
      );
      expect(canceledMeta.status).toBe('failed');
      expect(canceledMeta.error).toBe('Programmatic extraction stopped by the user.');
      expect(canceledMeta.extractionAttemptId).not.toBe(extractingMeta.extractionAttemptId);

      releaseLogoFallback();
      const extracted = await extraction;
      expect(extracted.status).toBe(409);
      expect(extracted.body).toEqual({
        error: 'Programmatic extraction stopped by the user.',
      });

      const finalMeta = JSON.parse(
        readFileSync(path.join(brandsRoot, started.body.id, 'meta.json'), 'utf8'),
      );
      expect(finalMeta.status).toBe('failed');
      expect(finalMeta.error).toBe('Programmatic extraction stopped by the user.');
      const assistantMessage = listMessages(db, started.body.conversationId).find(
        (message) => message.id === finalMeta.extractionTranscriptMessageId,
      );
      expect(assistantMessage?.runStatus).toBe('canceled');
    } finally {
      releaseLogoFallback();
      await server.close();
    }
  });

  function writeBrandFixture(
    id: string,
    options: {
      projectId?: string;
      logoPrimary: string;
      logoBody?: string;
      status?: string;
      error?: string;
      extractionTerminalRunId?: string;
      extractionTerminalError?: string;
    },
  ) {
    const brandDir = path.join(brandsRoot, id);
    mkdirSync(brandDir, { recursive: true });
    writeFileSync(
      path.join(brandDir, 'meta.json'),
      JSON.stringify({
        id,
        sourceUrl: 'https://example.com',
        createdAt: 1,
        updatedAt: 1,
        status: options.status ?? 'ready',
        ...(options.error ? { error: options.error } : {}),
        ...(options.extractionTerminalRunId ? { extractionTerminalRunId: options.extractionTerminalRunId } : {}),
        ...(options.extractionTerminalError ? { extractionTerminalError: options.extractionTerminalError } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
      }),
    );
    writeFileSync(
      path.join(brandDir, 'brand.json'),
      JSON.stringify({
        name: id,
        sourceUrl: 'https://example.com',
        logo: { primary: options.logoPrimary, alternates: [], notes: '' },
      }),
    );
    if (options.logoBody) {
      const logoPath = path.join(brandDir, options.logoPrimary);
      mkdirSync(path.dirname(logoPath), { recursive: true });
      writeFileSync(logoPath, options.logoBody);
    }
  }

  async function requestBrandLogo(id: string) {
    return requestText(`/api/brands/${id}/logo`);
  }

  async function requestJson(route: string) {
    const response = await requestText(route);
    return { ...response, body: JSON.parse(response.body) };
  }

  async function requestText(route: string, options?: RequestOptions) {
    const server = await startBrandServer();
    try {
      return await server.requestText(route, options);
    } finally {
      await server.close();
    }
  }

  type RequestOptions = {
    method?: string;
    body?: unknown;
  };

  async function startBrandServer(extraDeps: Partial<BrandRoutesDeps> = {}) {
    const app = express();
    app.use('/api/brands/:id/extract-from-html', express.json({ limit: '32mb' }));
    app.use(express.json({ limit: '4mb' }));
    registerBrandRoutes(app, {
      brandsRoot,
      userDesignSystemsRoot,
      projectsRoot,
      skillsRoot,
      dataDir,
      db,
      ...extraDeps,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
    const requestTextFromServer = async (route: string, options: RequestOptions = {}) => {
      const init: RequestInit = { method: options.method ?? 'GET' };
      if (Object.hasOwn(options, 'body')) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(options.body);
      }
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, init);
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body: await response.text(),
      };
    };
    return {
      requestText: requestTextFromServer,
      async requestJson(route: string, options: RequestOptions = {}) {
        const response = await requestTextFromServer(route, options);
        return { ...response, body: JSON.parse(response.body) };
      },
      async close() {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      },
    };
  }
});
