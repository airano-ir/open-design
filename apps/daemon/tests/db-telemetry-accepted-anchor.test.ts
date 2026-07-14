import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
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
    });
    expect(getRunFeedbackTelemetryAnchor(db, otherRunId, 'assistant-foreign')).toEqual({
      runStatus: 'succeeded',
      telemetryFinalized: true,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
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

  it('clears accepted telemetry anchors when upsert reuses a message for a new run_id', () => {
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

    // Old run row is gone; new run must not inherit the previous :tf anchor
    // or the previous finalization gate (fallback skip checks finalizedAt).
    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toBeNull();
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      runStatus: null,
      telemetryFinalized: false,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
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
    });
  });

  it('clears accepted telemetry anchors when run-pin reuses a message for a new run_id', () => {
    const oldRunId = 'run-failed-pin-original';
    const newRunId = 'run-retry-via-pin';
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
    });

    // Run creation pins existing assistant rows through a raw UPDATE, not
    // upsertMessage — that path must also drop the previous :tf anchor and
    // finalization gate.
    pinAssistantMessageOnRunCreate(db, {
      id: newRunId,
      conversationId: 'conv-1',
      assistantMessageId: 'assistant-1',
      status: 'running',
      createdAt: Date.now(),
    });

    expect(getRunFeedbackTelemetryAnchor(db, oldRunId, 'assistant-1')).toBeNull();
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      // Terminal run_status is preserved by the pin CASE expression.
      runStatus: 'failed',
      telemetryFinalized: false,
      acceptedTraceBodyId: null,
      acceptedReportTrigger: null,
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
      createdAt: Date.now(),
    });
    expect(getRunFeedbackTelemetryAnchor(db, newRunId, 'assistant-1')).toEqual({
      runStatus: 'failed',
      telemetryFinalized: false,
      acceptedTraceBodyId: newRunId,
      acceptedReportTrigger: 'final_message',
    });
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
    });
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
                  telemetry_accepted_report_trigger = NULL
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
});
