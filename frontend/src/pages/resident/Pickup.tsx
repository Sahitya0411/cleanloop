import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, CircleCheck, Minus, Plus } from 'lucide-react';
import type { LatLng, Material, PickupItemType } from '@cleanloop/shared';
import { MATERIAL_LABELS, PICKUP_MATERIALS } from '@cleanloop/shared';
import { PhotoCapture } from '../../components/PhotoCapture';
import { TopBar } from '../../components/Shell';
import { MaterialIcon, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { getPosition } from '../../lib/geo';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { uploadPhoto } from '../../lib/image';
import { useToast } from '../../lib/toast';

export default function Pickup() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialType = (params.get('type') === 'e_waste' ? 'e_waste' : 'dry') as PickupItemType;
  const initialMaterial = params.get('material') as Material | null;
  const [itemType, setItemType] = useState<PickupItemType>(initialType);
  const [material, setMaterial] = useState<Material | undefined>(
    initialMaterial && PICKUP_MATERIALS[initialType].includes(initialMaterial)
      ? initialMaterial
      : undefined,
  );
  const [kg, setKg] = useState(3);
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [photoKey, setPhotoKey] = useState(params.get('photoKey') ?? undefined);
  const [photoUrl, setPhotoUrl] = useState(params.get('photoUrl') ?? undefined);
  const [capturing, setCapturing] = useState(false);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useAsync(() => api.me(), []);

  useEffect(() => {
    if (me.data?.phone) setPhone((p) => p || me.data!.phone!);
  }, [me.data]);
  useEffect(() => {
    void getPosition(6000).then(setPosition);
  }, []);

  const submit = async () => {
    if (!material) return;
    setBusy(true);
    try {
      await api.createPickup({
        itemType,
        material,
        photoKey,
        lat: position?.lat,
        lng: position?.lng,
        estWeightKg: kg,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast(t('pickup.submitted'), 'success');
      navigate('/resident/pickups');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (capturing) {
    return (
      <PhotoCapture
        title={t('pickup.addPhoto')}
        onClose={() => setCapturing(false)}
        onCapture={async (blob) => {
          setCapturing(false);
          setPhotoUrl(URL.createObjectURL(blob));
          try {
            setPhotoKey(await uploadPhoto('pickup', blob));
          } catch (err) {
            toast((err as Error).message, 'error');
            setPhotoUrl(undefined);
          }
        }}
      />
    );
  }

  return (
    <>
      <TopBar title={t('pickup.title')} back="/resident" />
      <div className="page">
        <div className="segmented">
          {(['dry', 'e_waste'] as const).map((type) => (
            <button
              key={type}
              aria-pressed={itemType === type}
              onClick={() => {
                setItemType(type);
                setMaterial(undefined);
              }}
            >
              {type === 'dry' ? t('pickup.recyclables') : t('pickup.ewaste')}
            </button>
          ))}
        </div>

        <span className="label">{t('pickup.what')}</span>
        <div className="tile-grid">
          {PICKUP_MATERIALS[itemType].map((m) => (
            <button
              key={m}
              className="tile"
              aria-pressed={material === m}
              onClick={() => setMaterial(m)}
            >
              <MaterialIcon material={m} size={32} />
              {MATERIAL_LABELS[m][lang]}
            </button>
          ))}
        </div>

        <div className="card stack">
          <div className="row between">
            <span className="label">{t('pickup.weight')}</span>
            <div className="row">
              <button
                className="icon-btn"
                onClick={() => setKg((k) => Math.max(1, k - 1))}
                aria-label="−1 kg"
              >
                <Minus size={18} />
              </button>
              <span className="bold" style={{ minWidth: 64, textAlign: 'center', fontSize: 18 }}>
                {t('pickup.kg', { n: kg })}
              </span>
              <button
                className="icon-btn"
                onClick={() => setKg((k) => Math.min(200, k + 1))}
                aria-label="+1 kg"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="phone">{t('pickup.phone')}</label>
            <input
              id="phone"
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98xxxxxxxx"
            />
          </div>
          <div className="field">
            <label htmlFor="notes">{t('pickup.notes')}</label>
            <input
              id="notes"
              className="input"
              value={notes}
              maxLength={300}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={() => setCapturing(true)}>
            {photoUrl ? (
              <>
                <CircleCheck size={18} color="var(--primary)" /> {t('pickup.photoAdded')}
              </>
            ) : (
              <>
                <Camera size={18} /> {t('pickup.addPhoto')}
              </>
            )}
          </button>
          {photoUrl && <img className="thumb-lg" style={{ height: 140 }} src={photoUrl} alt="" />}
        </div>

        <button
          className="btn btn-primary btn-block btn-lg"
          disabled={!material || busy}
          onClick={submit}
        >
          {busy ? <Spinner /> : t('pickup.submit')}
        </button>
      </div>
    </>
  );
}
