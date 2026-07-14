import { describe, expect, it } from 'vitest';

import {
  createFlowTracker,
  resolveFlowShape,
  selectFlowShape,
} from '../src/flow/engine.js';

function stageState(tracker: ReturnType<typeof createFlowTracker>, id: string) {
  return tracker.snapshot.stages.find((s) => s.id === id)?.state;
}

function prepareGeneration(tracker: ReturnType<typeof createFlowTracker>): void {
  tracker.observeAgentEvent({
    type: 'tool_use',
    id: 'outline',
    name: 'Write',
    input: { file_path: 'generated/outline.md', content: '# Outline' },
  });
  tracker.noteUserMessage(
    '[form answers — plan-confirm]\n- Next step: Confirm and generate',
  );
  tracker.noteUserMessage('[inspiration — skip]');
}

describe('resolveFlowShape', () => {
  it('gates on design-mode new-generation work', () => {
    expect(resolveFlowShape({ sessionMode: 'chat', projectKind: 'deck' })).toBeNull();
    expect(resolveFlowShape({ sessionMode: 'plan', projectKind: 'deck' })).toBeNull();
    expect(
      resolveFlowShape({ sessionMode: 'design', taskKind: 'tune-collab', projectKind: 'deck' }),
    ).toBeNull();
    expect(resolveFlowShape({ sessionMode: 'design', projectKind: 'brand' })).toBeNull();
    expect(
      resolveFlowShape({
        sessionMode: 'design',
        projectKind: 'brand',
        requestText: 'Create a brand presentation',
      }),
    ).toBeNull();
  });

  it('maps project kind + platform onto flow shapes', () => {
    expect(resolveFlowShape({ sessionMode: 'design', projectKind: 'deck' })).toBe('deck');
    expect(
      resolveFlowShape({ sessionMode: 'design', projectKind: 'prototype', projectPlatform: 'mobile-ios' }),
    ).toBe('mobile');
    expect(
      resolveFlowShape({ sessionMode: 'design', projectKind: 'prototype', projectPlatform: 'responsive' }),
    ).toBe('prototype');
    expect(resolveFlowShape({ sessionMode: 'design', projectKind: 'video' })).toBe('media');
    expect(resolveFlowShape({ sessionMode: 'design', projectKind: 'template' })).toBe('document');
  });

  it.each([
    ['prototype', 'Create a SaaS landing page', 'landing'],
    ['prototype', 'Design a mobile app checkout flow', 'mobile'],
    ['prototype', 'Build an analytics dashboard', 'webapp'],
    ['prototype', 'Create a clickable product prototype', 'prototype'],
    ['template', 'Write a board decision memo', 'document'],
    ['template', 'Produce a quarterly operating report', 'report'],
    ['other', 'Create a PDF-first market report', 'report'],
  ] as const)(
    'routes %s request "%s" to %s',
    (projectKind, requestText, shape) => {
      expect(
        resolveFlowShape({
          sessionMode: 'design',
          projectKind,
          requestText,
        }),
      ).toBe(shape);
    },
  );

  it('infers a deck flow for an untyped project with an explicit PPT request', () => {
    expect(
      resolveFlowShape({
        sessionMode: 'design',
        projectKind: 'other',
        requestText: '做一个 agent native 的 ppt',
      }),
    ).toBe('deck');
  });

  it('maps the default-router task-type answer onto the selected flow shape', () => {
    expect(
      resolveFlowShape({
        sessionMode: 'design',
        projectKind: 'other',
        requestText: [
          '[form answers — task-type]',
          '- What should I build?: Slide deck',
          '- Who is this for?: Product leaders',
        ].join('\n'),
      }),
    ).toBe('deck');
  });
});

