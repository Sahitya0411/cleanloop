import { Phone, Recycle } from 'lucide-react';
import type { PickupStatus } from '@cleanloop/shared';
import { MATERIAL_LABELS } from '@cleanloop/shared';
import { OfficerShell } from '../../components/Shell';
import { Empty, ErrorState, Pill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';

const TONE: Record<PickupStatus, 'amber' | 'blue' | 'green' | 'grey'> = {
  open: 'amber',
  accepted: 'blue',
  done: 'green',
  cancelled: 'grey',
};

export default function Recyclers() {
  const recyclers = useAsync(() => api.officerRecyclers(), []);
  const pickups = useAsync(() => api.officerPickups(), [], { pollMs: 30_000 });
  const done = pickups.data?.filter((p) => p.status === 'done') ?? [];
  const kg = done.reduce((s, p) => s + (p.estWeightKg ?? 0), 0);

  return (
    <OfficerShell>
      <div className="officer-head">
        <div>
          <h1>Recyclers and pickups</h1>
          <p className="muted">
            Kabadiwalas who registered with consent. Residents' recyclables and e-waste go to the
            nearest one who buys that material.
          </p>
        </div>
        <Pill tone="green">
          {done.length} pickups done · ~{kg} kg diverted from landfill
        </Pill>
      </div>
      {(recyclers.error || pickups.error) && (
        <ErrorState error={(recyclers.error ?? pickups.error)!} onRetry={recyclers.reload} />
      )}
      {!recyclers.data && <Skeleton height={160} />}
      <div className="dash-grid-3">
        {recyclers.data?.map((r) => (
          <div key={r.recyclerId} className="card stack-sm">
            <div className="row between">
              <h3>{r.name}</h3>
              <Recycle size={20} color="var(--primary)" />
            </div>
            <span className="small muted">{r.area}</span>
            <a href={`tel:${r.phone.replace(/\s/g, '')}`} className="small row" style={{ gap: 6 }}>
              <Phone size={14} /> {r.phone}
            </a>
            <div className="row wrap" style={{ gap: 6 }}>
              {r.acceptedMaterials.map((m) => (
                <Pill key={m} tone="green">
                  {MATERIAL_LABELS[m].en}
                  {r.approxRates[m] !== undefined && ` ₹${r.approxRates[m]}/kg`}
                </Pill>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ marginBottom: 8 }}>Pickup requests</h3>
        {pickups.data?.length === 0 && <Empty icon={Recycle}>No pickup requests yet.</Empty>}
        {pickups.data && pickups.data.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Lane</th>
                <th>Status</th>
                <th>Recycler</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {pickups.data.map((p) => (
                <tr key={p.requestId}>
                  <td className="bold">
                    {MATERIAL_LABELS[p.material].en}
                    {p.estWeightKg ? ` · ${p.estWeightKg} kg` : ''}
                  </td>
                  <td>{p.laneName ?? '—'}</td>
                  <td>
                    <Pill tone={TONE[p.status]}>{p.status}</Pill>
                  </td>
                  <td>{p.recyclerName ?? '—'}</td>
                  <td className="small muted">{timeAgo(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OfficerShell>
  );
}
