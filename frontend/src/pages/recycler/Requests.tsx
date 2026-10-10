import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, MapPin, Sparkles, Store } from 'lucide-react';
import { MATERIAL_LABELS } from '@cleanloop/shared';
import { TopBar } from '../../components/Shell';
import { Empty, ErrorState, MaterialIcon, Pill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';

export default function Requests() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { session } = useSession();
  const [scope, setScope] = useState<'nearby' | 'all'>('nearby');
  const me = useAsync(() => api.recyclerMe(), []);
  const requests = useAsync(() => api.recyclerRequests(scope), [scope], { pollMs: 30_000 });
  const [busyId, setBusyId] = useState<string>();
  const registered = me.data?.recycler;

  const accept = async (id: string) => {
    setBusyId(id);
    try {
      await api.acceptPickup(id);
      toast(t('recycler.accepted'), 'success');
      void requests.reload(true);
    } catch (err) {
      toast((err as Error).message, 'error');
      void requests.reload(true);
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <>
      <TopBar />
      <div className="page">
        <h1>
          {t('recycler.welcome', {
            name: (registered?.name ?? session?.user.name ?? '').split(' ')[0] ?? '',
          })}
        </h1>
        {me.data && !registered && (
          <Link to="/recycler/profile" className="banner banner-amber card-link">
            <Store size={20} />
            <span className="grow bold">{t('recycler.registerFirst')}</span>
            <span className="btn btn-sm btn-primary">{t('recycler.register')}</span>
          </Link>
        )}
        <div className="segmented">
          <button aria-pressed={scope === 'nearby'} onClick={() => setScope('nearby')}>
            {t('recycler.nearby')}
          </button>
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            {t('recycler.all')}
          </button>
        </div>
        {requests.error && <ErrorState error={requests.error} onRetry={requests.reload} />}
        {!requests.data && requests.loading && <Skeleton height={300} />}
        {requests.data?.length === 0 && (
          <Empty icon={Inbox}>
            <p>{t('recycler.noRequests')}</p>
          </Empty>
        )}
        {requests.data?.map((p) => (
          <div key={p.requestId} className="card row-top">
            {p.photoUrl ? (
              <img className="thumb" style={{ width: 72, height: 72 }} src={p.photoUrl} alt="" />
            ) : (
              <span
                className="thumb row"
                style={{ width: 72, height: 72, justifyContent: 'center' }}
              >
                <MaterialIcon material={p.material} />
              </span>
            )}
            <div className="grow stack-sm">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <span className="bold">
                  {p.itemType === 'e_waste'
                    ? t('pickup.ewaste')
                    : MATERIAL_LABELS[p.material][lang]}
                </span>
                {p.suggestedRecyclerId === session?.user.userId && (
                  <Pill tone="green">
                    <Sparkles size={12} /> {t('recycler.matched')}
                  </Pill>
                )}
              </div>
              <span className="small">
                {[
                  p.itemType === 'e_waste' ? MATERIAL_LABELS[p.material][lang] : undefined,
                  p.estWeightKg ? t('pickup.kg', { n: p.estWeightKg }) : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {p.notes && <span className="small muted">{p.notes}</span>}
              <span className="small muted row" style={{ gap: 4 }}>
                <MapPin size={13} /> {p.laneName ?? '—'}
                {p.distanceKm !== undefined &&
                  ` · ${t('recycler.kmAway', { n: p.distanceKm })}`} · {timeAgo(p.createdAt, lang)}
              </span>
              <button
                className="btn btn-primary btn-sm"
                style={{ alignSelf: 'flex-end', minWidth: 110 }}
                disabled={!registered || busyId === p.requestId}
                onClick={() => accept(p.requestId)}
              >
                {t('recycler.accept')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
