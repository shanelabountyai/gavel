// Task 2.1 (D-42 Q1): invoice(settlements) per winning bidder per auction, derived on read. The expected totals
// are summed here, row by row, from fixtures/expected_lots.csv; the function under test never computes them.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type SettledLot, invoice } from '@/auction/engine/engine';
import { MoneyError } from '@/auction/engine/money';

type Csv = Record<string, string>;
const csv = (path: string): Csv[] => {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = head!.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i]!, v])));
};
const auctions: { auction_id: string; lots: { lot_id: string; lot_number: number }[] }[] = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8')).auctions;
const bidders: { bidder_id: string }[] = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8')).bidders;
const lotNumber = new Map(auctions.flatMap((a) => a.lots.map((l) => [l.lot_id, l.lot_number] as const)));
const lots = csv('fixtures/expected_lots.csv');

// Input in reverse file order, so lot-number order has to come from the function.
const settled: SettledLot[] = lots.reverse().map((r) => ({
  auctionId: r.auction_id!, lotId: r.lot_id!, lotNumber: lotNumber.get(r.lot_id!)!, outcome: r.outcome as SettledLot['outcome'],
  winner: r.winner || null, hammerCents: Number(r.hammer_cents), premiumCents: Number(r.premium_cents), totalCents: Number(r.total_cents),
}));

describe('invoice (task 2.1)', () => {
  const out = invoice(settled);

  for (const a of auctions) {
    it(`${a.auction_id}: each winner's invoice equals the sum of their SOLD rows in expected_lots.csv`, () => {
      const want = new Map<string, { lots: string[]; hammer: number; premium: number; total: number }>();
      for (const r of lots) {
        if (r.auction_id !== a.auction_id || r.outcome !== 'SOLD') continue;
        const w = want.get(r.winner!) ?? want.set(r.winner!, { lots: [], hammer: 0, premium: 0, total: 0 }).get(r.winner!)!;
        w.lots.push(r.lot_id!);
        w.hammer += Number(r.hammer_cents);
        w.premium += Number(r.premium_cents);
        w.total += Number(r.total_cents);
      }
      const got = out.filter((i) => i.auctionId === a.auction_id);
      expect(got.map((i) => i.bidderId)).toEqual([...want.keys()].sort());
      for (const i of got) {
        const w = want.get(i.bidderId)!;
        expect(i.lots.map((l) => l.lotId)).toEqual(w.lots.sort((x, y) => lotNumber.get(x)! - lotNumber.get(y)!));
        expect([i.hammerCents, i.premiumCents, i.totalCents]).toEqual([w.hammer, w.premium, w.total]);
        expect(i.totalCents).toBe(i.hammerCents + i.premiumCents);
      }
    });
  }

  it('lines are in lot-number order', () => {
    for (const i of out) expect(i.lots.map((l) => l.lotNumber)).toEqual([...i.lots.map((l) => l.lotNumber)].sort((x, y) => x - y));
  });

  it('an unsold lot appears on no invoice', () => {
    const unsold = lots.filter((r) => r.outcome !== 'SOLD').map((r) => r.lot_id);
    expect(unsold.length).toBeGreaterThan(0);
    expect(out.flatMap((i) => i.lots.map((l) => l.lotId)).filter((id) => unsold.includes(id))).toEqual([]);
  });

  it('a bidder with no wins has no invoice', () => {
    const winners = new Set(lots.filter((r) => r.outcome === 'SOLD').map((r) => r.winner));
    const losers = bidders.map((b) => b.bidder_id).filter((b) => !winners.has(b));
    expect(losers.length).toBeGreaterThan(0);
    expect(out.filter((i) => losers.includes(i.bidderId))).toEqual([]);
  });

  it('no settlements, no invoices', () => expect(invoice([])).toEqual([]));

  it('a non-integer amount is refused', () => {
    const s = settled.find((x) => x.outcome === 'SOLD')!;
    expect(() => invoice([{ ...s, premiumCents: s.premiumCents + 0.5 }])).toThrow(MoneyError);
  });

  it('with no tax input every total is hammer + premium and the tax fields are zero', () => {
    for (const i of out) expect([i.taxBps, i.taxBase, i.taxCents, i.exemptRef, i.totalCents]).toEqual([0, 'HAMMER', 0, null, i.hammerCents + i.premiumCents]);
  });
});

// R-09 / AX-09 (D-78): sales tax is the third rounding site, once per invoice over the configured base; GB-27.
describe('invoice sales tax (GB-27)', () => {
  const line = (lotNumber: number, hammerCents: number, premiumCents: number, winner = 'B1'): SettledLot => ({ auctionId: 'S', lotId: `L${lotNumber}`, lotNumber, outcome: 'SOLD', winner, hammerCents, premiumCents, totalCents: hammerCents + premiumCents });
  const two = [line(1, 10020, 1503), line(2, 33333, 5000)]; // GB-16's lots at 1500 bps: hammer 43,353, premium 6,503
  const tax = (taxBps: number, taxBase: 'HAMMER' | 'HAMMER_PLUS_PREMIUM', exempt: [string, string][] = []) => ({ bySale: new Map([['S', { taxBps, taxBase }]]), exempt: new Map(exempt) });

  it('GB-27a 825 bps on HAMMER → 3,577', () => expect(invoice(two, tax(825, 'HAMMER'))[0]).toMatchObject({ hammerCents: 43353, premiumCents: 6503, taxCents: 3577, totalCents: 53433, taxBps: 825, taxBase: 'HAMMER', exemptRef: null }));
  it('GB-27b 825 bps on HAMMER_PLUS_PREMIUM → 4,113', () => expect(invoice(two, tax(825, 'HAMMER_PLUS_PREMIUM'))[0]).toMatchObject({ taxCents: 4113, totalCents: 53969 }));
  it('GB-27c once per invoice, not per line: two 10,005 lots → 1,651', () => expect(invoice([line(1, 10005, 0), line(2, 10005, 0)], tax(825, 'HAMMER'))[0]!.taxCents).toBe(1651));
  it('GB-27d 0 bps and 10,000 bps', () => {
    expect(invoice(two, tax(0, 'HAMMER'))[0]).toMatchObject({ taxCents: 0, totalCents: 49856 });
    expect(invoice(two, tax(10000, 'HAMMER'))[0]!.taxCents).toBe(43353);
  });
  it('GB-27e an exempt bidder owes no tax and the certificate is on the invoice; another bidder on the same sale is taxed', () => {
    const out = invoice([...two, line(3, 10020, 1503, 'B2')], tax(825, 'HAMMER', [['B1', 'CERT-42']]));
    expect(out.find((i) => i.bidderId === 'B1')).toMatchObject({ taxCents: 0, exemptRef: 'CERT-42', totalCents: 49856 });
    expect(out.find((i) => i.bidderId === 'B2')).toMatchObject({ taxCents: 827, exemptRef: null, totalCents: 12350 }); // 10,020 × 825 / 10,000 = 826.65
  });
  it('a sale missing from the tax input is untaxed; a rate above 10,000 bps or a non-integer rate is refused', () => {
    expect(invoice(two, { bySale: new Map(), exempt: new Map() })[0]!.taxCents).toBe(0);
    expect(() => invoice(two, tax(10001, 'HAMMER'))).toThrow(MoneyError);
    expect(() => invoice(two, tax(8.25, 'HAMMER'))).toThrow(MoneyError);
  });
});
