import { Check, MapPin } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { ErrorState, Sheet, Skeleton } from './ui';

export function LanePicker({
  current,
  onPick,
  onClose,
}: {
  current?: string;
  onPick: (laneId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const wards = useAsync(() => api.wards(), []);
  return (
    <Sheet title={t('home.chooseLane')} onClose={onClose}>
      {wards.loading && <Skeleton height={240} />}
      {wards.error && <ErrorState error={wards.error} onRetry={wards.reload} />}
      {wards.data?.map(({ ward, lanes }) => (
        <div key={ward.wardId} className="stack-sm">
          <span className="label">{ward.name}</span>
          <div className="list">
            {lanes.map((lane) => (
              <button
                key={lane.laneId}
                className="list-item"
                style={{
                  background: 'none',
                  border: 0,
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onClick={() => onPick(lane.laneId)}
              >
                <MapPin size={18} color="var(--primary)" />
                <span className="grow">
                  <span className="bold">{lane.name}</span>
                  <span className="small muted"> · {lane.area}</span>
                </span>
                {lane.laneId === current && <Check size={20} color="var(--primary)" />}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}
