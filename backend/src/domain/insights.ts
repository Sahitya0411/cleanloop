import type {
  AlertChannel,
  AlertSubscription,
  ImpactSummary,
  OfficerOverview,
  ResidentHome,
} from '@cleanloop/shared';
import { addDays, istDate, istDateTime, round } from '@cleanloop/shared';
import type { AppContext } from '../services/types';
import type { AuthUser, WardRecord } from './common';
import { badRequest, defaultWard, getOrCreateProfile, notFound, publicWard } from './common';
import { laneEta } from './collection';
import { ensureRuns, planWard } from './planning';
import { sortForInbox, withPhotos } from './reports';

export async function residentHome(
  ctx: AppContext,
  user: AuthUser,
  laneIdParam?: string,
): Promise<ResidentHome> {
  let profile = await getOrCreateProfile(ctx, user);
  let laneId = laneIdParam ?? profile.laneId;
  if (!laneId) {
    const ward = await defaultWard(ctx);
    laneId = (await ctx.repo.listLanes(ward.wardId))[0]?.laneId;
  }
  const lane = laneId ? await ctx.repo.getLane(laneId) : undefined;
  if (!lane) return { profile, notifications: [] };
  if (profile.laneId !== lane.laneId) {
    profile = { ...profile, laneId: lane.laneId, wardId: lane.wardId };
    await ctx.repo.putProfile(profile);
  }
  const ward = (await ctx.repo.getWard(lane.wardId)) as WardRecord | undefined;
  const today = istDate(ctx.now());
  const [eta, risk, notifications] = await Promise.all([
    laneEta(ctx, lane, today),
    ctx.repo.getRisk(lane.laneId, today),
    ctx.repo.listNotifications(lane.laneId, 10),
  ]);
  return { profile, ward: ward && publicWard(ward), lane, eta, risk, notifications };
}

export async function officerOverview(ctx: AppContext, wardId?: string): Promise<OfficerOverview> {
  const ward = wardId
    ? ((await ctx.repo.getWard(wardId)) as WardRecord | undefined)
    : await defaultWard(ctx);
  if (!ward) throw notFound('Ward');
  const today = istDate(ctx.now());
  const tomorrow = addDays(today, 1);
  const weekAgoIso = istDateTime(addDays(today, -6), '00:00').toISOString();

  await ensureRuns(ctx, ward.wardId, today);
  let riskTomorrow = await ctx.repo.listRisks(ward.wardId, tomorrow);
  const routes = await ctx.repo.listRoutes(ward.wardId);
  let plans = (await Promise.all(routes.map((r) => ctx.repo.getRun(r.routeId, tomorrow)))).filter(
    (r) => r !== undefined,
  );
  if (!riskTomorrow.length || plans.length < routes.length) {
    const planned = await planWard(ctx, ward.wardId, tomorrow, 'nightly');
    riskTomorrow = planned.risks;
    plans = planned.runs;
  }

  const reports = await ctx.repo.listWardReports(
    ward.wardId,
    istDateTime(addDays(today, -30), '00:00').toISOString(),
  );
  const open = sortForInbox(reports.filter((r) => r.status !== 'resolved'));
  const today_ = await Promise.all(
    routes.map(async (r) => ({
      run: (await ctx.repo.getRun(r.routeId, today))!,
      stops: (await ctx.repo.listStops(r.routeId, today)).sort((a, b) => a.seq - b.seq),
    })),
  );
  const recentRuns = await ctx.repo.listWardRuns(ward.wardId, addDays(today, -6), today);
  const pickups = await ctx.repo.listPickups();

  return {
    ward: publicWard(ward),
    routes,
    lanes: await ctx.repo.listLanes(ward.wardId),
    kpis: {
      open: open.length,
      high: open.filter((r) => r.severity === 'high').length,
      medium: open.filter((r) => r.severity === 'medium').length,
      low: open.filter((r) => r.severity === 'low').length,
      resolved7d: reports.filter((r) => r.resolvedAt && r.resolvedAt >= weekAgoIso).length,
    },
    reports: await Promise.all(open.slice(0, 50).map((r) => withPhotos(ctx, r))),
    riskTomorrow,
    plans,
    today: today_.filter((t) => t.run),
    savings7d: {
      kmSaved: round(
        recentRuns.reduce((s, r) => s + r.savings.kmSaved, 0),
        1,
      ),
      dieselLitresSaved: round(
        recentRuns.reduce((s, r) => s + r.savings.dieselLitresSaved, 0),
        1,
      ),
      co2KgSaved: round(
        recentRuns.reduce((s, r) => s + r.savings.co2KgSaved, 0),
        1,
      ),
      // Seeded history runs model the old fixed route, so they do not count.
      runs: recentRuns.filter((r) => r.generatedBy !== 'seed').length,
    },
    recyclers: (await ctx.repo.listRecyclers()).length,
    openPickups: pickups.filter((p) => p.status === 'open').length,
    tomorrow,
  };
}

