import { randomBytes } from 'node:crypto';
import type { Lang, Profile, Role, UploadPurpose, Ward } from '@cleanloop/shared';
import { MAX_UPLOAD_BYTES } from '../services/s3-storage';
import type { AppContext, ImageInput } from '../services/types';

export interface AuthUser {
  userId: string;
  role: Role;
  email?: string;
  name?: string;
  phone?: string;
}

/** Ward as stored: the officer's address stays server-side. */
export type WardRecord = Ward & { officerEmail?: string };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const forbidden = (message = 'You cannot do that') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Short, URL-safe, time-sortable id like "rpt_mfz3k9x2a7bq". */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = [...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}_${time}${rand}`;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const ALLOWED_UPLOAD_TYPES = Object.keys(EXTENSIONS);

export function uploadKey(userId: string, purpose: UploadPurpose, contentType: string): string {
  return `uploads/${purpose}/${userId}/${newId('img')}.${EXTENSIONS[contentType] ?? 'jpg'}`;
}

/** Users may only attach photos they uploaded themselves, for a matching purpose. */
export function assertOwnUpload(
  key: string,
  userId: string,
  purpose: UploadPurpose | UploadPurpose[],
): void {
  const purposes = Array.isArray(purpose) ? purpose : [purpose];
  const ok = purposes.some((p) => key.startsWith(`uploads/${p}/${userId}/`));
  if (!ok || key.includes('..')) throw forbidden('That photo does not belong to you');
}

export async function loadImage(ctx: AppContext, key: string): Promise<ImageInput> {
  let file: { bytes: Uint8Array; contentType: string };
  try {
    file = await ctx.storage.read(key);
  } catch {
    throw badRequest('Photo upload not found. Please take the photo again.');
  }
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw badRequest('Photo is too large');
  if (!file.contentType.startsWith('image/')) throw badRequest('Upload must be an image');
  return { bytes: file.bytes, mediaType: file.contentType, key, bucket: ctx.storage.bucket };
}

export async function photoUrl(ctx: AppContext, key: string | undefined) {
  return key ? ctx.storage.viewUrl(key) : undefined;
}

export function publicWard(w: WardRecord): Ward {
  const { officerEmail: _hidden, ...ward } = w;
  return ward;
}

export async function getOrCreateProfile(ctx: AppContext, user: AuthUser): Promise<Profile> {
  const existing = await ctx.repo.getProfile(user.userId);
  if (existing && existing.role === user.role) return existing;
  const profile: Profile = {
    userId: user.userId,
    role: user.role,
    name: existing?.name ?? user.name ?? user.email?.split('@')[0] ?? 'Friend',
    email: existing?.email ?? user.email,
    phone: existing?.phone ?? user.phone,
    laneId: existing?.laneId,
    wardId: existing?.wardId,
    lang: existing?.lang ?? ('en' as Lang),
  };
  await ctx.repo.putProfile(profile);
  return profile;
}

/** The ward to show by default when a user has not picked one. */
export async function defaultWard(ctx: AppContext): Promise<WardRecord> {
  const wards = (await ctx.repo.listWards()) as WardRecord[];
  if (!wards[0]) throw notFound('Ward');
  return wards[0];
}
