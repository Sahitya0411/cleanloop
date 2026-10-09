import { Link } from 'react-router-dom';
import { CalendarClock, CircleCheck, Clock, TriangleAlert, Truck } from 'lucide-react';
import type { EtaInfo } from '@cleanloop/shared';
import { formatTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { Pill } from './ui';

function ProgressDots({ handled, total }: { handled: number; total: number }) {
  const n = 6;
  const filled = total ? Math.round((handled / total) * (n - 1)) : 0;
  return (
    <div className="dots" aria-label={`${handled}/${total}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <i className={i <= filled && handled > 0 ? 'on' : ''} />
          {i < n - 1 && <b className={i < filled ? 'on' : ''} />}
        </span>
      ))}
    </div>
  );
}

/** The truck card on the resident home screen. */
export function EtaCard({ eta, link = true }: { eta: EtaInfo; link?: boolean }) {
  const { t, lang } = useI18n();
  let headline: string;
  let sub: string | undefined;
  let tone: 'green' | 'red' | 'grey' = 'green';
  let Icon = Truck;

  switch (eta.status) {
    case 'next':
      headline = t('eta.nextStop');
      sub = t('eta.about', { n: eta.minutes ?? 0 });
      break;
    case 'upcoming':
      headline = eta.stopsAway ? t('eta.stopsAway', { n: eta.stopsAway }) : t('home.truck');
      sub = eta.minutes !== undefined ? t('eta.about', { n: eta.minutes }) : undefined;
      break;
    case 'collected':
      headline = t('eta.collected', { time: formatTime(eta.collectedAt, lang) });
      Icon = CircleCheck;
      break;
    case 'missed':
      headline = t('eta.missed');
      sub = eta.skipReason;
      tone = 'red';
      Icon = TriangleAlert;
      break;
    case 'deferred':
      headline = t('eta.deferred');
      sub = t('eta.deferredHint');
      tone = 'grey';
      Icon = CalendarClock;
      break;
    case 'not_scheduled':
      headline = t('eta.notScheduled');
      tone = 'grey';
      Icon = Clock;
      break;
    default:
      headline = t('eta.noRoute');
      tone = 'grey';
      Icon = Clock;
  }

  const body = (
    <div
      className={`card ${tone === 'green' ? 'card-green' : ''}`}
      style={tone === 'red' ? { border: '1px solid #f2c4c4' } : undefined}
    >
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm grow">
          <div className="row" style={{ gap: 8 }}>
            <span className="bold">{t('home.truck')}</span>
            {eta.late && (eta.status === 'upcoming' || eta.status === 'next') && (
              <Pill tone="amber">{t('eta.late')}</Pill>
            )}
          </div>
          <span
            className="eta-big"
            style={
              tone === 'red'
                ? { color: 'var(--danger)', fontSize: 24 }
                : tone === 'grey'
                  ? { fontSize: 22 }
                  : undefined
            }
          >
            {headline}
          </span>
          {sub && (
            <span
              className={tone === 'grey' ? 'small muted' : 'bold'}
              style={tone === 'green' ? { fontSize: 20 } : undefined}
            >
              {sub}
            </span>
          )}
        </div>
        <span className="eta-icon" style={tone === 'red' ? { color: 'var(--danger)' } : undefined}>
          <Icon size={36} />
        </span>
      </div>
      {eta.progress.total > 0 && (
        <div className="stack-sm" style={{ marginTop: 14 }}>
          <ProgressDots handled={eta.progress.handled} total={eta.progress.total} />
          {eta.truck && eta.progress.handled > 0 && (
            <span className="small muted">{t('eta.truckAt', { place: eta.truck.label })}</span>
          )}
        </div>
      )}
      {eta.status === 'missed' && (
        <Link to="/resident/report" className="btn btn-danger btn-block" style={{ marginTop: 12 }}>
          {t('eta.reportMissed')}
        </Link>
      )}
    </div>
  );
  return link && eta.status !== 'missed' ? (
    <Link to="/resident/track" className="card-link" aria-label={t('track.title')}>
      {body}
    </Link>
  ) : (
    body
  );
}
