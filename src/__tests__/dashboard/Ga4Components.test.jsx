// @vitest-environment jsdom
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KpiRow from '@/app/dashboard/google/analytics/components/KpiRow.jsx';
import ChannelTable from '@/app/dashboard/google/analytics/components/ChannelTable.jsx';
import SourcesAndPages from '@/app/dashboard/google/analytics/components/SourcesAndPages.jsx';
import PropertyPicker from '@/app/dashboard/google/analytics/components/PropertyPicker.jsx';
import ViewToggle from '@/app/dashboard/google/analytics/components/ViewToggle.jsx';

const M = (o = {}) => ({ users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, engagementRate: 0, keyEvents: 0, ...o });

describe('KpiRow', () => {
  it('KpiRow shows — for null deltas and pts for engagement rate', () => {
    render(
      <KpiRow
        totals={M({ users: 1440, newUsers: 1301, sessions: 1912, engagedSessions: 1113, engagementRate: 0.582, keyEvents: 87 })}
        deltas={{ users: null, newUsers: 0.15, sessions: 0.09, engagedSessions: 0.05, engagementRate: -0.011, keyEvents: 0.04 }}
        compareLabel="Sep 2026"
        showKeyEvents
      />
    );
    expect(screen.getByText('1,440')).toBeTruthy();
    expect(screen.getByText('58.2%')).toBeTruthy();
    expect(screen.getByText('▼ 1.1 pts')).toBeTruthy();
    expect(screen.getByText('▲ 9%')).toBeTruthy();
    const users = screen.getByTestId('kpi-users');
    expect(within(users).getByText('—')).toBeTruthy();
  });

  it('hides deltas when there is no comparison', () => {
    render(<KpiRow totals={M({ users: 5 })} deltas={{}} compareLabel={null} showKeyEvents={false} />);
    expect(screen.queryByText(/vs /)).toBeNull();
    // Key events not tracked: value is a dash.
    expect(within(screen.getByTestId('kpi-keyEvents')).getByText('—')).toBeTruthy();
  });
});

describe('ChannelTable', () => {
  it('ChannelTable renders total row labeled "Total (unique users)" using totals, not the sum of rows', () => {
    const channels = [
      { channel: 'Organic Search', current: M({ users: 10, sessions: 12 }), compare: null, deltas: {} },
      { channel: 'Direct', current: M({ users: 10, sessions: 11 }), compare: null, deltas: {} },
    ];
    render(<ChannelTable channels={channels} totals={M({ users: 15, sessions: 23 })} totalDeltas={{}} hasCompare={false} showKeyEvents />);
    const total = screen.getByText('Total (unique users)').closest('tr');
    expect(within(total).getByText('15')).toBeTruthy();
    expect(within(total).queryByText('20')).toBeNull();
  });

  it('sorts rows locally when a header is clicked', () => {
    const channels = [
      { channel: 'Direct', current: M({ users: 5, sessions: 50 }), compare: null, deltas: {} },
      { channel: 'Organic Search', current: M({ users: 9, sessions: 10 }), compare: null, deltas: {} },
    ];
    render(<ChannelTable channels={channels} totals={M({ users: 14, sessions: 60 })} totalDeltas={{}} hasCompare={false} showKeyEvents />);
    const firstBodyRow = () => screen.getAllByRole('row')[1];
    expect(within(firstBodyRow()).getByText('Direct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Users/ }));
    expect(within(firstBodyRow()).getByText('Organic Search')).toBeTruthy();
  });
});

describe('SourcesAndPages', () => {
  it('SourcesAndPages tags suspected rows "Likely paid"', () => {
    const sources = [
      { sourceMedium: 'google / organic', channel: 'Organic Search', sessions: 100, users: 90, suspectedPaid: false },
      { sourceMedium: 'facebook / paid', channel: 'Organic Social', sessions: 40, users: 35, suspectedPaid: true },
    ];
    const pages = [{ page: '/pricing', sessions: 30, users: 25, keyEvents: 2 }];
    render(<SourcesAndPages sources={sources} pages={pages} />);
    const tags = screen.getAllByText('Likely paid');
    expect(tags).toHaveLength(1);
    expect(tags[0].closest('tr').textContent).toContain('facebook / paid');
    expect(screen.getByText('Users (approx.)')).toBeTruthy();
    expect(screen.getByText('/pricing')).toBeTruthy();
  });
});

describe('PropertyPicker', () => {
  const properties = [
    { id: 'properties/1', name: 'Ranger Electric - GA4', account: 'Ranger Electric' },
    { id: 'properties/2', name: 'Semper Solaris - GA4', account: 'Semper Solaris' },
    { id: 'properties/3', name: 'Semper Solaris - Roofing', account: 'Semper Solaris' },
  ];

  it('filters by search, groups by account and selects', () => {
    const onChange = vi.fn();
    render(<PropertyPicker properties={properties} value="properties/1" onChange={onChange} onRefresh={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Ranger Electric - GA4/ }));
    fireEvent.change(screen.getByPlaceholderText('Search properties'), { target: { value: 'roof' } });
    expect(screen.queryByText('Semper Solaris - GA4')).toBeNull();
    expect(screen.getByText('Semper Solaris')).toBeTruthy(); // account group header
    fireEvent.click(screen.getByText('Semper Solaris - Roofing'));
    expect(onChange).toHaveBeenCalledWith('properties/3');
  });

  it('offers a Refresh list link', () => {
    const onRefresh = vi.fn();
    render(<PropertyPicker properties={properties} value="properties/1" onChange={() => {}} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: /Ranger Electric - GA4/ }));
    fireEvent.click(screen.getByText('Refresh list'));
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe('ViewToggle', () => {
  it('shows the four views and reports the clicked key', () => {
    const onChange = vi.fn();
    render(<ViewToggle value="nonPaid" onChange={onChange} />);
    ['Organic search', 'All non-paid', 'Paid', 'Everything'].forEach((l) => expect(screen.getByText(l)).toBeTruthy());
    fireEvent.click(screen.getByText('Paid'));
    expect(onChange).toHaveBeenCalledWith('paid');
  });
});
