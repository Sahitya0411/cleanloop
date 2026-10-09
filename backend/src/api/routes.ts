import { z } from 'zod';
import type {
  Material,
  PickupItemType,
  Role,
  UploadPurpose,
  WardWithLanes,
  WasteCategory,
} from '@cleanloop/shared';
import { MATERIALS, WASTE_CATEGORIES, addDays, istDate, isValidDate } from '@cleanloop/shared';
import type { WardRecord } from '../domain/common';
import {
  ALLOWED_UPLOAD_TYPES,
  HttpError,
  badRequest,
  defaultWard,
  getOrCreateProfile,
  notFound,
  publicWard,
  uploadKey,
} from '../domain/common';
import { driverRoute, laneTrack, markStop } from '../domain/collection';
import {
  impactFor,
  officerOverview,
  residentHome,
  subscribeAlerts,
  unsubscribeAlerts,
} from '../domain/insights';
import {
  acceptPickup,
  cancelPickup,
  completePickup,
  createPickup,
  listMyPickups,
  myJobs,
  openRequestsFor,
  saveRecycler,
} from '../domain/pickups';
import { planWard } from '../domain/planning';
import {
  createReport,
  getReportFor,
  markSeen,
  resolveReport,
  sortForInbox,
  withPhotos,
} from '../domain/reports';
import { chooseManually, sortPhoto } from '../domain/sorting';
import { Router, parse } from './router';

const ALL: Role[] = ['resident', 'driver', 'officer', 'recycler'];
const lang = z.enum(['en', 'hi']).default('en');
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const photoKey = z.string().min(1).max(300);
const material = z.enum(MATERIALS as [Material, ...Material[]]);

const UPLOAD_PURPOSES: Record<Role, UploadPurpose[]> = {
  resident: ['sort', 'report', 'pickup'],
  officer: ['resolve'],
  driver: [],
  recycler: [],
};

const ProfilePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  laneId: z.string().max(60).optional(),
  lang: z.enum(['en', 'hi']).optional(),
});

const UploadRequest = z.object({
  purpose: z.enum(['sort', 'report', 'pickup', 'resolve']),
  contentType: z
    .string()
    .refine((t) => ALLOWED_UPLOAD_TYPES.includes(t), 'Use a JPEG, PNG or WebP photo'),
});

const SortRequest = z.object({ photoKey, lang, fileName: z.string().max(200).optional() });

const ChooseRequest = z.object({
  category: z.enum(WASTE_CATEGORIES as [WasteCategory, ...WasteCategory[]]),
  material: material.optional(),
  itemName: z.string().max(80).optional(),
});

const ReportRequest = z.object({
  photoKey,
  lat: lat.optional(),
  lng: lng.optional(),
  laneId: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
  lang,
  force: z.boolean().optional(),
  fileName: z.string().max(200).optional(),
});

const ResolveRequest = z.object({ afterPhotoKey: photoKey, note: z.string().max(500).optional() });

const PickupRequestBody = z.object({
  itemType: z.enum(['dry', 'e_waste']).transform((t) => t as PickupItemType),
  material,
  photoKey: photoKey.optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  laneId: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
  estWeightKg: z.number().positive().max(500).optional(),
  phone: z.string().trim().max(20).optional(),
});

const AlertRequest = z.object({
  laneId: z.string().max(60),
  channel: z.enum(['email', 'sms']),
  endpoint: z.string().max(120),
});

const SkipRequest = z.object({ reason: z.string().trim().min(2).max(120) });

const PlanRequest = z.object({
  date: z.string().refine(isValidDate, 'Use YYYY-MM-DD').optional(),
  force: z.boolean().optional(),
});

const RecyclerBody = z.object({
  name: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(8).max(20),
  area: z.string().trim().min(2).max(80),
  lat,
  lng,
  acceptedMaterials: z.array(material).min(1),
  approxRates: z.record(z.string(), z.number().min(0).max(10_000)).default({}),
  consentGiven: z.boolean(),
});

const seqParam = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid stop number');
  return n;
};

