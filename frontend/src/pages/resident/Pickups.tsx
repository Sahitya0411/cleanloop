import { Link } from 'react-router-dom';
import { Phone, Plus, Recycle } from 'lucide-react';
import type { PickupStatus } from '@cleanloop/shared';
import { MATERIAL_LABELS } from '@cleanloop/shared';
import { TopBar } from '../../components/Shell';
import { Empty, ErrorState, MaterialIcon, Pill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';

const TONE: Record<PickupStatus, 'amber' | 'blue' | 'green' | 'grey'> = {
  open: 'amber',
  accepted: 'blue',
  done: 'green',
  cancelled: 'grey',
};

export default function Pickups() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const pickups = useAsync(() => api.myPickups(), [], { pollMs: 30_000 });
  return (
    <>
      <TopBar title={t('pickup.myPickups')} back="/resident" />
      <div className="page">
        {pickups.error && <ErrorState error={pickups.error} onRetry={pickups.reload} />}
        {pickups.loading && !pickups.data && <Skeleton height={160} />}
        {pickups.data?.length === 0 && (
          <Empty icon={Recycle}>
            <p>{t('pickup.noPickups')}</p>
          </Empty>
        )}
        {pickups.data?.map((p) => (
          <div key={p.requestId} className="card stack">
            <div className="row">
              {p.photoUrl ? (
                <img className="thumb" src={p.photoUrl} alt="" />
              ) : (
                <span className="thumb row" style={{ justifyContent: 'center' }}>
                  <MaterialIcon material={p.material} />
                </span>
              )}
              <div className="grow stack-sm">
                <span className="bold">
                  {MATERIAL_LABELS[p.material][lang]}
                  {p.estWeightKg ? ` · ${t('pickup.kg', { n: p.estWeightKg })}` : ''}
                </span>
                <span className="tiny faint">{timeAgo(p.createdAt, lang)}</span>
              </div>
              <Pill tone={TONE[p.status]}>{t(`pickup.status.${p.status}`)}</Pill>
            </div>
            {p.status === 'accepted' && p.recyclerName && (
              <div className="banner banner-blue">
                <Recycle size={20} />
                <div className="grow stack-sm">
                  <span className="bold">{p.recyclerName}</span>
                  <span className="small">{t('pickup.willCall', { name: p.recyclerName })}</span>
                </div>
                {p.recyclerPhone && (
                  <a
                    className="btn btn-sm btn-primary"
                    href={`tel:${p.recyclerPhone.replace(/\s/g, '')}`}
                  >
                    <Phone size={16} /> {t('pickup.call')}
                  </a>
                )}
              </div>
            )}
            {p.status === 'done' && p.recyclerName && (
              <span className="small muted">✓ {p.recyclerName}</span>
            )}
            {p.status === 'open' && (
              <button
                className="btn btn-sm btn-secondary"
                style={{ alignSelf: 'flex-start' }}
                onClick={async () => {
                  try {
                    await api.cancelPickup(p.requestId);
                    void pickups.reload(true);
                  } catch (err) {
                    toast((err as Error).message, 'error');
                  }
                }}
              >
                {t('pickup.cancel')}
              </button>
            )}
          </div>
        ))}
        <Link to="/resident/pickup" className="btn btn-primary btn-block">
          <Plus size={18} /> {t('home.pickup')}
        </Link>
      </div>
    </>
  );
}
