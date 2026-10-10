import { useState } from 'react';
import { Check, Play, RotateCcw, X } from 'lucide-react';
import type { Lane } from '@cleanloop/shared';
import { OfficerShell } from '../../components/Shell';
import { ErrorState, Pill, RiskPill, Skeleton, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDay, formatTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { SavingsCard, useOverview } from './Overview';

export default function Routes() {
  const overview = useOverview();
  const toast = useToast();
  const [busy, setBusy] = useState<'plan' | 'reset' | null>(null);
  const o = overview.data;
  const laneById = new Map<string, Lane>((o?.lanes ?? []).map((l) => [l.laneId, l]));
  const riskById = new Map((o?.riskTomorrow ?? []).map((r) => [r.laneId, r]));

  const act = async (kind: 'plan' | 'reset') => {
    if (
      kind === 'reset' &&
      !confirm("Reset today's route? All stops go back to pending (demo tool).")
    )
      return;
    setBusy(kind);
    try {
      if (kind === 'plan') await api.plan({ force: true });
      else await api.resetToday();
      toast(kind === 'plan' ? "Tomorrow's route re-planned." : "Today's route reset.", 'success');
      await overview.reload(true);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <OfficerShell openReports={o?.kpis.open}>
      <div className="officer-head">
        <div>
          <h1>Routes</h1>
          <p className="muted">
            Today's progress, and tomorrow's risk-ordered route against the old fixed route.
          </p>
        </div>
        <div className="row wrap">
          <button
            className="btn btn-secondary"
            onClick={() => act('reset')}
            disabled={busy !== null}
          >
            {busy === 'reset' ? <Spinner size={18} /> : <RotateCcw size={18} />} Reset today (demo)
          </button>
          <button className="btn btn-primary" onClick={() => act('plan')} disabled={busy !== null}>
            {busy === 'plan' ? <Spinner size={18} /> : <Play size={18} />} Re-plan tomorrow
          </button>
        </div>
      </div>
      {overview.error && !o && <ErrorState error={overview.error} onRetry={overview.reload} />}
      {!o && <Skeleton height={500} />}
      {o && (
        <>
          {o.today.map(({ run, stops }) => (
            <div key={run.routeId} className="card stack">
              <div className="row between wrap">
                <h3>Today · {run.routeName}</h3>
                <span className="row">
                  <Pill
                    tone={
                      run.status === 'completed'
                        ? 'green'
                        : run.status === 'in_progress'
                          ? 'blue'
                          : 'grey'
                    }
                  >
                    {run.status.replace('_', ' ')}
                  </Pill>
                  <span className="small muted">{run.savings.kmSaved} km saved vs fixed route</span>
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Lane</th>
                    <th>Risk</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((s) => (
                    <tr key={s.seq}>
                      <td>
                        <span
                          className={`num ${s.status === 'done' ? 'num-done' : s.status === 'skipped' ? 'num-skip' : ''}`}
                        >
                          {s.status === 'done' ? (
                            <Check size={14} />
                          ) : s.status === 'skipped' ? (
                            <X size={14} />
                          ) : (
                            s.seq
                          )}
                        </span>
                      </td>
                      <td className="bold">{s.laneName}</td>
                      <td>{s.riskLevel && <RiskPill level={s.riskLevel} score={s.riskScore} />}</td>
                      <td className="small">
                        {s.status}
                        {s.skipReason && <span className="muted"> · {s.skipReason}</span>}
                      </td>
                      <td className="small muted">{formatTime(s.doneAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {run.deferred.length > 0 && (
                <p className="small muted">
                  Deferred today (predicted nearly empty):{' '}
                  {run.deferred.map((d) => `${d.laneName} (${d.score})`).join(', ')}
                </p>
              )}
            </div>
          ))}

          <div className="dash-grid">
            {o.plans.map((plan) => {
              const route = o.routes.find((r) => r.routeId === plan.routeId);
              const deferred = new Set(plan.deferred.map((d) => d.laneId));
              return (
                <div key={plan.routeId} className="card stack">
                  <div className="row between">
                    <h3>Tomorrow · {formatDay(plan.date)}</h3>
                    <span className="small muted">
                      generated {formatTime(plan.generatedAt)} ({plan.generatedBy})
                    </span>
                  </div>
                  <div className="grid-2" style={{ alignItems: 'start' }}>
                    <div className="stack-sm">
                      <span className="label">Proposed order (high risk first)</span>
                      {plan.order.map((id, i) => {
                        const risk = riskById.get(id);
                        return (
                          <div key={id} className="row small">
                            <span className="num" style={{ width: 24, height: 24, fontSize: 12 }}>
                              {i + 1}
                            </span>
                            <span className="grow">{laneById.get(id)?.name ?? id}</span>
                            {risk && <RiskPill level={risk.level} score={risk.score} />}
                          </div>
                        );
                      })}
                    </div>
                    <div className="stack-sm">
                      <span className="label">Old fixed route</span>
                      {route?.baselineOrder.map((id, i) => (
                        <div
                          key={id}
                          className="row small"
                          style={
                            deferred.has(id)
                              ? { textDecoration: 'line-through', color: 'var(--faint)' }
                              : undefined
                          }
                        >
                          <span className="num" style={{ width: 24, height: 24, fontSize: 12 }}>
                            {i + 1}
                          </span>
                          <span className="grow">{laneById.get(id)?.name ?? id}</span>
                          {deferred.has(id) && <Pill>deferred</Pill>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            <SavingsCard o={o} />
          </div>
        </>
      )}
    </OfficerShell>
  );
}
