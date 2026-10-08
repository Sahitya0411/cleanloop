import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  haversineKm,
  isPickupEligible,
  istDate,
  istDateTime,
  weekdayOf,
} from '../src';

describe('IST date helpers', () => {
  it('rolls over to the next IST day at 18:30 UTC', () => {
    expect(istDate(new Date('2026-10-08T18:29:59Z'))).toBe('2026-10-08');
    expect(istDate(new Date('2026-10-08T18:30:00Z'))).toBe('2026-10-09');
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('computes weekdays and day differences', () => {
    expect(weekdayOf('2026-10-10')).toBe(6); // Saturday
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7);
  });

  it('builds IST instants', () => {
    expect(istDateTime('2026-10-10', '07:00').toISOString()).toBe('2026-10-10T01:30:00.000Z');
  });
});

describe('geo', () => {
  it('measures about 1.11 km per 0.01 degree of latitude', () => {
    const d = haversineKm({ lat: 28.75, lng: 77.11 }, { lat: 28.76, lng: 77.11 });
    expect(d).toBeGreaterThan(1.1);
    expect(d).toBeLessThan(1.12);
  });
});

describe('pickup eligibility', () => {
  it('allows recyclables and e-waste only', () => {
    expect(isPickupEligible('dry', 'plastic')).toBe(true);
    expect(isPickupEligible('e_waste', 'electronics')).toBe(true);
    expect(isPickupEligible('dry', 'mixed')).toBe(false);
    expect(isPickupEligible('wet', 'organic')).toBe(false);
    expect(isPickupEligible('special_care', 'hazardous')).toBe(false);
  });
});
