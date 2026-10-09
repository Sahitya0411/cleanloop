import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  Camera,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  Inbox,
  MapPin,
  Recycle,
  Sprout,
  Sun,
  TriangleAlert,
  Wind,
} from 'lucide-react';
import type { LaneNotification } from '@cleanloop/shared';
import { EtaCard } from '../../components/EtaCard';
import { LanePicker } from '../../components/LanePicker';
import { TopBar } from '../../components/Shell';
import { ErrorState, RiskPill, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { greetingKey, timeAgo } from '../../lib/format';
import { useAsync } from '../../lib/hooks';
import { useI18n } from '../../lib/i18n';
import { airBand, fetchWeather, weatherKind } from '../../lib/weather';

const SEEN_KEY = 'cleanloop.notificationsSeen';

export function lastSeenNotification(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function markNotificationsSeen(latest?: string) {
  try {
    if (latest) localStorage.setItem(SEEN_KEY, latest);
  } catch {
    // ignore
  }
}

const WEATHER_ICON = {
  clear: Sun,
  cloudy: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  storm: CloudLightning,
};
const AIR_COLOUR = {
  good: '#2f8f55',
  satisfactory: '#7cb342',
  moderate: '#e3b12d',
  poor: '#e3802d',
  veryPoor: '#d64545',
  severe: '#8e1f3a',
};

function WeatherCard({ lat, lng }: { lat: number; lng: number }) {
  const { t } = useI18n();
  const wx = useAsync(() => fetchWeather({ lat, lng }), [lat, lng]);
  if (!wx.data) return null;
  const kind = weatherKind(wx.data.code);
  const Icon = WEATHER_ICON[kind];
  const band = wx.data.pm25 !== null ? airBand(wx.data.pm25) : null;
  return (
    <div className="card row between" style={{ padding: '12px 16px' }}>
      <div className="row">
        <Icon size={30} color="#e3a12d" />
        <div>
          <div className="bold" style={{ fontSize: 20 }}>
            {wx.data.tempC}°C
          </div>
          <div className="small muted">{t(`weather.${kind}`)}</div>
        </div>
      </div>
      {band && (
        <div className="row" style={{ gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div className="small muted">{t('weather.air')}</div>
            <div className="bold" style={{ color: AIR_COLOUR[band] }}>
              {t(`air.${band}`)} · PM2.5 {wx.data.pm25}
            </div>
          </div>
          <Wind size={22} color={AIR_COLOUR[band]} />
        </div>
      )}
    </div>
  );
}

function NotificationItem({ n }: { n: LaneNotification }) {
  const { lang } = useI18n();
  return (
    <div className="list-item">
      <Bell size={18} color={n.type === 'missed' ? 'var(--danger)' : 'var(--primary)'} />
      <span className="grow small">{lang === 'hi' ? n.messageHi : n.message}</span>
      <span className="tiny faint">{timeAgo(n.createdAt, lang)}</span>
    </div>
  );
}

export default function ResidentHome() {
  const { t, lang } = useI18n();
  const [laneId, setLaneId] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const home = useAsync(() => api.residentHome(laneId), [laneId], { pollMs: 20_000 });
  const data = home.data;
  const unread = data?.notifications[0] && data.notifications[0].createdAt > lastSeenNotification();

  return (
    <>
      <TopBar
        right={
          <Link to="/resident/alerts" className="icon-btn" aria-label={t('notifications.title')}>
            <Bell size={20} />
            {unread && <span className="badge-dot" />}
          </Link>
        }
      />
      <div className="page">
        {home.error && !data && <ErrorState error={home.error} onRetry={home.reload} />}
        {!data && home.loading && (
          <>
            <Skeleton height={40} />
            <Skeleton height={150} />
            <Skeleton height={112} />
          </>
        )}
        {data && (
          <>
            <button
              className="pill"
              style={{
                alignSelf: 'flex-start',
                height: 36,
                fontSize: 14,
                cursor: 'pointer',
                background: 'var(--surface)',
              }}
              onClick={() => setPicking(true)}
            >
              <MapPin size={16} color="var(--primary)" />
              {data.lane
                ? `${data.ward?.shortName ?? ''} · ${data.lane.name}`
                : t('home.chooseLane')}
              <ChevronDown size={16} />
            </button>

            <div className="stack-sm">
              <h1>
                {t(greetingKey())}, {data.profile.name.split(' ')[0]}
              </h1>
              <p className="muted row" style={{ gap: 6 }}>
                {t('home.subtitle')} <Sprout size={16} color="var(--primary)" />
              </p>
            </div>

            {data.lane && <WeatherCard lat={data.lane.lat} lng={data.lane.lng} />}
            {data.eta && <EtaCard eta={data.eta} />}

            <div className="actions">
              <Link to="/resident/snap" className="action action-primary">
                <span className="action-icon">
                  <Camera size={22} />
                </span>
                {t('home.snap')}
              </Link>
              <Link to="/resident/report" className="action action-red">
                <span className="action-icon">
                  <TriangleAlert size={22} />
                </span>
                {t('home.report')}
              </Link>
              <Link to="/resident/pickup" className="action">
                <span className="action-icon">
                  <Recycle size={22} />
                </span>
                {t('home.pickup')}
              </Link>
            </div>

            {data.risk && (
              <div className="card-flat row between">
                <span className="small bold">{t('home.risk')}</span>
                <RiskPill level={data.risk.level} score={data.risk.score} />
              </div>
            )}

            <div className="grid-2">
              <Link to="/resident/reports" className="card-flat row between card-link">
                <span className="bold small">{t('home.myReports')}</span>
                <ChevronRight size={18} />
              </Link>
              <Link to="/resident/pickups" className="card-flat row between card-link">
                <span className="bold small">{t('home.myPickups')}</span>
                <ChevronRight size={18} />
              </Link>
            </div>

            <div className="section-title">
              <h3>{t('home.alerts')}</h3>
              <Link to="/resident/alerts" className="small bold">
                {lang === 'hi' ? 'सभी' : 'See all'}
              </Link>
            </div>
            <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {data.notifications.length ? (
                <div className="list">
                  {data.notifications.slice(0, 3).map((n) => (
                    <NotificationItem key={n.id} n={n} />
                  ))}
                </div>
              ) : (
                <div className="empty" style={{ padding: 16 }}>
                  <Inbox size={28} />
                  <span className="small">{t('home.noAlerts')}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {picking && (
        <LanePicker
          current={data?.lane?.laneId}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            setLaneId(id);
          }}
        />
      )}
    </>
  );
}
