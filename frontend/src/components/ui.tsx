import type { ReactNode } from 'react';
import {
  Apple,
  Bandage,
  BatteryFull,
  Cylinder,
  FlaskConical,
  Laptop,
  Leaf,
  LoaderCircle,
  Milk,
  Newspaper,
  Package,
  RefreshCw,
  Recycle,
  Shapes,
  Shirt,
  Smartphone,
  TriangleAlert,
  Wine,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Material, RiskLevel, Severity, WasteCategory } from '@cleanloop/shared';
import { BINS } from '@cleanloop/shared';
import { useI18n } from '../lib/i18n';

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#1f6b3e" />
      <path
        d="M32 13a19 19 0 1 0 18.4 14.2"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="M44 13l8 9-11 3z" fill="#fff" />
      <path
        d="M32 22c7 0 11 5 11 11-6 0-11-4-11-11zm0 0c-6 1-9 6-8 12 5-1 8-6 8-12z"
        fill="#a6e3a1"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      CleanLoop
    </span>
  );
}

export function Spinner({ size = 22, label }: { size?: number; label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <LoaderCircle size={size} className="spin" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Skeleton({ height = 80 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-hidden="true" />;
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="banner banner-red" role="alert">
      <TriangleAlert size={20} />
      <div className="grow stack-sm">
        <span>{error.message || t('somethingWrong')}</span>
        {onRetry && (
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => onRetry()}
            style={{ alignSelf: 'flex-start' }}
          >
            <RefreshCw size={16} /> {t('retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={36} />
      <div>{children}</div>
    </div>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'dark';
export function Pill({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill${tone === 'grey' ? '' : ` pill-${tone}`}`}>{children}</span>;
}

const SEVERITY_TONE: Record<Severity, Tone> = { high: 'red', medium: 'amber', low: 'green' };
export const SEVERITY_COLOUR: Record<Severity, string> = {
  high: '#d64545',
  medium: '#e39b2d',
  low: '#3e9b5b',
};

export function SeverityPill({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return <Pill tone={SEVERITY_TONE[severity]}>{t(`severity.${severity}`)}</Pill>;
}

const RISK_TONE: Record<RiskLevel, Tone> = { high: 'red', medium: 'amber', low: 'green' };
export const RISK_COLOUR: Record<RiskLevel, string> = {
  high: '#d64545',
  medium: '#e39b2d',
  low: '#3e9b5b',
};

export function RiskPill({ level, score }: { level: RiskLevel; score?: number }) {
  const { t } = useI18n();
  return (
    <Pill tone={RISK_TONE[level]}>
      {t(`risk.${level}`)}
      {score !== undefined && ` · ${score}`}
    </Pill>
  );
}

const CATEGORY_ICON: Record<WasteCategory, LucideIcon> = {
  wet: Leaf,
  dry: Recycle,
  sanitary: Bandage,
  special_care: FlaskConical,
  e_waste: Smartphone,
};

export function BinIcon({ category, size = 52 }: { category: WasteCategory; size?: number }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span
      className="bin-icon"
      style={{ background: BINS[category].colour, width: size, height: size }}
    >
      <Icon size={size * 0.5} />
    </span>
  );
}

const MATERIAL_ICON: Record<Material, LucideIcon> = {
  organic: Apple,
  plastic: Milk,
  paper: Newspaper,
  cardboard: Package,
  metal: Cylinder,
  glass: Wine,
  textile: Shirt,
  electronics: Laptop,
  battery: BatteryFull,
  hazardous: FlaskConical,
  sanitary: Bandage,
  mixed: Shapes,
  other: Shapes,
};

export function MaterialIcon({ material, size = 28 }: { material: Material; size?: number }) {
  const Icon = MATERIAL_ICON[material];
  return <Icon size={size} aria-hidden="true" />;
}

export function Sheet({
  title,
  onClose,
  children,
  modal = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  modal?: boolean;
}) {
  return (
    <div
      className={`backdrop${modal ? ' modal' : ''}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <div className="sheet stack" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
