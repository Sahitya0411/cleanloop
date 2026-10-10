import type {
  AlertChannel,
  AlertSubscription,
  Lane,
  LaneNotification,
  PickupRequest,
  Profile,
  Recycler,
  Report,
  RiskScore,
  Route,
  RouteRun,
  SeverityAnalysis,
  SortResult,
  Stop,
  Ward,
} from '@cleanloop/shared';
import { istDateOfIso } from '@cleanloop/shared';
import type { Item, KvStore } from './kv';
import { ConditionFailedError, stripKeys } from './kv';

/*
 * Single-table layout (pk / sk, plus two sparse GSIs):
 *
 *   Ward          WARD#<id>                META            gsi1: WARDS / <id>
 *   Lane          LANE#<id>                META            gsi1: WARD#<w>#LANES / <name>
 *   Risk score    LANE#<id>                RISK#<date>     gsi1: RISK#<w>#<date> / <laneId>
 *   Subscription  LANE#<id>                SUB#<user>#<ch> gsi2: USER#<user> / SUB#<lane>#<ch>
 *   Notification  LANE#<id>                NOTIF#<ts>#<id>  (TTL 14 days)
 *   Route         ROUTE#<id>               META            gsi1: WARD#<w>#ROUTES / <id>
 *   Route run     ROUTE#<id>               RUN#<date>      gsi1: WARD#<w>#RUNS / <date>#<route>
 *   Stop          RUN#<route>#<date>       STOP#<seq>      gsi1: LANE#<lane>#STOPS / <date>#<route>
 *   Report        REPORT#<id>              META            gsi1: WARD#<w>#REPORTS / <createdAt>
 *                                                          gsi2: USER#<reporter> / REPORT#<createdAt>
 *   AI analysis   ANALYSIS#<photoKey>      META             (TTL 1 day)
 *   Pickup        PICKUP#<id>              META            gsi1: PICKUPS / <createdAt>
 *                                                          gsi2: USER#<resident> / PICKUP#<createdAt>
 *   Recycler      RECYCLER#<id>            META            gsi1: RECYCLERS / <name>
 *   Profile       USER#<id>                PROFILE
 *   Sort result   USER#<id>                SORT#<ts>#<id>  gsi1: SORTS#<date> / <ts>
 */

const META = 'META';
const pad = (n: number) => String(n).padStart(3, '0');
const epochSeconds = (ms: number) => Math.floor(ms / 1000);
const DAY_MS = 86_400_000;

export class Repo {
  constructor(private kv: KvStore) {}

  // ---- Wards & lanes -------------------------------------------------------

  wardItem(w: Ward & { officerEmail?: string }): Item {
    return {
      pk: `WARD#${w.wardId}`,
      sk: META,
      gsi1pk: 'WARDS',
      gsi1sk: w.wardId,
      entity: 'WARD',
      ...w,
    };
  }

  async listWards(): Promise<Ward[]> {
    return (await this.kv.queryIndex('gsi1', 'WARDS')).map((i) => stripKeys<Ward>(i));
  }

  async getWard(wardId: string): Promise<Ward | undefined> {
    const item = await this.kv.get(`WARD#${wardId}`, META);
    return item && stripKeys<Ward>(item);
  }

  laneItem(l: Lane): Item {
    return {
      pk: `LANE#${l.laneId}`,
      sk: META,
      gsi1pk: `WARD#${l.wardId}#LANES`,
      gsi1sk: l.name,
      entity: 'LANE',
      ...l,
    };
  }

  async getLane(laneId: string): Promise<Lane | undefined> {
    const item = await this.kv.get(`LANE#${laneId}`, META);
    return item && stripKeys<Lane>(item);
  }

  async listLanes(wardId: string): Promise<Lane[]> {
    return (await this.kv.queryIndex('gsi1', `WARD#${wardId}#LANES`)).map((i) =>
      stripKeys<Lane>(i),
    );
  }

  // ---- Routes, runs, stops ---------------------------------------------------

  routeItem(r: Route): Item {
    return {
      pk: `ROUTE#${r.routeId}`,
      sk: META,
      gsi1pk: `WARD#${r.wardId}#ROUTES`,
      gsi1sk: r.routeId,
      entity: 'ROUTE',
      ...r,
    };
  }

  async getRoute(routeId: string): Promise<Route | undefined> {
    const item = await this.kv.get(`ROUTE#${routeId}`, META);
    return item && stripKeys<Route>(item);
  }

  async listRoutes(wardId: string): Promise<Route[]> {
    return (await this.kv.queryIndex('gsi1', `WARD#${wardId}#ROUTES`)).map((i) =>
      stripKeys<Route>(i),
    );
  }

