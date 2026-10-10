import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, LocateFixed, MapPin, Send, Sparkles, TriangleAlert } from 'lucide-react';
import type { CreateReportResponse, LatLng, Report as ReportT } from '@cleanloop/shared';
import { PhotoCapture } from '../../components/PhotoCapture';
import { TopBar } from '../../components/Shell';
import { StatusTracker } from '../../components/StatusTracker';
import { Pill, SeverityPill, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { getPosition } from '../../lib/geo';
import { useI18n } from '../../lib/i18n';
import { uploadPhoto } from '../../lib/image';
import { useToast } from '../../lib/toast';

export default function Report() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<{ blob: Blob; name: string; url: string }>();
  const [position, setPosition] = useState<LatLng | null | undefined>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState<string>();
  const [result, setResult] = useState<CreateReportResponse>();

  useEffect(() => {
    void getPosition().then(setPosition);
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const send = async (force = false) => {
    if (!photo) return;
    setBusy(true);
    try {
      const key = photoKey ?? (await uploadPhoto('report', photo.blob));
      setPhotoKey(key);
      const res = await api.createReport({
        photoKey: key,
        lat: position?.lat,
        lng: position?.lng,
        note: note.trim() || undefined,
        lang,
        force,
        fileName: photo.name,
      });
      setResult(res);
      if (res.created) toast(t('report.thanks'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!photo) {
    return (
      <PhotoCapture
        title={t('report.title')}
        hint={t('report.hint')}
        onClose={() => navigate('/resident')}
        onCapture={(blob, name) => setPhoto({ blob, name, url: URL.createObjectURL(blob) })}
      />
    );
  }

  const created: ReportT | undefined = result?.created ? result.report : undefined;
  const analysis = result?.analysis;

  return (
    <>
      <TopBar title={t('report.title')} back="/resident" />
      <div className="page">
        <img className="thumb-lg" src={photo.url} alt="" />

        <div className="card-flat row">
          {position ? (
            <LocateFixed size={20} color="var(--primary)" />
          ) : (
            <MapPin size={20} color="var(--warning)" />
          )}
          <div className="grow">
            <div className="small muted">{t('report.location')}</div>
            <div className="bold small">
              {position === undefined
                ? t('loading')
                : position
                  ? t('report.usingGps')
                  : t('report.usingLane')}
            </div>
          </div>
        </div>

        {analysis && (
          <div className="card stack">
            <div className="row between">
              <span className="row bold" style={{ gap: 6 }}>
                <Sparkles size={18} color="var(--primary)" /> {t('report.aiAnalysis')}
              </span>
              {analysis.isBinOrDump ? (
                <SeverityPill severity={analysis.severity} />
              ) : (
                <Pill tone="amber">?</Pill>
              )}
            </div>
            <p>{analysis.reason}</p>
            {analysis.hazards.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                {analysis.hazards.map((h) => (
                  <Pill key={h} tone="red">
                    {h.replace(/_/g, ' ')}
                  </Pill>
                ))}
              </div>
            )}
          </div>
        )}

        {result && !result.created && (
          <div className="stack">
            <div className="banner banner-amber">
              <TriangleAlert size={20} />
              <span>{t('report.notBin')}</span>
            </div>
            <div className="grid-2">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setPhoto(undefined);
                  setPhotoKey(undefined);
                  setResult(undefined);
                }}
              >
                <Camera size={18} /> {t('snap.retake')}
              </button>
              <button className="btn btn-primary" onClick={() => send(true)} disabled={busy}>
                {t('report.sendAnyway')}
              </button>
            </div>
          </div>
        )}

        {created && (
          <>
            <div className="card">
              <StatusTracker report={created} />
            </div>
            <Link to="/resident/reports" className="btn btn-secondary btn-block">
              {t('report.track')}
            </Link>
          </>
        )}

        {!result && (
          <>
            <div className="field">
              <label htmlFor="note">{t('report.note')}</label>
              <textarea
                id="note"
                className="input"
                placeholder={t('report.notePlaceholder')}
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => send(false)}
              disabled={busy || position === undefined}
            >
              {busy ? (
                <Spinner label={t('report.sending')} />
              ) : (
                <>
                  <Send size={20} /> {t('report.send')}
                </>
              )}
            </button>
            <button className="btn btn-ghost" onClick={() => setPhoto(undefined)} disabled={busy}>
              <Camera size={18} /> {t('snap.retake')}
            </button>
          </>
        )}
      </div>
    </>
  );
}
