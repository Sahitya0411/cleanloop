import type {
  AlertChannel,
  AlertSubscription,
  CreateReportResponse,
  DriverRoute,
  ImpactSummary,
  Lang,
  LaneNotification,
  Material,
  OfficerOverview,
  PickupItemType,
  PickupRequest,
  PlanResult,
  Profile,
  Recycler,
  Report,
  ResidentHome,
  SortResult,
  TrackInfo,
  UploadPurpose,
  UploadTicket,
  WardWithLanes,
  WasteCategory,
} from '@cleanloop/shared';
import { getIdToken } from './auth';
import { config } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let onUnauthorized: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getIdToken();
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'No connection. Check your internet and try again.');
  }
  const text = await res.text();
  let json: { error?: string; message?: string } | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error ?? 'error',
      json?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request<Profile>('GET', '/me'),
  updateMe: (patch: Partial<Pick<Profile, 'name' | 'phone' | 'laneId' | 'lang'>>) =>
    request<Profile>('PUT', '/me', patch),
  wards: () => request<WardWithLanes[]>('GET', '/wards'),
  uploadTicket: (purpose: UploadPurpose, contentType: string) =>
    request<UploadTicket>('POST', '/uploads', { purpose, contentType }),
  notifications: (laneId?: string) =>
    request<LaneNotification[]>('GET', `/notifications${q({ laneId })}`),
  track: (laneId: string) =>
    request<TrackInfo>('GET', `/lanes/${encodeURIComponent(laneId)}/track`),

  residentHome: (laneId?: string) => request<ResidentHome>('GET', `/resident/home${q({ laneId })}`),
  impact: () => request<ImpactSummary>('GET', '/impact'),
  sort: (photoKey: string, lang: Lang, fileName?: string) =>
    request<SortResult>('POST', '/sort', { photoKey, lang, fileName }),
  chooseSort: (
    id: string,
    body: { category: WasteCategory; material?: Material; itemName?: string },
  ) => request<SortResult>('POST', `/sort/${encodeURIComponent(id)}/choose`, body),
  createReport: (body: {
    photoKey: string;
    lat?: number;
    lng?: number;
    laneId?: string;
    note?: string;
    lang: Lang;
    force?: boolean;
    fileName?: string;
  }) => request<CreateReportResponse>('POST', '/reports', body),
  myReports: () => request<Report[]>('GET', '/reports/mine'),
  report: (id: string) => request<Report>('GET', `/reports/${encodeURIComponent(id)}`),
  createPickup: (body: {
    itemType: PickupItemType;
    material: Material;
    photoKey?: string;
    lat?: number;
    lng?: number;
    laneId?: string;
    notes?: string;
    estWeightKg?: number;
    phone?: string;
  }) => request<PickupRequest>('POST', '/pickups', body),
  myPickups: () => request<PickupRequest[]>('GET', '/pickups/mine'),
  cancelPickup: (id: string) =>
    request<PickupRequest>('POST', `/pickups/${encodeURIComponent(id)}/cancel`),
  alerts: () => request<AlertSubscription[]>('GET', '/alerts'),
  subscribe: (laneId: string, channel: AlertChannel, endpoint: string) =>
    request<AlertSubscription>('POST', '/alerts', { laneId, channel, endpoint }),
  unsubscribe: (channel: AlertChannel) => request<{ ok: true }>('DELETE', `/alerts/${channel}`),

  driverRoute: () => request<DriverRoute>('GET', '/driver/route'),
  stopDone: (seq: number) => request<DriverRoute>('POST', `/driver/stops/${seq}/done`),
  stopSkip: (seq: number, reason: string) =>
    request<DriverRoute>('POST', `/driver/stops/${seq}/skip`, { reason }),

  officerOverview: () => request<OfficerOverview>('GET', '/officer/overview'),
  officerReports: (status: 'open' | 'resolved' | 'all') =>
    request<Report[]>('GET', `/officer/reports${q({ status })}`),
  markSeen: (id: string) => request<Report>('POST', `/reports/${encodeURIComponent(id)}/seen`),
  resolve: (id: string, afterPhotoKey: string, note?: string) =>
    request<Report>('POST', `/reports/${encodeURIComponent(id)}/resolve`, { afterPhotoKey, note }),
  plan: (body: { date?: string; force?: boolean } = {}) =>
    request<PlanResult>('POST', '/officer/plan', body),
  resetToday: () => request<PlanResult>('POST', '/officer/demo/reset-today'),
  officerRecyclers: () => request<Recycler[]>('GET', '/officer/recyclers'),
  officerPickups: () => request<PickupRequest[]>('GET', '/officer/pickups'),

  recyclerMe: () => request<{ recycler: Recycler | null }>('GET', '/recycler/me'),
  saveRecycler: (body: Omit<Recycler, 'recyclerId' | 'createdAt' | 'updatedAt' | 'email'>) =>
    request<Recycler>('PUT', '/recycler/me', body),
  recyclerRequests: (scope: 'nearby' | 'all') =>
    request<PickupRequest[]>('GET', `/recycler/requests${q({ scope })}`),
  acceptPickup: (id: string) =>
    request<PickupRequest>('POST', `/recycler/requests/${encodeURIComponent(id)}/accept`),
  completePickup: (id: string) =>
    request<PickupRequest>('POST', `/recycler/requests/${encodeURIComponent(id)}/done`),
  recyclerJobs: () => request<PickupRequest[]>('GET', '/recycler/jobs'),
};
