// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

afterEach(() => vi.clearAllMocks());

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

  it('calls the API and renders results on successful generation', async () => {
    const campaignData = makeCampaign();
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }) // creatives fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            diagnosis: 'Low ROAS indicates creative fatigue.',
            strategy: 'Test fresh angles.',
            primaryTexts: [{ text: 'Primary 1', rationale: 'r1' }],
            headlines: [{ text: 'Headline 1', rationale: 'r2' }],
            descriptions: [{ text: 'Desc 1', rationale: 'r3' }],
            ctaRecommendation: { cta: 'Shop Now', rationale: 'Strong intent signal.' },
          },
        }),
      });

    render(
      <MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[campaignData]} />
    );

    // Wait for form to be ready
    await waitFor(() => expect(screen.getByLabelText(/business/i)).toBeTruthy());

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/business/i), { target: { value: 'HVAC Co' } });
    fireEvent.change(screen.getByLabelText(/target audience/i), { target: { value: 'Homeowners' } });
    fireEvent.change(screen.getByLabelText(/unique selling points/i), { target: { value: 'Same-day service' } });

    fireEvent.click(screen.getByText(/generate ad copy/i));

    await waitFor(() => expect(screen.getByText(/low roas indicates/i)).toBeTruthy());
    expect(screen.getByText('Primary 1')).toBeTruthy();
  });
});

describe('Mode toggle', () => {
  it('shows mode toggle with New campaign and Existing campaign options', async () => {
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />);
    await waitFor(() => expect(screen.getByText('New campaign')).toBeTruthy());
    expect(screen.getByText('Existing campaign')).toBeTruthy();
  });

  it('defaults to existing mode when underperforming campaigns exist', async () => {
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />);
    await waitFor(() => expect(screen.getByLabelText(/business/i)).toBeTruthy());
    expect(screen.queryByLabelText(/what are you selling/i)).toBeNull();
  });

  it('switches to new campaign form when New campaign is clicked', async () => {
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[makeCampaign()]} />);
    await waitFor(() => screen.getByText('New campaign'));
    fireEvent.click(screen.getByText('New campaign'));
    await waitFor(() => expect(screen.getByLabelText(/what are you selling/i)).toBeTruthy());
    expect(screen.queryByLabelText(/business/i)).toBeNull();
  });

  it('defaults to new campaign mode when no campaigns with spend', async () => {
    // 0 spend campaigns → campaignsWithSpend is empty → no form shown
    // But when campaigns have spend but ROAS >= 1: no underperforming → new mode
    const healthyCampaign = makeCampaign({ roas: 2.5, conversions: 5, spend: 500 });
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[healthyCampaign]} />);
    await waitFor(() => expect(screen.getByLabelText(/what are you selling/i)).toBeTruthy());
  });
});

describe('New campaign form — Meta', () => {
  beforeEach(async () => {
    const healthyCampaign = makeCampaign({ roas: 2.5, conversions: 5, spend: 500 });
    render(<MetaAdCopyPanel open={true} onClose={() => {}} selectedAccount={makeAccount()} campaigns={[healthyCampaign]} />);
    await waitFor(() => screen.getByLabelText(/what are you selling/i));
  });

  it('has Target audience field (not keywords)', () => {
    expect(screen.getByLabelText(/target audience/i)).toBeTruthy();
  });

  it('disables generate when required fields empty', () => {
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(true);
  });

  it('enables generate when all required fields filled', async () => {
    fireEvent.change(screen.getByLabelText(/what are you selling/i), { target: { value: 'Plumbing' } });
    fireEvent.change(screen.getByLabelText(/target audience/i), { target: { value: 'Homeowners' } });
    fireEvent.change(screen.getByLabelText(/what makes you different/i), { target: { value: 'Licensed' } });
    fireEvent.change(screen.getByLabelText(/main offer or cta/i), { target: { value: 'Call now' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /generate/i }).disabled).toBe(false));
  });
});
