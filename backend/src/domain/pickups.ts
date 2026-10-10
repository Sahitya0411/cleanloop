import type { Material, PickupItemType, PickupRequest, Recycler } from '@cleanloop/shared';
import { MATERIAL_LABELS, PICKUP_MATERIALS, haversineKm, mapsLink, round } from '@cleanloop/shared';
import { ConditionFailedError } from '../data/kv';
import { escapeHtml } from '../services/mime';
import type { AppContext } from '../services/types';
import type { AuthUser } from './common';
import {
  assertOwnUpload,
  badRequest,
  conflict,
  forbidden,
  getOrCreateProfile,
  newId,
  notFound,
  photoUrl,
} from './common';

/** Recyclers see, and are matched to, requests within this distance. */
export const NEARBY_KM = 10;

async function withPhoto(ctx: AppContext, p: PickupRequest): Promise<PickupRequest> {
  return { ...p, photoUrl: await photoUrl(ctx, p.photoKey) };
}

export function nearestRecycler(
  recyclers: Recycler[],
  material: Material,
  at: { lat: number; lng: number },
): Recycler | undefined {
  return recyclers
    .filter((r) => r.consentGiven && r.acceptedMaterials.includes(material))
    .map((r) => ({ r, km: haversineKm(r, at) }))
    .filter((x) => x.km <= NEARBY_KM)
    .sort((a, b) => a.km - b.km)[0]?.r;
}

export async function createPickup(
  ctx: AppContext,
  user: AuthUser,
  input: {
    itemType: PickupItemType;
    material: Material;
    photoKey?: string;
    lat?: number;
    lng?: number;
    laneId?: string;
    notes?: string;
    estWeightKg?: number;
    phone?: string;
  },
): Promise<PickupRequest> {
  if (!PICKUP_MATERIALS[input.itemType].includes(input.material)) {
    throw badRequest(`${input.material} is not collected as ${input.itemType}`);
  }
  // The photo from Snap to Sort can be reused for the pickup request.
  if (input.photoKey) assertOwnUpload(input.photoKey, user.userId, ['pickup', 'sort']);
  const profile = await getOrCreateProfile(ctx, user);
  if (input.phone && input.phone !== profile.phone) {
    await ctx.repo.putProfile({ ...profile, phone: input.phone });
  }
  const laneId = input.laneId ?? profile.laneId;
  const lane = laneId ? await ctx.repo.getLane(laneId) : undefined;
  let at: { lat: number; lng: number };
  if (input.lat !== undefined && input.lng !== undefined) at = { lat: input.lat, lng: input.lng };
  else if (lane) at = { lat: lane.lat, lng: lane.lng };
  else throw badRequest('Turn on location or choose your lane first.');

  const match = nearestRecycler(await ctx.repo.listRecyclers(), input.material, at);
  const request: PickupRequest = {
    requestId: newId('pku'),
    residentId: user.userId,
    residentName: profile.name,
    residentPhone: input.phone ?? profile.phone,
    itemType: input.itemType,
    material: input.material,
    photoKey: input.photoKey,
    lat: at.lat,
    lng: at.lng,
    laneId: lane?.laneId,
    laneName: lane?.name,
    notes: input.notes?.trim() || undefined,
    estWeightKg: input.estWeightKg,
    status: 'open',
    suggestedRecyclerId: match?.recyclerId,
    createdAt: ctx.now().toISOString(),
  };
  await ctx.repo.putPickup(request);
  ctx.metrics.count('PickupsRequested');

  if (match?.email) {
    const what = `${MATERIAL_LABELS[request.material].en}${request.estWeightKg ? `, about ${request.estWeightKg} kg` : ''}`;
    const where = request.laneName ?? 'near you';
    await ctx.notifier.sendEmail({
      to: match.email,
      subject: `[CleanLoop] New pickup near you: ${what}`,
      text: `A resident at ${where} wants to hand over ${what}.\nMap: ${mapsLink(at)}\nAccept it in CleanLoop: ${ctx.config.appUrl}/recycler`,
      html: `<p>A resident at <b>${escapeHtml(where)}</b> wants to hand over <b>${escapeHtml(what)}</b>.</p><p><a href="${mapsLink(at)}">Open map</a> · <a href="${ctx.config.appUrl}/recycler">Accept in CleanLoop</a></p>`,
    });
  }
  return withPhoto(ctx, request);
}

export async function listMyPickups(ctx: AppContext, user: AuthUser): Promise<PickupRequest[]> {
  return Promise.all((await ctx.repo.listUserPickups(user.userId)).map((p) => withPhoto(ctx, p)));
}

