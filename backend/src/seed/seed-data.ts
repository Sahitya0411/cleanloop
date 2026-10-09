import type {
  Lane,
  PickupRequest,
  Profile,
  Recycler,
  Report,
  Route,
  RouteRun,
  Severity,
  Stop,
} from '@cleanloop/shared';
import { addDays, istDateTime, weekdayOf } from '@cleanloop/shared';
import { computeSavings } from '../core/savings';
import type { WardRecord } from '../domain/common';
import { planWard } from '../domain/planning';
import type { AppContext } from '../services/types';
import { SEED_IMAGES } from './assets';

export interface DemoUserIds {
  resident: string;
  driver: string;
  officer: string;
  recycler: string;
}

export interface SeedInput {
  today: string;
  ids: DemoUserIds;
  officerEmail?: string;
  emails?: Partial<Record<keyof DemoUserIds, string>>;
  historyDays?: number;
}

export interface SeedData {
  ward: WardRecord;
  lanes: Lane[];
  route: Route;
  recyclers: Recycler[];
  profiles: Profile[];
  runs: RouteRun[];
  stops: Stop[];
  reports: Report[];
  pickups: PickupRequest[];
}

export const WARD_ID = 'ward-dtu';
export const ROUTE_ID = 'route-dtu-1';
export const DEMO_LANE_ID = 'lane-pocket-d-4';

// Demo lanes around Delhi Technological University. Coordinates are approximate;
// lane names follow the "Pocket / Lane" style used in the surrounding sectors.
const LANES: Omit<Lane, 'wardId' | 'households'>[] = [
  {
    laneId: 'lane-main-gate',
    name: 'Main Gate Market',
    area: 'Bawana Road',
    lat: 28.7468,
    lng: 77.1146,
    marketDays: [2],
  },
  {
    laneId: 'lane-shahbad-1',
    name: 'Shahbad Lane 1',
    area: 'Shahbad Daulatpur',
    lat: 28.7442,
    lng: 77.1201,
    marketDays: [],
  },
  {
    laneId: 'lane-shahbad-3',
    name: 'Shahbad Lane 3',
    area: 'Shahbad Daulatpur',
    lat: 28.7431,
    lng: 77.1224,
    marketDays: [],
  },
  {
    laneId: 'lane-chaupal',
    name: 'Chaupal Road',
    area: 'Shahbad Daulatpur',
    lat: 28.7419,
    lng: 77.1248,
    marketDays: [6],
  },
  {
    laneId: 'lane-pocket-a-1',
    name: 'Pocket A, Lane 1',
    area: 'Sector 17',
    lat: 28.7395,
    lng: 77.1268,
    marketDays: [],
  },
  {
    laneId: 'lane-pocket-a-2',
    name: 'Pocket A, Lane 2',
    area: 'Sector 17',
    lat: 28.7383,
    lng: 77.1281,
    marketDays: [],
  },
  {
    laneId: 'lane-pocket-b-4',
    name: 'Pocket B, Lane 4',
    area: 'Sector 17',
    lat: 28.737,
    lng: 77.1259,
    marketDays: [],
  },
  {
    laneId: 'lane-pocket-c-2',
    name: 'Pocket C, Lane 2',
    area: 'Sector 17',
    lat: 28.7356,
    lng: 77.1238,
    marketDays: [],
  },
  {
    laneId: DEMO_LANE_ID,
    name: 'Pocket D, Lane 4',
    area: 'Sector 17',
    lat: 28.7342,
    lng: 77.1215,
    marketDays: [],
  },
  {
    laneId: 'lane-pocket-d-6',
    name: 'Pocket D, Lane 6',
    area: 'Sector 17',
    lat: 28.7331,
    lng: 77.1196,
    marketDays: [],
  },
  {
    laneId: 'lane-budh-bazaar',
    name: 'Budh Bazaar Road',
    area: 'Sector 17',
    lat: 28.7322,
    lng: 77.1262,
    marketDays: [3],
  },
  {
    laneId: 'lane-staff-quarters',
    name: 'DTU Staff Quarters',
    area: 'DTU Campus',
    lat: 28.7517,
    lng: 77.1192,
    marketDays: [],
  },
  {
    laneId: 'lane-hostel-road',
    name: 'Hostel Road',
    area: 'DTU Campus',
    lat: 28.7531,
    lng: 77.1158,
    marketDays: [],
  },
  {
    laneId: 'lane-ghoga-mod',
    name: 'Ghoga Mod Lane',
    area: 'Bawana Road',
    lat: 28.7553,
    lng: 77.1121,
    marketDays: [],
  },
];

