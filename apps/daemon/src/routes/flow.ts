import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  ConfirmFlowPlanRequest,
  FlowSnapshot,
  FlowResearchMode,
  FlowStatusResponse,
  UpdateFlowResearchModeRequest,
} from '@open-design/contracts';

import {
  getConversation,
  getConversationFlow,
  getProject,
  listMessages,
  setConversationFlow,
  upsertMessage,
} from '../db.js';
import { materializeFlowArtifacts } from '../flow/artifacts.js';
import {
  createFlowTracker,
  resolveFlowShape,
  selectFlowShape,
} from '../flow/engine.js';
import { resolveProjectDir } from '../projects.js';

export interface RegisterFlowRoutesDeps {
  db: Database.Database;
  paths: {
    PROJECTS_DIR: string;
  };
  now?: () => number;
}

const FLOW_RESEARCH_MODES = new Set<FlowResearchMode>(['deep', 'basic', 'off']);

function persistedEventForFlow(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event;
  const record = event as Record<string, unknown>;
  if (record.kind === 'text' && typeof record.text === 'string') {
    return { type: 'text_delta', delta: record.text };
  }
  return typeof record.kind === 'string'
    ? { ...record, type: record.kind }
    : record;
}

function recoverConversationFlow(
  db: Database.Database,
  conversation: NonNullable<ReturnType<typeof getConversation>>,
  initial: FlowSnapshot | null,
  now: () => number,
): FlowSnapshot | null {
  const project = getProject(db, conversation.projectId);
  if (!project) return null;
  const messages = listMessages(db, conversation.id);
  const userMessages = messages.filter(
    (message) =>
      message.role === 'user' &&
      message.sessionMode !== 'chat' &&
      message.sessionMode !== 'plan',
  );
  const inferredShape = [...userMessages].reverse().reduce<
    FlowSnapshot['shape'] | null
  >(
    (resolved, message) =>
      resolved ??
      resolveFlowShape({
        sessionMode: message.sessionMode ?? null,
        projectKind: project.metadata.kind,
        projectPlatform: project.metadata.platform,
        requestText: message.content,
      }),
    null,
  );
  const shape = selectFlowShape(initial, inferredShape);
  if (!shape) return null;

  const trackerInitial = initial?.shape === shape ? initial : null;
  const tracker = createFlowTracker({
    shape,
    initial: trackerInitial,
    ...(initial && !trackerInitial
      ? { researchMode: initial.researchMode }
      : {}),
    now,
  });
  for (const message of messages) {
    if (message.role === 'user') tracker.noteUserMessage(message.content);
    for (const event of message.events ?? []) {
      tracker.observeAgentEvent(persistedEventForFlow(event));
    }
    if (message.role === 'assistant') tracker.noteRunEnd(message.runStatus);
  }
  const snapshot = tracker.snapshot;
  if (snapshot !== initial) setConversationFlow(db, conversation.id, snapshot);
  return snapshot;
}

/**
 * Staged-flow read surface (specs/current/staged-flow-north-star.zh-CN.md).
 *
 * The daemon advances a conversation's `FlowSnapshot` live over the chat SSE
 * stream (`flow_stage` agent events); this endpoint is the durable recovery
 * path — page refresh, CLI (`od flow status`), and any consumer that missed
 * the stream read the same persisted snapshot.
 */
