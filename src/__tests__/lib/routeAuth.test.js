import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getServerSession } from 'next-auth';
import { getAdminSession, getAllowedSession } from '@/lib/routeAuth';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/admins', () => ({
  isAdmin: vi.fn((email) => email === 'frank@lilikoiagency.com'),
}));

describe('routeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows company-domain sessions', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'user@lilikoiagency.com' } });

    const result = await getAllowedSession();

    expect(result.error).toBeNull();
    expect(result.email).toBe('user@lilikoiagency.com');
    expect(result.status).toBe(200);
  });

  it('rejects non-company-domain sessions', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'user@example.com' } });

    const result = await getAllowedSession();

    expect(result.error).toBe('Unauthorized');
    expect(result.status).toBe(401);
  });

  it('allows configured admins', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'frank@lilikoiagency.com' } });

    const result = await getAdminSession();

    expect(result.error).toBeNull();
    expect(result.email).toBe('frank@lilikoiagency.com');
  });

  it('forbids non-admin company users', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'user@lilikoiagency.com' } });

    const result = await getAdminSession();

    expect(result.error).toBe('Forbidden');
    expect(result.status).toBe(403);
  });
});
