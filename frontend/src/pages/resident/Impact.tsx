import {
  Camera,
  CircleCheck,
  Factory,
  Fuel,
  Recycle,
  Route as RouteIcon,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { TopBar } from '../../components/Shell';
import { ErrorState, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';

function Stat({
  icon: Icon,
  value,
  label,
  colour = 'var(--primary)',
}: {
  icon: typeof Camera;
  value: string | number;
  label: string;
  colour?: string;
}) {
  return (
    <div className="stat">
      <Icon size={22} color={colour} />
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function Impact() {
  const { t } = useI18n();
  const impact = useAsync(() => api.impact(), []);
  const d = impact.data;
  return (
    <>
      <TopBar title={t('impact.title')} />
      <div className="page">
        {impact.error && <ErrorState error={impact.error} onRetry={impact.reload} />}
        {!d && impact.loading && <Skeleton height={300} />}
        {d && (
          <>
            <div className="grid-2">
              <Stat icon={Camera} value={d.me.itemsSorted} label={t('impact.itemsSorted')} />
              <Stat
                icon={TriangleAlert}
                value={d.me.reports}
                label={t('impact.reports')}
                colour="var(--danger)"
              />
              <Stat icon={CircleCheck} value={d.me.reportsResolved} label={t('impact.resolved')} />
              <Stat icon={Recycle} value={d.me.pickups} label={t('impact.pickups')} />
            </div>
            <div className="section-title">
              <h3>{t('impact.ward')}</h3>
            </div>
            <div className="card card-dark stack">
              <div className="row between">
                <span className="row">
                  <RouteIcon size={22} /> {t('impact.kmSaved')}
                </span>
                <span className="eta-big">{d.ward.kmSaved7d} km</span>
              </div>
              <div className="grid-2">
                <div>
                  <div className="row small" style={{ opacity: 0.85 }}>
                    <Fuel size={16} /> {t('impact.diesel')}
                  </div>
                  <div className="bold" style={{ fontSize: 22 }}>
                    {d.ward.dieselLitresSaved7d} L
                  </div>
                </div>
                <div>
                  <div className="row small" style={{ opacity: 0.85 }}>
                    <Factory size={16} /> {t('impact.co2')}
                  </div>
                  <div className="bold" style={{ fontSize: 22 }}>
                    {d.ward.co2KgSaved7d} kg
                  </div>
                </div>
              </div>
            </div>
            <div className="grid-3">
              <Stat
                icon={CircleCheck}
                value={d.ward.reportsResolved7d}
                label={t('impact.reportsResolved')}
              />
              <Stat icon={Truck} value={d.ward.pickupsDone7d} label={t('impact.pickupsDone')} />
              <Stat icon={Camera} value={d.ward.itemsSorted7d} label={t('impact.sortedWard')} />
            </div>
            <p className="small muted">{t('impact.estimate', { kmpl: 3 })}</p>
          </>
        )}
      </div>
    </>
  );
}
