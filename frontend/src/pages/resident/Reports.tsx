import { Link } from 'react-router-dom';
import { ClipboardList, Plus } from 'lucide-react';
import { TopBar } from '../../components/Shell';
import { StatusTracker } from '../../components/StatusTracker';
import { Empty, ErrorState, SeverityPill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';

export default function Reports() {
  const { t, lang } = useI18n();
  const reports = useAsync(() => api.myReports(), [], { pollMs: 30_000 });
  return (
    <>
      <TopBar title={t('report.myReports')} back="/resident" />
      <div className="page">
        {reports.error && <ErrorState error={reports.error} onRetry={reports.reload} />}
        {reports.loading && !reports.data && <Skeleton height={220} />}
        {reports.data?.length === 0 && (
          <Empty icon={ClipboardList}>
            <p>{t('report.noReports')}</p>
          </Empty>
        )}
        {reports.data?.map((r) => (
          <div key={r.reportId} className="card stack">
            <div className="row-top">
              {r.photoUrl && <img className="thumb" src={r.photoUrl} alt="" />}
              <div className="grow stack-sm">
                <div className="row between">
                  <span className="bold">{r.laneName ?? r.wardName}</span>
                  <SeverityPill severity={r.severity} />
                </div>
                <span className="small muted">{r.reason}</span>
                <span className="tiny faint">{formatDate(r.createdAt, lang)}</span>
              </div>
            </div>
            <StatusTracker report={r} />
            {r.afterPhotoUrl && (
              <div className="stack-sm">
                <span className="label">{t('report.afterPhoto')}</span>
                <img
                  className="thumb-lg"
                  style={{ height: 160 }}
                  src={r.afterPhotoUrl}
                  alt={t('report.afterPhoto')}
                />
                {r.resolvedNote && <span className="small muted">{r.resolvedNote}</span>}
              </div>
            )}
          </div>
        ))}
        <Link to="/resident/report" className="btn btn-primary btn-block">
          <Plus size={18} /> {t('home.report')}
        </Link>
      </div>
    </>
  );
}
