import { useState } from 'react';
import { Camera, CircleCheck, ExternalLink, MapPin, User } from 'lucide-react';
import type { Report } from '@cleanloop/shared';
import { mapsLink } from '@cleanloop/shared';
import { PhotoCapture } from '../../components/PhotoCapture';
import { StatusTracker } from '../../components/StatusTracker';
import { Pill, SeverityPill, Sheet, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, formatTime, pct } from '../../lib/format';
import { uploadPhoto } from '../../lib/image';
import { useToast } from '../../lib/toast';

function ResolveFlow({
  report,
  onDone,
  onClose,
}: {
  report: Report;
  onDone: (r: Report) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [photo, setPhoto] = useState<{ blob: Blob; url: string }>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!photo) {
    return (
      <PhotoCapture
        title="After-photo"
        hint="Photograph the cleaned spot"
        onClose={onClose}
        onCapture={(blob) => setPhoto({ blob, url: URL.createObjectURL(blob) })}
      />
    );
  }
  const submit = async () => {
    setBusy(true);
    try {
      const key = await uploadPhoto('resolve', photo.blob);
      const updated = await api.resolve(report.reportId, key, note.trim() || undefined);
      toast('Marked resolved. The resident can see the after-photo.', 'success');
      onDone(updated);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Resolve report" onClose={onClose} modal>
      <img className="thumb-lg" src={photo.url} alt="After cleaning" />
      <div className="field">
        <label htmlFor="rnote">Note for the resident (optional)</label>
        <input
          id="rnote"
          className="input"
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Cleared and bin replaced"
        />
      </div>
      <div className="grid-2">
        <button className="btn btn-secondary" onClick={() => setPhoto(undefined)} disabled={busy}>
          <Camera size={18} /> Retake
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? <Spinner size={18} /> : <CircleCheck size={18} />} Resolve
        </button>
      </div>
    </Sheet>
  );
}

export function ReportDetail({
  report,
  onChange,
}: {
  report: Report;
  onChange: (r: Report) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const isSeed = report.reporterId.startsWith('seed-');
  return (
    <div className="card stack">
      <div className="row between wrap">
        <div>
          <h2>{report.laneName ?? 'Unmapped location'}</h2>
          <span className="small muted">
            {report.wardName} · {formatTime(report.createdAt)} {formatDate(report.createdAt)}
          </span>
        </div>
        <SeverityPill severity={report.severity} />
      </div>
      {report.photoUrl && (
        <img
          className="thumb-lg"
          style={{ height: 260 }}
          src={report.photoUrl}
          alt="Reported bin"
        />
      )}
      <div className="card-flat stack-sm">
        <span className="label">
          AI triage · {pct(report.confidence)} confidence ·{' '}
          {report.aiSource === 'bedrock' ? 'Claude on Amazon Bedrock' : report.aiSource}
        </span>
        <span>{report.reason}</span>
        {report.hazards.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {report.hazards.map((h) => (
              <Pill key={h} tone="red">
                {h.replace(/_/g, ' ')}
              </Pill>
            ))}
          </div>
        )}
      </div>
      {report.note && (
        <div className="row-top small">
          <User size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <b>{report.reporterName ?? 'Resident'}:</b> {report.note}
          </span>
        </div>
      )}
      <div className="row small">
        <MapPin size={16} color="var(--primary)" />
        <a
          href={mapsLink(report)}
          target="_blank"
          rel="noreferrer"
          className="row"
          style={{ gap: 4 }}
        >
          {report.lat.toFixed(5)}, {report.lng.toFixed(5)} <ExternalLink size={13} />
        </a>
        <span className="muted">
          ({report.locationSource === 'gps' ? 'phone GPS' : "resident's lane"})
        </span>
        {isSeed && <Pill>demo data</Pill>}
      </div>
      <StatusTracker report={report} />
      {report.afterPhotoUrl && (
        <div className="stack-sm">
          <span className="label">After-photo</span>
          <img
            className="thumb-lg"
            style={{ height: 180 }}
            src={report.afterPhotoUrl}
            alt="After cleaning"
          />
          {report.resolvedNote && <span className="small muted">{report.resolvedNote}</span>}
        </div>
      )}
      {report.status !== 'resolved' && (
        <button className="btn btn-primary btn-block" onClick={() => setResolving(true)}>
          <Camera size={18} /> Resolve with after-photo
        </button>
      )}
      {resolving && (
        <ResolveFlow
          report={report}
          onClose={() => setResolving(false)}
          onDone={(r) => {
            setResolving(false);
            onChange(r);
          }}
        />
      )}
    </div>
  );
}
