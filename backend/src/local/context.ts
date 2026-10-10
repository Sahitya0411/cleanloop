import type { Stop } from '@cleanloop/shared';
import { istDate } from '@cleanloop/shared';
import { stripKeys } from '../data/kv';
import { MemoryKv } from '../data/memory-kv';
import { Repo } from '../data/repo';
import { processStopChange } from '../domain/collection';
import { buildAi } from '../handlers/aws-context';
import { LocalNotifier, LocalStorage } from '../services/local';
import { EstimatePlanner } from '../services/location-planner';
import { MockAi } from '../services/mock-ai';
import { jsonLogger, memoryMetrics } from '../services/observability';
import { NoWeather, OpenMeteoWeather } from '../services/open-meteo';
import type { AppContext, Logger, RoutePlanner, WasteAi, WeatherService } from '../services/types';
import { buildSeed, writeSeed, type DemoUserIds } from '../seed/seed-data';

export const LOCAL_DEMO_IDS: DemoUserIds = {
  resident: 'demo-resident',
  driver: 'demo-driver',
  officer: 'demo-officer',
  recycler: 'demo-recycler',
};

export interface LocalOptions {
  baseUrl: string;
  ai?: WasteAi;
  weather?: WeatherService;
  planner?: RoutePlanner;
  log?: Logger;
  now?: () => Date;
}

export interface LocalRuntime {
  ctx: AppContext;
  kv: MemoryKv;
  storage: LocalStorage;
  notifier: LocalNotifier;
  /** Resolves once all simulated stream events have been processed. */
  drain(): Promise<void>;
}

/** Same domain code as AWS, with in-memory storage and a simulated DynamoDB stream. */
export function createLocalRuntime(opts: LocalOptions): LocalRuntime {
  const log = opts.log ?? jsonLogger({ stage: 'local' });
  const kv = new MemoryKv();
  const storage = new LocalStorage(opts.baseUrl);
  const notifier = new LocalNotifier(log);
  const ctx: AppContext = {
    repo: new Repo(kv),
    ai: opts.ai ?? new MockAi(),
    storage,
    notifier,
    planner: opts.planner ?? new EstimatePlanner(),
    weather: opts.weather ?? new NoWeather(),
    metrics: memoryMetrics(),
    log,
    config: {
      stage: 'local',
      appUrl: process.env.APP_URL ?? 'http://localhost:5173',
      region: 'local',
      kmPerLitre: 3,
      demoTools: true,
    },
    now: opts.now ?? (() => new Date()),
  };

  const pending = new Set<Promise<unknown>>();
  kv.onChange((before, after) => {
    if (after?.entity !== 'STOP' || !before || before.status === after.status) return;
    const job = processStopChange(ctx, stripKeys<Stop>(before), stripKeys<Stop>(after))
      .catch((err) => log.error('local stream failed', { error: String(err) }))
      .finally(() => pending.delete(job));
    pending.add(job);
  });

  return {
    ctx,
    kv,
    storage,
    notifier,
    async drain() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

export async function seedLocal(runtime: LocalRuntime): Promise<void> {
  const today = istDate(runtime.ctx.now());
  const data = buildSeed({
    today,
    ids: LOCAL_DEMO_IDS,
    officerEmail: 'officer@cleanloop.local',
    emails: {
      resident: 'heer@cleanloop.local',
      recycler: 'sunil@cleanloop.local',
    },
  });
  await writeSeed(runtime.ctx, data, today);
  await runtime.drain();
}

/** AI for local dev: mock by default, real Bedrock with LOCAL_AI=bedrock and AWS credentials. */
export function localAi(log: Logger): WasteAi {
  if (process.env.LOCAL_AI === 'bedrock') {
    return buildAi(log, process.env.AWS_REGION ?? 'ap-south-1', {
      ...process.env,
      AI_MODE: 'bedrock',
      REKOGNITION_FALLBACK: 'false',
    });
  }
  return new MockAi();
}

export function localWeather(log: Logger): WeatherService {
  return process.env.OFFLINE === '1' ? new NoWeather() : new OpenMeteoWeather(log);
}