/** The fixed route the truck drove before CleanLoop: campus first, then south. */
const BASELINE_ORDER = [
  'lane-staff-quarters',
  'lane-hostel-road',
  'lane-ghoga-mod',
  'lane-main-gate',
  'lane-shahbad-1',
  'lane-pocket-a-1',
  'lane-shahbad-3',
  'lane-chaupal',
  'lane-pocket-a-2',
  'lane-pocket-b-4',
  'lane-budh-bazaar',
  'lane-pocket-c-2',
  DEMO_LANE_ID,
  'lane-pocket-d-6',
];

/** Lanes that overflow often (dense housing or narrow access). */
const BUSY_LANES = new Set([DEMO_LANE_ID, 'lane-shahbad-3', 'lane-ghoga-mod']);
const NARROW_LANES = new Set(['lane-ghoga-mod', 'lane-shahbad-3']);

const SKIP_REASONS = [
  'Lane blocked by parked cars',
  'Truck full',
  'Waterlogged lane',
  'Road dug up',
];
const REASONS: Record<Severity, string[]> = {
  high: [
    'Large dump spilling onto the road and into the drain; stray cattle feeding.',
    'Overflowing dhalao with bags blocking half the lane.',
  ],
  medium: [
    'Bin overflowing with bags on the footpath around it.',
    'Small roadside dump of 4-5 bags next to the bin.',
  ],
  low: ['Bin full to the brim but waste is contained.', 'Lid broken; bin nearly full.'],
};
const PHOTO: Record<Severity, string> = {
  high: 'seed/roadside-dump.svg',
  medium: 'seed/bin-overflow.svg',
  low: 'seed/bin-full.svg',
};

