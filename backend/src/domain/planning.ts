import type { Lane, PlanResult, Report, RiskScore, Route, RouteRun, Stop } from '@cleanloop/shared';
import {
  addDays,
  daysBetween,
  istDate,
  istDateOfIso,
  istDateTime,
  weekdayOf,
} from '@cleanloop/shared';
import { decideRoute, type PlanCandidate } from '../core/planner';
import { computeRisk } from '../core/risk';
import { computeSavings, legMinutes } from '../core/savings';
import { EstimatePlanner } from '../services/location-planner';
import type { AppContext, RouteMeasure } from '../services/types';
import type { WardRecord } from './common';
import { notFound } from './common';

const REPORT_HISTORY_DAYS = 56;
const PICKUP_HISTORY_DAYS = 14;

interface LaneHistory {
  daysSincePickup: number | null;
  skippedLast7: number;
}

async function laneHistory(ctx: AppContext, laneId: string, date: string): Promise<LaneHistory> {
  const stops = await ctx.repo.laneStops(
    laneId,
    addDays(date, -PICKUP_HISTORY_DAYS),
    addDays(date, -1),
  );
  const today = istDate(ctx.now());
  // When planning ahead, a stop still pending today is expected to be collected today.
  const lastDone = stops
    .filter((s) => s.status === 'done' || (s.status === 'pending' && s.date >= today))
    .map((s) => s.date)
    .sort()
    .pop();
  const weekAgo = addDays(date, -7);
  return {
    daysSincePickup: lastDone ? daysBetween(lastDone, date) : null,
    skippedLast7: stops.filter((s) => s.status === 'skipped' && s.date >= weekAgo).length,
  };
}

/** Overflow risk (0-100) for every lane of a ward on `date`. */
export async function computeLaneRisks(
  ctx: AppContext,
  ward: WardRecord,
  lanes: Lane[],
  date: string,
  reports?: Report[],
): Promise<{ risks: RiskScore[]; history: Map<string, LaneHistory> }> {
  const weekday = weekdayOf(date);
  const since = istDateTime(addDays(date, -REPORT_HISTORY_DAYS), '00:00').toISOString();
  const wardReports = reports ?? (await ctx.repo.listWardReports(ward.wardId, since));
  const rain = await ctx.weather.rainForecast(ward.centre, date);
  const wardEvent = ward.eventDates.find((e) => e.date === date)?.label ?? null;
  const computedAt = ctx.now().toISOString();

  const history = new Map<string, LaneHistory>();
  const risks: RiskScore[] = [];
  for (const lane of lanes) {
    const h = await laneHistory(ctx, lane.laneId, date);
    history.set(lane.laneId, h);
    const reportsSameWeekday = wardReports.filter((r) => {
      if (r.laneId !== lane.laneId) return false;
      const day = istDateOfIso(r.createdAt);
      return day < date && weekdayOf(day) === weekday;
    }).length;
    const eventLabel = lane.marketDays.includes(weekday) ? 'Weekly market' : wardEvent;
    const inputs = {
      reportsSameWeekday,
      daysSincePickup: h.daysSincePickup,
      skippedLast7: h.skippedLast7,
      rainProbability: rain.probability,
      rainMm: rain.mm,
      eventLabel,
    };
    const { score, level, factors } = computeRisk(inputs);
    risks.push({
      laneId: lane.laneId,
      laneName: lane.name,
      wardId: ward.wardId,
      date,
      score,
      level,
      factors,
      inputs,
      computedAt,
    });
  }
  risks.sort((a, b) => b.score - a.score);
  return { risks, history };
}

/** Both routes must be measured the same way for the savings to mean anything. */
async function measurePair(
  ctx: AppContext,
  baseline: Parameters<AppContext['planner']['measure']>[0],
  optimised: Parameters<AppContext['planner']['measure']>[0],
): Promise<[RouteMeasure, RouteMeasure]> {
  const [a, b] = await Promise.all([ctx.planner.measure(baseline), ctx.planner.measure(optimised)]);
  if (a.method === b.method) return [a, b];
  const estimate = new EstimatePlanner();
  return Promise.all([estimate.measure(baseline), estimate.measure(optimised)]);
}

