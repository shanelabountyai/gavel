// R-07 / AX-07 (D-74): consignorStatement(lots, contract) against golden GB-25 (docs/domain-brief.md §9, tools/golden_answers.py).
// The expected numbers were worked by hand: 10,020 × 1250 bps = 1,252.5 → 1,253; 33,333 × 1250 = 4,166.625 → 4,167; 100 × 1250 = 12.5 → 13.
import { describe, expect, it } from 'vitest';
import { type ConsignedLot, consignorStatement } from '@/auction/engine/engine';
import { MoneyError } from '@/auction/engine/money';

const C = { commissionBps: 1250, lotFeeCents: 500, unsoldFeeCents: 1500 };
// Reverse lot order on purpose: the statement must sort.
const lots: ConsignedLot[] = [
  { lotId: 'g', lotNumber: 7, outcome: 'SOLD', hammerCents: 100 },
  { lotId: 'f', lotNumber: 6, outcome: 'UNSOLD_BY_CORRECTION', hammerCents: 0 },
  { lotId: 'e', lotNumber: 5, outcome: 'UNSOLD_WITHDRAWN', hammerCents: 0 },
  { lotId: 'd', lotNumber: 4, outcome: 'UNSOLD_RESERVE_NOT_MET', hammerCents: 0 },
  { lotId: 'c', lotNumber: 3, outcome: 'UNSOLD_NO_BIDS', hammerCents: 0 },
  { lotId: 'b', lotNumber: 2, outcome: 'SOLD', hammerCents: 33333 },
  { lotId: 'a', lotNumber: 1, outcome: 'SOLD', hammerCents: 10020 },
];

describe('consignorStatement (GB-25)', () => {
  const s = consignorStatement(lots, C);
  it('GB-25a lines in lot order: hammer, commission (half up), fee, net', () => {
    expect(s.lines.map((l) => [l.lotNumber, l.hammerCents, l.commissionCents, l.feeCents, l.netCents])).toEqual([
      [1, 10020, 1253, 500, 8267], [2, 33333, 4167, 500, 28666], [3, 0, 0, 1500, -1500], [4, 0, 0, 1500, -1500], [5, 0, 0, 0, 0], [6, 0, 0, 0, 0], [7, 100, 13, 500, -413],
    ]);
  });
  it('GB-25b totals', () => expect([s.hammerCents, s.commissionCents, s.feeCents, s.netCents]).toEqual([43453, 5433, 4500, 33520]));
  it('GB-25c net + commission + fees = hammer', () => expect(s.netCents + s.commissionCents + s.feeCents).toBe(s.hammerCents));
  it('GB-25d 0 bps and 10000 bps, no fees', () => {
    expect([0, 10000].map((b) => consignorStatement([lots[0]!], { commissionBps: b, lotFeeCents: 0, unsoldFeeCents: 0 }).lines[0]!.netCents)).toEqual([100, 0]);
  });
  it('GB-25e no lots: zero statement', () => expect(consignorStatement([], C)).toEqual({ lines: [], hammerCents: 0, commissionCents: 0, feeCents: 0, netCents: 0 }));
  it('GB-25f bps above 10000, negative fee, non-integer hammer refused', () => {
    expect(() => consignorStatement(lots, { ...C, commissionBps: 10001 })).toThrow(MoneyError);
    expect(() => consignorStatement(lots, { ...C, lotFeeCents: -1 })).toThrow(MoneyError);
    expect(() => consignorStatement([{ ...lots[0]!, hammerCents: 1.5 }], C)).toThrow(MoneyError);
  });
  it('same inputs, same statement', () => expect(consignorStatement(lots, C)).toEqual(s));
});