export async function cancelPickup(ctx: AppContext, user: AuthUser, id: string) {
  const p = await ctx.repo.getPickup(id);
  if (!p) throw notFound('Pickup request');
  if (p.residentId !== user.userId) throw forbidden();
  try {
    return withPhoto(
      ctx,
      await ctx.repo.updatePickup(id, { status: 'cancelled' }, { status: 'open' }),
    );
  } catch (err) {
    if (err instanceof ConditionFailedError)
      throw conflict('A recycler already accepted this pickup.');
    throw err;
  }
}

export async function openRequestsFor(
  ctx: AppContext,
  user: AuthUser,
  scope: 'nearby' | 'all',
): Promise<PickupRequest[]> {
  const me = await ctx.repo.getRecycler(user.userId);
  const open = (await ctx.repo.listPickups()).filter((p) => p.status === 'open');
  const rows = open
    .map((p) => ({ ...p, distanceKm: me ? round(haversineKm(me, p), 1) : undefined }))
    .filter(
      (p) =>
        scope === 'all' ||
        !me ||
        (me.acceptedMaterials.includes(p.material) && (p.distanceKm ?? 0) <= NEARBY_KM),
    )
    .sort((a, b) => {
      // Requests matched to this recycler first, then nearest.
      const am = a.suggestedRecyclerId === user.userId ? 0 : 1;
      const bm = b.suggestedRecyclerId === user.userId ? 0 : 1;
      return am - bm || (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    });
  return Promise.all(rows.map((p) => withPhoto(ctx, p)));
}

export async function acceptPickup(ctx: AppContext, user: AuthUser, id: string) {
  const me = await ctx.repo.getRecycler(user.userId);
  if (!me) throw badRequest('Register your shop details before accepting pickups.');
  let p: PickupRequest;
  try {
    p = await ctx.repo.updatePickup(
      id,
      {
        status: 'accepted',
        recyclerId: me.recyclerId,
        recyclerName: me.name,
        recyclerPhone: me.phone,
        acceptedAt: ctx.now().toISOString(),
      },
      { status: 'open' },
    );
  } catch (err) {
    if (err instanceof ConditionFailedError)
      throw conflict('Someone else already took this pickup.');
    throw err;
  }
  ctx.metrics.count('PickupsAccepted');
  const resident = await ctx.repo.getProfile(p.residentId);
  if (resident?.email) {
    const what = MATERIAL_LABELS[p.material].en;
    await ctx.notifier.sendEmail({
      to: resident.email,
      subject: `[CleanLoop] ${me.name} will pick up your ${what.toLowerCase()}`,
      text: `${me.name} (${me.phone}) accepted your pickup request. They will call you before coming.`,
      html: `<p><b>${escapeHtml(me.name)}</b> (${escapeHtml(me.phone)}) accepted your pickup request for ${escapeHtml(what.toLowerCase())}. They will call you before coming.</p>`,
    });
  }
  return withPhoto(ctx, p);
}

export async function completePickup(ctx: AppContext, user: AuthUser, id: string) {
  try {
    const p = await ctx.repo.updatePickup(
      id,
      { status: 'done', doneAt: ctx.now().toISOString() },
      { status: 'accepted', recyclerId: user.userId },
    );
    ctx.metrics.count('PickupsCompleted');
    return withPhoto(ctx, p);
  } catch (err) {
    if (err instanceof ConditionFailedError)
      throw conflict('Only your accepted jobs can be marked done.');
    throw err;
  }
}

export async function myJobs(ctx: AppContext, user: AuthUser): Promise<PickupRequest[]> {
  const mine = (await ctx.repo.listPickups()).filter((p) => p.recyclerId === user.userId);
  return Promise.all(mine.map((p) => withPhoto(ctx, p)));
}

export async function saveRecycler(
  ctx: AppContext,
  user: AuthUser,
  input: Omit<Recycler, 'recyclerId' | 'createdAt' | 'updatedAt' | 'email'>,
): Promise<Recycler> {
  if (!input.consentGiven) {
    throw badRequest('Please agree to share your name and phone with residents.');
  }
  const existing = await ctx.repo.getRecycler(user.userId);
  const now = ctx.now().toISOString();
  const recycler: Recycler = {
    ...input,
    recyclerId: user.userId,
    email: user.email,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ctx.repo.putRecycler(recycler);
  if (!existing) ctx.metrics.count('RecyclersRegistered');
  return recycler;
}