  runItem(run: RouteRun): Item {
    return {
      pk: `ROUTE#${run.routeId}`,
      sk: `RUN#${run.date}`,
      gsi1pk: `WARD#${run.wardId}#RUNS`,
      gsi1sk: `${run.date}#${run.routeId}`,
      entity: 'RUN',
      ...run,
    };
  }

  async getRun(routeId: string, date: string): Promise<RouteRun | undefined> {
    const item = await this.kv.get(`ROUTE#${routeId}`, `RUN#${date}`);
    return item && stripKeys<RouteRun>(item);
  }

  /**
   * Writes a run. `ifMissing` only creates; `ifPlanned` also replaces a run that has
   * not started. Returns false (without writing) when the condition does not hold.
   */
  async putRun(
    run: RouteRun,
    mode: 'always' | 'ifMissing' | 'ifPlanned' = 'always',
  ): Promise<boolean> {
    try {
      await this.kv.put(
        this.runItem(run),
        mode === 'always'
          ? undefined
          : {
              ifNotExists: true,
              orIfEquals: mode === 'ifPlanned' ? { status: 'planned' } : undefined,
            },
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionFailedError) return false;
      throw err;
    }
  }

  async updateRun(
    routeId: string,
    date: string,
    patch: Partial<RouteRun>,
    expect?: Partial<Pick<RouteRun, 'status'>>,
  ): Promise<RouteRun> {
    return stripKeys<RouteRun>(
      await this.kv.update(`ROUTE#${routeId}`, `RUN#${date}`, patch, { expect }),
    );
  }

  async listWardRuns(wardId: string, fromDate: string, toDate: string): Promise<RouteRun[]> {
    const items = await this.kv.queryIndex('gsi1', `WARD#${wardId}#RUNS`, {
      skFrom: fromDate,
      skTo: `${toDate}#￿`,
    });
    return items.map((i) => stripKeys<RouteRun>(i));
  }

  stopItem(s: Stop): Item {
    return {
      pk: `RUN#${s.routeId}#${s.date}`,
      sk: `STOP#${pad(s.seq)}`,
      gsi1pk: `LANE#${s.laneId}#STOPS`,
      gsi1sk: `${s.date}#${s.routeId}`,
      entity: 'STOP',
      ...s,
    };
  }

  async listStops(routeId: string, date: string): Promise<Stop[]> {
    return (await this.kv.query(`RUN#${routeId}#${date}`, { skPrefix: 'STOP#' })).map((i) =>
      stripKeys<Stop>(i),
    );
  }

  async getStop(routeId: string, date: string, seq: number): Promise<Stop | undefined> {
    const item = await this.kv.get(`RUN#${routeId}#${date}`, `STOP#${pad(seq)}`);
    return item && stripKeys<Stop>(item);
  }

  async deleteStop(routeId: string, date: string, seq: number): Promise<void> {
    await this.kv.delete(`RUN#${routeId}#${date}`, `STOP#${pad(seq)}`);
  }

  async putStops(stops: Stop[]): Promise<void> {
    await this.kv.batchPut(stops.map((s) => this.stopItem(s)));
  }

  /** Conditional update: fails with ConditionFailedError unless the stop is still `expectStatus`. */
  async updateStop(
    routeId: string,
    date: string,
    seq: number,
    patch: Partial<Stop>,
    expectStatus?: Stop['status'],
  ): Promise<Stop> {
    const item = await this.kv.update(`RUN#${routeId}#${date}`, `STOP#${pad(seq)}`, patch, {
      expect: expectStatus ? { status: expectStatus } : undefined,
    });
    return stripKeys<Stop>(item);
  }

  /** A lane's stops across all routes between two dates (inclusive). */
  async laneStops(laneId: string, fromDate: string, toDate: string): Promise<Stop[]> {
    const items = await this.kv.queryIndex('gsi1', `LANE#${laneId}#STOPS`, {
      skFrom: fromDate,
      skTo: `${toDate}#￿`,
    });
    return items.map((i) => stripKeys<Stop>(i));
  }

  // ---- Reports ------------------------------------------------------------------

  reportItem(r: Report): Item {
    return {
      pk: `REPORT#${r.reportId}`,
      sk: META,
      gsi1pk: `WARD#${r.wardId}#REPORTS`,
      gsi1sk: r.createdAt,
      gsi2pk: `USER#${r.reporterId}`,
      gsi2sk: `REPORT#${r.createdAt}`,
      entity: 'REPORT',
      ...r,
    };
  }

  async putReport(r: Report): Promise<void> {
    await this.kv.put(this.reportItem(r));
  }

