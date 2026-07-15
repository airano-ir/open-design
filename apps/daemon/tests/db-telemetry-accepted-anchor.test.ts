import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
  deleteConversation,
  deleteMessage,
  deleteProject,
  getMessageTelemetryFinalizationState,
  getRunFeedbackTelemetryAnchor,
  insertConversation,
  insertProject,
  openDatabase,
  setRunTelemetryAcceptedAnchor,
  upsertMessage,
} from '../src/db.js';
import {
  resolveFeedbackTraceId,
  resetAcceptedFinalTraceBodyIdsForTests,
  scopedTelemetryBodyId,
} from '../src/langfuse-trace.js';
import { pinAssistantMessageOnRunCreate } from '../src/runtimes/chat-run-messages.js';

describe('persisted telemetry accepted anchor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-db-telemetry-anchor-'));
    resetAcceptedFinalTraceBodyIdsForTests();
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
    resetAcceptedFinalTraceBodyIdsForTests();
  });

  function seedFailedAssistant(db: ReturnType<typeof openDatabase>, runId: string) {
    const now = Date.now();
    insertProject(db, {
      id: 'proj-1',
      name: 'Telemetry project',
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'Telemetry run',
      createdAt: now,
      updatedAt: now,
    });
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'partial',
      runId,
      runStatus: 'failed',
      telemetryFinalized: true,
      endedAt: now,
    });
  }

  it('survives restart: fallback accepted, final_message failed, feedback still targets runId:tf', () => {
    const runId = 'run-fallback-then-final-fail';
    const expectedBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');

    const db1 = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db1, runId);
    expect(
      setRunTelemetryAcceptedAnchor(db1, {
        runId,
        assistantMessageId: 'assistant-1',
        bodyId: expectedBodyId,
        reportTrigger: 'terminal_fallback',
        deliveryChannel: 'relay',
      }),
    ).toBe(true);
    // Simulate final_message failure: process memory cleared, no final accepted write.
    closeDatabase();
    resetAcceptedFinalTraceBodyIdsForTests();

    const db2 = openDatabase(tempDir, { dataDir: tempDir });
    const anchor = getRunFeedbackTelemetryAnchor(db2, runId, 'assistant-1');
    expect(anchor).toEqual({
      runStatus: 'failed',
      telemetryFinalized: true,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: 'relay',
      acceptedVelaIdentity: null,
    });
    expect(
      resolveFeedbackTraceId({
        runId,
        runStatus: anchor!.runStatus,
        telemetryFinalized: anchor!.telemetryFinalized,
        acceptedTraceBodyId: anchor!.acceptedTraceBodyId,
      }),
    ).toBe(expectedBodyId);
    // Without the persisted anchor, finalization alone would wrongly pick canonical runId.
    expect(
      resolveFeedbackTraceId({
        runId,
        runStatus: 'failed',
        telemetryFinalized: true,
      }),
    ).toBe(runId);
  });

  it('persists Vela delivery channel + identity so feedback can refuse anonymous/misaccount attach', () => {
    const runId = 'run-vela-accepted-channel';
    const velaIdentity = 'prod:abcdef0123456789';
    const db1 = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db1, runId);
    expect(
      setRunTelemetryAcceptedAnchor(db1, {
        runId,
        assistantMessageId: 'assistant-1',
        bodyId: runId,
        reportTrigger: 'final_message',
        deliveryChannel: 'vela',
        velaIdentity,
      }),
    ).toBe(true);
    closeDatabase();
    resetAcceptedFinalTraceBodyIdsForTests();

    const db2 = openDatabase(tempDir, { dataDir: tempDir });
    expect(getRunFeedbackTelemetryAnchor(db2, runId, 'assistant-1')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: true,
      acceptedTraceBodyId: runId,
      acceptedReportTrigger: 'final_message',
      acceptedDeliveryChannel: 'vela',
      acceptedVelaIdentity: velaIdentity,
    });
  });

  it('does not demote an accepted final_message anchor with a later terminal_fallback write', () => {
    const runId = 'run-final-wins';
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, runId);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-1',
        bodyId: runId,
        reportTrigger: 'final_message',
      }),
    ).toBe(true);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-1',
        bodyId: `${runId}:tf`,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(false);
    const anchor = getRunFeedbackTelemetryAnchor(db, runId, 'assistant-1');
    expect(anchor?.acceptedTraceBodyId).toBe(runId);
    expect(anchor?.acceptedReportTrigger).toBe('final_message');
  });

  it('ignores a stale or foreign assistantMessageId and falls back to the run row', () => {
    const runId = 'run-target';
    const otherRunId = 'run-other';
    const expectedBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, {
      id: 'proj-1',
      name: 'Telemetry project',
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'Telemetry run',
      createdAt: now,
      updatedAt: now,
    });
    // Foreign terminal assistant (different run) — must not steer the URL run.
    upsertMessage(db, 'conv-1', {
      id: 'assistant-foreign',
      role: 'assistant',
      content: 'other run',
      runId: otherRunId,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: now,
    });
    // User message id (no terminal run_status) — same trap as a stale client id.
    upsertMessage(db, 'conv-1', {
      id: 'user-1',
      role: 'user',
      content: 'prompt',
    });
    // Canonical terminal assistant for the feedback URL run.
    upsertMessage(db, 'conv-1', {
      id: 'assistant-target',
      role: 'assistant',
      content: 'partial',
      runId,
      runStatus: 'failed',
      telemetryFinalized: false,
      endedAt: now,
    });
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-target',
        bodyId: expectedBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);

    for (const staleId of ['assistant-foreign', 'user-1', 'missing-id'] as const) {
      const anchor = getRunFeedbackTelemetryAnchor(db, runId, staleId);
      expect(anchor).toEqual({
        runStatus: 'failed',
        telemetryFinalized: false,
        acceptedTraceBodyId: expectedBodyId,
        acceptedReportTrigger: 'terminal_fallback',
        acceptedDeliveryChannel: null,
        acceptedVelaIdentity: null,
      });
      expect(
        resolveFeedbackTraceId({
          runId,
          runStatus: anchor!.runStatus,
          telemetryFinalized: anchor!.telemetryFinalized,
          acceptedTraceBodyId: anchor!.acceptedTraceBodyId,
        }),
      ).toBe(expectedBodyId);
    }

    // Matching id + run_id + terminal status still wins.
    expect(getRunFeedbackTelemetryAnchor(db, runId, 'assistant-target')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: false,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
  });

  it('setRunTelemetryAcceptedAnchor ignores foreign message ids and writes the run row', () => {
    const runId = 'run-target-write';
    const otherRunId = 'run-other-write';
    const expectedBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const foreignBodyId = scopedTelemetryBodyId(otherRunId, 'final', 'final_message');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, {
      id: 'proj-1',
      name: 'Telemetry project',
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'Telemetry run',
      createdAt: now,
      updatedAt: now,
    });
    upsertMessage(db, 'conv-1', {
      id: 'assistant-foreign',
      role: 'assistant',
      content: 'other run',
      runId: otherRunId,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: now,
    });
    upsertMessage(db, 'conv-1', {
      id: 'assistant-target',
      role: 'assistant',
      content: 'partial',
      runId,
      runStatus: 'failed',
      telemetryFinalized: false,
      endedAt: now,
    });

    // Foreign id must not write the anchor onto the other run's row.
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-foreign',
        bodyId: expectedBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);
    expect(getRunFeedbackTelemetryAnchor(db, runId)).toEqual({
      runStatus: 'failed',
      telemetryFinalized: false,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    expect(getRunFeedbackTelemetryAnchor(db, otherRunId, 'assistant-foreign')).toEqual({
      runStatus: 'succeeded',
      telemetryFinalized: true,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });

    // Matching id still writes the intended row.
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: otherRunId,
        assistantMessageId: 'assistant-foreign',
        bodyId: foreignBodyId,
        reportTrigger: 'final_message',
      }),
    ).toBe(true);
    expect(
      getRunFeedbackTelemetryAnchor(db, otherRunId, 'assistant-foreign')
        ?.acceptedTraceBodyId,
    ).toBe(foreignBodyId);
  });

  it('keeps run-keyed accepted anchors when upsert reuses a message for a new run_id', () => {
    const oldRunId = 'run-failed-original';
    const newRunId = 'run-retry';
    const staleBodyId = scopedTelemetryBodyId(oldRunId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, oldRunId);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: oldRunId,
        assistantMessageId: 'assistant-1',
        bodyId: staleBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);
    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: true,
      acceptedTraceBodyId: staleBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });

    // Side-chat retry reuses the failed assistant message id with a new run.
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      runId: newRunId,
      runStatus: null,
      telemetryFinalized: false,
    });

    // Message columns for the reused row are cleared for B, but run-keyed
    // storage keeps A's accepted :tf anchor so late feedback still attaches.
    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: staleBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1')).toEqual({
      exists: true,
      finalizedAt: null,
    });
    expect(
      resolveFeedbackTraceId({
        runId: newRunId,
        runStatus: 'failed',
        telemetryFinalized: true,
        acceptedTraceBodyId: null,
      }),
    ).toBe(newRunId);

    // Same run_id updates keep an accepted anchor (mid-stream / finalize path).
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: newRunId,
        assistantMessageId: 'assistant-1',
        bodyId: newRunId,
        reportTrigger: 'final_message',
      }),
    ).toBe(true);
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'retry reply',
      runId: newRunId,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: Date.now(),
    });
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      runStatus: 'succeeded',
      telemetryFinalized: true,
      acceptedTraceBodyId: newRunId,
      acceptedReportTrigger: 'final_message',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
  });

  it('keeps run-keyed accepted anchors when run-pin reuses a message for a new run_id', () => {
    const oldRunId = 'run-failed-pin-original';
    const newRunId = 'run-retry-via-pin';
    const staleBodyId = scopedTelemetryBodyId(oldRunId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, oldRunId);
    // Seed terminal delivery metadata from the failed run so ownership change
    // must clear it (otherwise a fresh running retry stays delivery_failed).
    db.prepare(
      `UPDATE messages
          SET result_delivery_state = ?, started_at = ?, ended_at = ?
        WHERE id = ?`,
    ).run('delivery_failed', 1_700_000_000_000, 1_700_000_001_000, 'assistant-1');
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: oldRunId,
        assistantMessageId: 'assistant-1',
        bodyId: staleBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);
    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: true,
      acceptedTraceBodyId: staleBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });

    // Run creation pins existing assistant rows through a raw UPDATE, not
    // upsertMessage — message columns clear for B, run-keyed A stays.
    const retryCreatedAt = 1_700_000_100_000;
    pinAssistantMessageOnRunCreate(db, {
      id: newRunId,
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      createdAt: retryCreatedAt,
    });

    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: staleBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      // Ownership change must take the new run's non-terminal status so a
      // fresh retry is not observed as already completed.
      runStatus: 'running',
      telemetryFinalized: false,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    // Run-owned terminal fields must reset so conversation summaries and
    // delivery state do not inherit the previous run.
    expect(
      db
        .prepare(
          `SELECT result_delivery_state AS resultDeliveryState,
                  started_at AS startedAt,
                  ended_at AS endedAt
             FROM messages WHERE id = ?`,
        )
        .get('assistant-1') as {
        resultDeliveryState: string | null;
        startedAt: number | null;
        endedAt: number | null;
      },
    ).toEqual({
      resultDeliveryState: null,
      startedAt: retryCreatedAt,
      endedAt: null,
    });
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1')).toEqual({
      exists: true,
      finalizedAt: null,
    });
    expect(
      resolveFeedbackTraceId({
        runId: newRunId,
        runStatus: 'failed',
        telemetryFinalized: true,
        acceptedTraceBodyId: null,
      }),
    ).toBe(newRunId);

    // Same run_id pin keeps an accepted anchor (idempotent re-pin) without
    // re-opening the finalization gate (anchor write does not finalize).
    // Terminal status is preserved only on same-run pins; after ownership
    // change the row is still non-terminal here.
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: newRunId,
        assistantMessageId: 'assistant-1',
        bodyId: newRunId,
        reportTrigger: 'final_message',
      }),
    ).toBe(true);
    pinAssistantMessageOnRunCreate(db, {
      id: newRunId,
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      createdAt: retryCreatedAt + 1,
    });
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      runStatus: 'running',
      telemetryFinalized: false,
      acceptedTraceBodyId: newRunId,
      acceptedReportTrigger: 'final_message',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    // Same-run re-pin must keep the ownership-change started_at (COALESCE)
    // and leave ended_at / result_delivery_state cleared.
    expect(
      db
        .prepare(
          `SELECT result_delivery_state AS resultDeliveryState,
                  started_at AS startedAt,
                  ended_at AS endedAt
             FROM messages WHERE id = ?`,
        )
        .get('assistant-1') as {
        resultDeliveryState: string | null;
        startedAt: number | null;
        endedAt: number | null;
      },
    ).toEqual({
      resultDeliveryState: null,
      startedAt: retryCreatedAt,
      endedAt: null,
    });
  });

  it('A fails → row reused by B → A fallback accepted → restart still resolves A:tf', () => {
    // Review regression: delayed terminal_fallback acceptance for A must not
    // require a live messages row with run_id=A. After B reuses the assistant
    // row, the accepted write still lands in run-keyed storage and survives
    // restart so feedback targets A:tf instead of canonical A.
    const oldRunId = 'run-a-fallback-after-reuse';
    const newRunId = 'run-b-reused-row';
    const expectedBodyId = scopedTelemetryBodyId(
      oldRunId,
      'final',
      'terminal_fallback',
    );
    const db1 = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db1, oldRunId);

    // Rebind the only assistant row to B before A's fallback delivery lands.
    upsertMessage(db1, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'B running',
      runId: newRunId,
      runStatus: 'running',
      telemetryFinalized: false,
    });
    expect(getRunFeedbackTelemetryAnchor(db1, oldRunId, 'assistant-1')).toBeNull();

    // Delayed A acceptance: no run_id=A message remains, but run-keyed write
    // still succeeds.
    expect(
      setRunTelemetryAcceptedAnchor(db1, {
        runId: oldRunId,
        assistantMessageId: 'assistant-1',
        bodyId: expectedBodyId,
        reportTrigger: 'terminal_fallback',
        deliveryChannel: 'relay',
      }),
    ).toBe(true);
    expect(getRunFeedbackTelemetryAnchor(db1, oldRunId)).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: 'relay',
      acceptedVelaIdentity: null,
    });
    // B must not inherit A's anchor via the shared message row.
    expect(
      getRunFeedbackTelemetryAnchor(db1, newRunId, 'assistant-1')?.acceptedTraceBodyId,
    ).toBeNull();

    closeDatabase();
    resetAcceptedFinalTraceBodyIdsForTests();

    const db2 = openDatabase(tempDir, { dataDir: tempDir });
    const anchor = getRunFeedbackTelemetryAnchor(db2, oldRunId);
    expect(anchor).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: 'relay',
      acceptedVelaIdentity: null,
    });
    expect(
      resolveFeedbackTraceId({
        runId: oldRunId,
        acceptedTraceBodyId: anchor!.acceptedTraceBodyId,
      }),
    ).toBe(expectedBodyId);
  });

  it('reused assistant row after failed retry keeps finalization gate open for terminal fallback', () => {
    // Mirrors reportRunCompletionTelemetryFallback: it skips the send when
    // getMessageTelemetryFinalizationState(...).finalizedAt !== null. A side-
    // chat retry that reuses the assistant message id must not inherit the
    // previous run's finalized_at, or a failed/canceled retry drops telemetry.
    const oldRunId = 'run-failed-then-retry';
    const retryRunId = 'run-retry-then-fail';
    const oldBodyId = scopedTelemetryBodyId(oldRunId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, oldRunId);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: oldRunId,
        assistantMessageId: 'assistant-1',
        bodyId: oldBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1').finalizedAt).not.toBeNull();

    // Pin path used on run create, then upsert path used when the retry fails.
    pinAssistantMessageOnRunCreate(db, {
      id: retryRunId,
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      createdAt: Date.now(),
    });
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1')).toEqual({
      exists: true,
      finalizedAt: null,
    });

    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'retry partial',
      runId: retryRunId,
      runStatus: 'failed',
      telemetryFinalized: false,
      endedAt: Date.now(),
    });

    // Gate still open → terminal-fallback would not skip on finalizedAt.
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1')).toEqual({
      exists: true,
      finalizedAt: null,
    });
    expect(getRunFeedbackTelemetryAnchor(db, retryRunId, 'assistant-1')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: false,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
  });

  it('run-scoped finalization lookup keeps failed run A eligible after row reuse + B finalize', () => {
    // Overlapping sequence the message-id-only gate misses:
    // failed A schedules terminal_fallback → same assistant row rebinds to B →
    // B finalizes before A's timer fires. A's delayed check must pass run.id
    // so it does not observe B's telemetry_finalized_at and skip reporting.
    const oldRunId = 'run-a-failed-pending-fallback';
    const newRunId = 'run-b-reused-and-finalized';
    const db = openDatabase(tempDir, { dataDir: tempDir });
    const now = Date.now();
    insertProject(db, {
      id: 'proj-1',
      name: 'Telemetry project',
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'Telemetry run',
      createdAt: now,
      updatedAt: now,
    });
    // A failed without finalization yet (fallback delay still open).
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'partial A',
      runId: oldRunId,
      runStatus: 'failed',
      telemetryFinalized: false,
      endedAt: now,
    });
    expect(
      getMessageTelemetryFinalizationState(db, 'assistant-1', oldRunId),
    ).toEqual({
      exists: true,
      finalizedAt: null,
    });

    // Rebind the same assistant row to B and finalize B.
    pinAssistantMessageOnRunCreate(db, {
      id: newRunId,
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      createdAt: now + 1,
    });
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'final B',
      runId: newRunId,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: now + 2,
    });

    // Message-id-only lookup sees B's finalized_at (the bug surface).
    expect(getMessageTelemetryFinalizationState(db, 'assistant-1').finalizedAt).not.toBeNull();
    // Run-scoped A no longer owns the row → gate open for A's delayed fallback.
    expect(
      getMessageTelemetryFinalizationState(db, 'assistant-1', oldRunId),
    ).toEqual({
      exists: false,
      finalizedAt: null,
    });
    // Run-scoped B correctly sees finalization and would skip a redundant fallback.
    expect(
      getMessageTelemetryFinalizationState(db, 'assistant-1', newRunId).finalizedAt,
    ).not.toBeNull();
  });

  it('accepted write with stale assistantMessageId still lands on the run row after restart', () => {
    const runId = 'run-stale-write';
    const otherRunId = 'run-other-stale-write';
    const expectedBodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const now = Date.now();

    const db1 = openDatabase(tempDir, { dataDir: tempDir });
    insertProject(db1, {
      id: 'proj-1',
      name: 'Telemetry project',
      createdAt: now,
      updatedAt: now,
    });
    insertConversation(db1, {
      id: 'conv-1',
      projectId: 'proj-1',
      title: 'Telemetry run',
      createdAt: now,
      updatedAt: now,
    });
    // Foreign assistant (other run) and a user message act as stale client ids.
    upsertMessage(db1, 'conv-1', {
      id: 'assistant-foreign',
      role: 'assistant',
      content: 'other run',
      runId: otherRunId,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: now,
    });
    upsertMessage(db1, 'conv-1', {
      id: 'user-1',
      role: 'user',
      content: 'prompt',
    });
    // Real terminal assistant for the run that accepted terminal_fallback.
    upsertMessage(db1, 'conv-1', {
      id: 'assistant-target',
      role: 'assistant',
      content: 'partial',
      runId,
      runStatus: 'failed',
      telemetryFinalized: true,
      endedAt: now,
    });

    for (const staleId of ['assistant-foreign', 'user-1', 'missing-id'] as const) {
      // Clear any prior anchor so each stale id is exercised independently.
      db1
        .prepare(
          `UPDATE messages
              SET telemetry_accepted_body_id = NULL,
                  telemetry_accepted_report_trigger = NULL,
                  telemetry_accepted_delivery_channel = NULL
            WHERE run_id = ?`,
        )
        .run(runId);
      expect(
        setRunTelemetryAcceptedAnchor(db1, {
          runId,
          assistantMessageId: staleId,
          bodyId: expectedBodyId,
          reportTrigger: 'terminal_fallback',
        }),
      ).toBe(true);
      // Anchor must land on the run-owned assistant row, not the stale id.
      expect(getRunFeedbackTelemetryAnchor(db1, runId, 'assistant-target')).toEqual({
        runStatus: 'failed',
        telemetryFinalized: true,
        acceptedTraceBodyId: expectedBodyId,
        acceptedReportTrigger: 'terminal_fallback',
        acceptedDeliveryChannel: null,
        acceptedVelaIdentity: null,
      });
      expect(
        getRunFeedbackTelemetryAnchor(db1, otherRunId, 'assistant-foreign')
          ?.acceptedTraceBodyId,
      ).toBeNull();
    }

    closeDatabase();
    resetAcceptedFinalTraceBodyIdsForTests();

    // After restart, feedback still targets :tf even though the accepted write
    // was invoked with a stale/foreign assistantMessageId.
    const db2 = openDatabase(tempDir, { dataDir: tempDir });
    const anchor = getRunFeedbackTelemetryAnchor(db2, runId, 'assistant-foreign');
    expect(anchor).toEqual({
      runStatus: 'failed',
      telemetryFinalized: true,
      acceptedTraceBodyId: expectedBodyId,
      acceptedReportTrigger: 'terminal_fallback',
      acceptedDeliveryChannel: null,
      acceptedVelaIdentity: null,
    });
    expect(
      resolveFeedbackTraceId({
        runId,
        runStatus: anchor!.runStatus,
        telemetryFinalized: anchor!.telemetryFinalized,
        acceptedTraceBodyId: anchor!.acceptedTraceBodyId,
      }),
    ).toBe(expectedBodyId);
  });

  it('deletes run-keyed anchors with conversation/project/message delete paths', () => {
    const runId = 'run-delete-with-owner';
    const bodyId = scopedTelemetryBodyId(runId, 'final', 'final_message');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, runId);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-1',
        conversationId: 'conv-1',
        bodyId,
        reportTrigger: 'final_message',
        deliveryChannel: 'vela',
        velaIdentity: 'prod:abcdef0123456789',
      }),
    ).toBe(true);
    expect(getRunFeedbackTelemetryAnchor(db, runId)?.acceptedTraceBodyId).toBe(bodyId);

    // Message delete removes the matching run-keyed anchor.
    deleteMessage(db, 'assistant-1');
    expect(getRunFeedbackTelemetryAnchor(db, runId)).toBeNull();
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM run_telemetry_accepted_anchors WHERE run_id = ?`,
        )
        .get(runId) as { n: number },
    ).toEqual({ n: 0 });

    // Recreate message + anchor, then conversation delete must prune ownership.
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'partial',
      runId,
      runStatus: 'failed',
      telemetryFinalized: true,
      endedAt: Date.now(),
    });
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-1',
        conversationId: 'conv-1',
        bodyId,
        reportTrigger: 'final_message',
        deliveryChannel: 'vela',
        velaIdentity: 'prod:abcdef0123456789',
      }),
    ).toBe(true);
    deleteConversation(db, 'conv-1');
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM run_telemetry_accepted_anchors WHERE run_id = ?`,
        )
        .get(runId) as { n: number },
    ).toEqual({ n: 0 });

    // Project delete also prunes anchors owned by its conversations.
    insertConversation(db, {
      id: 'conv-2',
      projectId: 'proj-1',
      title: 'Second',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const runId2 = 'run-delete-with-project';
    upsertMessage(db, 'conv-2', {
      id: 'assistant-2',
      role: 'assistant',
      content: 'partial',
      runId: runId2,
      runStatus: 'succeeded',
      telemetryFinalized: true,
      endedAt: Date.now(),
    });
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: runId2,
        assistantMessageId: 'assistant-2',
        conversationId: 'conv-2',
        bodyId: runId2,
        reportTrigger: 'final_message',
      }),
    ).toBe(true);
    deleteProject(db, 'proj-1');
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM run_telemetry_accepted_anchors`)
        .get() as { n: number },
    ).toEqual({ n: 0 });
  });

  it('conversation delete removes rebinding orphan anchors with no live run_id row', () => {
    const oldRunId = 'run-rebinding-orphan';
    const newRunId = 'run-rebinding-current';
    const staleBodyId = scopedTelemetryBodyId(oldRunId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, oldRunId);
    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId: oldRunId,
        assistantMessageId: 'assistant-1',
        conversationId: 'conv-1',
        bodyId: staleBodyId,
        reportTrigger: 'terminal_fallback',
      }),
    ).toBe(true);

    // Side-chat retry rebinds the assistant row; run-keyed A remains intentional
    // while the conversation lives.
    upsertMessage(db, 'conv-1', {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      runId: newRunId,
      runStatus: null,
      telemetryFinalized: false,
    });
    expect(getRunFeedbackTelemetryAnchor(db, oldRunId)?.acceptedTraceBodyId).toBe(
      staleBodyId,
    );

    // Deleting the conversation must not leave the orphaned run-keyed row behind.
    deleteConversation(db, 'conv-1');
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM run_telemetry_accepted_anchors WHERE run_id = ?`,
        )
        .get(oldRunId) as { n: number },
    ).toEqual({ n: 0 });
  });

  it('skips accepted-anchor writes when the conversation owner is already gone', () => {
    const runId = 'run-late-accept-after-delete';
    const bodyId = scopedTelemetryBodyId(runId, 'final', 'terminal_fallback');
    const db = openDatabase(tempDir, { dataDir: tempDir });
    seedFailedAssistant(db, runId);

    // Owner deleted while terminal_fallback was still delayed.
    deleteConversation(db, 'conv-1');

    expect(
      setRunTelemetryAcceptedAnchor(db, {
        runId,
        assistantMessageId: 'assistant-1',
        conversationId: 'conv-1',
        bodyId,
        reportTrigger: 'terminal_fallback',
        deliveryChannel: 'vela',
        velaIdentity: 'prod:abcdef0123456789',
      }),
    ).toBe(false);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM run_telemetry_accepted_anchors WHERE run_id = ?`,
        )
        .get(runId) as { n: number },
    ).toEqual({ n: 0 });
    expect(getRunFeedbackTelemetryAnchor(db, runId)).toBeNull();
  });
});
