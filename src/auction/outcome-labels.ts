import type { BidErrorCode } from '@/auction/errors';
// Human labels for the outcome keys in rules/auction.v1.json (docs/design-brief.md "Outcomes"). Display only: the key
// stays the record, and staff see it beside the label. A key missing here shows as itself.
type Tone = 'good' | 'bad' | 'plain';
const LABELS: Record<string, [label: string, tone: Tone]> = {
  ACCEPTED_LEAD: ['Leading', 'good'],
  ACCEPTED_OUTBID: ['Accepted, outbid', 'plain'],
  ACCEPTED_RAISE: ['Maximum raised', 'good'],
  REJECTED_LOT_NOT_OPEN: ['Not open yet', 'bad'],
  REJECTED_LOT_CLOSED: ['Closed', 'bad'],
  REJECTED_BELOW_MINIMUM: ['Below minimum', 'bad'],
  REJECTED_NOT_ABOVE_OWN_MAX: ['Not above your maximum', 'bad'],
  SOLD: ['Sold', 'good'],
  UNSOLD_NO_BIDS: ['No bids', 'plain'],
  UNSOLD_RESERVE_NOT_MET: ['Reserve not met', 'plain'],
  UNSOLD_BY_CORRECTION: ['Withdrawn by correction', 'plain'],
};

export const outcomeLabel = (key: string) => LABELS[key]?.[0] ?? key;
export const outcomeTone = (key: string): Tone => LABELS[key]?.[1] ?? 'plain';

// What a bidder reads when the bid path refuses before judging (UX-05). The code stays the record, in `data-code`.
// Typed against BidErrorCode, so a new code does not compile until it has a line here.
const BID_ERRORS: Record<BidErrorCode, string> = {
  MISSING_KEY: 'Something went wrong sending that bid. Enter your maximum and press Bid again.',
  INVALID_AMOUNT: 'Enter a whole-cent amount such as 250 or 250.50.',
  LOT_NOT_FOUND: 'This lot is no longer in the sale.',
  BIDDER_NOT_ACTIVE: 'Register to bid first.',
  BID_TIMED_OUT: 'The lot is busy. Press Bid again; your bid will not be placed twice.',
  IDEMPOTENCY_MISMATCH: 'That bid was already sent with a different amount. Enter your maximum again.',
};
export const bidErrorText = (code: string) => BID_ERRORS[code as BidErrorCode] ?? 'That bid could not be placed. Press Bid again.';
