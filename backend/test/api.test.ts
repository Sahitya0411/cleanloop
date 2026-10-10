import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CreateReportResponse,
  DriverRoute,
  LaneNotification,
  OfficerOverview,
  PickupRequest,
  PlanResult,
  Report,
  ResidentHome,
  Role,
  SortResult,
  TrackInfo,
  UploadTicket,
} from '@cleanloop/shared';
import { buildRouter } from '../src/api/routes';
import { processStopChange } from '../src/domain/collection';
import { planWard } from '../src/domain/planning';
import type { AuthUser } from '../src/domain/common';
import {
  LOCAL_DEMO_IDS,
  createLocalRuntime,
  seedLocal,
  type LocalRuntime,
} from '../src/local/context';
import { silentLogger } from '../src/services/observability';
import { DEMO_LANE_ID } from '../src/seed/seed-data';

// Saturday 10 Oct 2026, 08:00 IST: the morning route is under way.
const NOW = new Date('2026-10-10T02:30:00.000Z');

const users: Record<string, AuthUser> = {
  resident: {
    userId: LOCAL_DEMO_IDS.resident,
    role: 'resident',
    name: 'Heer',
    email: 'heer@example.com',
  },
  driver: { userId: LOCAL_DEMO_IDS.driver, role: 'driver', name: 'Ramesh' },
  officer: { userId: LOCAL_DEMO_IDS.officer, role: 'officer', name: 'Officer' },
  recycler: {
    userId: LOCAL_DEMO_IDS.recycler,
    role: 'recycler',
    name: 'Sunil',
    email: 'sunil@example.com',
  },
  otherResident: { userId: 'someone-else', role: 'resident', name: 'Other' },
  newRecycler: { userId: 'new-recycler', role: 'recycler', name: 'New' },
};

let rt: LocalRuntime;
const router = buildRouter();

async function call<T = unknown>(
  who: keyof typeof users | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const url = new URL(path, 'http://x');
  const res = await router.handle(
    {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
      user: who ? users[who] : undefined,
    },
    rt.ctx,
  );
  return res as { status: number; body: T };
}

