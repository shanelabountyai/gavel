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
});
