import AnthropicBedrock, { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoKv } from '../data/dynamo-kv';
import { Repo } from '../data/repo';
import { AwsNotifier } from '../services/aws-notifier';
import { BedrockAi, usesInvokeModel, type MessagesClient } from '../services/bedrock-ai';
import { FallbackAi } from '../services/fallback-ai';
import { AmazonLocationPlanner, EstimatePlanner } from '../services/location-planner';
import { MockAi } from '../services/mock-ai';
import { emfMetrics, jsonLogger } from '../services/observability';
import { NoWeather, OpenMeteoWeather } from '../services/open-meteo';
import { RekognitionAi } from '../services/rekognition-ai';
import { S3Storage } from '../services/s3-storage';
import type { AppContext, Logger, WasteAi } from '../services/types';

export const DEFAULT_MODEL_ID = 'anthropic.claude-opus-5-5';
/**
 * Haiku 4.5 on the Messages endpoint, then Sonnet 4.6 through the older InvokeModel
 * API for accounts that only have that (seen on organisation-managed accounts).
 */
export const DEFAULT_FALLBACK_MODEL_IDS =
  'anthropic.claude-haiku-4-5,global.anthropic.claude-sonnet-4-6';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function modelIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const ids = [
    env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
    ...(env.BEDROCK_FALLBACK_MODEL_IDS ?? DEFAULT_FALLBACK_MODEL_IDS).split(','),
  ]
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Bedrock (Claude) first, Rekognition labels second; `AI_MODE=mock` skips both. */
export function buildAi(
  log: Logger,
  region: string,
  env: NodeJS.ProcessEnv = process.env,
): WasteAi {
  if (env.AI_MODE === 'mock') return new MockAi();
  const awsRegion = env.BEDROCK_REGION || region;
  // Each call gets its own timeout from BedrockAi's budget; no SDK-level retries,
  // because the next model (or Rekognition) is the retry.
  let mantle: MessagesClient | undefined;
  let invokeModel: MessagesClient | undefined;
  const clientFor = (model: string): MessagesClient =>
    usesInvokeModel(model)
      ? (invokeModel ??= new AnthropicBedrock({ awsRegion, maxRetries: 0 }))
      : (mantle ??= new AnthropicBedrockMantle({ awsRegion, maxRetries: 0 }));
  const bedrock = new BedrockAi(clientFor, modelIds(env), log);
  const providers: { name: string; ai: WasteAi }[] = [{ name: 'bedrock', ai: bedrock }];
  if (env.REKOGNITION_FALLBACK !== 'false') {
    providers.push({
      name: 'rekognition',
      ai: new RekognitionAi(
        new RekognitionClient({ maxAttempts: 2, requestHandler: { requestTimeout: 5_000 } }),
      ),
    });
  }
  return new FallbackAi(providers, log);
}

let cached: AppContext | undefined;

/** Built once per Lambda container and reused across invocations. */
export function awsContext(): AppContext {
  if (cached) return cached;
  const env = process.env;
  const stage = env.STAGE ?? 'dev';
  const region = env.AWS_REGION ?? 'ap-south-1';
  const log = jsonLogger({ stage });

  cached = {
    repo: new Repo(new DynamoKv(required('TABLE_NAME'))),
    storage: new S3Storage(new S3Client({}), required('PHOTO_BUCKET')),
    ai: buildAi(log, region, env),
    notifier: new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      required('LANE_TOPIC_ARN'),
      env.SENDER_EMAIL || undefined,
      log,
    ),
    planner:
      env.LOCATION_MODE === 'estimate'
        ? new EstimatePlanner()
        : new AmazonLocationPlanner(new GeoRoutesClient({}), log),
    weather: env.WEATHER_MODE === 'off' ? new NoWeather() : new OpenMeteoWeather(log),
    metrics: emfMetrics(stage),
    log,
    config: {
      stage,
      appUrl: (env.APP_URL ?? '').replace(/\/$/, ''),
      region,
      kmPerLitre: Number(env.KM_PER_LITRE ?? 3) || 3,
      demoTools: env.DEMO_TOOLS === 'true',
    },
    now: () => new Date(),
  };
  return cached;
}
