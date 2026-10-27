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
