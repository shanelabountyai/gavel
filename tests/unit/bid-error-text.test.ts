// UX-05: every refusal a bidder can see has plain words, never the developer message.
import { describe, expect, it } from 'vitest';
import { bidErrorText } from '@/auction/outcome-labels';

const CODES = ['MISSING_KEY', 'INVALID_AMOUNT', 'LOT_NOT_FOUND', 'BIDDER_NOT_ACTIVE', 'TERMS_NOT_ACCEPTED', 'BID_TIMED_OUT', 'IDEMPOTENCY_MISMATCH', 'SOMETHING_NEW'];

describe('bidErrorText', () => {
  it.each(CODES)('%s reads as a sentence with no developer words', (code) => {
    const t = bidErrorText(code);
    expect(t).toMatch(/^[A-Z].*\.$/);
    expect(t).not.toMatch(/\bkey\b|cents|resend|bidder is not/i);
  });
  it('the lock timeout tells the bidder to press again', () => expect(bidErrorText('BID_TIMED_OUT')).toContain('Press Bid again'));
});
