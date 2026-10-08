// API contract shared by the backend (Lambda) and the frontend (PWA).

export type Role = 'resident' | 'driver' | 'officer' | 'recycler';
export const ROLES: readonly Role[] = ['resident', 'driver', 'officer', 'recycler'];

export type Lang = 'en' | 'hi';

/** Solid Waste Management Rules 2026 four streams, plus e-waste (E-Waste Management Rules 2022). */
export type WasteCategory = 'wet' | 'dry' | 'sanitary' | 'special_care' | 'e_waste';

export type Material =
  | 'organic'
  | 'plastic'
  | 'paper'
  | 'cardboard'
  | 'metal'
  | 'glass'
  | 'textile'
  | 'electronics'
  | 'battery'
  | 'hazardous'
  | 'sanitary'
  | 'mixed'
  | 'other';

export type Severity = 'low' | 'medium' | 'high';
export type RiskLevel = 'low' | 'medium' | 'high';
export type StopStatus = 'pending' | 'done' | 'skipped';
export type ReportStatus = 'sent' | 'seen' | 'resolved';
export type PickupStatus = 'open' | 'accepted' | 'done' | 'cancelled';
export type PickupItemType = 'dry' | 'e_waste';
export type AiSource = 'bedrock' | 'rekognition' | 'manual' | 'mock';
export type UploadPurpose = 'sort' | 'report' | 'pickup' | 'resolve';
export type AlertChannel = 'email' | 'sms';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface WardEvent {
  date: string; // YYYY-MM-DD (IST)
  label: string;
}

export interface Ward {
  wardId: string;
  name: string;
  shortName: string;
  city: string;
  centre: LatLng;
  radiusKm: number;
  eventDates: WardEvent[];
}

export interface Lane {
  laneId: string;
  wardId: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  /** Weekly market days, 0 = Sunday ... 6 = Saturday. */
  marketDays: number[];
  households: number;
}

export interface Route {
  routeId: string;
  wardId: string;
  name: string;
  vehicleType: 'diesel' | 'ev';
  vehicleNumber: string;
  startTime: string; // HH:MM (IST)
  depot: LatLng & { name: string };
  baselineOrder: string[]; // laneIds in the fixed, pre-CleanLoop order
  driverId?: string;
  kmPerLitre: number;
}

export interface Stop {
  routeId: string;
  date: string;
  seq: number;
  laneId: string;
  laneName: string;
  lat: number;
  lng: number;
  avgMinutesToNext: number;
  status: StopStatus;
  /** Time the stop was handled (done or skipped). */
  doneAt?: string;
  skipReason?: string;
  riskScore?: number;
  riskLevel?: RiskLevel;
}

export interface Savings {
  baselineKm: number;
  optimisedKm: number;
  kmSaved: number;
  dieselLitresSaved: number;
  co2KgSaved: number;
  kmPerLitre: number;
  co2KgPerLitre: number;
  method: DistanceMethod;
  vehicleType: 'diesel' | 'ev';
}

export type DistanceMethod = 'amazon-location' | 'estimate';

export interface DeferredLane {
  laneId: string;
  laneName: string;
  score: number;
}

export interface RouteRun {
  routeId: string;
  wardId: string;
  routeName: string;
  date: string;
  status: 'planned' | 'in_progress' | 'completed';
  order: string[];
  deferred: DeferredLane[];
  savings: Savings;
  /** Road geometry for the optimised route as [lng, lat] pairs, when Amazon Location returned one. */
  path?: [number, number][];
  generatedAt: string;
  generatedBy: 'nightly' | 'officer' | 'seed';
}

export interface RiskFactors {
  pastReports: number;
  daysSincePickup: number;
  missedStops: number;
  rain: number;
  eventDay: number;
}

export interface RiskInputs {
  reportsSameWeekday: number;
  daysSincePickup: number | null;
  skippedLast7: number;
  rainProbability: number | null;
  rainMm: number | null;
  eventLabel: string | null;
}

export interface RiskScore {
  laneId: string;
  laneName: string;
  wardId: string;
  date: string;
  score: number;
  level: RiskLevel;
  factors: RiskFactors;
  inputs: RiskInputs;
  computedAt: string;
}

export interface BinInfo {
  category: WasteCategory;
  label: string;
  labelHi: string;
  colour: string;
  instruction: string;
  instructionHi: string;
}

export interface SortResult {
  id: string;
  itemName: string;
  category: WasteCategory;
  material: Material;
  tip: string;
  confidence: number;
  lowConfidence: boolean;
  recyclable: boolean;
  pickupEligible: boolean;
  source: AiSource;
  photoKey?: string;
  photoUrl?: string;
  createdAt: string;
}

export interface SeverityAnalysis {
  isBinOrDump: boolean;
  severity: Severity;
  reason: string;
  confidence: number;
  hazards: string[];
  source: AiSource;
}

