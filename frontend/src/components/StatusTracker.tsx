import { Check, Eye, Send } from 'lucide-react';
import type { Report } from '@cleanloop/shared';
import { formatDate, formatTime } from '../lib/format';
import { useI18n } from '../lib/i18n';

/** Sent -> Seen -> Resolved, with timestamps. */
export function StatusTracker({ report }: { report: Report }) {
  const { t, lang } = useI18n();
  const steps = [
    { key: 'report.sent' as const, at: report.createdAt, icon: Send },
    { key: 'report.seen' as const, at: report.seenAt, icon: Eye },
    { key: 'report.resolved' as const, at: report.resolvedAt, icon: Check },
  ];
  return (
    <ol className="timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s) => (
        <li key={s.key} className={`timeline-step${s.at ? ' done' : ''}`}>
          <span className="timeline-dot">
            <s.icon size={13} />
          </span>
          <span className={s.at ? 'bold' : 'muted'}>{t(s.key)}</span>
          <span className="small muted">
            {s.at ? `${formatTime(s.at, lang)} · ${formatDate(s.at, lang)}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