  async getReport(reportId: string): Promise<Report | undefined> {
    const item = await this.kv.get(`REPORT#${reportId}`, META);
    return item && stripKeys<Report>(item);
  }

  async updateReport(
    reportId: string,
    patch: Partial<Report>,
    expect?: Partial<Pick<Report, 'status'>>,
  ): Promise<Report> {
    return stripKeys<Report>(await this.kv.update(`REPORT#${reportId}`, META, patch, { expect }));
  }

  async listWardReports(wardId: string, sinceIso?: string): Promise<Report[]> {
    const items = await this.kv.queryIndex('gsi1', `WARD#${wardId}#REPORTS`, {
      skFrom: sinceIso,
      reverse: true,
    });
    return items.map((i) => stripKeys<Report>(i));
  }

  async listUserReports(userId: string): Promise<Report[]> {
    const items = await this.kv.queryIndex('gsi2', `USER#${userId}`, {
      skPrefix: 'REPORT#',
      reverse: true,
    });
    return items.map((i) => stripKeys<Report>(i));
  }

  async putAnalysis(photoKey: string, analysis: SeverityAnalysis, now: Date): Promise<void> {
    await this.kv.put({
      pk: `ANALYSIS#${photoKey}`,
      sk: META,
      entity: 'ANALYSIS',
      expiresAt: epochSeconds(now.getTime() + DAY_MS),
      ...analysis,
    });
  }

  async getAnalysis(photoKey: string): Promise<SeverityAnalysis | undefined> {
    const item = await this.kv.get(`ANALYSIS#${photoKey}`, META);
    return item && stripKeys<SeverityAnalysis>(item);
  }

  // ---- Pickups & recyclers --------------------------------------------------------

  pickupItem(p: PickupRequest): Item {
    return {
      pk: `PICKUP#${p.requestId}`,
      sk: META,
      gsi1pk: 'PICKUPS',
      gsi1sk: p.createdAt,
      gsi2pk: `USER#${p.residentId}`,
      gsi2sk: `PICKUP#${p.createdAt}`,
      entity: 'PICKUP',
      ...p,
    };
  }

  async putPickup(p: PickupRequest): Promise<void> {
    await this.kv.put(this.pickupItem(p));
  }

  async getPickup(requestId: string): Promise<PickupRequest | undefined> {
    const item = await this.kv.get(`PICKUP#${requestId}`, META);
    return item && stripKeys<PickupRequest>(item);
  }

  async updatePickup(
    requestId: string,
    patch: Partial<PickupRequest>,
    expect?: Partial<Pick<PickupRequest, 'status' | 'recyclerId'>>,
  ): Promise<PickupRequest> {
    return stripKeys<PickupRequest>(
      await this.kv.update(`PICKUP#${requestId}`, META, patch, { expect }),
    );
  }

  async listPickups(sinceIso?: string): Promise<PickupRequest[]> {
    const items = await this.kv.queryIndex('gsi1', 'PICKUPS', { skFrom: sinceIso, reverse: true });
    return items.map((i) => stripKeys<PickupRequest>(i));
  }

  async listUserPickups(userId: string): Promise<PickupRequest[]> {
    const items = await this.kv.queryIndex('gsi2', `USER#${userId}`, {
      skPrefix: 'PICKUP#',
      reverse: true,
    });
    return items.map((i) => stripKeys<PickupRequest>(i));
  }

  recyclerItem(r: Recycler): Item {
    return {
      pk: `RECYCLER#${r.recyclerId}`,
      sk: META,
      gsi1pk: 'RECYCLERS',
      gsi1sk: r.name.toLowerCase(),
      entity: 'RECYCLER',
      ...r,
    };
  }

  async putRecycler(r: Recycler): Promise<void> {
    await this.kv.put(this.recyclerItem(r));
  }

  async getRecycler(recyclerId: string): Promise<Recycler | undefined> {
    const item = await this.kv.get(`RECYCLER#${recyclerId}`, META);
    return item && stripKeys<Recycler>(item);
  }

  async listRecyclers(): Promise<Recycler[]> {
    return (await this.kv.queryIndex('gsi1', 'RECYCLERS')).map((i) => stripKeys<Recycler>(i));
  }

  // ---- Risk scores --------------------------------------------------------------

  riskItem(r: RiskScore): Item {
    return {
      pk: `LANE#${r.laneId}`,
      sk: `RISK#${r.date}`,
      gsi1pk: `RISK#${r.wardId}#${r.date}`,
      gsi1sk: r.laneId,
      entity: 'RISK',
      ...r,
    };
  }

