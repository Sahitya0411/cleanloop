import { useState } from 'react';
import { BellRing, Mail, MessageSquare } from 'lucide-react';
import type { AlertChannel, AlertSubscription, Profile } from '@cleanloop/shared';
import { api } from '../lib/api';
import { useAsync } from '../lib/hooks';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { ErrorState, Sheet } from './ui';

function ChannelRow({
  channel,
  laneId,
  laneName,
  sub,
  defaultEndpoint,
  onChange,
}: {
  channel: AlertChannel;
  laneId: string;
  laneName: string;
  sub?: AlertSubscription;
  defaultEndpoint: string;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [endpoint, setEndpoint] = useState(sub?.endpoint ?? defaultEndpoint);
  const [busy, setBusy] = useState(false);
  const Icon = channel === 'email' ? Mail : MessageSquare;
  const active = sub && sub.laneId === laneId;

  const toggle = async () => {
    setBusy(true);
    try {
      if (active) await api.unsubscribe(channel);
      else {
        const created = await api.subscribe(laneId, channel, endpoint);
        toast(
          created.pendingConfirmation ? t('alerts.pending') : t('alerts.on', { lane: laneName }),
          'success',
        );
      }
      onChange();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-flat stack">
      <div className="row">
        <Icon size={20} color="var(--primary)" />
        <span className="bold grow">{t(channel === 'email' ? 'alerts.email' : 'alerts.sms')}</span>
        {active && <span className="pill pill-green">{t('alerts.on', { lane: laneName })}</span>}
      </div>
      {!active && (
        <input
          className="input"
          type={channel === 'email' ? 'email' : 'tel'}
          inputMode={channel === 'email' ? 'email' : 'tel'}
          placeholder={channel === 'email' ? 'you@example.com' : '+91 98xxxxxxxx'}
          aria-label={channel === 'email' ? t('login.email') : t('alerts.phone')}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      )}
      {active && sub?.pendingConfirmation && channel === 'email' && (
        <p className="small muted">{t('alerts.pending')}</p>
      )}
      <button
        className={`btn ${active ? 'btn-secondary' : 'btn-primary'}`}
        onClick={toggle}
        disabled={busy || (!active && !endpoint.trim())}
      >
        {active ? t('alerts.turnOff') : t('alerts.turnOn')}
      </button>
    </div>
  );
}

export function AlertsSheet({
  profile,
  laneName,
  onClose,
}: {
  profile: Profile;
  laneName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const subs = useAsync(() => api.alerts(), []);
  if (!profile.laneId) return null;
  const by = (c: AlertChannel) => subs.data?.find((s) => s.channel === c);
  return (
    <Sheet title={t('alerts.title')} onClose={onClose}>
      <div className="banner banner-green">
        <BellRing size={20} />
        <span>{t('alerts.hint')}</span>
      </div>
      {subs.error && <ErrorState error={subs.error} onRetry={subs.reload} />}
      {subs.data && (
        <>
          <ChannelRow
            channel="email"
            laneId={profile.laneId}
            laneName={laneName}
            sub={by('email')}
            defaultEndpoint={profile.email ?? ''}
            onChange={() => subs.reload(true)}
          />
          <ChannelRow
            channel="sms"
            laneId={profile.laneId}
            laneName={laneName}
            sub={by('sms')}
            defaultEndpoint={profile.phone ?? '+91'}
            onChange={() => subs.reload(true)}
          />
        </>
      )}
      <p className="small muted center">{t('alerts.inApp')}</p>
    </Sheet>
  );
}
