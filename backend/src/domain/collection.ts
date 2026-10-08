import type {
  DriverRoute,
  EtaInfo,
  Lane,
  LaneNotification,
  Route,
  Stop,
  TrackInfo,
} from '@cleanloop/shared';
import { istDate } from '@cleanloop/shared';
import { computeEta, minutesUntil, trackStops } from '../core/eta';
import { messagesForStopChange } from '../core/notify-rules';
import { ConditionFailedError } from '../data/kv';
import type { AppContext } from '../services/types';
import type { AuthUser } from './common';
import { HttpError, conflict, notFound } from './common';
import { ensureRuns } from './planning';

export async function routeForLane(ctx: AppContext, lane: Lane): Promise<Route | undefined> {
  const routes = await ctx.repo.listRoutes(lane.wardId);
  return routes.find((r) => r.baselineOrder.includes(lane.laneId)) ?? routes[0];
}

export async function laneEta(
  ctx: AppContext,
  lane: Lane,
  date = istDate(ctx.now()),
): Promise<EtaInfo> {
  await ensureRuns(ctx, lane.wardId, date);
  const route = await routeForLane(ctx, lane);
  const run = route && (await ctx.repo.getRun(route.routeId, date));
  const stops = route ? await ctx.repo.listStops(route.routeId, date) : [];
  return computeEta(lane.laneId, { route, run, stops, date, now: ctx.now() });
}

export async function laneTrack(ctx: AppContext, lane: Lane): Promise<TrackInfo> {
  const date = istDate(ctx.now());
  await ensureRuns(ctx, lane.wardId, date);
  const route = await routeForLane(ctx, lane);
  const run = route && (await ctx.repo.getRun(route.routeId, date));
  const stops = route ? await ctx.repo.listStops(route.routeId, date) : [];
  const etaCtx = { route, run, stops, date, now: ctx.now() };
  return {
    eta: computeEta(lane.laneId, etaCtx),
    stops: trackStops(lane.laneId, etaCtx),
    path: run?.path,
    depot: route?.depot,
  };
}

async function routeForDriver(ctx: AppContext, user: AuthUser): Promise<Route> {
  for (const ward of await ctx.repo.listWards()) {
    const routes = await ctx.repo.listRoutes(ward.wardId);
    const mine = routes.find((r) => r.driverId === user.userId);
    if (mine) return mine;
  }
  throw new HttpError(404, 'no_route', 'No route is assigned to you yet. Ask your ward officer.');
}

export async function driverRoute(ctx: AppContext, user: AuthUser): Promise<DriverRoute> {
  const route = await routeForDriver(ctx, user);
  const date = istDate(ctx.now());
  await ensureRuns(ctx, route.wardId, date);
  const run = await ctx.repo.getRun(route.routeId, date);
  if (!run) throw notFound('Route run');
  const stops = await ctx.repo.listStops(route.routeId, date);
  return { route, run, stops: stops.sort((a, b) => a.seq - b.seq) };
}

/** Driver taps Done or Skip. The DynamoDB stream does the resident alerts. */
export async function markStop(
  ctx: AppContext,
  user: AuthUser,
  seq: number,
  status: 'done' | 'skipped',
  skipReason?: string,
): Promise<DriverRoute> {
  const route = await routeForDriver(ctx, user);
  const date = istDate(ctx.now());
  const existing = await ctx.repo.getStop(route.routeId, date, seq);
  if (!existing) throw notFound('Stop');
  // Mark the run as started first, so a concurrent re-plan can no longer replace it.
  await ctx.repo
    .updateRun(route.routeId, date, { status: 'in_progress' }, { status: 'planned' })
    .catch((err) => {
      if (!(err instanceof ConditionFailedError)) throw err;
    });
  try {
    await ctx.repo.updateStop(
      route.routeId,
      date,
      seq,
      {
        status,
        doneAt: ctx.now().toISOString(),
        skipReason: status === 'skipped' ? skipReason : undefined,
      },
      'pending',
    );
  } catch (err) {
    if (err instanceof ConditionFailedError) throw conflict('This stop is already marked.');
    throw err;
  }
  const stops = (await ctx.repo.listStops(route.routeId, date)).sort((a, b) => a.seq - b.seq);
  const allHandled = stops.every((s) => s.status !== 'pending');
  const run = await ctx.repo.updateRun(route.routeId, date, {
    status: allHandled ? 'completed' : 'in_progress',
  });
  ctx.metrics.count(status === 'done' ? 'StopsDone' : 'StopsSkipped');
  return { route, run, stops };
}

/**
 * Turns a stop status change into lane notifications (in-app) and SNS alerts
 * (SMS/email). Called by the DynamoDB Streams Lambda, or directly in local mode.
 */
export async function processStopChange(
  ctx: AppContext,
  before: Stop | undefined,
  after: Stop,
): Promise<LaneNotification[]> {
  // Only today's taps alert anyone (re-seeding history must not page residents).
  if (after.date !== istDate(ctx.now())) return [];
  const route = await ctx.repo.getRoute(after.routeId);
  if (!route) return [];
  const stops = await ctx.repo.listStops(after.routeId, after.date);
  const minutes = minutesUntil(route, stops, after.date, ctx.now());
  const messages = messagesForStopChange(before, after, stops, minutes);
  const sent: LaneNotification[] = [];
  for (const m of messages) {
    // Deterministic id and time: a retried stream batch finds it and does not re-send.
    const notification: LaneNotification = {
      laneId: m.laneId,
      id: `${after.routeId}-${after.seq}-${after.status}-${m.type}`,
      type: m.type,
      message: m.message,
      messageHi: m.messageHi,
      createdAt: after.doneAt ?? ctx.now().toISOString(),
    };
    if (await ctx.repo.hasNotification(notification)) continue;
    await ctx.repo.putNotification(notification);
    sent.push(notification);
    if (m.push) {
      try {
        await ctx.notifier.publishLaneAlert(m.laneId, {
          subject: m.sms.replace(/^CleanLoop: /, 'CleanLoop · '),
          sms: m.sms,
          email: `${m.message}\n\n${m.messageHi}\n\nOpen CleanLoop: ${ctx.config.appUrl}`,
        });
        ctx.metrics.count('LaneAlertsSent');
      } catch (err) {
        ctx.log.error('lane alert failed', { laneId: m.laneId, error: String(err) });
      }
    }
  }
  return sent;
}
