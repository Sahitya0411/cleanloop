import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChartColumn,
  ClipboardList,
  Gauge,
  House,
  Inbox,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Recycle,
  Route as RouteIcon,
  Store,
  Truck,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@cleanloop/shared';
import { useOnline } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { StringKey } from '../lib/strings';
import { Logo } from './ui';

interface NavItem {
  to: string;
  label: StringKey;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: Record<Exclude<Role, 'officer'>, NavItem[]> = {
  resident: [
    { to: '/resident', label: 'nav.home', icon: House, end: true },
    { to: '/resident/track', label: 'nav.track', icon: MapIcon },
    { to: '/resident/impact', label: 'nav.impact', icon: ChartColumn },
    { to: '/resident/profile', label: 'nav.profile', icon: User },
  ],
  driver: [
    { to: '/driver', label: 'nav.route', icon: RouteIcon, end: true },
    { to: '/driver/map', label: 'nav.map', icon: MapIcon },
    { to: '/driver/profile', label: 'nav.profile', icon: User },
  ],
  recycler: [
    { to: '/recycler', label: 'nav.requests', icon: Inbox, end: true },
    { to: '/recycler/jobs', label: 'nav.jobs', icon: ClipboardList },
    { to: '/recycler/profile', label: 'nav.shop', icon: Store },
  ],
};

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button
      className="icon-btn"
      onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
      aria-label={lang === 'en' ? 'हिन्दी में देखें' : 'View in English'}
      title={lang === 'en' ? 'हिन्दी' : 'English'}
      style={{ fontWeight: 800, fontSize: 16 }}
    >
      {lang === 'en' ? 'अ' : 'A'}
    </button>
  );
}

export function TopBar({
  title,
  back,
  right,
}: {
  title?: string;
  back?: boolean | string;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <header className="topbar">
      <div className="topbar-title">
        {back && (
          <button
            className="icon-btn"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            aria-label={t('back')}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        {title ? <h1 className="ellipsis">{title}</h1> : <Logo />}
      </div>
      <div className="row" style={{ gap: 8 }}>
        {right}
        <LangToggle />
      </div>
    </header>
  );
}

export function PhoneShell({
  role,
  children,
}: {
  role: Exclude<Role, 'officer'>;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const online = useOnline();
  return (
    <div className="phone">
      {!online && (
        <div className="banner banner-amber" style={{ borderRadius: 0 }}>
          {t('offline')}
        </div>
      )}
      {children}
      <nav className="bottom-nav" aria-label="Main">
        {NAV[role].map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            <item.icon size={22} />
            {t(item.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

const OFFICER_NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/officer', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/officer/reports', label: 'Reports', icon: Inbox },
  { to: '/officer/map', label: 'Map', icon: MapIcon },
  { to: '/officer/routes', label: 'Routes', icon: Truck },
  { to: '/officer/risk', label: 'Risk prediction', icon: Gauge },
  { to: '/officer/recyclers', label: 'Recyclers', icon: Recycle },
];

export function OfficerShell({
  children,
  openReports,
}: {
  children: ReactNode;
  openReports?: number;
}) {
  const { signOut } = useSession();
  return (
    <div className="officer">
      <aside className="sidebar" aria-label="Officer navigation">
        <Logo />
        {OFFICER_NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="side-link">
            <item.icon size={19} />
            {item.label}
            {item.to === '/officer/reports' && openReports ? (
              <span className="count">{openReports}</span>
            ) : null}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="side-link"
          style={{ border: 0, background: 'none', cursor: 'pointer' }}
          onClick={signOut}
        >
          <LogOut size={19} /> Sign out
        </button>
      </aside>
      <div style={{ minWidth: 0 }}>
        <nav className="mobile-tabs" aria-label="Officer navigation">
          {OFFICER_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
          <a href="#" onClick={(e) => (e.preventDefault(), signOut())}>
            Sign out
          </a>
        </nav>
        <main className="officer-main">{children}</main>
      </div>
    </div>
  );
}
