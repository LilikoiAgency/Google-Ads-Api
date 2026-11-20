// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AudiencePanels, { prettyEvent } from '@/app/dashboard/google/analytics/components/AudiencePanels.jsx';

const grid = () => Array.from({ length: 7 }, () => new Array(24).fill(0));
function audience() {
  const sessions = grid(); sessions[0][9] = 10;
  const keyEvents = grid(); keyEvents[2][14] = 3;
  const split = (o) => ({ sessions: 10, users: 8, engagedSessions: 5, keyEvents: 1, share: 0.5, engagementRate: 0.5, keyEventRate: 0.1, ...o });
  return {
    cities: [split({ city: 'San Diego', region: 'California', country: 'United States' })],
    regions: [split({ region: 'California', country: 'United States' })],
    devices: [split({ device: 'Mobile' })],
    visitorTypes: [split({ type: 'New visitors' })],
    keyEvents: [{ event: 'generate_lead', count: 4, share: 1 }],
    heatmap: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], sessions, keyEvents, max: 10 },
  };
}

describe('AudiencePanels', () => {
  it('renders nothing for reports without audience data', () => {
    const { container } = render(<AudiencePanels audience={null} showKeyEvents />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows cities, regions, devices, visitors, key events and the heatmap', () => {
    render(<AudiencePanels audience={audience()} showKeyEvents />);
    expect(screen.getByText('San Diego')).toBeInTheDocument();
    expect(screen.getByText('California, United States')).toBeInTheDocument();
    expect(screen.getByText('Mobile')).toBeInTheDocument();
    expect(screen.getByText('New visitors')).toBeInTheDocument();
    expect(screen.getByText('Generate lead')).toBeInTheDocument();
    expect(screen.getByTitle('Mon 9a: 10 sessions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Key events' }));
    expect(screen.getByTitle('Wed 2p: 3 key events')).toBeInTheDocument();
  });

  it('hides key-event pieces when the property has none', () => {
    render(<AudiencePanels audience={audience()} showKeyEvents={false} />);
    expect(screen.queryByText('Key events by action')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Key events' })).toBeNull();
  });

  it('prettifies GA event names', () => {
    expect(prettyEvent('website_form_fill_outs')).toBe('Website form fill outs');
  });
});
