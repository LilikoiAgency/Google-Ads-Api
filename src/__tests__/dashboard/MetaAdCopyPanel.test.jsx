// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MetaAdCopyPanel from '@/app/dashboard/meta/components/MetaAdCopyPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const makeAccount = () => ({ accountId: 'act_123', name: 'Test Account' });
const makeCampaign = (overrides = {}) => ({
  id: 'c1', name: 'Spring Promo', objective: 'CONVERSIONS',
  spend: 500, ctr: 0.015, cpc: 2.5, cpm: 15, frequency: 3,
  conversions: 0, revenue: 0, roas: 0, costPerResult: null,
  ...overrides,
});

beforeEach(() => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
});

describe('MetaAdCopyPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MetaAdCopyPanel open={false} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows "Select an account first" when no account is provided', () => {
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={null} campaigns={[]} />);
    expect(screen.getByText(/select an account/i)).toBeTruthy();
  });

  it('shows "No campaigns with spend" when all campaigns have zero spend', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign({ spend: 0 })]} />
    );
    await waitFor(() => expect(screen.getByText(/no campaigns with spend/i)).toBeTruthy());
  });

  it('renders the form when open with an account and campaigns with spend', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    await waitFor(() => expect(screen.getByLabelText(/business/i)).toBeTruthy());
    expect(screen.getByLabelText(/target audience/i)).toBeTruthy();
    expect(screen.getByLabelText(/unique selling points/i)).toBeTruthy();
  });

  it('pre-selects the first campaign with ROAS < 1 and spend > 0', async () => {
    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />
    );
    await waitFor(() => screen.getByLabelText(/business/i));
    const radio = screen.getByRole('radio', { name: /Spring Promo/i });
    expect(radio.checked).toBe(true);
  });
});