/** Small deterministic PRNG so every seed produces the same demo history. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, items: T[]): T => items[Math.floor(rand() * items.length)]!;

function isoAt(date: string, hour: number, minute: number): string {
  const hh = String(Math.min(23, hour)).padStart(2, '0');
  const mm = String(Math.min(59, minute)).padStart(2, '0');
  return istDateTime(date, `${hh}:${mm}`).toISOString();
}

export function buildSeed(input: SeedInput): SeedData {
  const { today, ids } = input;
  const rand = prng(20261008);
  const historyDays = input.historyDays ?? 28;

  const ward: WardRecord = {
    wardId: WARD_ID,
    name: 'DTU & Shahbad Daulatpur',
    shortName: 'DTU Ward',
    city: 'Delhi',
    centre: { lat: 28.7432, lng: 77.1205 },
    radiusKm: 3.5,
    eventDates: [
      { date: '2026-10-20', label: 'Dussehra' },
      { date: '2026-11-06', label: 'Dhanteras' },
      { date: '2026-11-08', label: 'Diwali' },
      { date: '2026-11-09', label: 'Day after Diwali' },
    ],
    officerEmail: input.officerEmail,
  };

  const lanes: Lane[] = LANES.map((l, i) => ({
    ...l,
    wardId: WARD_ID,
    households: 80 + ((i * 37) % 140),
  }));
  const laneById = new Map(lanes.map((l) => [l.laneId, l]));

  const route: Route = {
    routeId: ROUTE_ID,
    wardId: WARD_ID,
    name: 'DTU Ward · Morning route',
    vehicleType: 'diesel',
    vehicleNumber: 'DL 1L AB 4021',
    startTime: '07:00',
    depot: { lat: 28.7489, lng: 77.1105, name: 'Bawana Road depot' },
    baselineOrder: BASELINE_ORDER,
    driverId: ids.driver,
    kmPerLitre: 3,
  };

  // ---- History: the old fixed route, every day, with occasional skips and complaints.
  const runs: RouteRun[] = [];
  const stops: Stop[] = [];
  const reports: Report[] = [];
  let reportSeq = 0;
  const skippedYesterday = new Set<string>();

  for (let d = -historyDays; d <= -1; d++) {
    const date = addDays(today, d);
    const weekday = weekdayOf(date);
    let minute = 0;
    const todaySkips = new Set<string>();
    BASELINE_ORDER.forEach((laneId, i) => {
      const lane = laneById.get(laneId)!;
      const skipP = laneId === 'lane-ghoga-mod' ? 0.3 : NARROW_LANES.has(laneId) ? 0.18 : 0.05;
      const skipped = rand() < skipP;
      const doneMinute = 7 * 60 + minute + Math.round(rand() * 4);
      minute += 9 + Math.round(rand() * 4);
      if (skipped) todaySkips.add(laneId);
      stops.push({
        routeId: ROUTE_ID,
        date,
        seq: i + 1,
        laneId,
        laneName: lane.name,
        lat: lane.lat,
        lng: lane.lng,
        avgMinutesToNext: i === BASELINE_ORDER.length - 1 ? 0 : 11,
        status: skipped ? 'skipped' : 'done',
        doneAt: isoAt(date, Math.floor(doneMinute / 60), doneMinute % 60),
        skipReason: skipped ? pick(rand, SKIP_REASONS) : undefined,
      });

      let p = 0.03;
      if (lane.marketDays.includes(weekday)) p = 0.7;
      else if (lane.marketDays.length) p = 0.05;
      if (BUSY_LANES.has(laneId)) p = Math.max(p, 0.2);
      if (skippedYesterday.has(laneId)) p += 0.4;
      if (rand() < p) {
        const roll = rand();
        const severity: Severity = roll < 0.25 ? 'high' : roll < 0.75 ? 'medium' : 'low';
        const createdAt = isoAt(date, 8 + Math.floor(rand() * 12), Math.floor(rand() * 60));
        const age = -d;
        const status = age >= 3 ? 'resolved' : age === 2 ? 'seen' : 'sent';
        reports.push({
          reportId: `rpt_seed${String(++reportSeq).padStart(3, '0')}`,
          wardId: WARD_ID,
          wardName: ward.name,
          laneId,
          laneName: lane.name,
          lat: lane.lat + (rand() - 0.5) * 0.0008,
          lng: lane.lng + (rand() - 0.5) * 0.0008,
          locationSource: 'gps',
          photoKey: PHOTO[severity],
          severity,
          confidence: 0.8 + Math.round(rand() * 15) / 100,
          isBinOrDump: true,
          reason: pick(rand, REASONS[severity]),
          hazards: severity === 'high' ? ['blocking_drain', 'animals'] : [],
          aiSource: 'manual',
          status,
          reporterId: `seed-resident-${1 + (reportSeq % 9)}`,
          reporterName: 'Demo resident',
          createdAt,
          seenAt:
            status !== 'sent'
              ? new Date(Date.parse(createdAt) + 3_600_000).toISOString()
              : undefined,
          resolvedAt:
            status === 'resolved'
              ? new Date(
                  Date.parse(createdAt) + (4 + Math.floor(rand() * 16)) * 3_600_000,
                ).toISOString()
              : undefined,
          afterPhotoKey: status === 'resolved' ? 'seed/clean.svg' : undefined,
        });
      }
    });
    skippedYesterday.clear();
    todaySkips.forEach((l) => skippedYesterday.add(l));
    runs.push({
      routeId: ROUTE_ID,
      wardId: WARD_ID,
      routeName: route.name,
      date,
      status: 'completed',
      order: BASELINE_ORDER,
      deferred: [],
      savings: computeSavings({
        baselineKm: 0,
        optimisedKm: 0,
        vehicleType: 'diesel',
        method: 'estimate',
      }),
      generatedAt: isoAt(addDays(date, -1), 22, 0),
      generatedBy: 'seed',
    });
  }

  // Two fresh complaints this morning so the officer inbox has work in it.
  const fresh: [string, Severity, number][] = [
    ['lane-ghoga-mod', 'high', 7],
    ['lane-budh-bazaar', 'medium', 8],
  ];
  for (const [laneId, severity, hour] of fresh) {
    const lane = laneById.get(laneId)!;
    reports.push({
      reportId: `rpt_seed${String(++reportSeq).padStart(3, '0')}`,
      wardId: WARD_ID,
      wardName: ward.name,
      laneId,
      laneName: lane.name,
      lat: lane.lat,
      lng: lane.lng,
      locationSource: 'gps',
      photoKey: PHOTO[severity],
      severity,
      confidence: 0.88,
      isBinOrDump: true,
      reason: REASONS[severity][0]!,
      hazards: severity === 'high' ? ['blocking_drain', 'animals'] : [],
      aiSource: 'manual',
      status: 'sent',
      reporterId: 'seed-resident-7',
      reporterName: 'Demo resident',
      createdAt: isoAt(today, hour, 15),
    });
  }

  // ---- Kabadiwalas / recyclers (fictional businesses; phone numbers are placeholders).
  const createdAt = isoAt(addDays(today, -20), 10, 0);
  const recyclers: Recycler[] = [
    {
      recyclerId: ids.recycler,
      name: 'Sunil Kabadiwala',
      phone: '+91 00000 00001',
      email: input.emails?.recycler,
      area: 'Shahbad Daulatpur',
      lat: 28.7436,
      lng: 77.1212,
      acceptedMaterials: ['plastic', 'paper', 'cardboard', 'metal', 'glass'],
      approxRates: { paper: 12, cardboard: 10, plastic: 15, metal: 30, glass: 2 },
      consentGiven: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      recyclerId: 'seed-recycler-ewaste',
      name: 'Green E-Waste Collectors',
      phone: '+91 00000 00002',
      area: 'Sector 16, Rohini',
      lat: 28.7364,
      lng: 77.1335,
      acceptedMaterials: ['electronics', 'battery', 'metal'],
      approxRates: { electronics: 40, battery: 60, metal: 32 },
      consentGiven: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      recyclerId: 'seed-recycler-rekha',
      name: 'Rekha Scrap Traders',
      phone: '+91 00000 00003',
      area: 'Sector 17, Rohini',
      lat: 28.7349,
      lng: 77.1247,
      acceptedMaterials: ['paper', 'cardboard', 'textile', 'plastic'],
      approxRates: { paper: 11, cardboard: 9, textile: 6, plastic: 14 },
      consentGiven: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const pickup = (
    n: number,
    laneId: string,
    material: PickupRequest['material'],
    kg: number,
    photo: string,
    hoursAgo: number,
    extra: Partial<PickupRequest> = {},
  ): PickupRequest => {
    const lane = laneById.get(laneId)!;
    return {
      requestId: `pku_seed${n}`,
      residentId: `seed-resident-${n}`,
      residentName: 'Demo resident',
      itemType: material === 'electronics' || material === 'battery' ? 'e_waste' : 'dry',
      material,
      photoKey: photo,
      lat: lane.lat,
      lng: lane.lng,
      laneId,
      laneName: lane.name,
      estWeightKg: kg,
      status: 'open',
      createdAt: new Date(Date.parse(isoAt(today, 9, 0)) - hoursAgo * 3_600_000).toISOString(),
      ...extra,
    };
  };
  const pickups: PickupRequest[] = [
    pickup(1, 'lane-shahbad-1', 'electronics', 4, 'seed/laptop.svg', 2, {
      notes: 'Old laptop and a bag of cables',
      suggestedRecyclerId: 'seed-recycler-ewaste',
    }),
    pickup(2, 'lane-pocket-b-4', 'cardboard', 10, 'seed/cardboard.svg', 5, {
      suggestedRecyclerId: ids.recycler,
    }),
    pickup(3, 'lane-pocket-a-2', 'plastic', 3, 'seed/bottles.svg', 20, {
      suggestedRecyclerId: ids.recycler,
    }),
    pickup(4, 'lane-pocket-c-2', 'plastic', 5, 'seed/bottles.svg', 26, {
      status: 'accepted',
      recyclerId: ids.recycler,
      recyclerName: 'Sunil Kabadiwala',
      recyclerPhone: '+91 00000 00001',
      acceptedAt: isoAt(addDays(today, -1), 11, 0),
    }),
    pickup(5, 'lane-chaupal', 'paper', 8, 'seed/cardboard.svg', 50, {
      status: 'done',
      recyclerId: ids.recycler,
      recyclerName: 'Sunil Kabadiwala',
      recyclerPhone: '+91 00000 00001',
      acceptedAt: isoAt(addDays(today, -2), 10, 0),
      doneAt: isoAt(addDays(today, -2), 16, 30),
    }),
  ];

  const profiles: Profile[] = [
    {
      userId: ids.resident,
      role: 'resident',
      name: 'Heer',
      email: input.emails?.resident,
      laneId: DEMO_LANE_ID,
      wardId: WARD_ID,
      lang: 'en',
    },
    {
      userId: ids.driver,
      role: 'driver',
      name: 'Ramesh Kumar',
      email: input.emails?.driver,
      lang: 'hi',
    },
    {
      userId: ids.officer,
      role: 'officer',
      name: 'Ward Officer',
      email: input.emails?.officer,
      wardId: WARD_ID,
      lang: 'en',
    },
    {
      userId: ids.recycler,
      role: 'recycler',
      name: 'Sunil Kabadiwala',
      email: input.emails?.recycler,
      wardId: WARD_ID,
      lang: 'hi',
    },
  ];

  return { ward, lanes, route, recyclers, profiles, runs, stops, reports, pickups };
}

/** Writes the seed through the repository, uploads illustrations, and plans today and tomorrow. */
export async function writeSeed(ctx: AppContext, data: SeedData, today: string): Promise<void> {
  const { repo } = ctx;
  await repo.batchPut([
    repo.wardItem(data.ward),
    ...data.lanes.map((l) => repo.laneItem(l)),
    repo.routeItem(data.route),
    ...data.recyclers.map((r) => repo.recyclerItem(r)),
    ...data.runs.map((r) => repo.runItem(r)),
    ...data.stops.map((s) => repo.stopItem(s)),
    ...data.reports.map((r) => repo.reportItem(r)),
    ...data.pickups.map((p) => repo.pickupItem(p)),
  ]);
  for (const p of data.profiles) await repo.putProfile(p);
  for (const [key, svg] of Object.entries(SEED_IMAGES)) {
    await ctx.storage.write(key, new TextEncoder().encode(svg), 'image/svg+xml');
  }
  await planWard(ctx, data.ward.wardId, today, 'nightly', { force: true });
  await planWard(ctx, data.ward.wardId, addDays(today, 1), 'nightly', { force: true });
}
