// Home composer placeholder carousel — data + pure typewriter state machine.
//
// The empty Home composer rotates a set of scenario placeholders with a
// typewriter effect (type → hold → delete → next). Each scenario is bound to
// one of the create-rail templates (see `home-hero/chips.ts`): when the user
// presses Send on an empty composer while a scenario is showing, HomeView
// seeds the prompt with that scenario's text AND binds its template, so a
// single click creates a fully-routed project — the low-cost "just start"
// path mirrored from Claude Design's rotating placeholder.
//
// Copy is localised: each scenario carries a `textKey` into the i18n Dict
// (`homeHero.carousel.*`), resolved with `t()` at render time in HomeHero so
// the typed placeholder AND the submitted query follow the user's locale. The
// resolved `{ id, text, chipId }` shape (PlaceholderScenario) is what flows to
// the carousel and the submit path.
//
// `chipId` must match an `apply-scenario` create chip id in `HOME_HERO_CHIPS`;
// `home-hero-placeholder-scenarios.test.ts` asserts every binding resolves and
// every `textKey` is present in the English Dict, so a renamed chip or a
// missing translation can't silently break the one-click create.

import type { Dict } from '../../i18n/types';
import type { ChatSessionMode } from '@open-design/contracts';

// A scenario after its copy has been resolved through `t()`. Carousel display
// and the submit path consume this shape.
export interface PlaceholderScenario {
  // Stable key (React list key + test selector).
  id: string;
  // The localized text typed into the placeholder AND sent as the project query.
  text: string;
  // Create-rail chip id the scenario binds on submit (the "template").
  chipId: string;
  // Optional per-turn mode for in-project follow-up scenarios.
  sessionMode?: ChatSessionMode;
}

// The data table: stable id + i18n key + bound template. HomeHero maps each
// def's `textKey` through `t()` to build the resolved PlaceholderScenario list.
export interface PlaceholderScenarioDef {
  id: string;
  textKey: keyof Dict;
  chipId: string;
}

// i18n key for the idle hint shown as the editor's accessible placeholder while
// the visual carousel animates on top. Not part of the rotation — it is
// instructional copy ("here is what you can do"), not a submittable query, so
// it never binds a template.
export const PLACEHOLDER_BASE_HINT_KEY: keyof Dict = 'homeHero.carousel.hint';

export const PLACEHOLDER_SCENARIO_DEFS: ReadonlyArray<PlaceholderScenarioDef> = [
  { id: 'one-page-brief', textKey: 'homeHero.carousel.onePageBrief', chipId: 'document' },
  { id: 'notes-to-deck', textKey: 'homeHero.carousel.notesToDeck', chipId: 'deck' },
  { id: 'signup-flow', textKey: 'homeHero.carousel.signupFlow', chipId: 'prototype' },
  { id: 'improve-brief', textKey: 'homeHero.carousel.improveBrief', chipId: 'document' },
  { id: 'loading-animation', textKey: 'homeHero.carousel.loadingAnimation', chipId: 'hyperframes' },
  { id: 'team-update-slides', textKey: 'homeHero.carousel.teamUpdateSlides', chipId: 'deck' },
  { id: 'orders-dashboard', textKey: 'homeHero.carousel.ordersDashboard', chipId: 'prototype' },
  { id: 'product-detail', textKey: 'homeHero.carousel.productDetail', chipId: 'wireframe' },
  { id: 'case-study', textKey: 'homeHero.carousel.caseStudy', chipId: 'document' },
  { id: 'landing-intro', textKey: 'homeHero.carousel.landingIntro', chipId: 'prototype' },
  { id: 'pitch-deck', textKey: 'homeHero.carousel.pitchDeck', chipId: 'deck' },
  { id: 'app-idea', textKey: 'homeHero.carousel.appIdea', chipId: 'mobile' },
  { id: 'landing-layout', textKey: 'homeHero.carousel.landingLayout', chipId: 'wireframe' },
];

export interface BuildPlaceholderScenariosInput {
  activeChipId: string | null;
  resolveTextKey: (key: keyof Dict) => string;
  examplesForChip?: (chipId: string) => ReadonlyArray<string>;
  fallbackForChip?: (chipId: string) => string | null;
  scenarioDefs?: ReadonlyArray<PlaceholderScenarioDef>;
}

