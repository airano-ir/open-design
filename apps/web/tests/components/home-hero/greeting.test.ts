import { describe, expect, it } from 'vitest';
import {
  dayPeriodEmoji,
  dayPeriodForHour,
  homeHeroGreetingKey,
} from '../../../src/components/home-hero/greeting';

describe('home hero time-aware greeting', () => {
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('maps local hour %i to %s', (hour, expected) => {
    expect(dayPeriodForHour(hour)).toBe(expected);
  });

  it('maps each period to its localized headline key', () => {
    expect(homeHeroGreetingKey('morning')).toBe('homeHero.title.morning');
    expect(homeHeroGreetingKey('afternoon')).toBe('homeHero.title.afternoon');
    expect(homeHeroGreetingKey('evening')).toBe('homeHero.title.evening');
  });

  it('maps each period to its contextual emoji', () => {
    expect(dayPeriodEmoji('morning')).toBe('☀️');
    expect(dayPeriodEmoji('afternoon')).toBe('🌤️');
    expect(dayPeriodEmoji('evening')).toBe('🌙');
  });
});
