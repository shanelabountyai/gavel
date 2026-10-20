// V1 and V8 on the oracle's own ledger: fold() reads fixtures/expected_bids.csv (the rows tools/reference_replay.py
// wrote, not rows the TypeScript replay produced) and must land on every state column of fixtures/expected_lots.csv;
// settle() at the lot's own close must land on its settlement columns. Then resettle() (D-44) over the same ledgers:
// back to the fold's leader at the auction's rate is settle() exactly, and a correction to any other accepted bidder
// never charges more than the original hammer nor more than that bidder's own max. Expected values come only from
// the frozen CSVs; nothing here regenerates or edits them (CLAUDE.md rule 10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type FoldRow, type Lot, fold, resettle, settle } from '@/auction/engine/engine';
import type { BidOutcome } from '@/auction/engine/rules';
import { loadRules } from '@/auction/load-rules';

const { rules } = loadRules();

type Csv = Record<string, string>;
const csv = (path: string): Csv[] => {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = head!.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i]!, v])));
};
const nullable = (v: string | undefined) => (v === undefined || v === '' ? null : v);
const intOrNull = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));

type AuctionsJson = {
  auctions: {
    soft_close_window_seconds: number;
    max_extension_seconds: number;
    buyer_premium_bps: number;
    lots: { lot_id: string; start_cents: number; reserve_cents: number | null; opens_at_ms: number; scheduled_end_ms: number }[];
  }[];
};
const data: AuctionsJson = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8'));
const lotDefs = new Map<string, Lot>(
  data.auctions.flatMap((a) =>
    a.lots.map((l) => [l.lot_id, {
      startCents: l.start_cents, reserveCents: l.reserve_cents, opensAtMs: l.opens_at_ms, scheduledEndMs: l.scheduled_end_ms,
      softCloseWindowMs: a.soft_close_window_seconds * 1000, maxExtensionMs: a.max_extension_seconds * 1000, buyerPremiumBps: a.buyer_premium_bps,
    }] as const),
  ),
);

const expectedLots = csv('fixtures/expected_lots.csv');
const ledger = new Map<string, FoldRow[]>();
for (const r of csv('fixtures/expected_bids.csv')) {
  if (r.row_written !== 'true') continue; // REPLAY and IDEMPOTENCY_MISMATCH write no row (D-17)
  (ledger.get(r.lot_id!) ?? ledger.set(r.lot_id!, []).get(r.lot_id!)!).push({
    seq: Number(r.seq), bidderId: r.bidder_id!, maxCents: Number(r.max_cents), placedAtMs: Number(r.placed_at_ms), outcome: r.outcome as BidOutcome,
  });
}

describe('fold and settle over the oracle ledger (V1, V8 on fixtures/expected_bids.csv)', () => {
  it('the fixtures are what this file assumes: 36 lots, every lot defined, every ledger row on a known lot', () => {
    expect(expectedLots).toHaveLength(36);
    for (const e of expectedLots) expect(lotDefs.has(e.lot_id!)).toBe(true);
    for (const id of ledger.keys()) expect(lotDefs.has(id)).toBe(true);
  });

  for (const e of expectedLots) {
    it(`${e.lot_id} (${e.kind}): fold(ledger) equals the state columns, settle at closesAt equals the settlement columns`, () => {
      const lot = lotDefs.get(e.lot_id!)!;
      const rows = ledger.get(e.lot_id!) ?? [];
      // Fold sorts by seq itself; hand it the rows reversed so the order cannot come from the file.
      const s = fold(lot, [...rows].reverse(), rules);
      expect({
        priceCents: s.priceCents, leader: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq,
        bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAtMs: s.closesAtMs, extensionCount: s.extensionCount,
      }).toEqual({
        priceCents: Number(e.price_cents), leader: nullable(e.leader), leaderMaxCents: Number(e.leader_max_cents), leaderSeq: intOrNull(e.leader_seq),
        bidCount: Number(e.bid_count), acceptedCount: Number(e.accepted_count), closesAtMs: Number(e.closes_at_ms), extensionCount: Number(e.extension_count),
      });
      expect(s.closesAtMs - lot.scheduledEndMs).toBe(Number(e.extension_total_ms));

      expect(settle(lot, s, s.closesAtMs - 1)).toBeNull(); // still OPEN one ms before its close (D-21)
      const st = settle(lot, s, s.closesAtMs)!;
      expect({ outcome: st.outcome, winner: st.winner, winningSeq: st.winningSeq, hammerCents: st.hammerCents, premiumCents: st.premiumCents, totalCents: st.totalCents, closedAtMs: st.closedAtMs })
        .toEqual({
          outcome: e.outcome, winner: nullable(e.winner), winningSeq: intOrNull(e.winning_seq), hammerCents: Number(e.hammer_cents),
          premiumCents: Number(e.premium_cents), totalCents: Number(e.total_cents), closedAtMs: Number(e.closes_at_ms),
        });
    });
  }

  it('fold refuses each lot\'s ledger with one row dropped from the middle, naming the gap', () => {
    for (const [id, rows] of ledger) {
      if (rows.length < 3) continue;
      const gapped = rows.filter((r) => r.seq !== 2);
      expect(() => fold(lotDefs.get(id)!, gapped, rules), id).toThrow(/^seq gap at 3$/);
    }
  });
});

