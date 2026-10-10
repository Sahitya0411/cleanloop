import { useMemo, useState } from 'react';
import type { Report } from '@cleanloop/shared';
import { MapBox, type MapMarker } from '../../components/Map';
import { OfficerShell } from '../../components/Shell';
import { ErrorState, SEVERITY_COLOUR, Skeleton } from '../../components/ui';
import { ReportDetail } from './ReportDetail';
import { useOverview } from './Overview';

export default function MapPage() {
  const overview = useOverview();
  const [selected, setSelected] = useState<Report>();
  const o = overview.data;

  const markers = useMemo<MapMarker[]>(() => {
    if (!o) return [];
    const stops: MapMarker[] = o.today.flatMap(({ stops: ss }) =>
      ss.map((s) => ({
        id: `stop-${s.routeId}-${s.seq}`,
        lat: s.lat,
        lng: s.lng,
        kind: 'stop' as const,
        label: String(s.seq),
        color: s.status === 'done' ? '#9aa59e' : s.status === 'skipped' ? '#7a1f1f' : '#1f6b3e',
        title: `${s.seq}. ${s.laneName} (${s.status})`,
      })),
    );
    const reports: MapMarker[] = o.reports.map((r) => ({
      id: r.reportId,
      lat: r.lat,
      lng: r.lng,
      kind: 'pin',
      color: SEVERITY_COLOUR[r.severity],
      label: '!',
      large: true,
      title: r.laneName ?? r.wardName,
      onClick: () => setSelected(r),
    }));
    return [...stops, ...reports];
  }, [o]);

  return (
    <OfficerShell openReports={o?.kpis.open}>
      <div className="officer-head">
        <div>
          <h1>Map</h1>
          <p className="muted">
            Open reports coloured by severity, with today's route. Click a red, amber or green pin.
          </p>
        </div>
      </div>
      {overview.error && !o && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {!o && <Skeleton height={520} />}
      {o && (
        <div
          className="dash-grid"
          style={{ gridTemplateColumns: selected ? 'minmax(0,1.4fr) minmax(0,1fr)' : '1fr' }}
        >
          <div style={{ position: 'relative' }}>
            <MapBox
              className="map map-full"
              markers={markers}
              path={o.today[0]?.run.path}
              fitKey={String(o.reports.length)}
              ariaLabel="Ward map"
            />
            <div className="map-legend">
              {(['high', 'medium', 'low'] as const).map((s) => (
                <span key={s}>
                  <span className="legend-dot" style={{ background: SEVERITY_COLOUR[s] }} />
                  {s}
                </span>
              ))}
              <span>
                <span className="legend-dot" style={{ background: '#1f6b3e' }} />
                route stop
              </span>
            </div>
          </div>
          {selected && (
            <ReportDetail
              report={selected}
              onChange={(r) => {
                setSelected(r);
                void overview.reload(true);
              }}
            />
          )}
        </div>
      )}
    </OfficerShell>
  );
}
