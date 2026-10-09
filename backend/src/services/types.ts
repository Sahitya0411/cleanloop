import type {
  AiSource,
  AlertChannel,
  DistanceMethod,
  Lang,
  LatLng,
  UploadTicket,
} from '@cleanloop/shared';
import type { SeverityOutput, SortOutput } from '../core/ai-schema';
import type { Repo } from '../data/repo';

export interface ImageInput {
  bytes: Uint8Array;
  mediaType: string;
  key: string;
  /** Set when the image lives in S3, so Rekognition can read it directly. */
  bucket?: string;
}

export interface AiOptions {
  lang: Lang;
  /** Original file name; only the local mock uses it, to make demos predictable. */
  hint?: string;
}

export type SortAiResult = SortOutput & { source: AiSource };
export type SeverityAiResult = SeverityOutput & { source: AiSource };

export interface WasteAi {
  classify(image: ImageInput, opts: AiOptions): Promise<SortAiResult>;
  assessSeverity(image: ImageInput, opts: AiOptions): Promise<SeverityAiResult>;
}

export interface Storage {
  bucket?: string;
  uploadTicket(key: string, contentType: string): Promise<UploadTicket>;
  read(key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  viewUrl(key: string): Promise<string>;
  /** Server-side writes (seed images). */
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /** Referenced from the HTML as cid:<contentId>. */
  contentId?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface LaneAlert {
  subject: string;
  sms: string;
  email: string;
}

export interface Notifier {
  publishLaneAlert(laneId: string, alert: LaneAlert): Promise<void>;
  subscribe(
    laneId: string,
    channel: AlertChannel,
    endpoint: string,
  ): Promise<{ subscriptionArn?: string; pendingConfirmation: boolean }>;
  unsubscribe(subscriptionArn: string): Promise<void>;
  /** Returns false (and logs) when delivery fails; email is never on the critical path. */
  sendEmail(message: EmailMessage): Promise<boolean>;
}

export interface RouteMeasure {
  km: number;
  /** One entry per consecutive pair of points. */
  legKm: number[];
  legDriveMinutes: number[];
  path?: [number, number][];
  method: DistanceMethod;
}

export interface RoutePlanner {
  measure(points: LatLng[]): Promise<RouteMeasure>;
}

export interface RainForecast {
  probability: number | null;
  mm: number | null;
}

export interface WeatherService {
  rainForecast(point: LatLng, date: string): Promise<RainForecast>;
}

export interface Metrics {
  count(name: string, value?: number): void;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface AppConfig {
  stage: string;
  appUrl: string;
  region: string;
  kmPerLitre: number;
  /** Enables officer demo tools such as resetting today's route. */
  demoTools: boolean;
}

export interface AppContext {
  repo: Repo;
  ai: WasteAi;
  storage: Storage;
  notifier: Notifier;
  planner: RoutePlanner;
  weather: WeatherService;
  metrics: Metrics;
  log: Logger;
  config: AppConfig;
  now: () => Date;
}
