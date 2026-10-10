import type { RiskFactors, RiskScore } from '@cleanloop/shared';
import { weekdayName, weekdayOf } from '@cleanloop/shared';
import { OfficerShell } from '../../components/Shell';
import { ErrorState, RISK_COLOUR, RiskPill, Skeleton } from '../../components/ui';
import { formatDay } from '../../lib/format';
import { useOverview } from './Overview';

const FACTORS: { key: keyof RiskFactors; label: string; weight: number }[] = [
  { key: 'pastReports', label: 'Past reports on this weekday', weight: 30 },
  { key: 'daysSincePickup', label: 'Days since last pickup', weight: 25 },
  { key: 'missedStops', label: 'Missed stops, last 7 days', weight: 20 },
  { key: 'rain', label: 'Rain forecast', weight: 15 },
  { key: 'eventDay', label: 'Market / festival day', weight: 10 },
];

function why(r: RiskScore): string {
  const i = r.inputs;
  const parts = [
    `${i.reportsSameWeekday} report${i.reportsSameWeekday === 1 ? '' : 's'} on ${weekdayName(weekdayOf(r.date))}s`,
    i.daysSincePickup === null
      ? 'no recent pickup'
      : `last pickup ${i.daysSincePickup} day${i.daysSincePickup === 1 ? '' : 's'} before`,
    `${i.skippedLast7} missed in 7 days`,
    i.rainProbability === null
      ? 'no forecast'
      : `rain ${i.rainProbability}%${i.rainMm ? ` (${i.rainMm} mm)` : ''}`,
  ];
  if (i.eventLabel) parts.push(i.eventLabel);
  return parts.join(' · ');
}

export default function Risk() {
  const overview = useOverview();
  const o = overview.data;
  const order = new Map<string, number>();
  const deferred = new Set<string>();
  o?.plans.forEach((p) => {
    p.order.forEach((id, i) => order.set(id, i + 1));
    p.deferred.forEach((d) => deferred.add(d.laneId));
  });

  return (
    <OfficerShell openReports={o?.kpis.open}>
      <div className="officer-head">
        <div>
          <h1>Overflow risk {o ? `· ${formatDay(o.tomorrow)}` : ''}</h1>
          <p className="muted">
            Score 0–100 per lane, recomputed every night at 22:00 IST. Under 35 low, 35–65 medium,
            above 65 high.
          </p>
        </div>
      </div>
      {overview.error && !o && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {!o && <Skeleton height={480} />}
      {o && (
        <>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Lane</th>
                  <th style={{ width: 160 }}>Score</th>
                  <th>Level</th>
                  <th>Factors</th>
                  <th>Why</th>
                  <th>Tomorrow</th>
                </tr>
              </thead>
              <tbody>
                {o.riskTomorrow.map((r) => (
                  <tr key={r.laneId}>
                    <td className="bold">{r.laneName}</td>
                    <td>
                      <div className="row">
                        <div className="score-bar">
                          <span
                            style={{ width: `${r.score}%`, background: RISK_COLOUR[r.level] }}
                          />
                        </div>
                        <b>{r.score}</b>
                      </div>
                    </td>
                    <td>
                      <RiskPill level={r.level} />
                    </td>
                    <td>
                      <div className="factor-bars">
                        {FACTORS.map((f) => (
                          <span
                            key={f.key}
                            title={`${f.label} (${f.weight}%): ${Math.round(r.factors[f.key] * 100)}%`}
                          >
                            <i style={{ height: `${r.factors[f.key] * 100}%` }} />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="small muted" style={{ maxWidth: 360 }}>
                      {why(r)}
                    </td>
                    <td className="small bold">
                      {deferred.has(r.laneId) ? (
                        <span className="muted">deferred</span>
                      ) : order.has(r.laneId) ? (
                        `stop ${order.get(r.laneId)}`
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card stack-sm">
            <h3>How the score works</h3>
            <p className="small muted">
              Weighted sum of five factors, each scaled 0–1:{' '}
              {FACTORS.map((f) => `${f.label.toLowerCase()} ${f.weight}%`).join(', ')}. Rain comes
              from the Open-Meteo forecast for the ward centre; market days are per lane and
              festivals per ward. High-risk lanes go first tomorrow; lanes scoring under 20 that
              were collected within a day and have no open report can wait a day (never more than a
              third of the route). Bars left to right follow the same order. Weights were checked
              with <code>npm run backtest</code>.
            </p>
          </div>
        </>
      )}
    </OfficerShell>
  );
}
