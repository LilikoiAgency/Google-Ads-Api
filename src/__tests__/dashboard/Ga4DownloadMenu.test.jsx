// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DownloadMenu, { openingView } from '@/app/dashboard/google/analytics/components/DownloadMenu.jsx';

const open = () => fireEvent.click(screen.getByRole('button', { name: /download report/i }));
// The on-screen view's label also carries an "on screen" tag, so match on the start.
const box = (label) => screen.getByRole('checkbox', { name: new RegExp(`^${label}`) });

describe('DownloadMenu', () => {
  it('starts with only the on-screen view ticked', () => {
    render(<DownloadMenu currentView="organic" onDownload={() => {}} />);
    open();
    expect(box('Organic search').checked).toBe(true);
    expect(box('All non-paid').checked).toBe(false);
    expect(box('Paid').checked).toBe(false);
    expect(box('Everything').checked).toBe(false);
    expect(screen.getByText(/client sees only Organic search/i)).toBeTruthy();
    expect(screen.queryByText(/includes paid traffic/i)).toBeNull();
  });

  it('downloads exactly the ticked views, in standard order, opening on the on-screen view', () => {
    const onDownload = vi.fn();
    render(<DownloadMenu currentView="nonPaid" onDownload={onDownload} />);
    open();
    fireEvent.click(box('Organic search'));
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(onDownload).toHaveBeenCalledWith({ view: 'nonPaid', views: ['organic', 'nonPaid'] });
  });

  it('opens on the first ticked view when the on-screen one is unticked', () => {
    const onDownload = vi.fn();
    render(<DownloadMenu currentView="all" onDownload={onDownload} />);
    open();
    fireEvent.click(box('Everything'));
    fireEvent.click(box('Paid'));
    expect(screen.getByText(/includes paid traffic/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^download$/i }));
    expect(onDownload).toHaveBeenCalledWith({ view: 'paid', views: ['paid'] });
  });

  it('cannot download with nothing ticked', () => {
    render(<DownloadMenu currentView="paid" onDownload={() => {}} />);
    open();
    fireEvent.click(box('Paid'));
    expect(screen.getByRole('button', { name: /^download$/i }).disabled).toBe(true);
    expect(screen.getByText(/pick at least one view/i)).toBeTruthy();
  });

  it('resets to the on-screen view each time it opens', () => {
    const { rerender } = render(<DownloadMenu currentView="organic" onDownload={() => {}} />);
    open();
    fireEvent.click(box('Paid'));
    open(); // close
    rerender(<DownloadMenu currentView="nonPaid" onDownload={() => {}} />);
    open();
    expect(box('Paid').checked).toBe(false);
    expect(box('All non-paid').checked).toBe(true);
    expect(box('Organic search').checked).toBe(false);
  });

  it('openingView helper', () => {
    expect(openingView('paid', ['organic', 'paid'])).toBe('paid');
    expect(openingView('all', ['nonPaid', 'organic'])).toBe('organic');
    expect(openingView('all', [])).toBeNull();
  });
});
