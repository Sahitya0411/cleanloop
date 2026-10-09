import type { Role } from '@cleanloop/shared';

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const config = {
  /** `local` talks to the dev server with demo tokens; `cognito` uses Amazon Cognito. */
  authMode: (import.meta.env.VITE_AUTH_MODE ?? 'local') as 'local' | 'cognito',
  apiUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
  region: import.meta.env.VITE_AWS_REGION ?? 'ap-south-1',
  userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
  mapsApiKey: import.meta.env.VITE_MAPS_API_KEY ?? '',
  demoPassword: import.meta.env.VITE_DEMO_PASSWORD ?? '',
  demoEmails: parseJson<Partial<Record<Role, string>>>(import.meta.env.VITE_DEMO_EMAILS, {}),
};

/** Demo accounts for local mode; ids match the backend seed (LOCAL_DEMO_IDS). */
export const LOCAL_DEMO_USERS: Record<Role, { userId: string; name: string; email: string }> = {
  resident: { userId: 'demo-resident', name: 'Heer', email: 'heer@cleanloop.local' },
  driver: { userId: 'demo-driver', name: 'Ramesh Kumar', email: 'ramesh@cleanloop.local' },
  officer: { userId: 'demo-officer', name: 'Ward Officer', email: 'officer@cleanloop.local' },
  recycler: { userId: 'demo-recycler', name: 'Sunil Kabadiwala', email: 'sunil@cleanloop.local' },
};

export function demoLoginsAvailable(): boolean {
  if (config.authMode === 'local') return true;
  return Boolean(config.demoPassword && Object.keys(config.demoEmails).length);
}

export const HOME_PATH: Record<Role, string> = {
  resident: '/resident',
  driver: '/driver',
  officer: '/officer',
  recycler: '/recycler',
};
