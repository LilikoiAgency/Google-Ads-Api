// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DeepAnalysisPanel from '@/app/dashboard/google/ads/components/DeepAnalysisPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const sessionStorageMock = (() => {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });

const makeSelectedCustomer = () => ({
  customer: { customer_client: { id: '123', descriptive_name: 'Test Co' } },
  campaigns: [{
    campaignId: '1', campaignName: 'Brand Search',
    cost: 500_000_000, clicks: 100, impressions: 2000, conversions: 5,
  }],
});

const makeDeepResult = () => ({
  healthScore: 72,
  grade: 'B',
  summary: 'Account performing well with room to improve keyword quality.',
  categories: {
    conversionTracking: { score: 65, weight: 25, findings: [{ label: 'Enhanced Conversions', status: 'FAIL', detail: 'Not configured.' }] },
    wastedSpend:        { score: 80, weight: 20, findings: [{ label: 'Negative keywords', status: 'PASS', detail: 'Good coverage.' }] },
    accountStructure:   { score: 70, weight: 15, findings: [] },
    keywords:           { score: 75, weight: 15, findings: [] },
    ads:                { score: 68, weight: 15, findings: [] },
    settings:           { score: 85, weight: 10, findings: [] },
  },
  quickWins: [{ action: 'Add sitelinks to Brand Search', impact: 'Improve CTR by ~10%', effort: 'low' }],
  aiInsights: [{ title: 'Keyword cannibalization', detail: 'Brand terms appear in two campaigns, inflating CPCs.' }],
});

const emptyAuditData = {
  keywords: [], campaignConfig: [], adStrength: [], conversionActions: [],
  campaignSearchTerms: [], geoPerformance: [], daypartPerformance: [],
  conversionLag: [], pmaxAssetGroups: [], pmaxBrandExclusions: [],
  campaignAssets: [], accountAssetTypes: [],
};

beforeEach(() => {
  sessionStorageMock.clear();
  global.fetch.mockImplementation((url) => {
    if (url.includes('/api/googleads/audit')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: emptyAuditData }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: makeDeepResult() }) });
  });
});

describe('DeepAnalysisPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <DeepAnalysisPanel open={false} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the health score when analysis resolves', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('72')).toBeTruthy());
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('shows all six category labels', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('72'));
    expect(screen.getByText(/Conversion Tracking/i)).toBeTruthy();
    expect(screen.getByText(/Wasted Spend/i)).toBeTruthy();
    expect(screen.getByText(/Account Structure/i)).toBeTruthy();
    expect(screen.getByText(/Keywords/i)).toBeTruthy();
    expect(screen.getByText(/Ads/i)).toBeTruthy();
    expect(screen.getByText(/Settings/i)).toBeTruthy();
  });

  it('shows quick wins', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('Add sitelinks to Brand Search')).toBeTruthy());
  });

  it('shows AI insights', async () => {
    render(<DeepAnalysisPanel open={true} onClose={() => {}} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => expect(screen.getByText('Keyword cannibalization')).toBeTruthy());
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DeepAnalysisPanel open={true} onClose={onClose} selectedCustomer={makeSelectedCustomer()} />);
    await waitFor(() => screen.getByText('72'));
    fireEvent.click(screen.getByRole('button', { name: /✕/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
