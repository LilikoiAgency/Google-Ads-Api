// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SeoMetaPanel from '@/app/dashboard/components/SeoMetaPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

const seoMetaResponse = {
  ok: true,
  json: async () => ({
    data: {
      titles: ['Title one is fifty chars of great seo content here', 'Title two is also fifty chars and well optimized ok', 'Title three here is fifty chars of seo text yes ok'],
      descriptions: [
        'Description one is one hundred and fifty characters of well-written search-optimised meta description text here.',
        'Description two is one hundred and fifty characters of well-written search-optimised meta description text here.',
        'Description three is one hundred and fifty chars of well-written search-optimised meta description text here.',
      ],
    },
    requestId: 'test-id',
  }),
};

beforeEach(() => {
  global.fetch.mockReset();
  global.fetch.mockResolvedValue(seoMetaResponse);
});

describe('SeoMetaPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SeoMetaPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the form when open', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    expect(screen.getByLabelText(/page title/i)).toBeTruthy();
    expect(screen.getByLabelText(/target keyword/i)).toBeTruthy();
    expect(screen.getByLabelText(/page type/i)).toBeTruthy();
  });

  it('disables Generate button when page title is empty', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(true);
  });

  it('enables Generate button when page title has text', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/page title/i), { target: { value: 'My Home Page' } });
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(false);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SeoMetaPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close panel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  // Content source tests
  it('URL mode tab is selected by default', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    expect(screen.getByLabelText(/page url/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /fetch content/i })).toBeTruthy();
    expect(screen.queryByLabelText(/paste page content/i)).toBeNull();
  });

  it('clicking Paste text tab switches to text mode', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /paste text/i }));
    expect(screen.getByLabelText(/paste page content/i)).toBeTruthy();
    expect(screen.queryByLabelText(/page url/i)).toBeNull();
  });

  it('Fetch content button calls /api/fetch-page-content and shows fetched text', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Hello fetched content' }),
      });

    render(<SeoMetaPanel open={true} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/page url/i), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch content/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hello fetched content')).toBeTruthy();
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/fetch-page-content', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
    }));
  });

  it('shows fetch error on failed fetch', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Could not fetch page' }),
      });

    render(<SeoMetaPanel open={true} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/page url/i), { target: { value: 'https://bad-url.com' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch content/i }));

    await waitFor(() => {
      expect(screen.getByText('Could not fetch page')).toBeTruthy();
    });
  });

  it('submits pageContent from URL mode', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Fetched page text' }),
      })
      .mockResolvedValueOnce(seoMetaResponse);

    render(<SeoMetaPanel open={true} onClose={() => {}} />);

    // Fetch content first
    fireEvent.change(screen.getByLabelText(/page url/i), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /fetch content/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Fetched page text')).toBeTruthy();
    });

    // Fill in page title and generate
    fireEvent.change(screen.getByLabelText(/page title/i), { target: { value: 'My Page' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      const calls = global.fetch.mock.calls;
      const seoCall = calls.find(c => c[0] === '/api/claude/seo-meta');
      expect(seoCall).toBeTruthy();
      const body = JSON.parse(seoCall[1].body);
      expect(body.pageContent).toBe('Fetched page text');
    });
  });

  it('submits pageContent from text mode', async () => {
    global.fetch.mockResolvedValueOnce(seoMetaResponse);

    render(<SeoMetaPanel open={true} onClose={() => {}} />);

    // Switch to text mode
    fireEvent.click(screen.getByRole('button', { name: /paste text/i }));

    // Paste content
    fireEvent.change(screen.getByLabelText(/paste page content/i), { target: { value: 'My pasted content here' } });

    // Fill in page title and generate
    fireEvent.change(screen.getByLabelText(/page title/i), { target: { value: 'My Page' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => {
      const calls = global.fetch.mock.calls;
      const seoCall = calls.find(c => c[0] === '/api/claude/seo-meta');
      expect(seoCall).toBeTruthy();
      const body = JSON.parse(seoCall[1].body);
      expect(body.pageContent).toBe('My pasted content here');
    });
  });
});
