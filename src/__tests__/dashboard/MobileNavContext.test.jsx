// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MobileNavProvider, useMobileNav } from '@/app/dashboard/components/MobileNavContext.jsx';

function Consumer() {
  const { navOpen, setNavOpen } = useMobileNav();
  return (
    <div>
      <span data-testid="state">{navOpen ? 'open' : 'closed'}</span>
      <button onClick={() => setNavOpen(true)}>open</button>
      <button onClick={() => setNavOpen(false)}>close</button>
    </div>
  );
}

describe('MobileNavContext', () => {
  it('starts closed', () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });

  it('opens when setNavOpen(true) is called', async () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    await act(async () => { screen.getByText('open').click(); });
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('closes when setNavOpen(false) is called', async () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    await act(async () => { screen.getByText('open').click(); });
    await act(async () => { screen.getByText('close').click(); });
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });
});