export function buildPlaceholderScenarios({
  activeChipId,
  resolveTextKey,
  examplesForChip = () => [],
  fallbackForChip = () => null,
  scenarioDefs = PLACEHOLDER_SCENARIO_DEFS,
}: BuildPlaceholderScenariosInput): PlaceholderScenario[] {
  if (activeChipId) {
    const chipScenarioDefs = scenarioDefs.filter((def) => def.chipId === activeChipId);
    if (chipScenarioDefs.length > 0) {
      return chipScenarioDefs.map((def) => ({
        id: def.id,
        chipId: def.chipId,
        text: resolveTextKey(def.textKey),
      }));
    }
    const examples = examplesForChip(activeChipId);
    if (examples.length > 0) {
      return examples.map((text, index) => ({
        id: `${activeChipId}-prompt-example-${index + 1}`,
        chipId: activeChipId,
        text,
      }));
    }
    const fallback = fallbackForChip(activeChipId);
    return fallback
      ? [{ id: `${activeChipId}-fallback`, chipId: activeChipId, text: fallback }]
      : [];
  }

  return scenarioDefs.map((def) => ({
    id: def.id,
    chipId: def.chipId,
    text: resolveTextKey(def.textKey),
  }));
}

// ---- Typewriter state machine (pure, so it is unit-testable) --------------

export type TypewriterPhase = 'waiting' | 'typing' | 'holding' | 'pausing';

export interface TypewriterState {
  // Index into the scenario list.
  index: number;
  // Number of visible characters of the current scenario's text.
  charCount: number;
  phase: TypewriterPhase;
}

export interface TypewriterTiming {
  // Lead-in before the first character of a fresh activation. The carousel
  // re-activates the moment the composer goes back to empty, so typing
  // straight away means a user who deletes their last character gets ghost
  // text under their caret instantly — this beat lets them keep thinking.
  leadInMs: number;
  // Per-character delay while typing.
  typeMs: number;
  // Dwell once a line is fully typed, long enough to actually read it.
  holdMs: number;
  // Blank gap between two lines. There is no delete pass: a line is cleared
  // outright and the next one starts over from nothing.
  pauseMs: number;
}

export const DEFAULT_TYPEWRITER_TIMING: TypewriterTiming = {
  leadInMs: 900,
  typeMs: 68,
  holdMs: 5000,
  pauseMs: 420,
};

export function initialTypewriterState(): TypewriterState {
  return { index: 0, charCount: 0, phase: 'waiting' };
}

// Advance the machine one step and report how long to wait before applying it.
// `length` is the current scenario's text length; `count` is the scenario
// count (for wraparound). With `reducedMotion`, the per-character animation
// collapses to whole-line swaps held for `holdMs` (the caller renders the full
// text rather than a `slice`).
export function advanceTypewriter(
  state: TypewriterState,
  length: number,
  count: number,
  timing: TypewriterTiming,
  reducedMotion: boolean,
): { state: TypewriterState; delayMs: number } {
  if (count <= 0) return { state, delayMs: timing.holdMs };
  if (reducedMotion) {
    // Hold the current line, then jump straight to the next one.
    return {
      state: { index: (state.index + 1) % count, charCount: length, phase: 'holding' },
      delayMs: timing.holdMs,
    };
  }
  switch (state.phase) {
    case 'waiting':
      return { state: { ...state, phase: 'typing' }, delayMs: timing.leadInMs };
    case 'typing':
      if (state.charCount < length) {
        return { state: { ...state, charCount: state.charCount + 1 }, delayMs: timing.typeMs };
      }
      return { state: { ...state, phase: 'holding' }, delayMs: timing.holdMs };
    case 'holding':
      // Clear the line outright rather than backspacing it. The overlay sits
      // under a live caret, so an erase pass reads as the user's own text
      // vanishing; blanking and starting the next line from zero does not.
      // The index stays put through the blank beat so the scenario reported
      // to the parent (what Send submits on an empty composer) always matches
      // the line the user just saw.
      return { state: { ...state, charCount: 0, phase: 'pausing' }, delayMs: timing.pauseMs };
    case 'pausing':
    default:
      return {
        state: { index: (state.index + 1) % count, charCount: 0, phase: 'typing' },
        delayMs: timing.typeMs,
      };
  }
}
