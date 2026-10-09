import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, ImagePlus, LoaderCircle, Upload } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface Props {
  title: string;
  hint?: string;
  onClose: () => void;
  onCapture: (photo: Blob, fileName: string) => void;
  /** While set, shows the captured photo with a progress overlay. */
  busyLabel?: string;
  previewUrl?: string;
}

/**
 * Full-screen camera with a file-upload fallback. Uses the live rear camera where the
 * browser allows it; otherwise (desktop, denied permission) offers a file picker.
 */
export function PhotoCapture({ title, hint, onClose, onCapture, busyLabel, previewUrl }: Props) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<'camera' | 'upload'>(
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
      ? 'camera'
      : 'upload',
  );
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setReady(false);
  };

  useEffect(() => {
    if (mode !== 'camera' || previewUrl) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((track) => track.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch(() => {
        setCameraError(true);
        setMode('upload');
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [mode, previewUrl]);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stop();
        onCapture(blob, 'camera.jpg');
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={title}>
      <div className="camera-top">
        <button className="icon-btn" onClick={onClose} aria-label={t('back')}>
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ fontSize: 18 }}>{title}</h2>
        <span style={{ width: 44 }} />
      </div>

      <div className="viewfinder">
        {previewUrl ? (
          <img src={previewUrl} alt="" />
        ) : mode === 'camera' ? (
          <video ref={video} playsInline muted autoPlay aria-label={hint ?? title} />
        ) : (
          <button
            className="btn btn-soft"
            style={{
              height: 'auto',
              padding: 24,
              flexDirection: 'column',
              gap: 12,
              borderRadius: 18,
            }}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={40} />
            {t('snap.upload')}
          </button>
        )}
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        {busyLabel && (
          <div className="analysing">
            <LoaderCircle size={36} className="spin" />
            <span>{busyLabel}</span>
          </div>
        )}
        {!previewUrl && hint && mode === 'camera' && (
          <span className="pill pill-dark" style={{ position: 'absolute', top: 76 }}>
            {hint}
          </span>
        )}
      </div>

      <div className="camera-bottom">
        {cameraError && <p className="small muted center">{t('snap.cameraBlocked')}</p>}
        <div className="segmented" style={{ width: '100%', maxWidth: 320 }}>
          <button
            aria-pressed={mode === 'camera'}
            disabled={cameraError || Boolean(busyLabel)}
            onClick={() => setMode('camera')}
          >
            <Camera size={16} style={{ verticalAlign: -3 }} /> {t('snap.photo')}
          </button>
          <button
            aria-pressed={mode === 'upload'}
            disabled={Boolean(busyLabel)}
            onClick={() => {
              stop();
              setMode('upload');
            }}
          >
            <Upload size={16} style={{ verticalAlign: -3 }} /> {t('snap.upload')}
          </button>
        </div>
        {mode === 'camera' && !previewUrl ? (
          <button
            className="shutter"
            onClick={shoot}
            disabled={!ready}
            aria-label={t('snap.capture')}
          />
        ) : (
          <button
            className="btn btn-primary btn-block"
            style={{ maxWidth: 320 }}
            onClick={() => fileInput.current?.click()}
            disabled={Boolean(busyLabel)}
          >
            <ImagePlus size={20} /> {t('snap.upload')}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          data-testid="photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onCapture(file, file.name);
          }}
        />
      </div>
    </div>
  );
}
