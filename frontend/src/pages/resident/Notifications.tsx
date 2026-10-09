import { useEffect, useState } from 'react';
import {
  Bell,
  BellRing,
  CalendarClock,
  CircleCheck,
  Inbox,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import type { NotificationType } from '@cleanloop/shared';
import { AlertsSheet } from '../../components/AlertsSheet';
import { TopBar } from '../../components/Shell';
import { Empty, ErrorState, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatTime, timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { markNotificationsSeen } from './Home';

const ICON: Record<NotificationType, typeof Bell> = {
  truck_near: Truck,
  missed: TriangleAlert,
  collected: CircleCheck,
  deferred: CalendarClock,
  info: Bell,
};

export default function Notifications() {
  const { t, lang } = useI18n();
  const home = useAsync(() => api.residentHome(), []);
  const laneId = home.data?.lane?.laneId;
  const items = useAsync(
    () => (laneId ? api.notifications(laneId) : Promise.resolve([])),
    [laneId],
    { pollMs: 20_000 },
  );
  const [alerts, setAlerts] = useState(false);

  useEffect(() => markNotificationsSeen(items.data?.[0]?.createdAt), [items.data]);

  return (
    <>
      <TopBar title={t('notifications.title')} back="/resident" />
      <div className="page">
        {items.error && <ErrorState error={items.error} onRetry={items.reload} />}
        {(home.loading || items.loading) && !items.data && <Skeleton height={200} />}
        <button
          className="btn btn-secondary btn-block"
          onClick={() => setAlerts(true)}
          disabled={!home.data}
        >
          <BellRing size={18} /> {t('track.getNotified')}
        </button>
        {items.data?.length === 0 && (
          <Empty icon={Inbox}>
            <p>{t('home.noAlerts')}</p>
          </Empty>
        )}
        {items.data && items.data.length > 0 && (
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              {items.data.map((n) => {
                const Icon = ICON[n.type];
                return (
                  <div key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                    <Icon
                      size={20}
                      color={n.type === 'missed' ? 'var(--danger)' : 'var(--primary)'}
                      style={{ marginTop: 2 }}
                    />
                    <div className="grow stack-sm">
                      <span>{lang === 'hi' ? n.messageHi : n.message}</span>
                      <span className="tiny faint">
                        {formatTime(n.createdAt, lang)} · {timeAgo(n.createdAt, lang)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