export function registerFlowRoutes(app: Express, deps: RegisterFlowRoutesDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;

  app.get('/api/conversations/:id/flow', async (req, res) => {
    const id = String(req.params.id ?? '');
    const conversation = getConversation(db, id);
    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const persistedFlow = getConversationFlow(db, id);
    const flow =
      recoverConversationFlow(db, conversation, persistedFlow, now) ??
      persistedFlow;
    if (flow) {
      const project = getProject(db, conversation.projectId);
      if (project) {
        try {
          await materializeFlowArtifacts({
            conversationId: id,
            flow,
            messages: listMessages(db, id),
            projectRoot: resolveProjectDir(
              deps.paths.PROJECTS_DIR,
              project.id,
              project.metadata,
            ),
          });
        } catch (error) {
          console.warn('[flow] failed to materialize Design Files artifacts', error);
        }
      }
    }
    const body: FlowStatusResponse = {
      conversationId: id,
      flow,
    };
    res.json(body);
  });

  app.patch('/api/conversations/:id/flow', (req, res) => {
    const id = String(req.params.id ?? '');
    const conversation = getConversation(db, id);
    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const request = (req.body ?? {}) as Partial<UpdateFlowResearchModeRequest>;
    if (!request.researchMode || !FLOW_RESEARCH_MODES.has(request.researchMode)) {
      res.status(400).json({ error: 'researchMode must be deep, basic, or off' });
      return;
    }
    let flow = getConversationFlow(db, id);
    let flowCreated = false;
    if (!flow) {
      const project = getProject(db, conversation.projectId);
      const latestRequest = [...listMessages(db, id)]
        .reverse()
        .find((message) => message.role === 'user')?.content;
      const shape = project
        ? resolveFlowShape({
            sessionMode: conversation.sessionMode,
            projectKind: project.metadata.kind,
            projectPlatform: project.metadata.platform,
            requestText: latestRequest,
          })
        : null;
      if (!shape) {
        res.status(409).json({ error: 'conversation flow is not initialized' });
        return;
      }
      flow = createFlowTracker({
        shape,
        researchMode: request.researchMode,
        now,
      }).snapshot;
      flowCreated = true;
    }
    const next =
      flow.researchMode === request.researchMode
        ? flow
        : { ...flow, researchMode: request.researchMode, updatedAt: now() };
    if (flowCreated || next !== flow) setConversationFlow(db, id, next);
    const body: FlowStatusResponse = {
      conversationId: id,
      flow: next,
    };
    res.json(body);
  });

  app.post('/api/conversations/:id/flow/plan-confirm', (req, res) => {
    const id = String(req.params.id ?? '');
    const conversation = getConversation(db, id);
    if (!conversation) {
      res.status(404).json({ error: 'conversation not found' });
      return;
    }
    const request = (req.body ?? {}) as Partial<ConfirmFlowPlanRequest>;
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    if (
      !message.includes('[form answers') ||
      !message.includes('plan-confirm') ||
      !/\[value:\s*confirm\]/iu.test(message)
    ) {
      res.status(400).json({ error: 'a confirmed plan-confirm form answer is required' });
      return;
    }

    const current = getConversationFlow(db, id);
    if (!current) {
      res.status(409).json({ error: 'conversation flow is not initialized' });
      return;
    }
    const planState = current.stages.find((stage) => stage.id === 'plan')?.state;
    if (planState !== 'active' && planState !== 'complete') {
      res.status(409).json({ error: 'the plan is not ready for confirmation' });
      return;
    }

    const tracker = createFlowTracker({ shape: current.shape, initial: current, now });
    tracker.noteUserMessage(message);
    const next = tracker.snapshot;
    const inspireState = next.stages.find((stage) => stage.id === 'inspire')?.state;
    if (inspireState !== 'active') {
      res.status(409).json({ error: 'the inspiration checkpoint could not be activated' });
      return;
    }

    setConversationFlow(db, id, next);
    const messages = listMessages(db, id);
    if (messages.at(-1)?.role !== 'user' || messages.at(-1)?.content !== message) {
      const timestamp = now();
      upsertMessage(db, id, {
        id: randomUUID(),
        role: 'user',
        content: message,
        sessionMode: conversation.sessionMode ?? 'design',
        startedAt: timestamp,
        endedAt: timestamp,
      });
    }
    const body: FlowStatusResponse = {
      conversationId: id,
      flow: next,
    };
    res.json(body);
  });
}
