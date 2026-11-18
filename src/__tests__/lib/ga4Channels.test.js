import { bucketFor, VIEWS, channelsForView, inView, isSuspectedPaid, CHANNEL_DEFINITIONS } from '@/lib/ga4Channels';

it('buckets known channels', () => {
  expect(bucketFor('Organic Search')).toBe('organic');
  expect(bucketFor('Direct')).toBe('otherNonPaid');
  expect(bucketFor('AI Assistant')).toBe('otherNonPaid');
  expect(bucketFor('Cross-network')).toBe('paid');
  expect(bucketFor('Unassigned')).toBe('unassigned');
});
it('unknown channel buckets to unassigned', () => {
  expect(bucketFor('Something New')).toBe('unassigned');
  expect(inView('Something New', 'nonPaid')).toBe(false);
  expect(inView('Something New', 'all')).toBe(true);
});
it('views', () => {
  expect(VIEWS.map(v => v.key)).toEqual(['organic', 'nonPaid', 'paid', 'all']);
  expect(channelsForView('organic')).toEqual(['Organic Search']);
  expect(channelsForView('all')).toBeNull();
  expect(channelsForView('nonPaid')).toContain('Direct');
  expect(channelsForView('nonPaid')).not.toContain('Unassigned');
});
it('flags untagged paid social', () => {
  expect(isSuspectedPaid('facebook / cpc', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('ig / paid', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('google / cpc', 'otherNonPaid')).toBe(true);
  expect(isSuspectedPaid('facebook.com / referral', 'otherNonPaid')).toBe(false);
  expect(isSuspectedPaid('facebook / cpc', 'paid')).toBe(false);
  expect(isSuspectedPaid('instagram / social', 'otherNonPaid')).toBe(false);
});
it('has a definition for Organic Search using the BBT wording', () => {
  expect(CHANNEL_DEFINITIONS[0].name).toBe('Organic Search');
  expect(CHANNEL_DEFINITIONS[0].text).toMatch(/unpaid result on Google, Bing/);
});
