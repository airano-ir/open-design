export type HomeHeroDayPeriod = 'morning' | 'afternoon' | 'evening';

export type HomeHeroGreetingKey =
  | 'homeHero.title.morning'
  | 'homeHero.title.afternoon'
  | 'homeHero.title.evening';

const DAY_PERIOD_EMOJI: Record<HomeHeroDayPeriod, string> = {
  morning: '☀️',
  afternoon: '🌤️',
  evening: '🌙',
};

export function dayPeriodForHour(hour: number): HomeHeroDayPeriod {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function homeHeroGreetingKey(period: HomeHeroDayPeriod): HomeHeroGreetingKey {
  return `homeHero.title.${period}`;
}

export function dayPeriodEmoji(period: HomeHeroDayPeriod): string {
  return DAY_PERIOD_EMOJI[period];
}
