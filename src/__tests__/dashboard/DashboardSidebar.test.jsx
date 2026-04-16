// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard/google/ads'),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: { user: { name: 'Frank', email: 'frank@lilikoiagency.com' } }, status: 'authenticated' })),
  signOut: vi.fn(),
}));
vi.mock('@/lib/useTheme', () => ({
  useTheme: vi.fn(() => ({ theme: 'dark', toggleTheme: vi.fn() })),
}));
vi.mock('@/lib/admins', () => ({
  isAdmin: vi.fn((email) => email === 'frank@lilikoiagency.com'),
}));

import DashboardSidebar from '@/app/dashboard/components/DashboardSidebar.jsx';

describe('DashboardSidebar', () => {
  it('renders nav links for all main tools', () => {
    render(<DashboardSidebar />);
    expect(screen.getByTitle('Google Ads')).toBeTruthy();
    expect(screen.getByTitle('Meta Ads')).toBeTruthy();
    expect(screen.getByTitle('SEO Audit')).toBeTruthy();
  });

  it('shows Usage Analytics for admins', () => {
    render(<DashboardSidebar />);
    expect(screen.getByTitle('Usage Analytics')).toBeTruthy();
  });

  it('shows user first name', () => {
    render(<DashboardSidebar />);
    expect(screen.getByText('Frank')).toBeTruthy();
  });
});
