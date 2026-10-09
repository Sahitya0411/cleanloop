import { useMemo, useState } from 'react';
import { BellRing, House } from 'lucide-react';
import type { EtaStop } from '@cleanloop/shared';
import { AlertsSheet } from '../../components/AlertsSheet';
import { EtaCard } from '../../components/EtaCard';
import { MapBox, type MapMarker } from '../../components/Map';
import { TopBar } from '../../components/Shell';
import { ErrorState, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';

export const STOP_COLOUR = { done: '#9aa59e', skipped: '#d64545', pending: '#1f6b3e' };

export function stopMarkers(
  stops: EtaStop[],
  truck?: { lat: number; lng: number; label: string },
): MapMarker[] {
  const markers: MapMarker[] = stops.map((s) => ({
    id: `stop-${s.seq}`,
    lat: s.lat,
    lng: s.lng,
    kind: s.isMine ? 'home' : 'stop',
    color: s.isMine ? '#e37a2d' : STOP_COLOUR[s.status],
    label: String(s.seq),
    large: s.isMine,
    title: `${s.seq}. ${s.laneName}`,
  }));
  if (truck)
    markers.push({
      id: 'truck',
      lat: truck.lat,
      lng: truck.lng,
      kind: 'truck',
      title: truck.label,
    });
  return markers;
}

export default function Track() {
  const { t, lang } = useI18n();
  const home = useAsync(() => api.residentHome(), []);
  const laneId = home.data?.lane?.laneId;
  const track = useAsync(
    () => (laneId ? api.track(laneId) : Promise.resolve(undefined)),
    [laneId],
    {
      pollMs: 15_000,
    },
  );
  const [alerts, setAlerts] = useState(false);
  const data = track.data;
  const markers = useMemo(() => (data ? stopMarkers(data.stops, data.eta.truck) : []), [data]);

  return (
    <>
      <TopBar title={t('track.title')} back="/resident" />
      <div className="page">
        {(home.error || track.error) && (
          <ErrorState error={(home.error ?? track.error)!} onRetry={track.reload} />
        )}
        {!data && !track.error && <Skeleton height={300} />}
        {data && (
          <>
            <div style={{ position: 'relative' }}>
              <MapBox
                markers={markers}
                path={data.path}
                fitKey={laneId}
                ariaLabel={t('track.title')}
              />
              <span
                className="pill pill-green"
                style={{ position: 'absolute', top: 10, left: 10, zIndex: 2 }}
              >
                <span className="live-dot" /> {t('track.live')}
              </span>
            </div>
            <EtaCard eta={data.eta} link={false} />
            {data.eta.upcoming.length > 0 && (
              <div className="card">
                <h3 style={{ marginBottom: 6 }}>{t('track.nextStops')}</h3>
                <div className="list">
                  {data.eta.upcoming.map((s) => (
                    <div key={s.seq} className="list-item">
                      <span className={`num ${s.isMine ? 'num-current' : ''}`}>
                        {s.isMine ? <House size={14} /> : s.seq}
                      </span>
                      <span className="grow">
                        <span className={s.isMine ? 'bold' : ''}>
                          {s.isMine ? t('track.yourLane') : s.laneName}
                        </span>
                        {s.isMine && <span className="small muted"> · {s.laneName}</span>}
                      </span>
                      <span className="small bold">
                        {s.minutes !== undefined ? t('eta.about', { n: s.minutes }) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="btn btn-secondary btn-block" onClick={() => setAlerts(true)}>
              <BellRing size={18} /> {t('track.getNotified')}
            </button>
            <details className="card">
              <summary className="bold" style={{ cursor: 'pointer' }}>
                {t('track.allStops')} ({data.eta.progress.handled}/{data.eta.progress.total})
              </summary>
              <div className="list" style={{ marginTop: 8 }}>
                {data.stops.map((s) => (
                  <div key={s.seq} className="list-item small">
                    <span
                      className={`num ${s.status === 'done' ? 'num-done' : s.status === 'skipped' ? 'num-skip' : ''}`}
                    >
                      {s.seq}
                    </span>
                    <span className={`grow ${s.isMine ? 'bold' : ''}`}>{s.laneName}</span>
                    <span className="muted">
                      {s.status === 'pending'
                        ? s.etaAt && formatTime(s.etaAt, lang)
                        : `${s.status === 'skipped' ? '✕ ' : '✓ '}${formatTime(s.doneAt, lang)}`}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
      {alerts && home.data && (
        <AlertsSheet
          profile={home.data.profile}
          laneName={home.data.lane?.name ?? ''}
          onClose={() => setAlerts(false)}
        />
      )}
    </>
  );
}
