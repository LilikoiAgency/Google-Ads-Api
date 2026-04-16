// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardToolHeader from '@/app/dashboard/components/DashboardToolHeader.jsx';

describe('DashboardToolHeader', () => {
  it('renders the title', () => {
    render(<DashboardToolHeader title="Google Ads" />);
    expect(screen.getByText('Google Ads')).toBeTruthy();
  });

  it('renders the subtitle when provided', () => {
    render(<DashboardToolHeader title="Google Ads" subtitle="Campaign Dashboard" />);
    expect(screen.getByText('Campaign Dashboard')).toBeTruthy();
  });

  it('renders children in the right slot', () => {
    render(
      <DashboardToolHeader title="Google Ads">
        <button>My Control</button>
      </DashboardToolHeader>
    );
    expect(screen.getByText('My Control')).toBeTruthy();
  });

  it('renders without subtitle or children without crashing', () => {
    render(<DashboardToolHeader title="SEO Audit" />);
    expect(screen.getByText('SEO Audit')).toBeTruthy();
  });
});
