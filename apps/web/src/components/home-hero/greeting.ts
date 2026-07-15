export type HomeHeroDayPeriod = 'morning' | 'afternoon' | 'evening';

export type HomeHeroGreetingKey =
  | 'homeHero.title.morning'
  | 'homeHero.title.afternoon'
  | 'homeHero.title.evening';

export function dayPeriodForHour(hour: number): HomeHeroDayPeriod {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function homeHeroGreetingKey(period: HomeHeroDayPeriod): HomeHeroGreetingKey {
  return `homeHero.title.${period}`;
}
