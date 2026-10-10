import { describe, expect, it } from 'vitest';
import type { Stop } from '@cleanloop/shared';
import { pendingEtas, currentStop } from '../pages/driver/useDriverRoute';
import { decodeJwt, loadSession, normalizePhone, signInLocal, userFromIdToken } from './auth';
import { timeAgo } from './format';
import { translate } from './i18n';
import { en, hi } from './strings';
import { airBand, weatherKind } from './weather';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('strings', () => {
  it('has a Hindi string for every English key, with the same placeholders', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(hi[key], key).toBeTruthy();
      expect(placeholders(hi[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('interpolates variables', () => {
    expect(translate('en', 'eta.stopsAway', { n: 3 })).toBe('3 stops away');
    expect(translate('hi', 'eta.stopsAway', { n: 3 })).toBe('3 स्टॉप दूर');
  });
});

function fakeJwt(claims: object): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'none' })}.${enc(claims)}.sig`;
}

describe('auth', () => {
  it('reads the role from Cognito groups, most privileged first', () => {
    const token = fakeJwt({
      sub: 'u1',
      email: 'a@b.in',
      name: 'Asha',
      'cognito:groups': ['resident', 'officer'],
    });
    expect(userFromIdToken(token)).toEqual({
      userId: 'u1',
      role: 'officer',
      name: 'Asha',
      email: 'a@b.in',
    });
    expect(userFromIdToken(fakeJwt({ sub: 'u2', email: 'x@y.in' })).role).toBe('resident');
  });

  it('normalises Indian phone numbers to E.164', () => {
    expect(normalizePhone('98100 00001')).toBe('+919810000001');
    expect(normalizePhone('09810000001')).toBe('+919810000001');
    expect(normalizePhone('+44 20 7946 0000')).toBe('+442079460000');
    expect(normalizePhone('  ')).toBeUndefined();
  });

  it('decodes UTF-8 names', () => {
    expect(decodeJwt(fakeJwt({ sub: 'u', name: 'Asha' })).name).toBe('Asha');
  });

  it('creates local demo sessions the dev server understands', () => {
    const session = signInLocal('driver');
    expect(session.idToken.startsWith('local.')).toBe(true);
    const claims = JSON.parse(atob(session.idToken.slice(6).replace(/-/g, '+').replace(/_/g, '/')));
    expect(claims).toMatchObject({ sub: 'demo-driver', role: 'driver' });
    expect(loadSession()?.user.role).toBe('driver');
  });
});

describe('helpers', () => {
  it('uses India AQI bands for PM2.5', () => {
    expect(airBand(25)).toBe('good');
    expect(airBand(75)).toBe('moderate');
    expect(airBand(180)).toBe('veryPoor');
    expect(airBand(300)).toBe('severe');
  });

  it('groups WMO weather codes', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(45)).toBe('fog');
    expect(weatherKind(63)).toBe('rain');
    expect(weatherKind(95)).toBe('storm');
  });

  it('formats relative times in both languages', () => {
    const now = Date.parse('2026-10-10T10:00:00Z');
    expect(timeAgo('2026-10-10T09:45:00Z', 'en', now)).toBe('15 min ago');
    expect(timeAgo('2026-10-10T07:00:00Z', 'hi', now)).toBe('3 घंटे पहले');
  });

  it('chains driver ETAs from the current stop', () => {
    const stop = (seq: number, status: Stop['status'], mins: number): Stop => ({
      routeId: 'r',
      date: '2026-10-10',
      seq,
      laneId: `l${seq}`,
      laneName: `L${seq}`,
      lat: 0,
      lng: 0,
      avgMinutesToNext: mins,
      status,
    });
    const stops = [
      stop(1, 'done', 10),
      stop(2, 'pending', 8),
      stop(3, 'pending', 12),
      stop(4, 'pending', 0),
    ];
    expect([...pendingEtas(stops).entries()]).toEqual([
      [2, 0],
      [3, 8],
      [4, 20],
    ]);
    expect(currentStop(stops)?.seq).toBe(2);
  });
});
