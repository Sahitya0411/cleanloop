import { useState } from 'react';
import { CircleCheck, ClipboardList, MapPin, Phone } from 'lucide-react';
import { MATERIAL_LABELS, mapsLink } from '@cleanloop/shared';
import { TopBar } from '../../components/Shell';
import { Empty, ErrorState, MaterialIcon, Pill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatTime, timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';

export default function Jobs() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const jobs = useAsync(() => api.recyclerJobs(), [], { pollMs: 30_000 });
  const rows =
    jobs.data?.filter((j) => (tab === 'active' ? j.status === 'accepted' : j.status === 'done')) ??
    [];
  const activeCount = jobs.data?.filter((j) => j.status === 'accepted').length ?? 0;

  return (
    <>
      <TopBar title={t('nav.jobs')} />
      <div className="page">
        <div className="segmented">
          <button aria-pressed={tab === 'active'} onClick={() => setTab('active')}>
            {t('recycler.active')} ({activeCount})
          </button>
          <button aria-pressed={tab === 'completed'} onClick={() => setTab('completed')}>
            {t('recycler.completed')}
          </button>
        </div>
        {jobs.error && <ErrorState error={jobs.error} onRetry={jobs.reload} />}
        {!jobs.data && jobs.loading && <Skeleton height={200} />}
        {jobs.data && rows.length === 0 && (
          <Empty icon={ClipboardList}>
            <p>{t('recycler.noJobs')}</p>
          </Empty>
        )}
        {rows.map((j) => (
          <div key={j.requestId} className="card stack">
            <div className="row">
              {j.photoUrl ? (
                <img className="thumb" src={j.photoUrl} alt="" />
              ) : (
                <span className="thumb row" style={{ justifyContent: 'center' }}>
                  <MaterialIcon material={j.material} />
                </span>
              )}
              <div className="grow stack-sm">
                <span className="bold">
                  {MATERIAL_LABELS[j.material][lang]}
                  {j.estWeightKg ? ` · ${t('pickup.kg', { n: j.estWeightKg })}` : ''}
                </span>
                <span className="small muted">
                  {j.residentName} · {j.laneName ?? ''}
                </span>
                <span className="tiny faint">
                  {j.status === 'done'
                    ? `✓ ${formatTime(j.doneAt, lang)}`
                    : timeAgo(j.acceptedAt ?? j.createdAt, lang)}
                </span>
              </div>
              <Pill tone={j.status === 'done' ? 'green' : 'blue'}>
                {t(`pickup.status.${j.status}`)}
              </Pill>
            </div>
            {j.status === 'accepted' && (
              <div className="grid-3">
                {j.residentPhone ? (
                  <a
                    className="btn btn-sm btn-secondary"
                    href={`tel:${j.residentPhone.replace(/\s/g, '')}`}
                  >
                    <Phone size={16} /> {t('pickup.call')}
                  </a>
                ) : (
                  <span />
                )}
                <a
                  className="btn btn-sm btn-secondary"
                  href={mapsLink(j)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={16} /> {t('recycler.openMap')}
                </a>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    try {
                      await api.completePickup(j.requestId);
                      void jobs.reload(true);
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }}
                >
                  <CircleCheck size={16} /> {t('recycler.markDone')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
