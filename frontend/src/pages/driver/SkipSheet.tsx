import { useState } from 'react';
import { Sheet } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import type { StringKey } from '../../lib/strings';

const REASONS: StringKey[] = [
  'driver.reason.blocked',
  'driver.reason.parked',
  'driver.reason.full',
  'driver.reason.flooded',
];

export function SkipSheet({
  laneName,
  onSkip,
  onClose,
}: {
  laneName: string;
  onSkip: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string>('');
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const final = other ? text.trim() : reason;
  return (
    <Sheet title={t('driver.skipTitle')} onClose={onClose}>
      <p className="bold">{laneName}</p>
      <div className="grid-2">
        {REASONS.map((key) => (
          <button
            key={key}
            className="tile"
            style={{ minHeight: 64 }}
            aria-pressed={!other && reason === t(key)}
            onClick={() => {
              setOther(false);
              setReason(t(key));
            }}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <button
        className="tile"
        style={{ minHeight: 56 }}
        aria-pressed={other}
        onClick={() => setOther(true)}
      >
        {t('driver.reason.other')}
      </button>
      {other && (
        <input
          className="input"
          autoFocus
          value={text}
          maxLength={120}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('driver.reason.other')}
        />
      )}
      <button
        className="btn btn-danger btn-lg btn-block"
        disabled={final.length < 2}
        onClick={() => onSkip(final)}
      >
        {t('driver.confirmSkip')}
      </button>
    </Sheet>
  );
}
