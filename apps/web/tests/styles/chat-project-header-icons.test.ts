import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../src/styles/chat.css', import.meta.url), 'utf8');

function cssDeclarations(selector: string): string {
  const blocks: string[] = [];
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  const cssWithoutComments = chatCss.replace(/\/\*[\s\S]*?\*\//g, '');
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(cssWithoutComments)) !== null) {
    const selectors = (match[1] ?? '').split(',').map((item) => item.trim());
    if (selectors.includes(selector)) blocks.push(match[2] ?? '');
  }
  if (blocks.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return blocks.join('\n');
}

function ruleValue(block: string, property: string): string {
  const matches = [...block.matchAll(new RegExp(`(?:^|[;\\n])\\s*${property}:\\s*([^;]+);`, 'g'))];
  const match = matches.at(-1);
  if (!match) throw new Error(`Missing CSS property ${property}`);
  return match[1]!.trim();
}

describe('chat project header icons', () => {
  it('keeps every toolbar glyph at a consistent size inside the compact hit area', () => {
    const actionButton = cssDeclarations(
      '.chat-project-primary-actions .chat-project-action-button',
    );
    const actionIcon = cssDeclarations(
      '.chat-project-primary-actions .chat-project-action-button > svg',
    );
    const sessionIcon = cssDeclarations(
      '.chat-project-primary-actions .chat-session-trigger > svg',
    );

    expect(ruleValue(actionButton, 'width')).toBe('28px');
    expect(ruleValue(actionButton, 'height')).toBe('28px');
    expect(ruleValue(actionButton, 'padding')).toBe('0');
    for (const icon of [actionIcon, sessionIcon]) {
      expect(ruleValue(icon, 'width')).toBe('18px');
      expect(ruleValue(icon, 'height')).toBe('18px');
      expect(ruleValue(icon, 'flex')).toBe('0 0 18px');
    }
  });
});
