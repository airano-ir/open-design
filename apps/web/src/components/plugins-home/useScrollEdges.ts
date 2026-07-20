// Overflow tracking for the single-line facet strips.
//
// The category and subcategory pills scroll horizontally instead of
// wrapping, so the strip needs a fade on whichever side still has chips
// hidden past the edge — a fade painted unconditionally would dim the
// last chip of a row that already fits, which reads as a disabled pill.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollEdges {
  // True when content is clipped past that edge of the scroll container.
  start: boolean;
  end: boolean;
}

// Sub-pixel layout rounding leaves ~1px of phantom scrollable width on a
// row that visually fits, so only treat a real gap as overflow.
const EDGE_EPSILON = 2;

/**
 * Watches a horizontally scrollable element and reports which edges are
 * currently clipping content. Re-measures on scroll, on resize, and
 * whenever `contentKey` changes — the pill set swaps without the
 * container itself resizing, which a ResizeObserver alone would miss.
 */
export function useScrollEdges<T extends HTMLElement>(contentKey: unknown) {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const maxScroll = node.scrollWidth - node.clientWidth;
    const left = node.scrollLeft;
    const next: ScrollEdges = {
      start: left > EDGE_EPSILON,
      end: maxScroll - left > EDGE_EPSILON,
    };
    // Bail on an unchanged result: `measure` runs on every scroll frame and
    // a fresh object each time would re-render the whole pill strip.
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [measure, contentKey]);

  return { ref, edges };
}