export function buildRouter(): Router {
  const r = new Router();

  // ---- Everyone -------------------------------------------------------------
  r.add('GET', '/health', 'public', async (_req, ctx) => ({
    ok: true,
    stage: ctx.config.stage,
    time: ctx.now().toISOString(),
  }));

  r.add('GET', '/me', ALL, (req, ctx) => getOrCreateProfile(ctx, req.user));

  r.add('PUT', '/me', ALL, async (req, ctx) => {
    const patch = parse(ProfilePatch, req.body);
    const profile = await getOrCreateProfile(ctx, req.user);
    let wardId = profile.wardId;
    if (patch.laneId) {
      const lane = await ctx.repo.getLane(patch.laneId);
      if (!lane) throw notFound('Lane');
      wardId = lane.wardId;
    }
    const updated = { ...profile, ...patch, wardId };
    await ctx.repo.putProfile(updated);
    return updated;
  });

  r.add('GET', '/wards', ALL, async (_req, ctx): Promise<WardWithLanes[]> => {
    const wards = (await ctx.repo.listWards()) as WardRecord[];
    return Promise.all(
      wards.map(async (w) => ({ ward: publicWard(w), lanes: await ctx.repo.listLanes(w.wardId) })),
    );
  });

  r.add('POST', '/uploads', ALL, async (req, ctx) => {
    const { purpose, contentType } = parse(UploadRequest, req.body);
    if (!UPLOAD_PURPOSES[req.user.role].includes(purpose)) {
      throw new HttpError(403, 'forbidden', `A ${req.user.role} cannot upload ${purpose} photos`);
    }
    return ctx.storage.uploadTicket(uploadKey(req.user.userId, purpose, contentType), contentType);
  });

  r.add('GET', '/notifications', ['resident', 'officer'], async (req, ctx) => {
    const laneId = req.query.laneId ?? (await getOrCreateProfile(ctx, req.user)).laneId;
    return laneId ? ctx.repo.listNotifications(laneId, 30) : [];
  });

  r.add('GET', '/lanes/:laneId/track', ALL, async (req, ctx) => {
    const lane = await ctx.repo.getLane(req.params.laneId!);
    if (!lane) throw notFound('Lane');
    return laneTrack(ctx, lane);
  });

  // ---- Resident ---------------------------------------------------------------
  r.add('GET', '/resident/home', ['resident'], (req, ctx) =>
    residentHome(ctx, req.user, req.query.laneId),
  );

  r.add('GET', '/impact', ['resident'], (req, ctx) => impactFor(ctx, req.user));

  r.add('POST', '/sort', ['resident'], (req, ctx) =>
    sortPhoto(ctx, req.user, parse(SortRequest, req.body)),
  );

  r.add('POST', '/sort/:id/choose', ['resident'], (req, ctx) =>
    chooseManually(ctx, req.user, { sortId: req.params.id!, ...parse(ChooseRequest, req.body) }),
  );

  r.add('POST', '/reports', ['resident'], (req, ctx) =>
    createReport(ctx, req.user, parse(ReportRequest, req.body)),
  );

  r.add('GET', '/reports/mine', ['resident'], async (req, ctx) =>
    Promise.all(
      (await ctx.repo.listUserReports(req.user.userId)).map((rep) => withPhotos(ctx, rep)),
    ),
  );

  r.add('GET', '/reports/:id', ['resident', 'officer'], (req, ctx) =>
    getReportFor(ctx, req.user, req.params.id!),
  );

  r.add('POST', '/pickups', ['resident'], (req, ctx) =>
    createPickup(ctx, req.user, parse(PickupRequestBody, req.body)),
  );

  r.add('GET', '/pickups/mine', ['resident'], (req, ctx) => listMyPickups(ctx, req.user));

  r.add('POST', '/pickups/:id/cancel', ['resident'], (req, ctx) =>
    cancelPickup(ctx, req.user, req.params.id!),
  );

  r.add('GET', '/alerts', ['resident'], (req, ctx) =>
    ctx.repo.listUserSubscriptions(req.user.userId),
  );

  r.add('POST', '/alerts', ['resident'], (req, ctx) =>
    subscribeAlerts(ctx, req.user, parse(AlertRequest, req.body)),
  );

  r.add('DELETE', '/alerts/:channel', ['resident'], async (req, ctx) => {
    const channel = z.enum(['email', 'sms']).parse(req.params.channel);
    await unsubscribeAlerts(ctx, req.user, channel);
    return { ok: true };
  });

  // ---- Driver -------------------------------------------------------------------
  r.add('GET', '/driver/route', ['driver'], (req, ctx) => driverRoute(ctx, req.user));

  r.add('POST', '/driver/stops/:seq/done', ['driver'], (req, ctx) =>
    markStop(ctx, req.user, seqParam(req.params.seq), 'done'),
  );

  r.add('POST', '/driver/stops/:seq/skip', ['driver'], (req, ctx) =>
    markStop(
      ctx,
      req.user,
      seqParam(req.params.seq),
      'skipped',
      parse(SkipRequest, req.body).reason,
    ),
  );

  // ---- Officer --------------------------------------------------------------------
  r.add('GET', '/officer/overview', ['officer'], (req, ctx) =>
    officerOverview(ctx, req.query.wardId),
  );

  r.add('GET', '/officer/reports', ['officer'], async (req, ctx) => {
    const ward = req.query.wardId ?? (await defaultWard(ctx)).wardId;
    const status = req.query.status ?? 'open';
    const all = await ctx.repo.listWardReports(ward);
    const filtered =
      status === 'all'
        ? all
        : status === 'resolved'
          ? all.filter((rep) => rep.status === 'resolved')
          : all.filter((rep) => rep.status !== 'resolved');
    return Promise.all(
      sortForInbox(filtered)
        .slice(0, 200)
        .map((rep) => withPhotos(ctx, rep)),
    );
  });

  r.add('POST', '/reports/:id/seen', ['officer'], (req, ctx) => markSeen(ctx, req.params.id!));

  r.add('POST', '/reports/:id/resolve', ['officer'], (req, ctx) =>
    resolveReport(ctx, req.user, req.params.id!, parse(ResolveRequest, req.body)),
  );

  r.add('POST', '/officer/plan', ['officer'], async (req, ctx) => {
    const body = parse(PlanRequest, req.body);
    const ward = req.query.wardId ?? (await defaultWard(ctx)).wardId;
    const date = body.date ?? addDays(istDate(ctx.now()), 1);
    return planWard(ctx, ward, date, 'officer', { force: body.force });
  });

  r.add('POST', '/officer/demo/reset-today', ['officer'], async (req, ctx) => {
    if (!ctx.config.demoTools) throw new HttpError(403, 'forbidden', 'Demo tools are disabled');
    const ward = req.query.wardId ?? (await defaultWard(ctx)).wardId;
    return planWard(ctx, ward, istDate(ctx.now()), 'officer', { force: true });
  });

  r.add('GET', '/officer/recyclers', ['officer'], (_req, ctx) => ctx.repo.listRecyclers());

  r.add('GET', '/officer/pickups', ['officer'], (_req, ctx) => ctx.repo.listPickups());

  // ---- Recycler ---------------------------------------------------------------------
  r.add('GET', '/recycler/me', ['recycler'], async (req, ctx) => ({
    recycler: (await ctx.repo.getRecycler(req.user.userId)) ?? null,
  }));

  r.add('PUT', '/recycler/me', ['recycler'], (req, ctx) => {
    const body = parse(RecyclerBody, req.body);
    return saveRecycler(ctx, req.user, {
      ...body,
      approxRates: body.approxRates as Partial<Record<Material, number>>,
    });
  });

  r.add('GET', '/recycler/requests', ['recycler'], (req, ctx) =>
    openRequestsFor(ctx, req.user, req.query.scope === 'all' ? 'all' : 'nearby'),
  );

  r.add('POST', '/recycler/requests/:id/accept', ['recycler'], (req, ctx) =>
    acceptPickup(ctx, req.user, req.params.id!),
  );

  r.add('POST', '/recycler/requests/:id/done', ['recycler'], (req, ctx) =>
    completePickup(ctx, req.user, req.params.id!),
  );

  r.add('GET', '/recycler/jobs', ['recycler'], (req, ctx) => myJobs(ctx, req.user));

  return r;
}
