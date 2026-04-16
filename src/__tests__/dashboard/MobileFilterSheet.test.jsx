// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileFilterSheet from '@/app/dashboard/components/MobileFilterSheet.jsx';

describe('MobileFilterSheet', () => {
  it('renders nothing when open is false', () => {
    render(<MobileFilterSheet open={false} onClose={vi.fn()} onApply={vi.fn()}>content</MobileFilterSheet>);
    expect(screen.queryByText('Filters')).toBeNull();
  });

  it('renders children when open is true', () => {
    render(<MobileFilterSheet open={true} onClose={vi.fn()} onApply={vi.fn()}><span>my filter</span></MobileFilterSheet>);
    expect(screen.getByText('my filter')).toBeTruthy();
    expect(screen.getByText('Filters')).toBeTruthy();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<MobileFilterSheet open={true} onClose={onClose} onApply={vi.fn()}>content</MobileFilterSheet>);
    await act(async () => { screen.getByLabelText('Close filters').click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onApply when Apply button is clicked', async () => {
    const onApply = vi.fn();
    render(<MobileFilterSheet open={true} onClose={vi.fn()} onApply={onApply}>content</MobileFilterSheet>);
    await act(async () => { screen.getByText('Apply Filters').click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