async function upload(who: keyof typeof users, purpose: string): Promise<string> {
  const res = await call<UploadTicket>(who, 'POST', '/uploads', {
    purpose,
    contentType: 'image/jpeg',
  });
  expect(res.status).toBe(200);
  await rt.storage.write(res.body.key, new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
  return res.body.key;
}

beforeEach(async () => {
  rt = createLocalRuntime({ baseUrl: 'http://local', log: silentLogger, now: () => NOW });
  await seedLocal(rt);
});

describe('access control', () => {
  it('requires sign-in and the right role', async () => {
    expect((await call(null, 'GET', '/health')).status).toBe(200);
    expect((await call(null, 'GET', '/me')).status).toBe(401);
    expect((await call('driver', 'POST', '/reports', {})).status).toBe(403);
    expect((await call('resident', 'GET', '/officer/overview')).status).toBe(403);
    expect((await call('resident', 'GET', '/nope')).status).toBe(404);
    expect((await call('resident', 'PATCH', '/me')).status).toBe(405);
  });

  it('only lets each role upload its own kind of photo', async () => {
    expect(
      (await call('driver', 'POST', '/uploads', { purpose: 'sort', contentType: 'image/jpeg' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('resident', 'POST', '/uploads', {
          purpose: 'resolve',
          contentType: 'image/jpeg',
        })
      ).status,
    ).toBe(403);
    const bad = await call<{ message: string }>('resident', 'POST', '/uploads', {
      purpose: 'sort',
      contentType: 'image/gif',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('contentType');
  });

  it('rejects photos uploaded by someone else', async () => {
    const key = await upload('otherResident', 'sort');
    expect((await call('resident', 'POST', '/sort', { photoKey: key })).status).toBe(403);
  });
});

describe('Sort', () => {
  it('classifies a photo and offers a pickup for recyclables', async () => {
    const photoKey = await upload('resident', 'sort');
    const res = await call<SortResult>('resident', 'POST', '/sort', {
      photoKey,
      fileName: 'bottle.jpg',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      category: 'dry',
      material: 'plastic',
      pickupEligible: true,
      lowConfidence: false,
    });
    expect(res.body.photoUrl).toContain(encodeURIComponent(photoKey));
  });

  it('asks for a manual choice when unsure, then records it', async () => {
    const photoKey = await upload('resident', 'sort');
    const unsure = await call<SortResult>('resident', 'POST', '/sort', {
      photoKey,
      fileName: 'blurry.jpg',
    });
    expect(unsure.body.lowConfidence).toBe(true);
    expect(unsure.body.pickupEligible).toBe(false);
    const chosen = await call<SortResult>('resident', 'POST', `/sort/${unsure.body.id}/choose`, {
      category: 'e_waste',
    });
    expect(chosen.body).toMatchObject({
      category: 'e_waste',
      source: 'manual',
      pickupEligible: true,
      confidence: 1,
    });
  });

  it('answers in Hindi when asked', async () => {
    const photoKey = await upload('resident', 'sort');
    const res = await call<SortResult>('resident', 'POST', '/sort', {
      photoKey,
      lang: 'hi',
      fileName: 'banana.jpg',
    });
    expect(res.body.itemName).toBe('केले का छिलका');
  });
});

describe('Report -> officer -> resolve', () => {
  it('runs the whole report loop', async () => {
    // Not a bin: the resident is asked to retake unless they insist.
    const selfie = await upload('resident', 'report');
    const rejected = await call<CreateReportResponse>('resident', 'POST', '/reports', {
      photoKey: selfie,
      fileName: 'selfie.jpg',
    });
    expect(rejected.body.created).toBe(false);

    // A real dump, reported with GPS inside the ward.
    const photoKey = await upload('resident', 'report');
    const created = await call<CreateReportResponse>('resident', 'POST', '/reports', {
      photoKey,
      fileName: 'dump-near-drain.jpg',
      lat: 28.73425,
      lng: 77.12145,
      note: 'Next to the temple',
    });
    expect(created.body.created).toBe(true);
    const report = (created.body as { report: Report }).report;
    expect(report).toMatchObject({
      severity: 'high',
      status: 'sent',
      laneId: DEMO_LANE_ID,
      locationSource: 'gps',
    });

    // SES email to the ward officer, with the photo inline.
    const email = rt.notifier.outbox.find(
      (e) => e.kind === 'email' && e.message.to === 'officer@cleanloop.local',
    );
    expect(email).toMatchObject({ attachments: 1 });
    expect(email?.kind === 'email' && email.message.subject).toContain('HIGH');

    // Officer inbox: high severity first.
    const overview = await call<OfficerOverview>('officer', 'GET', '/officer/overview');
    expect(overview.body.reports[0]!.severity).toBe('high');
    expect(overview.body.reports.some((r) => r.reportId === report.reportId)).toBe(true);

    // Seen, then resolved with an after-photo.
    expect(
      (await call<Report>('officer', 'POST', `/reports/${report.reportId}/seen`)).body.status,
    ).toBe('seen');
    const after = await upload('officer', 'resolve');
    const resolved = await call<Report>('officer', 'POST', `/reports/${report.reportId}/resolve`, {
      afterPhotoKey: after,
      note: 'Cleared',
    });
    expect(resolved.body).toMatchObject({ status: 'resolved', resolvedNote: 'Cleared' });
    expect(resolved.body.afterPhotoUrl).toBeTruthy();
    expect(
      (
        await call('officer', 'POST', `/reports/${report.reportId}/resolve`, {
          afterPhotoKey: after,
        })
      ).status,
    ).toBe(409);

    // The resident's tracker shows it resolved; another resident cannot read it.
    const mine = await call<Report[]>('resident', 'GET', '/reports/mine');
    expect(mine.body[0]).toMatchObject({ reportId: report.reportId, status: 'resolved' });
    expect((await call('otherResident', 'GET', `/reports/${report.reportId}`)).status).toBe(403);
  });

  it('falls back to the resident lane when the GPS is outside every ward', async () => {
    const photoKey = await upload('resident', 'report');
    const res = await call<CreateReportResponse>('resident', 'POST', '/reports', {
      photoKey,
      lat: 12.97,
      lng: 77.59,
    });
    expect(res.body.created && res.body.report).toMatchObject({
      locationSource: 'lane',
      laneId: DEMO_LANE_ID,
    });
  });
});

describe('Collect: driver taps and resident alerts', () => {
  it('updates the ETA and alerts the lane two stops ahead', async () => {
    const route = await call<DriverRoute>('driver', 'GET', '/driver/route');
    expect(route.status).toBe(200);
    const stops = route.body.stops;
    expect(stops.length).toBeGreaterThan(5);
    const mineIdx = stops.findIndex((s) => s.laneId === DEMO_LANE_ID);
    expect(mineIdx).toBeGreaterThanOrEqual(2);

    const before = await call<ResidentHome>('resident', 'GET', '/resident/home');
    const awayBefore = before.body.eta!.stopsAway!;

    // Work through the stops until our lane is two away.
    for (let i = 0; i <= mineIdx - 2; i++) {
      const res = await call<DriverRoute>('driver', 'POST', `/driver/stops/${stops[i]!.seq}/done`);
      expect(res.status).toBe(200);
    }
    await rt.drain();

    const home = await call<ResidentHome>('resident', 'GET', '/resident/home');
    expect(awayBefore).toBe(mineIdx + 1);
    expect(home.body.eta!.stopsAway).toBe(2);
    const notes = await call<LaneNotification[]>(
      'resident',
      'GET',
      `/notifications?laneId=${DEMO_LANE_ID}`,
    );
    expect(
      notes.body.some((n) => n.type === 'truck_near' && n.message.includes('2 stops away')),
    ).toBe(true);
    expect(
      rt.notifier.outbox.some((e) => e.kind === 'lane_alert' && e.laneId === DEMO_LANE_ID),
    ).toBe(true);

    // Tapping the same stop twice is refused.
    expect((await call('driver', 'POST', `/driver/stops/${stops[0]!.seq}/done`)).status).toBe(409);

    // Skipping needs a reason, and tells the lane it was missed.
    const next = stops[mineIdx - 1]!;
    expect((await call('driver', 'POST', `/driver/stops/${next.seq}/skip`, {})).status).toBe(400);
    const skipped = await call<DriverRoute>('driver', 'POST', `/driver/stops/${next.seq}/skip`, {
      reason: 'Road dug up',
    });
    expect(skipped.body.run.status).toBe('in_progress');
    await rt.drain();
    const missed = await call<LaneNotification[]>(
      'resident',
      'GET',
      `/notifications?laneId=${next.laneId}`,
    );
    expect(missed.body[0]).toMatchObject({ type: 'missed' });
    expect(missed.body[0]!.message).toContain('Road dug up');

    // The live map for the lane shows every stop and where the truck is.
    const track = await call<TrackInfo>('resident', 'GET', `/lanes/${DEMO_LANE_ID}/track`);
    expect(track.body.stops).toHaveLength(stops.length);
    expect(track.body.eta.truck?.label).toBe(next.laneName);
  });

  it('completes the run when every stop is handled', async () => {
    const { body } = await call<DriverRoute>('driver', 'GET', '/driver/route');
    let last: DriverRoute | undefined;
    for (const s of body.stops)
      last = (await call<DriverRoute>('driver', 'POST', `/driver/stops/${s.seq}/done`)).body;
    expect(last?.run.status).toBe('completed');
  });
});

describe('stream processing', () => {
  it('does not alert twice when a stream batch is retried', async () => {
    const { body } = await call<DriverRoute>('driver', 'GET', '/driver/route');
    await call('driver', 'POST', `/driver/stops/${body.stops[0]!.seq}/done`);
    await rt.drain();
    const after = await rt.ctx.repo.getStop(body.route.routeId, '2026-10-10', body.stops[0]!.seq);
    const before = { ...after!, status: 'pending' as const };
    const alerts = rt.notifier.outbox.filter((e) => e.kind === 'lane_alert').length;
    expect(await processStopChange(rt.ctx, before, after!)).toEqual([]);
    expect(rt.notifier.outbox.filter((e) => e.kind === 'lane_alert').length).toBe(alerts);
  });

  it('ignores changes to past days (for example when re-seeding history)', async () => {
    const past = (await rt.ctx.repo.laneStops(DEMO_LANE_ID, '2026-10-01', '2026-10-01'))[0]!;
    const changed = { ...past, status: 'skipped' as const, skipReason: 'test' };
    expect(await processStopChange(rt.ctx, past, changed)).toEqual([]);
  });
});

describe('planning races', () => {
  it('lets only one of several parallel first-time plans write the day', async () => {
    const date = '2026-10-12';
    await Promise.all(
      [1, 2, 3].map(() => planWard(rt.ctx, 'ward-dtu', date, 'nightly', { onlyIfMissing: true })),
    );
    const run = (await rt.ctx.repo.getRun('route-dtu-1', date))!;
    const stops = await rt.ctx.repo.listStops('route-dtu-1', date);
    expect(stops.map((s) => s.laneId)).toEqual(run.order);
  });

  it('never replans a run once the driver has started it', async () => {
    const { body } = await call<DriverRoute>('driver', 'GET', '/driver/route');
    await call('driver', 'POST', `/driver/stops/${body.stops[0]!.seq}/done`);
    await planWard(rt.ctx, 'ward-dtu', '2026-10-10', 'officer');
    const stop = await rt.ctx.repo.getStop(body.route.routeId, '2026-10-10', body.stops[0]!.seq);
    expect(stop?.status).toBe('done');
  });
});

describe('Predict: nightly planning', () => {
  it('scores every lane, reorders the route and records savings', async () => {
    const res = await call<PlanResult>('officer', 'POST', '/officer/plan', {});
    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2026-10-11');
    const scores = res.body.risks.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const run = res.body.runs[0]!;
    expect(run.deferred.length).toBeLessThanOrEqual(Math.floor(14 / 3));
    expect(run.order.length + run.deferred.length).toBe(14);
    expect(run.savings.kmSaved).toBeGreaterThanOrEqual(0);
    expect(run.savings.co2KgSaved).toBeCloseTo(run.savings.dieselLitresSaved * 2.68, 0);

    // High-risk lanes come before everything else.
    const levels = run.order.map((id) => res.body.risks.find((r) => r.laneId === id)!.level);
    const firstNonHigh = levels.findIndex((l) => l !== 'high');
    if (firstNonHigh >= 0) expect(levels.slice(firstNonHigh)).not.toContain('high');

    // An open report keeps its lane on the route.
    const openLanes = (
      await call<OfficerOverview>('officer', 'GET', '/officer/overview')
    ).body.reports.map((r) => r.laneId);
    for (const d of run.deferred) expect(openLanes).not.toContain(d.laneId);
  });

  it('leaves a run that is already under way alone', async () => {
    const { body } = await call<DriverRoute>('driver', 'GET', '/driver/route');
    await call('driver', 'POST', `/driver/stops/${body.stops[0]!.seq}/done`);
    const replanned = await call<PlanResult>('officer', 'POST', '/officer/plan', {
      date: '2026-10-10',
    });
    expect(replanned.body.runs[0]!.status).toBe('in_progress');
    const reset = await call<PlanResult>('officer', 'POST', '/officer/demo/reset-today');
    expect(reset.body.runs[0]!.status).toBe('planned');
  });

  it('validates the date', async () => {
    expect((await call('officer', 'POST', '/officer/plan', { date: '10/11/2026' })).status).toBe(
      400,
    );
  });
});

describe('Recycle: pickups', () => {
  it('matches the nearest recycler and lets one recycler accept', async () => {
    const photoKey = await upload('resident', 'pickup');
    const created = await call<PickupRequest>('resident', 'POST', '/pickups', {
      itemType: 'dry',
      material: 'cardboard',
      photoKey,
      estWeightKg: 6,
      phone: '+919800000000',
    });
    expect(created.status).toBe(200);
    expect(created.body.suggestedRecyclerId).toBeDefined();
    expect(
      (await call('resident', 'POST', '/pickups', { itemType: 'e_waste', material: 'paper' }))
        .status,
    ).toBe(400);

    // An unregistered recycler must register first.
    expect(
      (await call('newRecycler', 'POST', `/recycler/requests/${created.body.requestId}/accept`))
        .status,
    ).toBe(400);
    const reg = await call('newRecycler', 'PUT', '/recycler/me', {
      name: 'New Kabadi',
      phone: '+919811111111',
      area: 'Sector 17',
      lat: 28.735,
      lng: 77.124,
      acceptedMaterials: ['cardboard'],
      approxRates: { cardboard: 9 },
      consentGiven: true,
    });
    expect(reg.status).toBe(200);

    const nearby = await call<PickupRequest[]>('recycler', 'GET', '/recycler/requests');
    const row = nearby.body.find((p) => p.requestId === created.body.requestId)!;
    expect(row.distanceKm).toBeLessThan(10);

    const accepted = await call<PickupRequest>(
      'recycler',
      'POST',
      `/recycler/requests/${row.requestId}/accept`,
    );
    expect(accepted.body).toMatchObject({ status: 'accepted', recyclerName: 'Sunil Kabadiwala' });
    expect(
      (await call('newRecycler', 'POST', `/recycler/requests/${row.requestId}/accept`)).status,
    ).toBe(409);
    expect(
      (await call('newRecycler', 'POST', `/recycler/requests/${row.requestId}/done`)).status,
    ).toBe(409);
    expect((await call('resident', 'POST', `/pickups/${row.requestId}/cancel`)).status).toBe(409);

    const done = await call<PickupRequest>(
      'recycler',
      'POST',
      `/recycler/requests/${row.requestId}/done`,
    );
    expect(done.body.status).toBe('done');
    const mine = await call<PickupRequest[]>('resident', 'GET', '/pickups/mine');
    expect(mine.body[0]).toMatchObject({ status: 'done', recyclerPhone: '+91 00000 00001' });
    expect(
      rt.notifier.outbox.some((e) => e.kind === 'email' && e.message.to === 'heer@cleanloop.local'),
    ).toBe(true);
  });

  it('requires consent to register', async () => {
    const res = await call('newRecycler', 'PUT', '/recycler/me', {
      name: 'X Y',
      phone: '+919811111111',
      area: 'Somewhere',
      lat: 28.7,
      lng: 77.1,
      acceptedMaterials: ['paper'],
      consentGiven: false,
    });
    expect(res.status).toBe(400);
  });
});

describe('alerts and profile', () => {
  it('subscribes a lane by email and validates phone numbers', async () => {
    const sub = await call<{ pendingConfirmation: boolean }>('resident', 'POST', '/alerts', {
      laneId: DEMO_LANE_ID,
      channel: 'email',
      endpoint: 'heer@example.com',
    });
    expect(sub.body.pendingConfirmation).toBe(true);
    expect(
      (
        await call('resident', 'POST', '/alerts', {
          laneId: DEMO_LANE_ID,
          channel: 'sms',
          endpoint: '98100',
        })
      ).status,
    ).toBe(400);
    expect((await call<unknown[]>('resident', 'GET', '/alerts')).body).toHaveLength(1);
    await call('resident', 'DELETE', '/alerts/email');
    expect((await call<unknown[]>('resident', 'GET', '/alerts')).body).toHaveLength(0);
  });

  it('remembers the chosen lane and language', async () => {
    const lane = 'lane-shahbad-3';
    const res = await call<{ laneId: string; wardId: string; lang: string }>(
      'resident',
      'PUT',
      '/me',
      { laneId: lane, lang: 'hi' },
    );
    expect(res.body).toMatchObject({ laneId: lane, wardId: 'ward-dtu', lang: 'hi' });
    const home = await call<ResidentHome>('resident', 'GET', '/resident/home');
    expect(home.body.lane?.laneId).toBe(lane);
  });

  it('summarises personal and ward impact', async () => {
    const photoKey = await upload('resident', 'sort');
    await call('resident', 'POST', '/sort', { photoKey });
    const impact = await call<{ me: { itemsSorted: number }; ward: { itemsSorted7d: number } }>(
      'resident',
      'GET',
      '/impact',
    );
    expect(impact.body.me.itemsSorted).toBe(1);
    expect(impact.body.ward.itemsSorted7d).toBe(1);
  });

  it('never exposes the officer email to clients', async () => {
    const wards = await call<{ ward: Record<string, unknown> }[]>('resident', 'GET', '/wards');
    expect(wards.body[0]!.ward).not.toHaveProperty('officerEmail');
    expect(wards.body[0]!.ward.name).toBeTruthy();
  });
});

it('every role can open its home screen', async () => {
  const checks: [Role, string][] = [
    ['resident', '/resident/home'],
    ['driver', '/driver/route'],
    ['officer', '/officer/overview'],
    ['recycler', '/recycler/me'],
  ];
  for (const [role, path] of checks) {
    expect((await call(role, 'GET', path)).status, `${role} ${path}`).toBe(200);
  }
});
