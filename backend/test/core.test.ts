import { describe, expect, it } from 'vitest';
import type { RiskInputs } from '@cleanloop/shared';
import { extractJsonObject, SortOutputSchema } from '../src/core/ai-schema';
import { computeEta, minutesUntil } from '../src/core/eta';
import { messagesForStopChange } from '../src/core/notify-rules';
import { decideRoute, nearestNeighbour, type PlanCandidate } from '../src/core/planner';
import { severityFromLabels, sortFromLabels } from '../src/core/rekognition-map';
import { computeRisk, riskLevel } from '../src/core/risk';
import { computeSavings, legMinutes } from '../src/core/savings';
import { locateWard, nearestLane } from '../src/core/wards';
import { DATE, at, lane, route, run, stops } from './fixtures';

describe('ETA', () => {
  it('counts from the route start before the first tap', () => {
    const eta = computeEta('c', {
      route,
      run: run(),
      stops: stops(['pending', 'pending', 'pending', 'pending']),
      date: DATE,
      now: at(-30),
    });
    expect(eta.status).toBe('upcoming');
    expect(eta.stopsAway).toBe(3);
    // stop c = start + 10 + 10 minutes; now is 30 minutes before start.
    expect(eta.minutes).toBe(50);
    expect(eta.late).toBe(false);
    expect(eta.truck?.label).toBe('Depot');
  });

  it('uses the last completed stop plus the minutes between', () => {
    const s = stops(['done', 'pending', 'pending', 'pending']);
    s[0]!.doneAt = at(5).toISOString();
    const eta = computeEta('d', { route, run: run(), stops: s, date: DATE, now: at(6) });
    // d = done(5) + 10 (a->b) + 10 (b->c) + 10 (c->d) = 35, now 6 => 29 minutes.
    expect(eta.minutes).toBe(29);
    expect(eta.stopsAway).toBe(3);
    expect(eta.upcoming.map((u) => u.laneId)).toEqual(['b', 'c', 'd']);
    expect(eta.upcoming.at(-1)?.isMine).toBe(true);
    expect(eta.truck?.label).toBe('Lane A');
    expect(eta.progress).toEqual({ handled: 1, total: 4 });
  });

  it('treats skipped stops as passed and marks the next stop', () => {
    const s = stops(['done', 'skipped', 'pending']);
    s[0]!.doneAt = at(0).toISOString();
    s[1]!.doneAt = at(8).toISOString();
    const eta = computeEta('c', { route, run: run(), stops: s, date: DATE, now: at(9) });
    expect(eta.status).toBe('next');
    expect(eta.stopsAway).toBe(1);
    expect(eta.minutes).toBe(9);
  });

  it('restarts from now when the route is running late', () => {
    const eta = computeEta('b', {
      route,
      run: run(),
      stops: stops(['pending', 'pending']),
      date: DATE,
      now: at(120),
    });
    expect(eta.late).toBe(true);
    expect(eta.minutes).toBe(10);
  });

  it('reports collected, missed, deferred and unscheduled lanes', () => {
    const s = stops(['done', 'skipped', 'pending']);
    s[0]!.doneAt = at(1).toISOString();
    s[1]!.skipReason = 'Road blocked';
    const base = { route, stops: s, date: DATE, now: at(20) };
    expect(computeEta('a', { ...base, run: run() }).status).toBe('collected');
    const missed = computeEta('b', { ...base, run: run() });
    expect(missed.status).toBe('missed');
    expect(missed.skipReason).toBe('Road blocked');
    expect(
      computeEta('z', {
        ...base,
        run: run({ deferred: [{ laneId: 'z', laneName: 'Z', score: 5 }] }),
      }).status,
    ).toBe('deferred');
    expect(computeEta('y', { ...base, run: run() }).status).toBe('not_scheduled');
    expect(computeEta('a', { ...base, route: undefined, run: undefined }).status).toBe('no_route');
  });

  it('keeps the upcoming list short but always ends with my lane', () => {
    const eta = computeEta('f', {
      route,
      run: run(),
      stops: stops(Array(6).fill('pending')),
      date: DATE,
      now: at(0),
    });
    expect(eta.upcoming).toHaveLength(4);
    expect(eta.upcoming.at(-1)?.laneId).toBe('f');
  });

  it('gives minutes per pending stop for alert wording', () => {
    const m = minutesUntil(route, stops(['pending', 'pending', 'pending']), DATE, at(0));
    expect([...m.entries()]).toEqual([
      [1, 0],
      [2, 10],
      [3, 20],
    ]);
  });
});

