// R-15 (D-86): the recap is sums plus one rounded ratio; the CSV is RFC 4180. The fixtures comparison is the integration test.
import { describe, expect, it } from 'vitest';
import { LEDGER_COLUMNS, ledgerCsv, recap } from '@/auction/recap';

const lot = (outcome: string | null, hammerCents = 0, extensionCount = 0) => ({ outcome, hammerCents, premiumCents: Math.round(hammerCents * 0.15), totalCents: hammerCents + Math.round(hammerCents * 0.15), extensionCount });

describe('recap()', () => {
  it('counts, sums and the sell-through in whole bps, half up', () => {
    const r = recap([lot('SOLD', 10000, 2), lot('UNSOLD_NO_BIDS'), lot('UNSOLD_RESERVE_NOT_MET', 0, 1), lot(null)]);
    expect(r).toEqual({ offered: 4, settled: 3, sold: 1, unsold: [['UNSOLD_NO_BIDS', 1], ['UNSOLD_RESERVE_NOT_MET', 1]], unsettled: 1, sellThroughBps: 2500, hammerCents: 10000, premiumCents: 1500, totalCents: 11500, lotsExtended: 2, extensions: 3 });
    expect(recap([lot('SOLD', 1), lot('SOLD', 1), lot('UNSOLD_NO_BIDS')]).sellThroughBps).toBe(6667); // 2/3 = 6666.67
    expect(recap([lot('SOLD', 1), lot('UNSOLD_NO_BIDS'), lot('UNSOLD_NO_BIDS')]).sellThroughBps).toBe(3333);
    expect(recap([]).sellThroughBps).toBe(0);
  });
  it('an unsettled lot is offered, never sold, and its hammer is not counted', () => {
    expect(recap([lot(null, 999)])).toMatchObject({ offered: 1, settled: 0, sold: 0, hammerCents: 0, sellThroughBps: 0 });
  });
});

describe('ledgerCsv()', () => {
  it('header, CRLF, quoting only where a cell needs it', () => {
    const row = Object.fromEntries(LEDGER_COLUMNS.map((c) => [c, null])) as Parameters<typeof ledgerCsv>[0][number];
    const csv = ledgerCsv([{ ...row, lot_number: 1, lot_title: 'Crock, 5 gal "blue"', seq: 1, max_cents: 51000, accepted: true, extended: false }]);
    const [head, line, tail] = csv.split('\r\n');
    expect(head).toBe(LEDGER_COLUMNS.join(','));
    expect(line).toBe('1,"Crock, 5 gal ""blue""",1,,51000,,true,,,,,,,false,');
    expect(tail).toBe('');
  });
});
