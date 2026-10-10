import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocateFixed, LogOut } from 'lucide-react';
import type { LatLng, Material } from '@cleanloop/shared';
import { E_WASTE_MATERIALS, MATERIAL_LABELS, RECYCLABLE_MATERIALS } from '@cleanloop/shared';
import { TopBar } from '../../components/Shell';
import { ErrorState, MaterialIcon, Skeleton, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { getPosition } from '../../lib/geo';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { useToast } from '../../lib/toast';

const ALL_MATERIALS: Material[] = [...RECYCLABLE_MATERIALS, ...E_WASTE_MATERIALS];

export default function ShopProfile() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { session, signOut } = useSession();
  const me = useAsync(() => api.recyclerMe(), []);
  const [name, setName] = useState(session?.user.name ?? '');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [where, setWhere] = useState<LatLng>();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [rates, setRates] = useState<Partial<Record<Material, string>>>({});
  const [consent, setConsent] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = me.data?.recycler;
    if (!r) return;
    setName(r.name);
    setPhone(r.phone);
    setArea(r.area);
    setWhere({ lat: r.lat, lng: r.lng });
    setMaterials(r.acceptedMaterials);
    setRates(Object.fromEntries(Object.entries(r.approxRates).map(([k, v]) => [k, String(v)])));
    setConsent(r.consentGiven);
  }, [me.data]);

  const locate = async () => {
    setLocating(true);
    const p = await getPosition();
    setLocating(false);
    if (p) setWhere(p);
    else toast(t('recycler.locationNeeded'), 'error');
  };

  const toggle = (m: Material) =>
    setMaterials((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));

  const save = async () => {
    if (!where) return toast(t('recycler.locationNeeded'), 'error');
    setBusy(true);
    try {
      const approxRates = Object.fromEntries(
        materials
          .filter((m) => rates[m] && !Number.isNaN(Number(rates[m])))
          .map((m) => [m, Number(rates[m])]),
      );
      await api.saveRecycler({
        name: name.trim(),
        phone: phone.trim(),
        area: area.trim(),
        lat: where.lat,
        lng: where.lng,
        acceptedMaterials: materials,
        approxRates,
        consentGiven: consent,
      });
      toast(t('profile.saved'), 'success');
      navigate('/recycler');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title={t('recycler.profileTitle')} />
      <div className="page">
        {me.error && <ErrorState error={me.error} onRetry={me.reload} />}
        {me.loading && !me.data && <Skeleton height={400} />}
        {me.data && (
          <>
            <div className="card stack">
              <div className="field">
                <label htmlFor="shop">{t('recycler.shopName')}</label>
                <input
                  id="shop"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="rphone">{t('profile.phone')}</label>
                <input
                  id="rphone"
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98xxxxxxxx"
                />
              </div>
              <div className="field">
                <label htmlFor="area">{t('recycler.area')}</label>
                <input
                  id="area"
                  className="input"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="Shahbad Daulatpur"
                />
              </div>
              <button className="btn btn-secondary" onClick={locate} disabled={locating}>
                {locating ? <Spinner size={18} /> : <LocateFixed size={18} />}
                {where
                  ? `${t('recycler.locationSet')} (${where.lat.toFixed(3)}, ${where.lng.toFixed(3)})`
                  : t('recycler.useLocation')}
              </button>
            </div>

            <span className="label">{t('recycler.materials')}</span>
            <div className="tile-grid">
              {ALL_MATERIALS.map((m) => (
                <button
                  key={m}
                  className="tile"
                  aria-pressed={materials.includes(m)}
                  onClick={() => toggle(m)}
                >
                  <MaterialIcon material={m} />
                  {MATERIAL_LABELS[m][lang]}
                </button>
              ))}
            </div>

            {materials.length > 0 && (
              <div className="card stack">
                <span className="label">{t('recycler.rates')}</span>
                <div className="grid-2">
                  {materials.map((m) => (
                    <div key={m} className="field">
                      <label htmlFor={`rate-${m}`}>{MATERIAL_LABELS[m][lang]}</label>
                      <input
                        id={`rate-${m}`}
                        className="input"
                        inputMode="decimal"
                        value={rates[m] ?? ''}
                        onChange={(e) => setRates((r) => ({ ...r, [m]: e.target.value }))}
                        placeholder="₹"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="checkbox card-flat">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{t('recycler.consent')}</span>
            </label>

            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={
                busy ||
                !name.trim() ||
                phone.trim().length < 8 ||
                area.trim().length < 2 ||
                !materials.length ||
                !consent
              }
              onClick={save}
            >
              {busy ? <Spinner /> : t('save')}
            </button>
            <button className="btn btn-ghost" onClick={signOut}>
              <LogOut size={18} /> {t('signOut')}
            </button>
          </>
        )}
      </div>
    </>
  );
}