describe('risk score', () => {
  const base: RiskInputs = {
    reportsSameWeekday: 0,
    daysSincePickup: 1,
    skippedLast7: 0,
    rainProbability: 0,
    rainMm: 0,
    eventLabel: null,
  };

  it('applies the 30/25/20/15/10 weights', () => {
    const max = computeRisk({
      reportsSameWeekday: 5,
      daysSincePickup: 5,
      skippedLast7: 5,
      rainProbability: 100,
      rainMm: 30,
      eventLabel: 'Diwali',
    });
    expect(max.score).toBe(100);
    expect(max.level).toBe('high');
    expect(computeRisk({ ...base, reportsSameWeekday: 2, daysSincePickup: 0 }).score).toBe(30);
    expect(computeRisk({ ...base, daysSincePickup: 3 }).score).toBe(25);
    expect(computeRisk({ ...base, daysSincePickup: 0, skippedLast7: 2 }).score).toBe(20);
    expect(computeRisk({ ...base, daysSincePickup: 0, eventLabel: 'Weekly market' }).score).toBe(
      10,
    );
  });

  it('treats a lane with no recorded pickup as overdue', () => {
    expect(computeRisk({ ...base, daysSincePickup: null }).factors.daysSincePickup).toBe(1);
  });

  it('ignores missing weather', () => {
    expect(computeRisk({ ...base, rainProbability: null, rainMm: null }).factors.rain).toBe(0);
  });

  it('maps scores to levels at 35 and 65', () => {
    expect(riskLevel(34)).toBe('low');
    expect(riskLevel(35)).toBe('medium');
    expect(riskLevel(65)).toBe('medium');
    expect(riskLevel(66)).toBe('high');
  });
});

