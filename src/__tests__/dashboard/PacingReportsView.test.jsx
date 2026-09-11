// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PacingReportsView from '../../app/dashboard/components/PacingReportsView';

vi.mock('../../app/dashboard/components/PacingTrendChart', () => ({ default: () => <div>chart</div> }));

const CONFIG = {
  sheetId: 'SHARED123',
  recipients: ['a@lilikoiagency.com'],
  clients: [{ key: 'SMP', name: 'Semper Solaris', sheetId: 'PER1', enabled: true }],
  subjectPrefix: 'X', fromAddress: 'r@x.com',
};

function mockFetch() {
  global.fetch = vi.fn((url) => {
    const body = String(url).endsWith('/config') ? { data: CONFIG } : { data: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
}

describe('PacingReportsView', () => {
  beforeEach(mockFetch);

  it('renders the given title and fetches from apiBase', async () => {
    render(<PacingReportsView apiBase="/api/streaming-pacing" title="Streaming Pacing" subtitle="sub" sheetMode="shared" />);
    expect(screen.getByText('Streaming Pacing')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/streaming-pacing/config'));
    expect(global.fetch).toHaveBeenCalledWith('/api/streaming-pacing/reports');
  });

  it('shows one shared Sheet ID input in shared mode', async () => {
    render(<PacingReportsView apiBase="/api/streaming-pacing" title="T" subtitle="s" sheetMode="shared" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    screen.getByText('Config').click();
    await waitFor(() => expect(screen.getByDisplayValue('SHARED123')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('PER1')).toBeNull();
  });

  it('shows per-client Sheet ID inputs in perClient mode', async () => {
    render(<PacingReportsView apiBase="/api/pacing" title="T" subtitle="s" sheetMode="perClient" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    screen.getByText('Config').click();
    await waitFor(() => expect(screen.getByDisplayValue('PER1')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('SHARED123')).toBeNull();
  });
});
