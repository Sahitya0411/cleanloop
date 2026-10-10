import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import type { Report } from '@cleanloop/shared';
import { OfficerShell } from '../../components/Shell';
import { Empty, ErrorState, SeverityPill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatTime, timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { ReportDetail } from './ReportDetail';

type Filter = 'open' | 'resolved' | 'all';

export default function OfficerReports() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('open');
  const reports = useAsync(() => api.officerReports(filter), [filter], { pollMs: 30_000 });
  const [selected, setSelected] = useState<Report>();
  const openId = params.get('open');

  const select = async (r: Report) => {
    setSelected(r);
    setParams({ open: r.reportId }, { replace: true });
    if (r.status === 'sent') {
      try {
        const seen = await api.markSeen(r.reportId);
        setSelected(seen);
        void reports.reload(true);
      } catch {
        // Seen is best-effort.
      }
    }
  };

  useEffect(() => {
    if (!openId || selected?.reportId === openId) return;
    const inList = reports.data?.find((r) => r.reportId === openId);
    if (inList) void select(inList);
    else if (reports.data)
      void api
        .report(openId)
        .then(select)
        .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, reports.data]);

  const openCount = filter === 'open' ? reports.data?.length : undefined;

  return (
    <OfficerShell openReports={openCount}>
      <div className="officer-head">
        <div>
          <h1>Reports inbox</h1>
          <p className="muted">
            Sorted by severity, then newest. Opening a report marks it seen for the resident.
          </p>
        </div>
        <div className="segmented" style={{ minWidth: 300 }}>
          {(['open', 'resolved', 'all'] as const).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {reports.error && <ErrorState error={reports.error} onRetry={reports.reload} />}
      <div className="dash-grid">
        <div className="card" style={{ padding: 6 }}>
          {!reports.data && reports.loading && <Skeleton height={300} />}
          {reports.data?.length === 0 && <Empty icon={Inbox}>Nothing here.</Empty>}
          {reports.data && reports.data.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Location</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Reported</th>
                </tr>
              </thead>
              <tbody>
                {reports.data.map((r) => (
                  <tr
                    key={r.reportId}
                    className={`clickable${selected?.reportId === r.reportId ? ' selected' : ''}`}
                    onClick={() => select(r)}
                  >
                    <td style={{ width: 64 }}>
                      {r.photoUrl && (
                        <img
                          className="thumb"
                          style={{ width: 48, height: 48 }}
                          src={r.photoUrl}
                          alt=""
                        />
                      )}
                    </td>
                    <td>
                      <div className="bold">{r.laneName ?? r.wardName}</div>
                      <div className="small muted ellipsis" style={{ maxWidth: 240 }}>
                        {r.reason}
                      </div>
                    </td>
                    <td>
                      <SeverityPill severity={r.severity} />
                    </td>
                    <td className="small" style={{ textTransform: 'capitalize' }}>
                      {r.status}
                    </td>
                    <td className="small muted">
                      {formatTime(r.createdAt)}
                      <br />
                      {timeAgo(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          {selected ? (
            <ReportDetail
              report={selected}
              onChange={(r) => {
                setSelected(r);
                void reports.reload(true);
              }}
            />
          ) : (
            <div className="card">
              <Empty icon={Inbox}>Select a report to see the photo, AI triage and location.</Empty>
            </div>
          )}
        </div>
      </div>
    </OfficerShell>
  );
}