describe('route planner', () => {
  const lanes = {
    a: lane('a', 28.751, 77.111),
    b: lane('b', 28.74, 77.12),
    c: lane('c', 28.752, 77.112),
    d: lane('d', 28.745, 77.115),
    e: lane('e', 28.735, 77.125),
  };
  const cand = (
    id: keyof typeof lanes,
    score: number,
    extra: Partial<PlanCandidate> = {},
  ): PlanCandidate => ({
    lane: lanes[id],
    score,
    level: riskLevel(score),
    daysSincePickup: 1,
    hasOpenReport: false,
    isEventDay: false,
    ...extra,
  });

  it('visits high-risk lanes first', () => {
    const d = decideRoute(route, [
      cand('a', 40),
      cand('b', 80),
      cand('c', 40),
      cand('d', 70),
      cand('e', 40),
    ]);
    expect(
      d.order
        .slice(0, 2)
        .map((c) => c.lane.laneId)
        .sort(),
    ).toEqual(['b', 'd']);
    expect(d.deferred).toHaveLength(0);
  });

  it('defers nearly-empty lanes, but never more than a third', () => {
    const d = decideRoute(route, [
      cand('a', 5),
      cand('b', 6),
      cand('c', 7),
      cand('d', 40),
      cand('e', 50),
    ]);
    expect(d.deferred.map((c) => c.lane.laneId)).toEqual(['a']);
    expect(d.order).toHaveLength(4);
  });

  it('never defers a lane with an open report, an event, or a missed pickup', () => {
    const d = decideRoute(route, [
      cand('a', 5, { hasOpenReport: true }),
      cand('b', 5, { isEventDay: true }),
      cand('c', 5, { daysSincePickup: 2 }),
      cand('d', 5, { daysSincePickup: null }),
      cand('e', 40),
    ]);
    expect(d.deferred).toHaveLength(0);
  });

  it('keeps the baseline in the fixed order', () => {
    const d = decideRoute(route, [
      cand('e', 40),
      cand('d', 40),
      cand('c', 40),
      cand('b', 40),
      cand('a', 40),
    ]);
    expect(d.baseline.map((l) => l.laneId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('orders by nearest neighbour', () => {
    const order = nearestNeighbour({ lat: 28.75, lng: 77.11 }, [
      cand('e', 1),
      cand('a', 1),
      cand('c', 1),
    ]);
    expect(order.map((c) => c.lane.laneId)).toEqual(['a', 'c', 'e']);
  });
});

describe('savings', () => {
  it('converts km to diesel and CO2 with the stated assumptions', () => {
    const s = computeSavings({
      baselineKm: 12,
      optimisedKm: 9,
      vehicleType: 'diesel',
      method: 'estimate',
    });
    expect(s.kmSaved).toBe(3);
    expect(s.dieselLitresSaved).toBe(1);
    expect(s.co2KgSaved).toBe(2.7);
  });

  it('never reports negative savings and gives EVs no diesel savings', () => {
    expect(
      computeSavings({ baselineKm: 8, optimisedKm: 9, vehicleType: 'diesel', method: 'estimate' })
        .kmSaved,
    ).toBe(0);
    const ev = computeSavings({
      baselineKm: 12,
      optimisedKm: 9,
      vehicleType: 'ev',
      method: 'estimate',
    });
    expect(ev.dieselLitresSaved).toBe(0);
    expect(ev.co2KgSaved).toBe(0);
  });

  it('adds loading time to each leg', () => {
    expect(legMinutes(1.2)).toBe(12); // 6 min drive at 12 km/h + 6 min loading
    expect(legMinutes(5, 3)).toBe(9);
  });
});

describe('resident alerts', () => {
  it('alerts the lane two stops ahead when a stop is done', () => {
    const before = stops(['done', 'pending', 'pending', 'pending', 'pending']);
    const after = before.map((s) => (s.seq === 2 ? { ...s, status: 'done' as const } : s));
    const msgs = messagesForStopChange(before[1], after[1]!, after, new Map([[4, 18]]));
    const near = msgs.filter((m) => m.type === 'truck_near');
    expect(near).toHaveLength(1);
    expect(near[0]!.laneId).toBe('d');
    expect(near[0]!.message).toContain('2 stops away');
    expect(near[0]!.message).toContain('18 min');
    expect(near[0]!.messageHi).toContain('2 स्टॉप');
    expect(msgs.find((m) => m.type === 'collected')?.push).toBe(false);
  });

  it('also alerts the next lane on the first tap of the day', () => {
    const after = stops(['done', 'pending', 'pending']);
    const msgs = messagesForStopChange(
      { ...after[0]!, status: 'pending' },
      after[0]!,
      after,
      new Map(),
    );
    expect(msgs.filter((m) => m.type === 'truck_near').map((m) => m.laneId)).toEqual(['b', 'c']);
  });

  it('tells a skipped lane it was missed, with the reason', () => {
    const after = stops(['done', 'skipped', 'pending']);
    after[1]!.skipReason = 'Road blocked';
    const msgs = messagesForStopChange(
      { ...after[1]!, status: 'pending' },
      after[1]!,
      after,
      new Map(),
    );
    const missed = msgs.find((m) => m.type === 'missed')!;
    expect(missed.laneId).toBe('b');
    expect(missed.push).toBe(true);
    expect(missed.sms).toContain('Road blocked');
  });

  it('ignores updates that do not change the status', () => {
    const s = stops(['done', 'pending']);
    expect(messagesForStopChange(s[0], s[0]!, s, new Map())).toEqual([]);
  });
});

describe('Rekognition fallback mapping', () => {
  it('maps labels to the most confident matching stream', () => {
    const r = sortFromLabels([
      { name: 'Bottle', confidence: 90 },
      { name: 'Banana', confidence: 97 },
    ]);
    expect(r.category).toBe('wet');
    expect(r.confidence).toBeLessThanOrEqual(0.75);
  });

  it('prefers e-waste for electronics and falls back to a low-confidence guess', () => {
    expect(sortFromLabels([{ name: 'Mobile Phone', confidence: 95 }]).category).toBe('e_waste');
    expect(sortFromLabels([{ name: 'Sky', confidence: 99 }]).confidence).toBeLessThan(0.6);
  });

  it('scores dumps by how much garbage is visible', () => {
    const high = severityFromLabels([
      { name: 'Garbage', confidence: 95 },
      { name: 'Litter', confidence: 90 },
      { name: 'Rubbish', confidence: 88 },
      { name: 'Trash', confidence: 92 },
      { name: 'Dump', confidence: 80 },
    ]);
    expect(high.isBinOrDump).toBe(true);
    expect(high.severity).toBe('high');
    const none = severityFromLabels([{ name: 'Person', confidence: 99 }]);
    expect(none.isBinOrDump).toBe(false);
    expect(
      severityFromLabels([
        { name: 'Trash Can', confidence: 90 },
        { name: 'Fire', confidence: 85 },
      ]).severity,
    ).toBe('high');
  });
});

describe('ward lookup', () => {
  const ward = {
    wardId: 'w1',
    name: 'W',
    shortName: 'W',
    city: 'Delhi',
    centre: { lat: 28.74, lng: 77.12 },
    radiusKm: 2,
    eventDates: [],
  };
  it('finds the ward containing a point, or none', () => {
    expect(locateWard({ lat: 28.745, lng: 77.121 }, [ward])?.wardId).toBe('w1');
    expect(locateWard({ lat: 28.6, lng: 77.2 }, [ward])).toBeUndefined();
  });
  it('finds the nearest lane within range', () => {
    const lanes = [lane('a', 28.74, 77.12), lane('b', 28.745, 77.125)];
    expect(nearestLane({ lat: 28.7449, lng: 77.1249 }, lanes)?.laneId).toBe('b');
    expect(nearestLane({ lat: 28.9, lng: 77.5 }, lanes)).toBeUndefined();
  });
});

describe('AI output parsing', () => {
  it('extracts JSON from prose and validates it', () => {
    const raw = extractJsonObject(
      'Here you go: {"isWasteItem":true,"itemName":"Bottle","category":"dry","material":"plastic","tip":"Rinse","confidence":"0.9"} done',
    );
    const parsed = SortOutputSchema.parse(raw);
    expect(parsed.confidence).toBe(0.9);
    expect(extractJsonObject('no json')).toBeUndefined();
  });

  it('rejects categories outside the five streams', () => {
    expect(
      SortOutputSchema.safeParse({
        isWasteItem: true,
        itemName: 'x',
        category: 'hazardous',
        material: 'other',
        tip: '',
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });
});
