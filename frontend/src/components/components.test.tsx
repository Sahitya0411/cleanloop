import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { EtaInfo, Report } from '@cleanloop/shared';
import { I18nProvider } from '../lib/i18n';
import { EtaCard } from './EtaCard';
import { StatusTracker } from './StatusTracker';

const wrap = (ui: React.ReactNode) =>
  render(
    <I18nProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nProvider>,
  );

const base: EtaInfo = {
  status: 'upcoming',
  date: '2026-10-10',
  upcoming: [],
  progress: { handled: 4, total: 12 },
  truck: { lat: 0, lng: 0, label: 'Pocket A, Lane 1' },
};

describe('EtaCard', () => {
  it('shows stops away and minutes', () => {
    wrap(<EtaCard eta={{ ...base, stopsAway: 3, minutes: 25 }} />);
    expect(screen.getByText('3 stops away')).toBeInTheDocument();
    expect(screen.getByText('~25 min')).toBeInTheDocument();
    expect(screen.getByText('Truck at Pocket A, Lane 1')).toBeInTheDocument();
  });

  it('flags a late truck', () => {
    wrap(<EtaCard eta={{ ...base, status: 'next', minutes: 0, late: true }} />);
    expect(screen.getByText('Next stop is yours!')).toBeInTheDocument();
    expect(screen.getByText('Running late')).toBeInTheDocument();
  });

  it('offers a report when the lane was missed', () => {
    wrap(<EtaCard eta={{ ...base, status: 'missed', skipReason: 'Road dug up' }} />);
    expect(screen.getByText('Missed today')).toBeInTheDocument();
    expect(screen.getByText('Road dug up')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Report an overflowing bin' })).toHaveAttribute(
      'href',
      '/resident/report',
    );
  });

  it('explains a deferred pickup', () => {
    wrap(<EtaCard eta={{ ...base, status: 'deferred' }} />);
    expect(screen.getByText('No pickup today')).toBeInTheDocument();
  });
});

describe('StatusTracker', () => {
  it('marks completed steps', () => {
    const report = {
      reportId: 'r',
      status: 'seen',
      createdAt: '2026-10-10T04:00:00Z',
      seenAt: '2026-10-10T05:00:00Z',
    } as Report;
    const { container } = wrap(<StatusTracker report={report} />);
    expect(container.querySelectorAll('.timeline-step.done')).toHaveLength(2);
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });
});
