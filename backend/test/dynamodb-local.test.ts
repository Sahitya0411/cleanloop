// Runs the main API flows against a real DynamoDB engine (DynamoDB Local), to catch
// key-condition, index and conditional-write mistakes the in-memory store cannot.
//
//   docker run -d -p 8000:8000 amazon/dynamodb-local
//   DYNAMODB_ENDPOINT=http://localhost:8000 npm test -w backend
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CreateReportResponse,
  DriverRoute,
  OfficerOverview,
  PickupRequest,
  PlanResult,
  ResidentHome,
  UploadTicket,
} from '@cleanloop/shared';
import { buildRouter } from '../src/api/routes';
import { DynamoKv } from '../src/data/dynamo-kv';
import { Repo } from '../src/data/repo';
import type { AuthUser } from '../src/domain/common';
import { LOCAL_DEMO_IDS } from '../src/local/context';
import { LocalNotifier, LocalStorage } from '../src/services/local';
import { EstimatePlanner } from '../src/services/location-planner';
import { MockAi } from '../src/services/mock-ai';
import { memoryMetrics, silentLogger } from '../src/services/observability';
import { NoWeather } from '../src/services/open-meteo';
import type { AppContext } from '../src/services/types';
import { buildSeed, writeSeed } from '../src/seed/seed-data';

const endpoint = process.env.DYNAMODB_ENDPOINT;
const NOW = new Date('2026-10-10T02:30:00.000Z');
const TODAY = '2026-10-10';

describe.skipIf(!endpoint)('against DynamoDB Local', () => {
  const client = new DynamoDBClient({
    endpoint,
    region: 'ap-south-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const table = `cleanloop-test-${Date.now()}`;
  const storage = new LocalStorage('http://local');
  const ctx: AppContext = {
    repo: new Repo(new DynamoKv(table, client)),
    ai: new MockAi(),
    storage,
    notifier: new LocalNotifier(silentLogger),
    planner: new EstimatePlanner(),
    weather: new NoWeather(),
    metrics: memoryMetrics(),
    log: silentLogger,
    config: {
      stage: 'test',
      appUrl: 'http://local',
      region: 'local',
      kmPerLitre: 3,
      demoTools: true,
    },
    now: () => NOW,
  };
  const router = buildRouter();
  const users: Record<string, AuthUser> = {
    resident: { userId: LOCAL_DEMO_IDS.resident, role: 'resident', name: 'Heer' },
    driver: { userId: LOCAL_DEMO_IDS.driver, role: 'driver' },
    officer: { userId: LOCAL_DEMO_IDS.officer, role: 'officer' },
    recycler: { userId: LOCAL_DEMO_IDS.recycler, role: 'recycler' },
  };
  const call = async <T>(who: string, method: string, path: string, body?: unknown) => {
    const url = new URL(path, 'http://x');
    const res = await router.handle(
      {
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        user: users[who],
      },
      ctx,
    );
    return res as { status: number; body: T };
  };

  beforeAll(async () => {
    // Same keys and indexes as infra/template.yaml.
    await client.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: ['pk', 'sk', 'gsi1pk', 'gsi1sk', 'gsi2pk', 'gsi2sk'].map((n) => ({
          AttributeName: n,
          AttributeType: 'S',
        })),
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: ['gsi1', 'gsi2'].map((g) => ({
          IndexName: g,
          KeySchema: [
            { AttributeName: `${g}pk`, KeyType: 'HASH' },
            { AttributeName: `${g}sk`, KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        })),
      }),
    );
    await writeSeed(
      ctx,
      buildSeed({ today: TODAY, ids: LOCAL_DEMO_IDS, officerEmail: 'o@x.in' }),
      TODAY,
    );
  }, 120_000);

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: table })).catch(() => undefined);
  });

  it('serves every home screen from the seeded data', async () => {
    const home = await call<ResidentHome>('resident', 'GET', '/resident/home');
    expect(home.status).toBe(200);
    expect(home.body.eta?.status).toMatch(/upcoming|next/);
    const overview = await call<OfficerOverview>('officer', 'GET', '/officer/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.riskTomorrow.length).toBe(14);
    expect(overview.body.reports.length).toBeGreaterThan(0);
  });

  it('enforces conditional writes on stops and pickups', async () => {
    const route = await call<DriverRoute>('driver', 'GET', '/driver/route');
    const seq = route.body.stops[0]!.seq;
    expect((await call('driver', 'POST', `/driver/stops/${seq}/done`)).status).toBe(200);
    expect((await call('driver', 'POST', `/driver/stops/${seq}/done`)).status).toBe(409);

    const open = await call<PickupRequest[]>('recycler', 'GET', '/recycler/requests?scope=all');
    const id = open.body[0]!.requestId;
    expect((await call('recycler', 'POST', `/recycler/requests/${id}/accept`)).status).toBe(200);
    expect((await call('recycler', 'POST', `/recycler/requests/${id}/accept`)).status).toBe(409);
  });

  it('files and resolves a report through the GSIs', async () => {
    const ticket = await call<UploadTicket>('resident', 'POST', '/uploads', {
      purpose: 'report',
      contentType: 'image/jpeg',
    });
    await storage.write(ticket.body.key, new Uint8Array([1, 2, 3]), 'image/jpeg');
    const created = await call<CreateReportResponse>('resident', 'POST', '/reports', {
      photoKey: ticket.body.key,
      lat: 28.7342,
      lng: 77.1215,
    });
    expect(created.body.created).toBe(true);
    const mine = await call<{ reportId: string }[]>('resident', 'GET', '/reports/mine');
    expect(mine.body.length).toBe(1);
    const reportId = mine.body[0]!.reportId;
    expect(
      (await call<{ status: string }>('officer', 'POST', `/reports/${reportId}/seen`)).body.status,
    ).toBe('seen');
  });

  it('plans tomorrow', async () => {
    const plan = await call<PlanResult>('officer', 'POST', '/officer/plan', {});
    expect(plan.status).toBe(200);
    expect(plan.body.runs[0]!.order.length).toBeGreaterThan(0);
  });
});
