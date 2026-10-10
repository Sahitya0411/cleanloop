import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleAlert,
  Factory,
  Fuel,
  Inbox,
  Play,
  Recycle,
  Route as RouteIcon,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import type { OfficerOverview } from '@cleanloop/shared';
import { istDate } from '@cleanloop/shared';
import { MapBox, type MapMarker } from '../../components/Map';
import { OfficerShell } from '../../components/Shell';
import {
  Empty,
  ErrorState,
  RISK_COLOUR,
  RiskPill,
  SEVERITY_COLOUR,
  SeverityPill,
  Skeleton,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { formatDay, formatTime, timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useToast } from '../../lib/toast';

export function useOverview() {
  return useAsync(() => api.officerOverview(), [], { pollMs: 30_000 });
}

export function reportMarkers(o: OfficerOverview): MapMarker[] {
  return o.reports.map((r) => ({
    id: r.reportId,
    lat: r.lat,
    lng: r.lng,
    kind: 'pin',
    color: SEVERITY_COLOUR[r.severity],
    label: '!',
    title: `${r.laneName ?? r.wardName}: ${r.reason}`,
  }));
}

function Kpi({
  icon: Icon,
  value,
  label,
  colour,
  bg,
}: {
  icon: typeof Inbox;
  value: number;
  label: string;
  colour: string;
  bg: string;
}) {
  return (
    <div className="card kpi">
      <span className="kpi-icon" style={{ background: bg, color: colour }}>
        <Icon size={22} />
      </span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export function SavingsCard({ o }: { o: OfficerOverview }) {
  const s = o.plans.reduce(
    (acc, p) => ({
      km: acc.km + p.savings.kmSaved,
      litres: acc.litres + p.savings.dieselLitresSaved,
      co2: acc.co2 + p.savings.co2KgSaved,
      baseline: acc.baseline + p.savings.baselineKm,
      optimised: acc.optimised + p.savings.optimisedKm,
    }),
    { km: 0, litres: 0, co2: 0, baseline: 0, optimised: 0 },
  );
  const plan = o.plans[0];
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return (
    <div className="card stack">
      <div className="row between">
        <h3>Savings vs fixed route</h3>
        <span className="small muted">{formatDay(o.tomorrow)}</span>
      </div>
      <div className="row">
        <RouteIcon size={22} color="var(--primary)" />
        <span className="grow">Distance saved</span>
        <span className="stat-value" style={{ fontSize: 22 }}>
          {r1(s.km)} km
        </span>
      </div>
      <div className="row">
        <Fuel size={22} color="#e3a12d" />
        <span className="grow">Diesel saved (est.)</span>
        <span className="stat-value" style={{ fontSize: 22 }}>
          {r1(s.litres)} L
        </span>
      </div>
      <div className="row">
        <Factory size={22} color="#607066" />
        <span className="grow">CO₂ avoided (est.)</span>
        <span className="stat-value" style={{ fontSize: 22 }}>
          {r1(s.co2)} kg
        </span>
      </div>
      <p className="tiny muted">
        {r1(s.baseline)} km fixed route → {r1(s.optimised)} km planned ·{' '}
        {plan?.savings.method === 'amazon-location'
          ? 'Amazon Location truck routing'
          : 'straight-line × 1.35 estimate'}{' '}
        · {plan?.savings.kmPerLitre ?? 3} km/L, 2.68 kg CO₂/L. Last 7 days: {o.savings7d.kmSaved}{' '}
        km, {o.savings7d.co2KgSaved} kg CO₂.
      </p>
    </div>
  );
}

export default function Overview() {
  const overview = useOverview();
  const toast = useToast();
  const [planning, setPlanning] = useState(false);
  const o = overview.data;
  const markers = useMemo(() => (o ? reportMarkers(o) : []), [o]);

  const runPlan = async () => {
    setPlanning(true);
    try {
      const res = await api.plan();
      const km = res.runs.reduce((a, r) => a + r.savings.kmSaved, 0);
      const high = res.risks.filter((r) => r.level === 'high').length;
      toast(
        `Planned ${formatDay(res.date)}: ${high} high-risk lane${high === 1 ? '' : 's'}, ${Math.round(km * 10) / 10} km saved`,
        'success',
      );
      await overview.reload(true);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPlanning(false);
    }
  };

  return (
    <OfficerShell openReports={o?.kpis.open}>
      <div className="officer-head">
        <div>
          <h1>{o?.ward.name ?? 'Ward overview'}</h1>
          <p className="muted">Ward overview · {formatDay(istDate())}</p>
        </div>
        <button className="btn btn-primary" onClick={runPlan} disabled={planning || !o}>
          {planning ? <Spinner size={18} /> : <Play size={18} />} Run tonight's plan now
        </button>
      </div>
      {overview.error && !o && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {!o && overview.loading && (
        <>
          <Skeleton height={90} />
          <Skeleton height={340} />
        </>
      )}
      {o && (
        <>
          <div className="kpis">
            <Kpi
              icon={Inbox}
              value={o.kpis.open}
              label="Open reports"
              colour="#d64545"
              bg="var(--danger-50)"
            />
            <Kpi
              icon={TriangleAlert}
              value={o.kpis.high}
              label="High severity"
              colour="#d64545"
              bg="var(--danger-50)"
            />
            <Kpi
              icon={CircleAlert}
              value={o.kpis.medium}
              label="Medium"
              colour="#d98a1c"
              bg="var(--warning-50)"
            />
            <Kpi
              icon={CircleAlert}
              value={o.kpis.low}
              label={`Low · ${o.kpis.resolved7d} resolved this week`}
              colour="#2f6fdf"
              bg="var(--info-50)"
            />
          </div>

          <div className="dash-grid">
            <div className="card stack">
              <div className="row between">
                <h3>Reports</h3>
                <Link to="/officer/reports" className="small bold">
                  Open inbox →
                </Link>
              </div>
              {o.reports.length === 0 ? (
                <Empty icon={Inbox}>No open reports.</Empty>
              ) : (
                <div className="list">
                  {o.reports.slice(0, 5).map((r) => (
                    <Link
                      key={r.reportId}
                      to={`/officer/reports?open=${r.reportId}`}
                      className="list-item card-link"
                    >
                      {r.photoUrl && <img className="thumb" src={r.photoUrl} alt="" />}
                      <div className="grow stack-sm" style={{ minWidth: 0 }}>
                        <span className="bold ellipsis">{r.laneName ?? r.wardName}</span>
                        <span className="small muted ellipsis">{r.reason}</span>
                        <span className="tiny faint">
                          {formatTime(r.createdAt)} · {timeAgo(r.createdAt)} · {r.status}
                        </span>
                      </div>
                      <SeverityPill severity={r.severity} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="card stack">
              <div className="row between">
                <h3>Reports on map</h3>
                <Link to="/officer/map" className="small bold">
                  View full map →
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <MapBox
                  markers={markers}
                  className="map map-tall"
                  fitKey={String(markers.length)}
                  ariaLabel="Reports on map"
                />
                <div className="map-legend">
                  {(['high', 'medium', 'low'] as const).map((s) => (
                    <span key={s}>
                      <span className="legend-dot" style={{ background: SEVERITY_COLOUR[s] }} />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="dash-grid-3">
            <div className="card stack">
              <div className="row between">
                <h3>Tomorrow's risk prediction</h3>
                <Link to="/officer/risk" className="small bold">
                  Details →
                </Link>
              </div>
              <table className="table">
                <tbody>
                  {o.riskTomorrow.slice(0, 7).map((r) => (
                    <tr key={r.laneId}>
                      <td className="bold">{r.laneName}</td>
                      <td style={{ width: '35%' }}>
                        <div className="score-bar">
                          <span
                            style={{ width: `${r.score}%`, background: RISK_COLOUR[r.level] }}
                          />
                        </div>
                      </td>
                      <td className="bold" style={{ width: 36 }}>
                        {r.score}
                      </td>
                      <td style={{ width: 90 }}>
                        <RiskPill level={r.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SavingsCard o={o} />
            <div className="card stack">
              <div className="row between">
                <h3>Today on the road</h3>
                <Link to="/officer/routes" className="small bold">
                  Routes →
                </Link>
              </div>
              {o.today.map(({ run, stops }) => {
                const handled = stops.filter((s) => s.status !== 'pending').length;
                const current = stops.find((s) => s.status === 'pending');
                return (
                  <div key={run.routeId} className="stack-sm">
                    <div className="row between">
                      <span className="row bold">
                        <Truck size={18} color="var(--primary)" /> {run.routeName}
                      </span>
                      <span className="small bold">
                        {handled}/{stops.length}
                      </span>
                    </div>
                    <div className="progress">
                      <span
                        style={{ width: `${stops.length ? (handled / stops.length) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="small muted">
                      {current ? `Next: ${current.laneName}` : 'Route complete'} ·{' '}
                      {stops.filter((s) => s.status === 'skipped').length} skipped ·{' '}
                      {run.deferred.length} deferred
                    </span>
                  </div>
                );
              })}
              <div className="card-flat row">
                <Recycle size={20} color="var(--primary)" />
                <span className="grow small">
                  <b>{o.openPickups}</b> open pickup requests · <b>{o.recyclers}</b> registered
                  recyclers
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </OfficerShell>
  );
}