export async function impactFor(ctx: AppContext, user: AuthUser): Promise<ImpactSummary> {
  const profile = await getOrCreateProfile(ctx, user);
  const ward = profile.wardId
    ? ((await ctx.repo.getWard(profile.wardId)) as WardRecord | undefined)
    : await defaultWard(ctx);
  const today = istDate(ctx.now());
  const weekAgo = addDays(today, -6);
  const weekAgoIso = istDateTime(weekAgo, '00:00').toISOString();

  const [sorts, reports, pickups, runs, wardReports, allPickups] = await Promise.all([
    ctx.repo.listUserSorts(user.userId, 1000),
    ctx.repo.listUserReports(user.userId),
    ctx.repo.listUserPickups(user.userId),
    ward ? ctx.repo.listWardRuns(ward.wardId, weekAgo, today) : Promise.resolve([]),
    ward ? ctx.repo.listWardReports(ward.wardId, weekAgoIso) : Promise.resolve([]),
    ctx.repo.listPickups(weekAgoIso),
  ]);
  let itemsSorted7d = 0;
  for (let d = 0; d < 7; d++) itemsSorted7d += await ctx.repo.countSortsOn(addDays(today, -d));

  return {
    me: {
      itemsSorted: sorts.length,
      reports: reports.length,
      reportsResolved: reports.filter((r) => r.status === 'resolved').length,
      pickups: pickups.filter((p) => p.status !== 'cancelled').length,
    },
    ward: {
      kmSaved7d: round(
        runs.reduce((s, r) => s + r.savings.kmSaved, 0),
        1,
      ),
      dieselLitresSaved7d: round(
        runs.reduce((s, r) => s + r.savings.dieselLitresSaved, 0),
        1,
      ),
      co2KgSaved7d: round(
        runs.reduce((s, r) => s + r.savings.co2KgSaved, 0),
        1,
      ),
      reportsResolved7d: wardReports.filter((r) => r.status === 'resolved').length,
      pickupsDone7d: allPickups.filter((p) => p.status === 'done').length,
      itemsSorted7d,
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

export async function subscribeAlerts(
  ctx: AppContext,
  user: AuthUser,
  input: { laneId: string; channel: AlertChannel; endpoint: string },
): Promise<AlertSubscription> {
  const lane = await ctx.repo.getLane(input.laneId);
  if (!lane) throw notFound('Lane');
  const endpoint = input.endpoint.trim();
  if (input.channel === 'email' && !EMAIL_RE.test(endpoint))
    throw badRequest('Enter a valid email');
  if (input.channel === 'sms' && !PHONE_RE.test(endpoint)) {
    throw badRequest('Enter the phone number with country code, e.g. +919876543210');
  }
  // One subscription per lane and channel: replace any older one.
  for (const old of await ctx.repo.listUserSubscriptions(user.userId)) {
    if (old.channel !== input.channel) continue;
    if (old.subscriptionArn) await ctx.notifier.unsubscribe(old.subscriptionArn);
    await ctx.repo.deleteSubscription(old.laneId, user.userId, old.channel);
  }
  const res = await ctx.notifier.subscribe(lane.laneId, input.channel, endpoint);
  const sub: AlertSubscription = {
    laneId: lane.laneId,
    userId: user.userId,
    channel: input.channel,
    endpoint,
    subscriptionArn: res.subscriptionArn,
    pendingConfirmation: res.pendingConfirmation,
    createdAt: ctx.now().toISOString(),
  };
  await ctx.repo.putSubscription(sub);
  ctx.metrics.count('AlertSubscriptions');
  return sub;
}

export async function unsubscribeAlerts(ctx: AppContext, user: AuthUser, channel: AlertChannel) {
  for (const sub of await ctx.repo.listUserSubscriptions(user.userId)) {
    if (sub.channel !== channel) continue;
    if (sub.subscriptionArn) await ctx.notifier.unsubscribe(sub.subscriptionArn);
    await ctx.repo.deleteSubscription(sub.laneId, user.userId, channel);
  }
}
