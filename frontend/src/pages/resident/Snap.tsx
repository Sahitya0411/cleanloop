import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CircleCheck, Lightbulb, Recycle, TriangleAlert } from 'lucide-react';
import type { SortResult, WasteCategory } from '@cleanloop/shared';
import { BINS, CATEGORY_LABELS, WASTE_CATEGORIES, pickupItemTypeFor } from '@cleanloop/shared';
import { PhotoCapture } from '../../components/PhotoCapture';
import { TopBar } from '../../components/Shell';
import { BinIcon, Pill } from '../../components/ui';
import { api } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { uploadPhoto } from '../../lib/image';
import { useToast } from '../../lib/toast';

export function ResultView({
  result,
  onRetake,
  onChoose,
}: {
  result: SortResult;
  onRetake: () => void;
  onChoose: (category: WasteCategory) => void;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const bin = BINS[result.category];
  const confidence = Math.round(result.confidence * 100);

  return (
    <div className="page">
      {result.photoUrl && <img className="thumb-lg" src={result.photoUrl} alt={result.itemName} />}

      {result.lowConfidence ? (
        <div className="card stack">
          <div className="banner banner-amber">
            <TriangleAlert size={20} />
            <div className="stack-sm">
              <span className="bold">{t('snap.unsure')}</span>
              <span className="small">{t('snap.unsureHint')}</span>
            </div>
          </div>
          {result.confidence > 0 && (
            <p className="small muted">
              {t('snap.looksLike')}: <b>{result.itemName}</b> (
              {t('snap.confidence', { n: confidence })})
            </p>
          )}
          <span className="label">{t('snap.chooseBin')}</span>
          <div className="stack-sm">
            {WASTE_CATEGORIES.map((c) => (
              <button
                key={c}
                className="card-flat row"
                style={{ cursor: 'pointer', textAlign: 'left' }}
                onClick={() => onChoose(c)}
              >
                <BinIcon category={c} size={40} />
                <span className="grow">
                  <span className="bold">{CATEGORY_LABELS[c][lang]}</span>
                  <br />
                  <span className="small muted">
                    {lang === 'hi' ? BINS[c].labelHi : BINS[c].label}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" onClick={onRetake}>
            <Camera size={18} /> {t('snap.retake')}
          </button>
        </div>
      ) : (
        <>
          <div className="card stack">
            <div className="stack-sm">
              <span className="small muted">{t('snap.looksLike')}</span>
              <h1 style={{ fontSize: 24 }}>{result.itemName}</h1>
              <div className="row wrap">
                <Pill tone={confidence >= 75 ? 'green' : 'amber'}>
                  {t('snap.confidence', { n: confidence })}
                </Pill>
                <span className="tiny faint">{t(`snap.source.${result.source}`)}</span>
              </div>
            </div>
            <div
              className="card-flat row"
              style={{ background: `${bin.colour}12`, borderColor: `${bin.colour}40` }}
            >
              <BinIcon category={result.category} />
              <div className="grow">
                <div
                  className="bold"
                  style={{ color: bin.colour, textTransform: 'uppercase', letterSpacing: '0.03em' }}
                >
                  {CATEGORY_LABELS[result.category][lang]}
                </div>
                <div className="small">
                  {result.recyclable ? t('snap.recyclable') : t('snap.notRecyclable')}
                </div>
              </div>
              {result.recyclable && <Recycle size={22} color={bin.colour} />}
            </div>
            <div className="stack-sm">
              <div className="row bold">
                <CircleCheck size={20} color="var(--primary)" />
                {t('snap.putIn', { bin: lang === 'hi' ? bin.labelHi : bin.label })}
              </div>
              {result.tip && (
                <div className="row-top small">
                  <Lightbulb size={18} color="#e3a12d" style={{ flexShrink: 0 }} />
                  <span>{result.tip}</span>
                </div>
              )}
              <div className="row-top small muted">
                <Lightbulb size={18} color="var(--faint)" style={{ flexShrink: 0 }} />
                <span>{lang === 'hi' ? bin.instructionHi : bin.instruction}</span>
              </div>
            </div>
          </div>
          {result.pickupEligible && (
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                const params = new URLSearchParams({
                  type: pickupItemTypeFor(result.category),
                  material: result.material,
                  ...(result.photoKey ? { photoKey: result.photoKey } : {}),
                  ...(result.photoUrl ? { photoUrl: result.photoUrl } : {}),
                });
                navigate(`/resident/pickup?${params}`);
              }}
            >
              <Recycle size={20} /> {t('snap.requestPickup')}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onRetake}>
            <Camera size={18} /> {t('snap.another')}
          </button>
        </>
      )}
    </div>
  );
}

export default function Snap() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SortResult>();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const capture = async (photo: Blob, fileName: string) => {
    setPreview(URL.createObjectURL(photo));
    setBusy(true);
    try {
      const key = await uploadPhoto('sort', photo);
      setResult(await api.sort(key, lang, fileName));
    } catch (err) {
      toast((err as Error).message, 'error');
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  };

  const choose = async (category: WasteCategory) => {
    if (!result) return;
    try {
      setResult(await api.chooseSort(result.id, { category }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!result) {
    return (
      <PhotoCapture
        title={t('snap.title')}
        hint={t('snap.hint')}
        onClose={() => navigate('/resident')}
        onCapture={capture}
        previewUrl={preview}
        busyLabel={busy ? t('snap.analysing') : undefined}
      />
    );
  }

  return (
    <>
      <TopBar title={t('snap.title')} back="/resident" />
      <ResultView
        result={result}
        onChoose={choose}
        onRetake={() => {
          setResult(undefined);
          setPreview(undefined);
        }}
      />
    </>
  );
}