export interface Report {
  reportId: string;
  wardId: string;
  wardName: string;
  laneId?: string;
  laneName?: string;
  lat: number;
  lng: number;
  locationSource: 'gps' | 'lane';
  photoKey: string;
  photoUrl?: string;
  severity: Severity;
  confidence: number;
  isBinOrDump: boolean;
  reason: string;
  hazards: string[];
  aiSource: AiSource;
  status: ReportStatus;
  note?: string;
  reporterId: string;
  reporterName?: string;
  createdAt: string;
  seenAt?: string;
  resolvedAt?: string;
  resolvedNote?: string;
  afterPhotoKey?: string;
  afterPhotoUrl?: string;
}

export type CreateReportResponse =
  | { created: true; report: Report; analysis: SeverityAnalysis }
  | { created: false; analysis: SeverityAnalysis; message: string };

export interface PickupRequest {
  requestId: string;
  residentId: string;
  residentName: string;
  residentPhone?: string;
  itemType: PickupItemType;
  material: Material;
  photoKey?: string;
  photoUrl?: string;
  lat: number;
  lng: number;
  laneId?: string;
  laneName?: string;
  notes?: string;
  estWeightKg?: number;
  status: PickupStatus;
  suggestedRecyclerId?: string;
  recyclerId?: string;
  recyclerName?: string;
  recyclerPhone?: string;
  createdAt: string;
  acceptedAt?: string;
  doneAt?: string;
  /** Present on recycler views: distance from the recycler's base. */
  distanceKm?: number;
}

export interface Recycler {
  recyclerId: string;
  name: string;
  phone: string;
  email?: string;
  area: string;
  lat: number;
  lng: number;
  acceptedMaterials: Material[];
  /** Approximate rates in INR per kg, keyed by material. */
  approxRates: Partial<Record<Material, number>>;
  consentGiven: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NotificationType = 'truck_near' | 'missed' | 'collected' | 'deferred' | 'info';

export interface LaneNotification {
  laneId: string;
  id: string;
  type: NotificationType;
  message: string;
  messageHi: string;
  createdAt: string;
}

export interface Profile {
  userId: string;
  role: Role;
  name: string;
  email?: string;
  phone?: string;
  laneId?: string;
  wardId?: string;
  lang: Lang;
}

export interface EtaStop {
  seq: number;
  laneId: string;
  laneName: string;
  lat: number;
  lng: number;
  status: StopStatus;
  etaAt?: string;
  minutes?: number;
  doneAt?: string;
  isMine: boolean;
}

export type EtaStatus =
  'upcoming' | 'next' | 'collected' | 'missed' | 'deferred' | 'not_scheduled' | 'no_route';

export interface EtaInfo {
  status: EtaStatus;
  date: string;
  routeId?: string;
  routeName?: string;
  stopsAway?: number;
  minutes?: number;
  etaAt?: string;
  late?: boolean;
  collectedAt?: string;
  skipReason?: string;
  truck?: LatLng & { label: string };
  upcoming: EtaStop[];
  progress: { handled: number; total: number };
}

export interface TrackInfo {
  eta: EtaInfo;
  stops: EtaStop[];
  path?: [number, number][];
  depot?: LatLng & { name: string };
}

export interface WardWithLanes {
  ward: Ward;
  lanes: Lane[];
}

export interface ResidentHome {
  profile: Profile;
  ward?: Ward;
  lane?: Lane;
  eta?: EtaInfo;
  risk?: RiskScore;
  notifications: LaneNotification[];
}

/** A presigned S3 POST: send `fields` plus the file (as `file`, last) as multipart form data. */
export interface UploadTicket {
  key: string;
  url: string;
  fields: Record<string, string>;
  maxBytes: number;
}

export interface AlertSubscription {
  laneId: string;
  userId: string;
  channel: AlertChannel;
  endpoint: string;
  subscriptionArn?: string;
  pendingConfirmation: boolean;
  createdAt: string;
}

export interface DriverRoute {
  route: Route;
  run: RouteRun;
  stops: Stop[];
}

export interface OfficerOverview {
  ward: Ward;
  routes: Route[];
  lanes: Lane[];
  kpis: { open: number; high: number; medium: number; low: number; resolved7d: number };
  reports: Report[];
  riskTomorrow: RiskScore[];
  plans: RouteRun[];
  today: { run: RouteRun; stops: Stop[] }[];
  savings7d: { kmSaved: number; dieselLitresSaved: number; co2KgSaved: number; runs: number };
  recyclers: number;
  openPickups: number;
  tomorrow: string;
}

export interface PlanResult {
  date: string;
  runs: RouteRun[];
  risks: RiskScore[];
}

export interface ImpactSummary {
  me: { itemsSorted: number; reports: number; reportsResolved: number; pickups: number };
  ward: {
    kmSaved7d: number;
    dieselLitresSaved7d: number;
    co2KgSaved7d: number;
    reportsResolved7d: number;
    pickupsDone7d: number;
    itemsSorted7d: number;
  };
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
