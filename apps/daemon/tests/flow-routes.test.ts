import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerFlowRoutes } from '../src/routes/flow.js';
import {
  closeDatabase,
  getConversationFlow,
  insertConversation,
  insertProject,
  openDatabase,
  setConversationFlow,
  upsertMessage,
} from '../src/db.js';
import { applyFlowMarker, createFlowSnapshot } from '@open-design/contracts';

describe('flow routes', () => {
  let tempDir: string;
  let projectsRoot: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-flow-routes-'));
    const dataDir = path.join(tempDir, '.od');
    projectsRoot = path.join(dataDir, 'projects');
    mkdirSync(projectsRoot, { recursive: true });
    db = openDatabase(projectsRoot, { dataDir });
    insertProject(db, {
      id: 'project-1',
      name: 'Flow Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'deck' },
    });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'project-1',
      title: 'Deck run',
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function getFlow(conversationId: string) {
    const app = express();
    registerFlowRoutes(app, { db, paths: { PROJECTS_DIR: projectsRoot } });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    try {
      const resp = await fetch(
        `http://127.0.0.1:${port}/api/conversations/${conversationId}/flow`,
      );
      return {
        status: resp.status,
        body: (await resp.json()) as {
          conversationId?: string;
          flow: import('@open-design/contracts').FlowSnapshot | null;
        },
      };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  async function patchFlow(conversationId: string, body: unknown) {
    const app = express();
    app.use(express.json());
    registerFlowRoutes(app, {
      db,
      paths: { PROJECTS_DIR: projectsRoot },
      now: () => 50,
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    try {
      const response = await fetch(
        'http://127.0.0.1:' + port + '/api/conversations/' + conversationId + '/flow',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      return {
        status: response.status,
        body: await response.json() as {
          error?: string;
          conversationId?: string;
          flow?: import('@open-design/contracts').FlowSnapshot | null;
        },
      };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('404s for an unknown conversation', async () => {
    const { status } = await getFlow('missing');
    expect(status).toBe(404);
  });

  it('returns null flow for a conversation that never entered the staged flow', async () => {
    const { status, body } = await getFlow('conv-1');
    expect(status).toBe(200);
    expect(body).toEqual({ conversationId: 'conv-1', flow: null });
  });

  it('round-trips a persisted snapshot (refresh recovery path)', async () => {
    const snapshot = applyFlowMarker(
      createFlowSnapshot('deck', { now: 10 }),
      { stage: 'plan', state: 'active', detail: '正在写大纲' },
      11,
    );
    setConversationFlow(db, 'conv-1', snapshot);
    expect(getConversationFlow(db, 'conv-1')).toEqual(snapshot);

    const { status, body } = await getFlow('conv-1');
    expect(status).toBe(200);
    expect(body.flow?.activeStage).toBe('plan');
    expect(body.flow?.shape).toBe('deck');
    expect(body.flow?.stages.find((s: { id: string }) => s.id === 'plan')?.detail).toBe(
      '正在写大纲',
    );
  });

  it('materializes submitted questions and inspiration in Design Files', async () => {
    upsertMessage(db, 'conv-1', {
      id: 'assistant-form',
      role: 'assistant',
      content: [
        '<question-form id="discovery" title="Quick brief">',
        JSON.stringify({
          questions: [
            {
              id: 'audience',
              label: 'Who is this for?',
              type: 'text',
              defaultValue: 'Product teams',
            },
          ],
        }),
        '</question-form>',
      ].join('\n'),
    });
    upsertMessage(db, 'conv-1', {
      id: 'user-answers',
      role: 'user',
      content: [
        '[form answers — discovery]',
        '- Who is this for?: Design leads',
      ].join('\n'),
    });
    setConversationFlow(db, 'conv-1', {
      ...createFlowSnapshot('deck', { now: 10 }),
      inspireChoice: { templateId: 'tech-utility', skipped: false },
    });

    const response = await getFlow('conv-1');

    expect(response.status).toBe(200);
    const brief = readFileSync(
      path.join(projectsRoot, 'project-1', 'generated', 'brief.md'),
      'utf8',
    );
    expect(brief).toContain('Who is this for?');
    expect(brief).toContain('Design leads');
    const inspiration = JSON.parse(
      readFileSync(
        path.join(projectsRoot, 'project-1', 'generated', 'inspiration.json'),
        'utf8',
      ),
    ) as { selectedTemplateId: string; skipped: boolean };
    expect(inspiration).toMatchObject({
      selectedTemplateId: 'tech-utility',
      skipped: false,
    });
  });

  it('patches research mode and keeps an exact retry idempotent', async () => {
    setConversationFlow(db, 'conv-1', createFlowSnapshot('deck', { now: 10 }));

    const updated = await patchFlow('conv-1', { researchMode: 'deep' });
    expect(updated.status).toBe(200);
    expect(updated.body.flow?.researchMode).toBe('deep');
    expect(updated.body.flow?.updatedAt).toBe(50);
    expect(getConversationFlow(db, 'conv-1')?.researchMode).toBe('deep');

    const retry = await patchFlow('conv-1', { researchMode: 'deep' });
    expect(retry.status).toBe(200);
    expect(retry.body.flow?.updatedAt).toBe(50);
  });

  it('initializes a deck flow when research mode changes before the first run', async () => {
    const response = await patchFlow('conv-1', { researchMode: 'off' });
    expect(response.status).toBe(200);
    expect(response.body.flow?.shape).toBe('deck');
    expect(response.body.flow?.researchMode).toBe('off');
    expect(response.body.flow?.activeStage).toBe('clarify');
    expect(getConversationFlow(db, 'conv-1')).toEqual(response.body.flow);
  });

  it('validates research-mode updates', async () => {
    setConversationFlow(db, 'conv-1', createFlowSnapshot('deck', { now: 10 }));
    const response = await patchFlow('conv-1', { researchMode: 'turbo' });
    expect(response.status).toBe(400);
  });

  it('recovers a missing generic-project flow from the persisted transcript', async () => {
    insertProject(db, {
      id: 'project-generic',
      name: 'Generic PPT Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'other' },
    });
    insertConversation(db, {
      id: 'conv-generic',
      projectId: 'project-generic',
      title: 'Agent Native PPT',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conv-generic', {
      id: 'user-generic',
      role: 'user',
      content: '做一个 Agent Native 的 PPT',
      sessionMode: 'design',
    });
    upsertMessage(db, 'conv-generic', {
      id: 'assistant-generic',
      role: 'assistant',
      content: 'Generated the deck.',
      runStatus: 'succeeded',
      events: [
        {
          kind: 'tool_use',
          id: 'completed-todos',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Build the deck', status: 'completed' },
              { content: 'Review the output', status: 'completed' },
            ],
          },
        },
      ],
    });

    const { status, body } = await getFlow('conv-generic');

    expect(status).toBe(200);
    expect(body.flow?.shape).toBe('deck');
    expect(body.flow?.activeStage).toBe('clarify');
    expect(body.flow?.stages.find((stage) => stage.id === 'generate')?.state).toBe(
      'pending',
    );
    expect(getConversationFlow(db, 'conv-generic')).toEqual(body.flow);
  });

  it('recovers a missing prototype-family flow from request semantics', async () => {
    insertProject(db, {
      id: 'project-landing',
      name: 'Landing Project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'prototype', platform: 'desktop' },
    });
    insertConversation(db, {
      id: 'conv-landing',
      projectId: 'project-landing',
      title: 'SaaS landing',
      createdAt: 1,
      updatedAt: 1,
    });
    upsertMessage(db, 'conv-landing', {
      id: 'user-landing',
      role: 'user',
      content: 'Create a conversion-focused SaaS landing page',
      sessionMode: 'design',
    });

    const { status, body } = await getFlow('conv-landing');

    expect(status).toBe(200);
    expect(body.flow?.shape).toBe('landing');
    expect(body.flow?.activeStage).toBe('clarify');
    expect(getConversationFlow(db, 'conv-landing')).toEqual(body.flow);
  });
});
