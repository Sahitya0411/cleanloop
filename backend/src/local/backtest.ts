// Backtest the overflow-risk score: for each past day, score every lane using only
// earlier data, then check whether the lanes we ranked riskiest are the ones that
// actually got an overflow report that day. Compares a few weight settings.
//
//   npm run backtest -w backend
//
// Runs on the seeded demo history (synthetic). Point it at real ward data before
// trusting the numbers.

import type { RiskFactors, RiskScore } from '@cleanloop/shared';
import { addDays, istDate, istDateOfIso, istDateTime } from '@cleanloop/shared';
import { DEFAULT_WEIGHTS, computeRisk } from '../core/risk';
import type { WardRecord } from '../domain/common';
import { computeLaneRisks } from '../domain/planning';
import { silentLogger } from '../services/observability';
import { buildSeed } from '../seed/seed-data';
import { LOCAL_DEMO_IDS, createLocalRuntime } from './context';

const VARIANTS: Record<string, RiskFactors> = {
  'brief (30/25/20/15/10)': DEFAULT_WEIGHTS,
  'reports-heavy (45/20/15/10/10)': {
    pastReports: 0.45,
    daysSincePickup: 0.2,
    missedStops: 0.15,
    rain: 0.1,
    eventDay: 0.1,
  },
  'missed-heavy (25/20/35/10/10)': {
    pastReports: 0.25,
    daysSincePickup: 0.2,
    missedStops: 0.35,
    rain: 0.1,
    eventDay: 0.1,
  },
  'events-heavy (25/15/20/10/30)': {
    pastReports: 0.25,
    daysSincePickup: 0.15,
    missedStops: 0.2,
    rain: 0.1,
    eventDay: 0.3,
  },
  'uniform (20 each)': {
    pastReports: 0.2,
    daysSincePickup: 0.2,
    missedStops: 0.2,
    rain: 0.2,
    eventDay: 0.2,
  },
};

/** Probability that a random overflow lane-day outranks a random quiet one. */
function auc(scored: { score: number; positive: boolean }[]): number {
  const pos = scored.filter((s) => s.positive);
  const neg = scored.filter((s) => !s.positive);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos)
    for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

async function main() {
  const evalDays = Number(process.env.DAYS ?? 28);
  const today = istDate();
  const rt = createLocalRuntime({ baseUrl: 'http://local', log: silentLogger });
  const seed = buildSeed({ today, ids: LOCAL_DEMO_IDS, historyDays: evalDays + 56 });
  const { repo } = rt.ctx;
  await repo.batchPut([
    repo.wardItem(seed.ward),
    ...seed.lanes.map((l) => repo.laneItem(l)),
    ...seed.stops.map((s) => repo.stopItem(s)),
    ...seed.reports.map((r) => repo.reportItem(r)),
  ]);
  const ward: WardRecord = seed.ward;
  const reported = new Set(seed.reports.map((r) => `${r.laneId}|${istDateOfIso(r.createdAt)}`));

  // Factors only depend on the data, so compute them once per lane-day.
  const rows: { risk: RiskScore; positive: boolean }[] = [];
  for (let d = -evalDays; d <= -1; d++) {
    const date = addDays(today, d);
    const ctx = { ...rt.ctx, now: () => istDateTime(addDays(date, -1), '22:00') };
    const { risks } = await computeLaneRisks(ctx, ward, seed.lanes, date);
    for (const risk of risks) rows.push({ risk, positive: reported.has(`${risk.laneId}|${date}`) });
  }

  const positives = rows.filter((r) => r.positive).length;
  console.log(
    `Backtest over ${evalDays} days x ${seed.lanes.length} lanes = ${rows.length} lane-days, ${positives} with an overflow report (base rate ${((100 * positives) / rows.length).toFixed(1)}%).\n`,
  );
  console.log(
    'weights'.padEnd(34),
    'AUC'.padStart(6),
    'top-3 hit'.padStart(10),
    'high-level precision'.padStart(22),
  );

  for (const [name, weights] of Object.entries(VARIANTS)) {
    const scored = rows.map((r) => {
      const { score, level } = computeRisk(r.risk.inputs, weights);
      return { score, level, positive: r.positive, date: r.risk.date };
    });
    const byDay = new Map<string, typeof scored>();
    for (const s of scored) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
    let topHits = 0;
    let topTotal = 0;
    for (const day of byDay.values()) {
      const top = [...day].sort((a, b) => b.score - a.score).slice(0, 3);
      topHits += top.filter((t) => t.positive).length;
      topTotal += top.length;
    }
    const flagged = scored.filter((s) => s.level !== 'low');
    const precision = flagged.length
      ? flagged.filter((s) => s.positive).length / flagged.length
      : NaN;
    console.log(
      name.padEnd(34),
      auc(scored).toFixed(3).padStart(6),
      `${((100 * topHits) / topTotal).toFixed(1)}%`.padStart(10),
      `${(100 * precision).toFixed(1)}% of ${flagged.length}`.padStart(22),
    );
  }
  console.log(
    '\nAUC 0.5 = random ranking, 1.0 = perfect. "high-level precision" counts medium+high lanes.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