async function planRoute(
  ctx: AppContext,
  route: Route,
  lanes: Map<string, Lane>,
  risks: Map<string, RiskScore>,
  history: Map<string, LaneHistory>,
  openReportLanes: Set<string>,
  date: string,
  generatedBy: RouteRun['generatedBy'],
): Promise<{ run: RouteRun; stops: Stop[] }> {
  const candidates: PlanCandidate[] = route.baselineOrder
    .map((id) => lanes.get(id))
    .filter((l): l is Lane => Boolean(l))
    .map((lane) => {
      const risk = risks.get(lane.laneId);
      return {
        lane,
        score: risk?.score ?? 50,
        level: risk?.level ?? 'medium',
        daysSincePickup: history.get(lane.laneId)?.daysSincePickup ?? null,
        hasOpenReport: openReportLanes.has(lane.laneId),
        isEventDay: Boolean(risk?.inputs.eventLabel),
      };
    });
  const decision = decideRoute(route, candidates);
  const depot = { lat: route.depot.lat, lng: route.depot.lng };
  const [base, opt] = await measurePair(
    ctx,
    [depot, ...decision.baseline, depot],
    [depot, ...decision.order.map((c) => c.lane), depot],
  );

  const stops: Stop[] = decision.order.map((c, i) => {
    const isLast = i === decision.order.length - 1;
    // Leg i+1 runs from this stop to the next one (leg 0 is depot -> first stop).
    return {
      routeId: route.routeId,
      date,
      seq: i + 1,
      laneId: c.lane.laneId,
      laneName: c.lane.name,
      lat: c.lane.lat,
      lng: c.lane.lng,
      avgMinutesToNext: isLast ? 0 : legMinutes(opt.legKm[i + 1] ?? 0, opt.legDriveMinutes[i + 1]),
      status: 'pending',
      riskScore: c.score,
      riskLevel: c.level,
    };
  });

  const run: RouteRun = {
    routeId: route.routeId,
    wardId: route.wardId,
    routeName: route.name,
    date,
    status: 'planned',
    order: stops.map((s) => s.laneId),
    deferred: decision.deferred.map((c) => ({
      laneId: c.lane.laneId,
      laneName: c.lane.name,
      score: c.score,
    })),
    savings: computeSavings({
      baselineKm: base.km,
      optimisedKm: opt.km,
      vehicleType: route.vehicleType,
      kmPerLitre: route.kmPerLitre || ctx.config.kmPerLitre,
      method: opt.method,
    }),
    path: opt.path,
    generatedAt: ctx.now().toISOString(),
    generatedBy,
  };
  return { run, stops };
}

/**
 * The nightly job for one ward: score every lane, reorder each route (high risk
 * first, nearly-empty lanes deferred) and record the savings against the fixed route.
 * Runs already under way are left untouched unless `force` is set.
 */
export async function planWard(
  ctx: AppContext,
  wardId: string,
  date: string,
  generatedBy: RouteRun['generatedBy'],
  opts: { force?: boolean; onlyIfMissing?: boolean } = {},
): Promise<PlanResult> {
  const ward = (await ctx.repo.getWard(wardId)) as WardRecord | undefined;
  if (!ward) throw notFound('Ward');
  const [laneList, routes] = await Promise.all([
    ctx.repo.listLanes(wardId),
    ctx.repo.listRoutes(wardId),
  ]);
  const since = istDateTime(addDays(date, -REPORT_HISTORY_DAYS), '00:00').toISOString();
  const reports = await ctx.repo.listWardReports(wardId, since);
  const { risks, history } = await computeLaneRisks(ctx, ward, laneList, date, reports);
  await ctx.repo.putRisks(risks);

  const lanes = new Map(laneList.map((l) => [l.laneId, l]));
  const riskByLane = new Map(risks.map((r) => [r.laneId, r]));
  const openReportLanes = new Set(
    reports.filter((r) => r.status !== 'resolved' && r.laneId).map((r) => r.laneId!),
  );

  const runs: RouteRun[] = [];
  for (const route of routes) {
    const existing = await ctx.repo.getRun(route.routeId, date);
    if (existing && existing.status !== 'planned' && !opts.force) {
      runs.push(existing);
      continue;
    }
    const { run, stops } = await planRoute(
      ctx,
      route,
      lanes,
      riskByLane,
      history,
      openReportLanes,
      date,
      generatedBy,
    );
    // The run is written first, conditionally: a run that started (or that a parallel
    // request already created) is never overwritten, and its stops are left alone.
    const mode = opts.force ? 'always' : opts.onlyIfMissing ? 'ifMissing' : 'ifPlanned';
    if (!(await ctx.repo.putRun(run, mode))) {
      const current = await ctx.repo.getRun(route.routeId, date);
      if (current) runs.push(current);
      continue;
    }
    const previous = await ctx.repo.listStops(route.routeId, date);
    await ctx.repo.putStops(stops);
    for (const old of previous.filter((s) => s.seq > stops.length)) {
      await ctx.repo.deleteStop(route.routeId, date, old.seq);
    }
    runs.push(run);
    ctx.metrics.count('RoutesPlanned');
    ctx.metrics.count('KmSavedPlanned', run.savings.kmSaved);
  }
  ctx.log.info('ward planned', { wardId, date, routes: runs.length, generatedBy });
  return { date, runs, risks };
}

/** Plans a day on first use, so a fresh deployment always has a route to show. */
export async function ensureRuns(
  ctx: AppContext,
  wardId: string,
  date: string,
): Promise<RouteRun[]> {
  const routes = await ctx.repo.listRoutes(wardId);
  const runs = await Promise.all(routes.map((r) => ctx.repo.getRun(r.routeId, date)));
  if (runs.every(Boolean)) return runs as RouteRun[];
  return (await planWard(ctx, wardId, date, 'nightly', { onlyIfMissing: true })).runs;
}
