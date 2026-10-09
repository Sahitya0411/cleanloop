import { useMemo, useState } from 'react';
import { Check, Navigation, SkipForward } from 'lucide-react';
import { directionsLink, haversineKm, round } from '@cleanloop/shared';
import { MapBox, type MapMarker } from '../../components/Map';
import { TopBar } from '../../components/Shell';
import { ErrorState, Skeleton } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { STOP_COLOUR } from '../resident/Track';
import { SkipSheet } from './SkipSheet';
import { currentStop, pendingEtas, useDriverRoute } from './useDriverRoute';

export default function RouteMap() {
  const { t } = useI18n();
  const route = useDriverRoute();
  const [skipping, setSkipping] = useState(false);
  const data = route.data;
  const stops = useMemo(() => (data ? [...data.stops].sort((a, b) => a.seq - b.seq) : []), [data]);
  const current = currentStop(stops);
  const truck = useMemo(() => {
    const lastHandled = [...stops].reverse().find((s) => s.status !== 'pending');
    if (lastHandled)
      return { lat: lastHandled.lat, lng: lastHandled.lng, laneName: lastHandled.laneName };
    return data
      ? { lat: data.route.depot.lat, lng: data.route.depot.lng, laneName: data.route.depot.name }
      : undefined;
  }, [stops, data]);

  const markers = useMemo<MapMarker[]>(() => {
    const ms: MapMarker[] = stops.map((s) => ({
      id: `s${s.seq}`,
      lat: s.lat,
      lng: s.lng,
      kind: 'stop',
      label: String(s.seq),
      color: s.seq === current?.seq ? '#e37a2d' : STOP_COLOUR[s.status],
      large: s.seq === current?.seq,
      title: `${s.seq}. ${s.laneName}`,
    }));
    if (truck)
      ms.push({
        id: 'truck',
        lat: truck.lat,
        lng: truck.lng,
        kind: 'truck',
        title: truck.laneName,
      });
    return ms;
  }, [stops, current?.seq, truck]);

  const km = current && truck ? round(haversineKm(truck, current) * 1.35, 1) : undefined;

  return (
    <>
      <TopBar title={t('nav.map')} back="/driver" />
      <div className="page driver-page">
        {route.error && !data && <ErrorState error={route.error} onRetry={route.reload} />}
        {!data && route.loading && <Skeleton height={420} />}
        {data && (
          <>
            <MapBox
              className="map map-tall"
              markers={markers}
              path={data.run.path}
              fitKey={String(current?.seq ?? 'done')}
              ariaLabel={t('driver.title')}
            />
            {current ? (
              <div className="card stack">
                <span className="small muted">{t('driver.next')}</span>
                <h2>{current.laneName}</h2>
                <span className="muted">
                  {t('eta.about', { n: pendingEtas(stops).get(current.seq) ?? 0 })}
                  {km !== undefined && ` · ~${km} km`}
                </span>
                <a
                  className="btn btn-soft btn-block"
                  href={directionsLink(current)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Navigation size={20} /> {t('driver.navigate')}
                </a>
              </div>
            ) : (
              <div className="card card-green center bold">{t('driver.allDone')}</div>
            )}
          </>
        )}
      </div>
      {current && (
        <div className="driver-actions">
          <button
            className="btn btn-primary btn-lg"
            disabled={route.busy}
            onClick={() => route.done(current.seq)}
          >
            <Check size={26} /> {t('driver.done')}
          </button>
          <button
            className="btn btn-secondary btn-lg"
            disabled={route.busy}
            onClick={() => setSkipping(true)}
          >
            <SkipForward size={22} /> {t('driver.skip')}
          </button>
        </div>
      )}
      {skipping && current && (
        <SkipSheet
          laneName={current.laneName}
          onClose={() => setSkipping(false)}
          onSkip={(reason) => {
            setSkipping(false);
            void route.skip(current.seq, reason);
          }}
        />
      )}
    </>
  );
}
