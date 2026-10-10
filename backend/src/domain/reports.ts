import type {
  CreateReportResponse,
  Lang,
  LatLng,
  Report,
  SeverityAnalysis,
} from '@cleanloop/shared';
import { SEVERITY_RANK, mapsLink, round } from '@cleanloop/shared';
import { locateWard, nearestLane } from '../core/wards';
import { ConditionFailedError } from '../data/kv';
import { escapeHtml } from '../services/mime';
import type { AppContext } from '../services/types';
import type { AuthUser, WardRecord } from './common';
import {
  assertOwnUpload,
  badRequest,
  conflict,
  forbidden,
  getOrCreateProfile,
  loadImage,
  newId,
  notFound,
  photoUrl,
} from './common';

/** Only a confident "this is not a bin" stops a report; otherwise we let it through. */
const NOT_A_BIN_CONFIDENCE = 0.6;

export async function withPhotos(ctx: AppContext, r: Report): Promise<Report> {
  return {
    ...r,
    photoUrl: await photoUrl(ctx, r.photoKey),
    afterPhotoUrl: await photoUrl(ctx, r.afterPhotoKey),
  };
}

export function sortForInbox(reports: Report[]): Report[] {
  return [...reports].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

async function analyse(
  ctx: AppContext,
  photoKey: string,
  lang: Lang,
  hint?: string,
): Promise<SeverityAnalysis> {
  const cached = await ctx.repo.getAnalysis(photoKey);
  if (cached) return cached;
  const image = await loadImage(ctx, photoKey);
  let analysis: SeverityAnalysis;
  try {
    const ai = await ctx.ai.assessSeverity(image, { lang, hint });
    analysis = { ...ai, confidence: round(ai.confidence, 2) };
  } catch (err) {
    ctx.log.error('severity analysis failed', { error: String(err) });
    // Never drop a citizen report because the model is down; the officer triages it.
    analysis = {
      isBinOrDump: true,
      severity: 'medium',
      reason: 'Automatic triage unavailable; please review the photo.',
      hazards: [],
      confidence: 0,
      source: 'manual',
    };
  }
  await ctx.repo.putAnalysis(photoKey, analysis, ctx.now());
  return analysis;
}

async function officerEmail(ctx: AppContext, ward: WardRecord, report: Report) {
  const to = ward.officerEmail;
  if (!to) return;
  let photo: { bytes: Uint8Array; contentType: string } | undefined;
  try {
    photo = await ctx.storage.read(report.photoKey);
  } catch {
    photo = undefined;
  }
  const where = report.laneName ? `${report.laneName}, ${ward.name}` : ward.name;
  const map = mapsLink(report);
  const link = `${ctx.config.appUrl}/officer/reports?open=${report.reportId}`;
  const sev = report.severity.toUpperCase();
  const colour = { high: '#D64545', medium: '#E8A33D', low: '#3E9B5B' }[report.severity];
  const hazards = report.hazards.length ? report.hazards.join(', ') : 'none flagged';
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1b2b21;max-width:560px">
<h2 style="margin:0 0 8px">New ${escapeHtml(sev)} severity report</h2>
<p style="margin:0 0 12px"><span style="background:${colour};color:#fff;padding:2px 8px;border-radius:10px">${escapeHtml(sev)}</span>
&nbsp;${escapeHtml(where)}</p>
${photo ? '<img src="cid:report-photo" alt="Reported bin" style="max-width:100%;border-radius:8px"/>' : ''}
<p><b>AI triage:</b> ${escapeHtml(report.reason)} (confidence ${Math.round(report.confidence * 100)}%, ${escapeHtml(report.aiSource)})</p>
<p><b>Hazards:</b> ${escapeHtml(hazards)}</p>
${report.note ? `<p><b>Resident note:</b> ${escapeHtml(report.note)}</p>` : ''}
<p><b>Location:</b> <a href="${map}">${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}</a> (${report.locationSource === 'gps' ? 'phone GPS' : 'resident lane'})</p>
<p><a href="${link}" style="background:#1f6f43;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in CleanLoop</a></p>
<p style="color:#6b7a70;font-size:12px">Report ${escapeHtml(report.reportId)} · ${escapeHtml(report.createdAt)}</p>
</body></html>`;
  const text = [
    `New ${sev} severity report at ${where}`,
    `AI triage: ${report.reason}`,
    `Hazards: ${hazards}`,
    report.note ? `Resident note: ${report.note}` : '',
    `Map: ${map}`,
    `Open: ${link}`,
  ]
    .filter(Boolean)
    .join('\n');
  const sent = await ctx.notifier.sendEmail({
    to,
    subject: `[CleanLoop] ${sev} · Overflowing bin at ${where}`,
    text,
    html,
    attachments: photo
      ? [
          {
            filename: 'report.jpg',
            contentType: photo.contentType,
            bytes: photo.bytes,
            contentId: 'report-photo',
          },
        ]
      : [],
  });
  if (sent) ctx.metrics.count('OfficerEmailsSent');
}

export async function createReport(
  ctx: AppContext,
  user: AuthUser,
  input: {
    photoKey: string;
    lat?: number;
    lng?: number;
    laneId?: string;
    note?: string;
    lang: Lang;
    force?: boolean;
    fileName?: string;
  },
): Promise<CreateReportResponse> {
  assertOwnUpload(input.photoKey, user.userId, 'report');
  const analysis = await analyse(ctx, input.photoKey, input.lang, input.fileName);
  if (!analysis.isBinOrDump && analysis.confidence >= NOT_A_BIN_CONFIDENCE && !input.force) {
    return {
      created: false,
      analysis,
      message: "This doesn't look like a garbage bin or dump. Retake the photo, or send it anyway.",
    };
  }

  const profile = await getOrCreateProfile(ctx, user);
  const wards = (await ctx.repo.listWards()) as WardRecord[];
  let ward: WardRecord | undefined;
  let point: LatLng | undefined;
  let locationSource: Report['locationSource'] = 'gps';
  if (input.lat !== undefined && input.lng !== undefined) {
    point = { lat: input.lat, lng: input.lng };
    ward = locateWard(point, wards);
  }
  let lane = undefined;
  if (ward && point) {
    lane = nearestLane(point, await ctx.repo.listLanes(ward.wardId));
  }
  if (!ward) {
    // Outside every ward (or no GPS): fall back to the resident's chosen lane.
    const laneId = input.laneId ?? profile.laneId;
    lane = laneId ? await ctx.repo.getLane(laneId) : undefined;
    if (!lane) throw badRequest('Turn on location or choose your lane first.');
    ward = wards.find((w) => w.wardId === lane!.wardId);
    if (!ward) throw notFound('Ward');
    point = { lat: lane.lat, lng: lane.lng };
    locationSource = 'lane';
  }

  const report: Report = {
    reportId: newId('rpt'),
    wardId: ward.wardId,
    wardName: ward.name,
    laneId: lane?.laneId,
    laneName: lane?.name,
    lat: point!.lat,
    lng: point!.lng,
    locationSource,
    photoKey: input.photoKey,
    severity: analysis.severity,
    confidence: analysis.confidence,
    isBinOrDump: analysis.isBinOrDump,
    reason: analysis.reason,
    hazards: analysis.hazards,
    aiSource: analysis.source,
    status: 'sent',
    note: input.note?.trim() || undefined,
    reporterId: user.userId,
    reporterName: profile.name,
    createdAt: ctx.now().toISOString(),
  };
  await ctx.repo.putReport(report);
  ctx.metrics.count('ReportsFiled');
  if (report.severity === 'high') ctx.metrics.count('HighSeverityReports');
  await officerEmail(ctx, ward, report);
  return { created: true, report: await withPhotos(ctx, report), analysis };
}

export async function getReportFor(ctx: AppContext, user: AuthUser, reportId: string) {
  const report = await ctx.repo.getReport(reportId);
  if (!report) throw notFound('Report');
  if (user.role !== 'officer' && report.reporterId !== user.userId) throw forbidden();
  return withPhotos(ctx, report);
}

export async function markSeen(ctx: AppContext, reportId: string): Promise<Report> {
  try {
    const r = await ctx.repo.updateReport(
      reportId,
      { status: 'seen', seenAt: ctx.now().toISOString() },
      { status: 'sent' },
    );
    return withPhotos(ctx, r);
  } catch (err) {
    if (!(err instanceof ConditionFailedError)) throw err;
    const r = await ctx.repo.getReport(reportId);
    if (!r) throw notFound('Report');
    return withPhotos(ctx, r);
  }
}

export async function resolveReport(
  ctx: AppContext,
  user: AuthUser,
  reportId: string,
  input: { afterPhotoKey: string; note?: string },
): Promise<Report> {
  assertOwnUpload(input.afterPhotoKey, user.userId, 'resolve');
  const existing = await ctx.repo.getReport(reportId);
  if (!existing) throw notFound('Report');
  if (existing.status === 'resolved') throw conflict('This report is already resolved.');
  const now = ctx.now().toISOString();
  let report: Report;
  try {
    // Conditional on the status we read, so two officers can't both resolve it.
    report = await ctx.repo.updateReport(
      reportId,
      {
        status: 'resolved',
        resolvedAt: now,
        seenAt: existing.seenAt ?? now,
        afterPhotoKey: input.afterPhotoKey,
        resolvedNote: input.note?.trim() || undefined,
      },
      { status: existing.status },
    );
  } catch (err) {
    if (err instanceof ConditionFailedError)
      throw conflict('This report was just updated by someone else.');
    throw err;
  }
  ctx.metrics.count('ReportsResolved');

  const reporter = await ctx.repo.getProfile(report.reporterId);
  if (reporter?.email) {
    const where = report.laneName ?? report.wardName;
    await ctx.notifier.sendEmail({
      to: reporter.email,
      subject: `[CleanLoop] Your report at ${where} is resolved`,
      text: `Thanks for reporting. The ward officer marked your report at ${where} as resolved.\n${report.resolvedNote ?? ''}\nSee the after-photo: ${ctx.config.appUrl}/resident/reports`,
      html: `<p>Thanks for reporting. The ward officer marked your report at <b>${escapeHtml(where)}</b> as resolved.</p>${report.resolvedNote ? `<p>${escapeHtml(report.resolvedNote)}</p>` : ''}<p><a href="${ctx.config.appUrl}/resident/reports">See the after-photo in CleanLoop</a></p>`,
    });
  }
  return withPhotos(ctx, report);
}
