import { describe, expect, it } from 'vitest';
import type { PersistedAgentEvent } from '@open-design/contracts';
import {
  computerStepsFromEvents,
  deriveCurrentRound,
  taskStepBrief,
  type TaskStep,
} from '../../src/runtime/task-steps';

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${Object.values(vars).join(' ')}` : key;

describe('deriveCurrentRound', () => {
  it('returns the latest assistant round with derived steps and live status', () => {
    const events: PersistedAgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'x' } },
    ];
    const round = deriveCurrentRound([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', runStatus: 'running', events },
    ]);
    expect(round?.assistantMessageId).toBe('a1');
    expect(round?.live).toBe(true);
    expect(round?.steps).toHaveLength(1);
    expect(round?.steps[0]?.kind).toBe('search');
  });

  it('treats a finished message without an explicit runStatus as ended', () => {
    const round = deriveCurrentRound([{ id: 'a1', role: 'assistant', endedAt: 5, events: [] }]);
    expect(round?.status).toBe('succeeded');
    expect(round?.live).toBe(false);
  });

  it('returns null when there is no assistant message', () => {
    expect(deriveCurrentRound([{ id: 'u1', role: 'user' }])).toBeNull();
    expect(deriveCurrentRound([])).toBeNull();
  });
});

describe('taskStepBrief', () => {
  const brief = (step: TaskStep) => taskStepBrief(step, t);

  it('uses the file basename for file steps and the raw query for search', () => {
    expect(brief({ id: '1', kind: 'read', status: 'done', target: 'src/deep/app.ts', brief: 'Read', title: 'app.ts', ts: 1 })).toContain('app.ts');
    expect(brief({ id: '2', kind: 'search', status: 'done', target: 'hello world', brief: 'Search', title: 'hello world', ts: 2 })).toContain('hello world');
    expect(brief({ id: '3', kind: 'plan', status: 'done', brief: 'Plan', title: 'Plan', ts: 3 })).toBe('task.step.plan');
  });
});

describe('computerStepsFromEvents', () => {
  it('joins a completed search detail with its raw tool_use and tool_result', () => {
    const steps = computerStepsFromEvents([
      { kind: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://example.com/detail' } },
      { kind: 'tool_result', toolUseId: 't1', content: 'hi', isError: false },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.contentKind).toBe('search-detail');
    expect(steps[0]?.use?.name).toBe('WebFetch');
    expect(steps[0]?.result?.content).toBe('hi');
  });

  it('keeps only resolved plan, search, drilldown, and artifact content', () => {
    const steps = computerStepsFromEvents([
      {
        kind: 'tool_use',
        id: 'todo-1',
        name: 'TodoWrite',
        input: { todos: [{ content: 'Plan the work', status: 'in_progress' }] },
      },
      { kind: 'tool_result', toolUseId: 'todo-1', content: 'ok', isError: false },
      { kind: 'tool_use', id: 'loading-search', name: 'WebSearch', input: { query: 'still loading' } },
      { kind: 'tool_use', id: 'search-1', name: 'WebSearch', input: { query: 'design replay' } },
      { kind: 'tool_result', toolUseId: 'search-1', content: 'search results', isError: false },
      { kind: 'tool_use', id: 'fetch-1', name: 'WebFetch', input: { url: 'https://example.com/result' } },
      { kind: 'tool_result', toolUseId: 'fetch-1', content: 'detail', isError: false },
      { kind: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'DESIGN.md' } },
      { kind: 'tool_result', toolUseId: 'read-1', content: 'tokens', isError: false },
      { kind: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'pnpm typecheck' } },
      { kind: 'tool_result', toolUseId: 'bash-1', content: 'done', isError: false },
      { kind: 'tool_use', id: 'plan-1', name: 'Write', input: { file_path: 'generated/plan.md' } },
      { kind: 'tool_result', toolUseId: 'plan-1', content: 'ok', isError: false },
      { kind: 'tool_use', id: 'artifact-1', name: 'Write', input: { file_path: 'report.md' } },
      { kind: 'tool_result', toolUseId: 'artifact-1', content: 'ok', isError: false },
      { kind: 'thinking', text: 'Checking spacing and tokens' },
    ]);

    expect(steps.map(({ contentKind }) => contentKind)).toEqual([
      'search-list',
      'search-detail',
      'plan',
      'artifact',
    ]);
    expect(steps.map(({ step }) => step.id)).toEqual([
      'search-1',
      'fetch-1',
      'plan-1',
      'artifact-1',
    ]);
  });
});
