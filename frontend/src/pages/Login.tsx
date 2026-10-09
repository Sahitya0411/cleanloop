import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Bell,
  Camera,
  House,
  LayoutDashboard,
  MapPin,
  Recycle,
  Route as RouteIcon,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@cleanloop/shared';
import { LangToggle } from '../components/Shell';
import { LogoMark, Spinner } from '../components/ui';
import {
  AuthError,
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  resendCode,
  signIn,
  signInLocal,
  signUp,
} from '../lib/auth';
import { HOME_PATH, config, demoLoginsAvailable } from '../lib/config';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';

type Mode = 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset';

const DEMO: { role: Role; icon: LucideIcon; hint: string; hintHi: string }[] = [
  { role: 'resident', icon: House, hint: 'Sort, track, report', hintHi: 'छाँटें, ट्रैक, शिकायत' },
  { role: 'driver', icon: Truck, hint: "Today's route", hintHi: 'आज का रूट' },
  { role: 'officer', icon: LayoutDashboard, hint: 'Reports and routes', hintHi: 'शिकायतें और रूट' },
  { role: 'recycler', icon: Recycle, hint: 'Pickup requests', hintHi: 'पिकअप अनुरोध' },
];

export default function Login() {
  const { t, lang } = useI18n();
  const { session, start } = useSession();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'resident' | 'recycler'>('resident');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (session) return <Navigate to={HOME_PATH[session.user.role]} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'UserNotConfirmedException') setMode('confirm');
      setError(err instanceof Error ? err.message : t('somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const demo = (r: Role) =>
    run(async () => {
      if (config.authMode === 'local') start(signInLocal(r));
      else start(await signIn(config.demoEmails[r]!, config.demoPassword));
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') return run(async () => start(await signIn(email, password)));
    if (mode === 'signup') {
      return run(async () => {
        await signUp({ email, password, name, role, phone: phone.trim() || undefined });
        setMode('confirm');
      });
    }
    if (mode === 'confirm') {
      return run(async () => {
        await confirmSignUp(email, code);
        if (password) start(await signIn(email, password));
        else {
          toast(t('login.confirmed'), 'success');
          setMode('signin');
        }
      });
    }
    if (mode === 'forgot') {
      return run(async () => {
        await forgotPassword(email);
        setMode('reset');
      });
    }
    return run(async () => {
      await confirmForgotPassword(email, code, password);
      toast(t('login.passwordReset'), 'success');
      setMode('signin');
    });
  };

  const cognito = config.authMode === 'cognito';

  return (
    <div className="login">
      <section className="login-hero" aria-hidden="true">
        <div className="row" style={{ fontWeight: 800, fontSize: 22 }}>
          <LogoMark size={36} /> CleanLoop
        </div>
        <div className="stack-lg">
          <h1>
            Cleaner cities,
            <br />
            smarter together.
          </h1>
          <div className="hero-list">
            <div>
              <Camera size={22} /> Snap an item, learn the right bin
            </div>
            <div>
              <Bell size={22} /> Know when the truck is 2 stops away
            </div>
            <div>
              <MapPin size={22} /> Report overflowing bins with one photo
            </div>
            <div>
              <RouteIcon size={22} /> Smarter routes: less diesel, less CO₂
            </div>
            <div>
              <Recycle size={22} /> Sell recyclables to a nearby kabadiwala
            </div>
          </div>
        </div>
        <p style={{ opacity: 0.8 }}>Environmental Hacks 2026 · Waste and Energy · Built on AWS</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="row between">
            <span className="logo">
              <LogoMark /> CleanLoop
            </span>
            <LangToggle />
          </div>
          <div className="stack-sm">
            <h1>{t('login.title')}</h1>
            <p className="muted">{t('login.subtitle')}</p>
          </div>

          {demoLoginsAvailable() && (
            <div className="stack">
              <span className="label">{t('login.tryDemo')}</span>
              <div className="demo-grid">
                {DEMO.map((d) => (
                  <button
                    key={d.role}
                    className="demo-btn"
                    onClick={() => demo(d.role)}
                    disabled={busy}
                  >
                    <d.icon size={22} color="var(--primary)" />
                    <span>
                      {t(`role.${d.role}`)}
                      <small>{lang === 'hi' ? d.hintHi : d.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="small muted">{t('login.demoNote')}</p>
            </div>
          )}

          {cognito && (
            <>
              {demoLoginsAvailable() && <div className="divider">{t('login.or')}</div>}
              <form className="stack" onSubmit={submit}>
                {mode === 'confirm' && (
                  <div className="stack-sm">
                    <h2>{t('login.confirmTitle')}</h2>
                    <p className="muted">{t('login.confirmHint', { email })}</p>
                  </div>
                )}
                {(mode === 'forgot' || mode === 'reset') && <h2>{t('login.resetTitle')}</h2>}
                {mode === 'signup' && (
                  <>
                    <div className="field">
                      <label htmlFor="name">{t('login.name')}</label>
                      <input
                        id="name"
                        className="input"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </div>
                    <div className="field">
                      <span className="label">{t('login.iAm')}</span>
                      <div className="segmented">
                        <button
                          type="button"
                          aria-pressed={role === 'resident'}
                          onClick={() => setRole('resident')}
                        >
                          {t('login.roleResident')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={role === 'recycler'}
                          onClick={() => setRole('recycler')}
                        >
                          {t('login.roleRecycler')}
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {mode !== 'confirm' && mode !== 'reset' && (
                  <div className="field">
                    <label htmlFor="email">{t('login.email')}</label>
                    <input
                      id="email"
                      className="input"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                )}
                {(mode === 'confirm' || mode === 'reset') && (
                  <div className="field">
                    <label htmlFor="code">{t('login.code')}</label>
                    <input
                      id="code"
                      className="input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </div>
                )}
                {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
                  <div className="field">
                    <label htmlFor="password">
                      {mode === 'reset' ? t('login.newPassword') : t('login.password')}
                    </label>
                    <input
                      id="password"
                      className="input"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    />
                  </div>
                )}
                {mode === 'signup' && (
                  <div className="field">
                    <label htmlFor="phone">{t('login.phoneOptional')}</label>
                    <input
                      id="phone"
                      className="input"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel"
                    />
                  </div>
                )}
                {error && (
                  <p className="error-text" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? (
                    <Spinner size={20} />
                  ) : mode === 'signin' ? (
                    t('login.signIn')
                  ) : mode === 'signup' ? (
                    t('login.signUp')
                  ) : mode === 'confirm' ? (
                    t('login.confirm')
                  ) : mode === 'forgot' ? (
                    t('login.sendCode')
                  ) : (
                    t('save')
                  )}
                </button>
                <div className="row between wrap">
                  {mode === 'signin' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setMode('signup')}
                      >
                        {t('login.createAccount')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setMode('forgot')}
                      >
                        {t('login.forgot')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setMode('signin')}
                    >
                      {t('login.haveAccount')}
                    </button>
                  )}
                  {mode === 'confirm' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        run(
                          async () => (
                            await resendCode(email),
                            toast(t('login.codeSent'), 'success')
                          ),
                        )
                      }
                    >
                      {t('login.resend')}
                    </button>
                  )}
                </div>
                <p className="small muted">{t('login.staffNote')}</p>
              </form>
            </>
          )}
          {!cognito && error && <p className="error-text">{error}</p>}
        </div>
      </section>
    </div>
  );
}
