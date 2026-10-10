import { useEffect, useState } from 'react';
import { BellRing, ChevronRight, Languages, LogOut, MapPin } from 'lucide-react';
import { AlertsSheet } from '../components/AlertsSheet';
import { LanePicker } from '../components/LanePicker';
import { TopBar } from '../components/Shell';
import { ErrorState, LogoMark, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

/** Profile for every phone role; residents also pick their lane and alerts. */
export default function Profile() {
  const { t, lang, setLang } = useI18n();
  const { session, signOut } = useSession();
  const toast = useToast();
  const me = useAsync(() => api.me(), []);
  const wards = useAsync(() => api.wards(), []);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picking, setPicking] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const isResident = session?.user.role === 'resident';

  useEffect(() => {
    if (me.data) {
      setName(me.data.name);
      setPhone(me.data.phone ?? '');
    }
  }, [me.data]);

  const laneName = wards.data
    ?.flatMap((w) => w.lanes)
    .find((l) => l.laneId === me.data?.laneId)?.name;

  const save = async (patch: Parameters<typeof api.updateMe>[0]) => {
    try {
      me.setData(await api.updateMe(patch));
      toast(t('profile.saved'), 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <TopBar title={t('profile.title')} />
      <div className="page">
        {me.error && <ErrorState error={me.error} onRetry={me.reload} />}
        {!me.data && me.loading && <Skeleton height={260} />}
        {me.data && (
          <>
            <div className="card stack">
              <div className="row">
                <span
                  className="num num-done"
                  style={{ width: 52, height: 52, fontSize: 22, borderRadius: 16 }}
                  aria-hidden="true"
                >
                  {me.data.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="grow">
                  <div className="bold" style={{ fontSize: 18 }}>
                    {me.data.name}
                  </div>
                  <div className="small muted">
                    {t(`role.${me.data.role}`)} {me.data.email ? `· ${me.data.email}` : ''}
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="pname">{t('profile.name')}</label>
                <input
                  id="pname"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="pphone">{t('profile.phone')}</label>
                <input
                  id="pphone"
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98xxxxxxxx"
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={
                  !name.trim() || (name === me.data.name && phone === (me.data.phone ?? ''))
                }
                onClick={() => save({ name: name.trim(), phone: phone.trim() || undefined })}
              >
                {t('save')}
              </button>
            </div>

            {isResident && (
              <div className="card" style={{ padding: '4px 16px' }}>
                <button
                  className="list-item"
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 0,
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onClick={() => setPicking(true)}
                >
                  <MapPin size={20} color="var(--primary)" />
                  <span className="grow">
                    <span className="small muted">{t('profile.myLane')}</span>
                    <br />
                    <span className="bold">{laneName ?? t('home.chooseLane')}</span>
                  </span>
                  <ChevronRight size={18} />
                </button>
                <button
                  className="list-item"
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onClick={() => setAlerts(true)}
                  disabled={!me.data.laneId}
                >
                  <BellRing size={20} color="var(--primary)" />
                  <span className="grow bold">{t('profile.alerts')}</span>
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            <div className="card stack">
              <span className="row bold">
                <Languages size={20} color="var(--primary)" /> {t('language')}
              </span>
              <div className="segmented">
                <button
                  aria-pressed={lang === 'en'}
                  onClick={() => {
                    setLang('en');
                    void api.updateMe({ lang: 'en' }).catch(() => undefined);
                  }}
                >
                  English
                </button>
                <button
                  aria-pressed={lang === 'hi'}
                  onClick={() => {
                    setLang('hi');
                    void api.updateMe({ lang: 'hi' }).catch(() => undefined);
                  }}
                >
                  हिन्दी
                </button>
              </div>
            </div>

            <button className="btn btn-secondary btn-block" onClick={signOut}>
              <LogOut size={18} /> {t('signOut')}
            </button>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <LogoMark size={22} />
              <span className="small muted">{t('profile.about')}</span>
            </div>
          </>
        )}
      </div>
      {picking && (
        <LanePicker
          current={me.data?.laneId}
          onClose={() => setPicking(false)}
          onPick={(laneId) => {
            setPicking(false);
            void save({ laneId });
          }}
        />
      )}
      {alerts && me.data && (
        <AlertsSheet profile={me.data} laneName={laneName ?? ''} onClose={() => setAlerts(false)} />
      )}
    </>
  );
}