describe('resettle over the oracle ledger (D-44)', () => {
  const sold = expectedLots.filter((e) => e.outcome === 'SOLD');

  it('the fixtures have SOLD lots with underbidders to correct to', () => {
    expect(sold.length).toBeGreaterThan(0);
    expect(sold.some((e) => new Set((ledger.get(e.lot_id!) ?? []).filter((r) => r.outcome.startsWith('ACCEPTED_')).map((r) => r.bidderId)).size > 1)).toBe(true);
  });

  for (const e of sold) {
    it(`${e.lot_id} (${e.kind}): to the leader at the auction's rate is the original; to any other accepted bidder never exceeds it`, () => {
      const lot = lotDefs.get(e.lot_id!)!;
      const rows = ledger.get(e.lot_id!)!;
      const same = resettle(lot, rows, rules, { winner: e.winner!, premiumBps: lot.buyerPremiumBps });
      expect(same).toMatchObject({
        outcome: 'SOLD', winner: e.winner, winningSeq: Number(e.winning_seq), hammerCents: Number(e.hammer_cents),
        premiumCents: Number(e.premium_cents), totalCents: Number(e.total_cents), premiumBps: lot.buyerPremiumBps,
      });

      const withdrawn = resettle(lot, rows, rules, { winner: null, premiumBps: lot.buyerPremiumBps });
      expect(withdrawn).toMatchObject({ outcome: 'UNSOLD_BY_CORRECTION', winner: null, winningSeq: null, hammerCents: 0, premiumCents: 0, totalCents: 0 });

      const others = new Set(rows.filter((r) => r.outcome.startsWith('ACCEPTED_') && r.bidderId !== e.winner).map((r) => r.bidderId));
      for (const b of others) {
        const r = resettle(lot, rows, rules, { winner: b, premiumBps: lot.buyerPremiumBps });
        const last = rows.filter((x) => x.bidderId === b && x.outcome.startsWith('ACCEPTED_')).sort((x, y) => y.seq - x.seq)[0]!;
        if ('refused' in r) {
          // Only the reserve can refuse an accepted bidder, and only when their own max is under it.
          expect(r.refused, b).toBe('RESERVE_NOT_MET');
          expect(lot.reserveCents, b).not.toBeNull();
          expect(last.maxCents, b).toBeLessThan(lot.reserveCents!);
          continue;
        }
        expect(r.winner).toBe(b);
        expect(r.winningSeq, b).toBe(last.seq);
        expect(r.hammerCents, b).toBeLessThanOrEqual(last.maxCents);
        expect(r.hammerCents, b).toBeLessThanOrEqual(Number(e.hammer_cents));
        expect(r.hammerCents, b).toBeGreaterThanOrEqual(lot.reserveCents ?? lot.startCents);
        expect(r.totalCents, b).toBe(r.hammerCents + r.premiumCents);
      }
    });
  }

  it('a bidder whose every row was rejected is NOT_AN_ACCEPTED_BIDDER on every SOLD lot that has one', () => {
    let seen = 0;
    for (const e of sold) {
      const rows = ledger.get(e.lot_id!)!;
      const accepted = new Set(rows.filter((r) => r.outcome.startsWith('ACCEPTED_')).map((r) => r.bidderId));
      for (const b of new Set(rows.map((r) => r.bidderId))) {
        if (accepted.has(b)) continue;
        seen++;
        expect(resettle(lotDefs.get(e.lot_id!)!, rows, rules, { winner: b, premiumBps: 1500 }), `${e.lot_id} ${b}`).toEqual({ refused: 'NOT_AN_ACCEPTED_BIDDER' });
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
