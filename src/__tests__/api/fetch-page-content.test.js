// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init) => ({ _body: body, status: init?.status ?? 200 }),
  },
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/fetch-page-content/route.js';

const authorizedSession = { user: { email: 'test@lilikoiagency.com' } };
const makeRequest = (body) => ({ json: async () => body });

beforeEach(() => {
  getServerSession.mockResolvedValue(authorizedSession);
  global.fetch = vi.fn();
});
afterEach(() => { vi.clearAllMocks(); });

describe('POST /api/fetch-page-content', () => {
  it('returns 401 when not authenticated', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'outsider@other.com' } });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(res._body.error).toMatch(/url is required/i);
  });

  it('returns 400 when url is not a valid URL', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url' }));
    expect(res.status).toBe(400);
    expect(res._body.error).toMatch(/invalid url/i);
  });

  it('returns 400 for non-http protocols', async () => {
    const res = await POST(makeRequest({ url: 'ftp://example.com' }));
    expect(res.status).toBe(400);
  });

  it('returns 422 when fetched page is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'text/html' }, text: async () => '' });
    const res = await POST(makeRequest({ url: 'https://example.com/missing' }));
    expect(res.status).toBe(422);
    expect(res._body.error).toMatch(/404/);
  });

  it('strips HTML and returns plain text', async () => {
    const html = '<html><head><title>My Page</title><style>body{color:red}</style></head><body><script>alert(1)</script><h1>Hello World</h1><p>This is content.</p></body></html>';
    global.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html,
    });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(res._body.text).toContain('Hello World');
    expect(res._body.text).toContain('This is content.');
    expect(res._body.text).not.toContain('<h1>');
    expect(res._body.text).not.toContain('alert(1)');
    expect(res._body.text).not.toContain('color:red');
  });

  it('truncates content to 5000 characters', async () => {
    const longContent = 'A'.repeat(10000);
    const html = `<body><p>${longContent}</p></body>`;
    global.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => html,
    });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(res._body.text.length).toBeLessThanOrEqual(5000);
  });
});