  async putRisks(risks: RiskScore[]): Promise<void> {
    await this.kv.batchPut(risks.map((r) => this.riskItem(r)));
  }

  async listRisks(wardId: string, date: string): Promise<RiskScore[]> {
    const items = await this.kv.queryIndex('gsi1', `RISK#${wardId}#${date}`);
    return items.map((i) => stripKeys<RiskScore>(i)).sort((a, b) => b.score - a.score);
  }

  async getRisk(laneId: string, date: string): Promise<RiskScore | undefined> {
    const item = await this.kv.get(`LANE#${laneId}`, `RISK#${date}`);
    return item && stripKeys<RiskScore>(item);
  }

  // ---- Alerts -------------------------------------------------------------------

  async putSubscription(s: AlertSubscription): Promise<void> {
    await this.kv.put({
      pk: `LANE#${s.laneId}`,
      sk: `SUB#${s.userId}#${s.channel}`,
      gsi2pk: `USER#${s.userId}`,
      gsi2sk: `SUB#${s.laneId}#${s.channel}`,
      entity: 'SUB',
      ...s,
    });
  }

  async getSubscription(
    laneId: string,
    userId: string,
    channel: AlertChannel,
  ): Promise<AlertSubscription | undefined> {
    const item = await this.kv.get(`LANE#${laneId}`, `SUB#${userId}#${channel}`);
    return item && stripKeys<AlertSubscription>(item);
  }

  async deleteSubscription(laneId: string, userId: string, channel: AlertChannel): Promise<void> {
    await this.kv.delete(`LANE#${laneId}`, `SUB#${userId}#${channel}`);
  }

  async listUserSubscriptions(userId: string): Promise<AlertSubscription[]> {
    const items = await this.kv.queryIndex('gsi2', `USER#${userId}`, { skPrefix: 'SUB#' });
    return items.map((i) => stripKeys<AlertSubscription>(i));
  }

  async putNotification(n: LaneNotification): Promise<void> {
    await this.kv.put({
      pk: `LANE#${n.laneId}`,
      sk: `NOTIF#${n.createdAt}#${n.id}`,
      entity: 'NOTIF',
      expiresAt: epochSeconds(Date.parse(n.createdAt) + 14 * DAY_MS),
      ...n,
    });
  }

  async hasNotification(
    n: Pick<LaneNotification, 'laneId' | 'createdAt' | 'id'>,
  ): Promise<boolean> {
    return Boolean(await this.kv.get(`LANE#${n.laneId}`, `NOTIF#${n.createdAt}#${n.id}`));
  }

  async listNotifications(laneId: string, limit = 20): Promise<LaneNotification[]> {
    const items = await this.kv.query(`LANE#${laneId}`, {
      skPrefix: 'NOTIF#',
      reverse: true,
      limit,
    });
    return items.map((i) => stripKeys<LaneNotification>(i));
  }

  // ---- Profiles & sort history --------------------------------------------------------

  async getProfile(userId: string): Promise<Profile | undefined> {
    const item = await this.kv.get(`USER#${userId}`, 'PROFILE');
    return item && stripKeys<Profile>(item);
  }

  async putProfile(p: Profile): Promise<void> {
    await this.kv.put({ pk: `USER#${p.userId}`, sk: 'PROFILE', entity: 'PROFILE', ...p });
  }

  async putSort(userId: string, r: SortResult): Promise<void> {
    await this.kv.put({
      pk: `USER#${userId}`,
      sk: `SORT#${r.createdAt}#${r.id}`,
      gsi1pk: `SORTS#${istDateOfIso(r.createdAt)}`,
      gsi1sk: r.createdAt,
      entity: 'SORT',
      ...r,
    });
  }

  async getSort(userId: string, id: string): Promise<SortResult | undefined> {
    const items = await this.kv.query(`USER#${userId}`, { skPrefix: 'SORT#' });
    const found = items.find((i) => i.id === id);
    return found && stripKeys<SortResult>(found);
  }

  async updateSort(userId: string, r: SortResult): Promise<void> {
    await this.putSort(userId, r);
  }

  async listUserSorts(userId: string, limit = 50): Promise<SortResult[]> {
    const items = await this.kv.query(`USER#${userId}`, {
      skPrefix: 'SORT#',
      reverse: true,
      limit,
    });
    return items.map((i) => stripKeys<SortResult>(i));
  }

  async countSortsOn(date: string): Promise<number> {
    return (await this.kv.queryIndex('gsi1', `SORTS#${date}`)).length;
  }

  // ---- Bulk ----------------------------------------------------------------------

  async batchPut(items: Item[]): Promise<void> {
    await this.kv.batchPut(items);
  }
}