describe('createFlowTracker', () => {
  it('refines a provisional prototype while clarify is still active', () => {
    const provisional = createFlowTracker({
      shape: 'prototype',
      now: () => 1,
    }).snapshot;
    expect(selectFlowShape(provisional, 'mobile')).toBe('mobile');

    const planning = createFlowTracker({
      shape: 'prototype',
      now: () => 1,
    });
    planning.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="plan" state="active"/>',
    });
    expect(selectFlowShape(planning.snapshot, 'mobile')).toBe('prototype');
  });

  it('never downgrades a specific shape to its generic project shape', () => {
    for (const shape of ['landing', 'mobile', 'webapp'] as const) {
      const initial = createFlowTracker({
        shape,
        now: () => 1,
      }).snapshot;
      expect(selectFlowShape(initial, 'prototype')).toBe(shape);
    }

    const report = createFlowTracker({
      shape: 'report',
      now: () => 1,
    }).snapshot;
    expect(selectFlowShape(report, 'document')).toBe('report');
  });

  it('starts a fresh conversation at clarify', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    expect(tracker.snapshot.shape).toBe('deck');
    expect(tracker.snapshot.activeStage).toBe('clarify');
    expect(stageState(tracker, 'clarify')).toBe('active');
  });

  it('persists the requested deep research mode in a fresh snapshot', () => {
    const tracker = createFlowTracker({
      shape: 'deck',
      researchMode: 'deep',
      now: () => 1,
    });

    expect(tracker.snapshot.researchMode).toBe('deep');
  });

  it('consumes <od-flow> markers split across text_delta chunk boundaries', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    expect(
      tracker.observeAgentEvent({ type: 'text_delta', delta: '开始规划。\n<od-flow stage="pl' }),
    ).toBeNull();
    const advanced = tracker.observeAgentEvent({
      type: 'text_delta',
      delta: 'an" state="active" detail="正在写大纲"/>\n继续。',
    });
    expect(advanced).not.toBeNull();
    expect(tracker.snapshot.activeStage).toBe('plan');
    expect(tracker.snapshot.stages.find((s) => s.id === 'plan')?.detail).toBe('正在写大纲');
  });

  it('activates clarify from a streamed question form (heuristic channel)', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    // Force clarify past pending first? No — clarify starts active; complete it
    // via a marker, then a NEW question form must not reopen it (monotonic).
    tracker.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="clarify" state="complete"/>',
    });
    expect(stageState(tracker, 'clarify')).toBe('complete');
    tracker.observeAgentEvent({ type: 'text_delta', delta: '<question-form id="x">' });
    expect(stageState(tracker, 'clarify')).toBe('complete');
  });

  it('advances research from the research CLI tool call and its report write', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      input: { command: '"$OD_NODE_BIN" "$OD_BIN" research search --query "robots"' },
    });
    expect(stageState(tracker, 'research')).toBe('active');
    expect(tracker.snapshot.stages.find((stage) => stage.id === 'research')?.detail).toBe(
      'Searching · robots',
    );
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't2',
      name: 'Write',
      input: { file_path: 'research/robots-market.md', content: '# findings' },
    });
    expect(stageState(tracker, 'research')).toBe('complete');
    expect(tracker.snapshot.stages.find((stage) => stage.id === 'research')?.detail).toBe(
      'Research saved · research/robots-market.md',
    );
  });

  it('detects Bash-authored plan files and requests a host confirmation fallback', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    tracker.noteUserMessage('[form answers — discovery]\n- Format: 16:9');
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't1',
      name: 'Bash',
      input: {
        command:
          'mkdir -p research generated && printf \'# Research\' > research/brief.md && printf \'# Outline\' > generated/outline.md',
      },
    });

    expect(stageState(tracker, 'research')).toBe('complete');
    expect(stageState(tracker, 'plan')).toBe('active');
    expect(tracker.snapshot.stages.find((stage) => stage.id === 'plan')?.detail).toBe(
      'Writing · generated/outline.md',
    );
    expect(tracker.needsPlanConfirmationFallback()).toBe(true);

    tracker.observeAgentEvent({
      type: 'text_delta',
      delta: '<question-form id="plan-confirm">',
    });
    expect(tracker.needsPlanConfirmationFallback()).toBe(false);
  });

  it('blocks html generation until the outline and inspiration are confirmed', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't1',
      name: 'Write',
      input: { file_path: 'generated/outline.md', content: '# outline' },
    });
    expect(tracker.snapshot.activeStage).toBe('plan');
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't2',
      name: 'Write',
      input: { file_path: 'deck.html', content: '<html>' },
    });
    expect(tracker.snapshot.activeStage).toBe('plan');
    expect(stageState(tracker, 'generate')).toBe('pending');

    tracker.noteUserMessage(
      '[form answers — plan-confirm]\n- Next step: Confirm and generate',
    );
    tracker.noteUserMessage('[inspiration — skip]');
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't3',
      name: 'Write',
      input: { file_path: 'deck.html', content: '<html>' },
    });
    expect(tracker.snapshot.activeStage).toBe('generate');
    expect(stageState(tracker, 'plan')).toBe('complete');
    expect(stageState(tracker, 'research')).toBe('skipped');
  });

  it.each([
    ['document', 'generated/toc.md', 'decision-memo.md'],
    ['report', 'generated/outline.md', 'operating-review.html'],
    ['landing', 'generated/structure.md', 'index.html'],
    ['mobile', 'generated/flows.md', 'mobile-prototype.html'],
    ['webapp', 'generated/plan.md', 'dashboard.html'],
    ['prototype', 'generated/prototype-plan.md', 'concept.html'],
  ] as const)(
    'activates %s generation for its configured artifact type',
    (shape, planPath, artifactPath) => {
      const tracker = createFlowTracker({ shape, now: () => 1 });
      tracker.observeAgentEvent({
        type: 'tool_use',
        name: 'Write',
        input: { file_path: planPath, content: '# Plan' },
      });
      tracker.noteUserMessage(
        '[form answers — plan-confirm]\n- Next step: Confirm and generate',
      );
      tracker.noteUserMessage('[inspiration — skip]');

      tracker.observeAgentEvent({
        type: 'tool_use',
        name: 'Write',
        input: { file_path: artifactPath, content: 'artifact' },
      });

      expect(tracker.snapshot.activeStage).toBe('generate');
    },
  );

  it('completes clarify from the [form answers] echo in the next user message', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    const advanced = tracker.noteUserMessage('[form answers — discovery]\n- 页数: 12');
    expect(advanced).not.toBeNull();
    expect(stageState(tracker, 'clarify')).toBe('complete');
  });

  it('completes plan only when the plan-confirm form accepts the outline', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't1',
      name: 'Write',
      input: { file_path: 'generated/outline.md', content: '# Outline' },
    });

    const advanced = tracker.noteUserMessage(
      '[form answers — plan-confirm]\n- 下一步: ✓ 确认，生成 12 页',
    );

    expect(advanced).not.toBeNull();
    expect(stageState(tracker, 'plan')).toBe('complete');
    expect(stageState(tracker, 'inspire')).toBe('active');
    expect(tracker.snapshot.activeStage).toBe('inspire');
  });

  it('keeps plan active when the plan-confirm form requests changes', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    tracker.observeAgentEvent({
      type: 'tool_use',
      id: 't1',
      name: 'Write',
      input: { file_path: 'generated/outline.md', content: '# Outline' },
    });

    const advanced = tracker.noteUserMessage(
      '[form answers — plan-confirm]\n- 下一步: 我要修改\n- 补充: 增加竞品页',
    );

    expect(advanced).not.toBeNull();
    expect(stageState(tracker, 'plan')).toBe('active');
    expect(tracker.snapshot.stages.find((stage) => stage.id === 'plan')?.detail).toBe(
      'Waiting for outline changes',
    );
  });

  it('promotes generate → deliver on a clean run end', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    prepareGeneration(tracker);
    tracker.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="generate" state="active" done="12" total="12"/>',
    });
    const advanced = tracker.noteRunEnd('succeeded');
    expect(advanced).not.toBeNull();
    expect(stageState(tracker, 'generate')).toBe('complete');
    expect(tracker.snapshot.activeStage).toBe('deliver');
  });

  it('does not touch the ladder when a run fails mid-generate', () => {
    const tracker = createFlowTracker({ shape: 'deck', now: () => 1 });
    prepareGeneration(tracker);
    tracker.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="generate" state="active"/>',
    });
    expect(tracker.noteRunEnd('failed')).toBeNull();
    expect(stageState(tracker, 'generate')).toBe('active');
  });

  it('resumes from a persisted snapshot instead of restarting the ladder', () => {
    const first = createFlowTracker({ shape: 'deck', now: () => 1 });
    first.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="plan" state="active"/>',
    });
    const resumed = createFlowTracker({ shape: 'deck', initial: first.snapshot, now: () => 2 });
    expect(resumed.snapshot.activeStage).toBe('plan');
    const regressed = resumed.observeAgentEvent({
      type: 'text_delta',
      delta: '<od-flow stage="clarify" state="active"/>',
    });
    expect(regressed).toBeNull();
  });
});
