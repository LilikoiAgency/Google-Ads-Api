// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdCopyPanel from '@/app/dashboard/google/ads/components/AdCopyPanel.jsx';

// Stub createPortal so it renders inline
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const makeCampaign = (overrides = {}) => ({
  campaignId: '1',
  campaignName: 'Brand Search',
  cost: 500_000_000,
  clicks: 1000,
  impressions: 20000,
  conversions: 10,
  searchBudgetLostImpressionShare: 0.05,
  searchRankLostImpressionShare: 0.35,
  ads: [{ headlines: ['Buy Now', 'Shop Today'], descriptions: ['Great deals'] }],
  searchTerms: [{ term: 'brand search', conversions: 5, cost: 100_000_000, clicks: 50 }],
  ...overrides,
});

const makeSelectedCustomer = (campaigns = [makeCampaign()]) => ({
  customer: { customer_client: { id: '123', descriptive_name: 'Test Co' } },
  campaigns,
  searchTerms: [{ term: 'brand search', conversions: 5, cost: 100_000_000, clicks: 50 }],
});

beforeEach(() => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { keywords: [], campaignConfig: [], campaignAssets: [], adStrength: [] } }),
  });
});

describe('AdCopyPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AdCopyPanel open={false} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the form when open with campaign selector and focus field', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: /Brand Search/i })).toBeTruthy());
    expect(screen.getByLabelText(/focus area/i)).toBeTruthy();
    expect(screen.getByText('New campaign')).toBeTruthy();
    expect(screen.getByText('Existing campaign')).toBeTruthy();
  });

  it('pre-selects the first underperforming campaign (FIX_QS verdict)', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByRole('radio', { name: /Brand Search/i }));
    const radio = screen.getByRole('radio', { name: /Brand Search/i });
    expect(radio.checked).toBe(true);
  });

  it('enables Generate button when a campaign is selected', async () => {
    render(
      <AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByRole('radio', { name: /Brand Search/i }));
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(false);
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <AdCopyPanel open={true} onClose={onClose} selectedCustomer={makeSelectedCustomer()} />
    );
    await waitFor(() => screen.getByText('New campaign'));
    fireEvent.click(screen.getByRole('button', { name: /✕/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Mode toggle', () => {
  it('shows mode toggle with New campaign and Existing campaign options', async () => {
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('New campaign'));
    expect(screen.getByText('New campaign')).toBeTruthy();
    expect(screen.getByText('Existing campaign')).toBeTruthy();
  });

  it('defaults to existing campaign mode when underperforming campaigns exist', async () => {
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByRole('radio', { name: /Brand Search/i }));
    expect(screen.queryByLabelText(/what are you selling/i)).toBeNull();
    expect(screen.getByLabelText(/focus area/i)).toBeTruthy();
  });

  it('switches to new campaign form when New campaign is clicked', async () => {
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('New campaign'));
    fireEvent.click(screen.getByText('New campaign'));
    await waitFor(() => expect(screen.getByLabelText(/what are you selling/i)).toBeTruthy());
    expect(screen.queryByLabelText(/focus area/i)).toBeNull();
  });

  it('defaults to new campaign mode when no underperforming campaigns exist', async () => {
    // SCALE verdict: lostBudget > 0.25 && conv > 0 — not in UNDERPERFORMING set
    const customer = makeSelectedCustomer([makeCampaign({ searchBudgetLostImpressionShare: 0.4, searchRankLostImpressionShare: 0 })]);
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={customer} />);
    await waitFor(() => expect(screen.getByLabelText(/what are you selling/i)).toBeTruthy());
  });
});

describe('New campaign form', () => {
  beforeEach(async () => {
    // SCALE verdict: lostBudget > 0.25 && conv > 0 — not in UNDERPERFORMING set
    const customer = makeSelectedCustomer([makeCampaign({ searchBudgetLostImpressionShare: 0.4, searchRankLostImpressionShare: 0 })]);
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={customer} />);
    await waitFor(() => screen.getByLabelText(/what are you selling/i));
  });

  it('disables generate button when required fields are empty', () => {
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(true);
  });

  it('enables generate button when all required fields are filled', async () => {
    fireEvent.change(screen.getByLabelText(/what are you selling/i), { target: { value: 'Plumbing services' } });
    fireEvent.change(screen.getByLabelText(/target keywords/i), { target: { value: 'plumber, repair' } });
    fireEvent.change(screen.getByLabelText(/what makes you different/i), { target: { value: 'Licensed' } });
    fireEvent.change(screen.getByLabelText(/main offer or cta/i), { target: { value: 'Call now' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /generate/i }).disabled).toBe(false));
  });
});

describe('Existing campaign current copy preview', () => {
  it('shows current copy preview when a campaign with ads is selected', async () => {
    render(<AdCopyPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByRole('radio', { name: /Brand Search/i }));
    // The default campaign (Brand Search) has ads with headlines ['Buy Now', 'Shop Today']
    await waitFor(() => expect(screen.getByText('Buy Now')).toBeTruthy());
  });
});
