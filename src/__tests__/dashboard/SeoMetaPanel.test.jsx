// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SeoMetaPanel from '@/app/dashboard/components/SeoMetaPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

beforeEach(() => {
  global.fetch.mockResolvedValue({
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
  });
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
});
