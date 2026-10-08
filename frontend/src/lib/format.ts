import type { Lang } from '@cleanloop/shared';

const IST = 'Asia/Kolkata';

export function formatTime(iso: string | undefined, lang: Lang = 'en'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDate(iso: string | undefined, lang: Lang = 'en'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/** "Sat, 10 Oct" for a YYYY-MM-DD IST date. */
export function formatDay(date: string, lang: Lang = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function timeAgo(iso: string, lang: Lang = 'en', now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  const hi = lang === 'hi';
  if (mins < 1) return hi ? 'अभी' : 'just now';
  if (mins < 60) return hi ? `${mins} मिनट पहले` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hi ? `${hours} घंटे पहले` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return hi ? `${days} दिन पहले` : `${days} d ago`;
}

export function istHour(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: 'numeric', hourCycle: 'h23' }).format(
      now,
    ),
  );
}

export function greetingKey(now = new Date()): 'goodMorning' | 'goodAfternoon' | 'goodEvening' {
  const h = istHour(now);
  if (h < 12) return 'goodMorning';
  if (h < 17) return 'goodAfternoon';
  return 'goodEvening';
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
