import { useState } from 'react';
import { CalendarClock, Check, PartyPopper, SkipForward, X } from 'lucide-react';
import { TopBar } from '../../components/Shell';
import { ErrorState, Pill, RiskPill, Skeleton } from '../../components/ui';
import { formatTime } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { SkipSheet } from './SkipSheet';
import { currentStop, pendingEtas, useDriverRoute } from './useDriverRoute';

export default function DriverRoute() {
  const { t, lang } = useI18n();
  const route = useDriverRoute();
  const [skipping, setSkipping] = useState(false);
  const data = route.data;
  const stops = data ? [...data.stops].sort((a, b) => a.seq - b.seq) : [];
  const current = currentStop(stops);
  const handled = stops.filter((s) => s.status !== 'pending').length;
  const pct = stops.length ? Math.round((handled / stops.length) * 100) : 0;
  const etas = pendingEtas(stops);

  return (
    <>
      <TopBar title={t('driver.title')} />
      <div className="page driver-page">
        {route.error && !data && <ErrorState error={route.error} onRetry={route.reload} />}
        {!data && route.loading && <Skeleton height={400} />}
        {data && (
          <>
            <div className="card stack">
              <div className="row between">
                <div>
                  <div className="bold">{data.route.name}</div>
                  <div className="small muted">
                    {t('driver.vehicle', { n: data.route.vehicleNumber })}
                  </div>
                </div>
                <span className="bold" style={{ fontSize: 20 }}>
                  {pct}%
                </span>
              </div>
              <div className="progress" aria-label={`${pct}%`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <span className="bold">
                {t('driver.stops', { done: handled, total: stops.length })}
              </span>
            </div>

            {data.run.deferred.length > 0 && (
              <details className="banner banner-blue" style={{ display: 'block' }}>
                <summary className="row" style={{ cursor: 'pointer' }}>
                  <CalendarClock size={18} />{' '}
                  {t('driver.deferred', { n: data.run.deferred.length })}
                </summary>
                <p className="small" style={{ marginTop: 6 }}>
                  {data.run.deferred.map((d) => d.laneName).join(', ')}
                </p>
              </details>
            )}

            {!current && (
              <div className="card card-green stack center" style={{ alignItems: 'center' }}>
                <PartyPopper size={40} color="var(--primary)" />
                <h2>{t('driver.allDone')}</h2>
                <p className="muted">{t('driver.allDoneHint')}</p>
              </div>
            )}

            <div className="card" style={{ padding: '6px 12px' }}>
              <ol className="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {stops.map((s) => {
                  const isCurrent = s.seq === current?.seq;
                  return (
                    <li key={s.seq} className={`list-item${isCurrent ? ' stop-current' : ''}`}>
                      <span
                        className={`num ${s.status === 'done' ? 'num-done' : s.status === 'skipped' ? 'num-skip' : isCurrent ? 'num-current' : ''}`}
                      >
                        {s.status === 'done' ? (
                          <Check size={16} />
                        ) : s.status === 'skipped' ? (
                          <X size={16} />
                        ) : (
                          s.seq
                        )}
                      </span>
                      <span className="grow">
                        <span
                          className={isCurrent ? 'bold' : s.status !== 'pending' ? 'muted' : ''}
                        >
                          {s.laneName}
                        </span>
                        {isCurrent && (
                          <span
                            className="small"
                            style={{ display: 'block', color: 'var(--primary)', fontWeight: 700 }}
                          >
                            {t('driver.current')}
                          </span>
                        )}
                        {s.status === 'skipped' && s.skipReason && (
                          <span
                            className="small"
                            style={{ display: 'block', color: 'var(--danger)' }}
                          >
                            {t('driver.skipped')}: {s.skipReason}
                          </span>
                        )}
                      </span>
                      {s.riskLevel === 'high' && s.status === 'pending' && (
                        <RiskPill level="high" />
                      )}
                      <span className="small muted" style={{ minWidth: 64, textAlign: 'right' }}>
                        {s.status !== 'pending'
                          ? formatTime(s.doneAt, lang)
                          : isCurrent
                            ? ''
                            : t('eta.about', { n: etas.get(s.seq) ?? 0 })}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
            {data.run.status === 'completed' && <Pill tone="green">✓ {t('driver.allDone')}</Pill>}
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
