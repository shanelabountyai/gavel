// R-08 / AX-08 (D-75): invoiceBalance against golden GB-26 (docs/domain-brief.md §9, tools/golden_answers.py), and
// secondChance: the underbidder a defaulted lot is offered to, at D-44's min(price their last accepted row reached, own max).
import { describe, expect, it } from 'vitest';
import { type FoldRow, applyBid, invoiceBalance, openState, secondChance } from '@/auction/engine/engine';
import { MoneyError } from '@/auction/engine/money';
import { loadRules } from '@/auction/load-rules';

const TOT = 11523; // GB-16: 10,020 + 1,503 at 1500 bps
const DUE = 1_000_000;
const ib = (total: number, paid: number, now: number, due: number | null = DUE, defaulted = false) => {
  const b = invoiceBalance(total, paid, now, due, defaulted);
  return [b.status, b.paidCents, b.balanceCents];
};

describe('invoiceBalance (GB-26)', () => {
  it('GB-26a no marks before the due date: UNPAID', () => expect(ib(TOT, 0, DUE - 1)).toEqual(['UNPAID', 0, 11523]));
  it('GB-26b at the due instant UNPAID; one ms later OVERDUE', () => expect([ib(TOT, 0, DUE)[0], ib(TOT, 0, DUE + 1)[0]]).toEqual(['UNPAID', 'OVERDUE']));
  it('GB-26c no due date: never OVERDUE', () => expect(ib(TOT, 0, DUE * 1000, null)[0]).toBe('UNPAID'));
  it('GB-26d partial past due: PARTIAL, balance 6,523', () => expect(ib(TOT, 5000, DUE + 1)).toEqual(['PARTIAL', 5000, 6523]));
  it('GB-26e paid in full: PAID, balance 0', () => expect(ib(TOT, 11523, DUE + 1)).toEqual(['PAID', 11523, 0]));
  it('GB-26f paid, then the total corrected down: CREDIT', () => {
    expect(ib(8000, 11523, DUE + 1)).toEqual(['CREDIT', 11523, -3523]);
    expect(ib(0, 11523, DUE + 1)).toEqual(['CREDIT', 11523, -11523]);
  });
  it('GB-26g defaulted outranks a partial payment', () => expect(ib(TOT, 5000, DUE + 1, DUE, true)).toEqual(['DEFAULTED', 5000, 6523]));
  it('GB-26h a negative or fractional sum is refused', () => {
    expect(() => invoiceBalance(TOT, -1, DUE, DUE)).toThrow(MoneyError);
    expect(() => invoiceBalance(TOT, 1.5, DUE, DUE)).toThrow(MoneyError);
  });
});

// Lot G of the brief: start 10,000, no reserve; the increment at 30,000 is 500 (GB-17).
const { rules } = loadRules();
const G = { startCents: 10000, reserveCents: null, opensAtMs: 0, scheduledEndMs: 3_600_000, softCloseWindowMs: 120_000, maxExtensionMs: 600_000, buyerPremiumBps: 1500, withdrawnAtMs: null };
function ledger(bids: [string, number][]): FoldRow[] {
  let state = openState(G);
  return bids.map(([who, max], i) => {
    const r = applyBid(G, state, who, max, 1000 * (i + 1), rules);
    state = r.state;
    return { seq: i + 1, bidderId: who, maxCents: max, placedAtMs: 1000 * (i + 1), outcome: r.outcome };
  });
}

describe('secondChance: the underbidder and the price (D-44 min(reached, own max))', () => {
  it('A 50,000 leads, B 30,000 is outbid at 30,500, C is rejected: offer B at 30,000', () => {
    const rows = ledger([['A', 50000], ['B', 30000], ['C', 15000]]);
    expect(rows.map((r) => r.outcome)).toEqual(['ACCEPTED_LEAD', 'ACCEPTED_OUTBID', 'REJECTED_BELOW_MINIMUM']);
    const o = secondChance(G, rows, rules, 'A', 1500);
    expect(o && [o.bidderId, o.settlement.hammerCents, o.settlement.premiumCents, o.settlement.winningSeq]).toEqual(['B', 30000, 4500, 2]);
  });
  it('the highest-priced underbidder wins the offer, not the latest row', () => {
    // D 20,000 leads first, then A 50,000 takes it, then B 30,000 is outbid: B (30,000) over D (20,000) although D bid first.
    const rows = ledger([['D', 20000], ['A', 50000], ['B', 30000]]);
    expect(secondChance(G, rows, rules, 'A', 1500)?.bidderId).toBe('B');
    // Excluding B too (B already declined): D, at 10,000: D's only row led alone at the start price, and D-44 sells at the
    // price that row reached, not at D's 20,000 max (A's bid moved the price after D's last row).
    expect(secondChance(G, rows, rules, 'A', 1500, ['B'])).toMatchObject({ bidderId: 'D', settlement: { hammerCents: 10000, winningSeq: 1 } });
  });
  it('a lot with no other accepted bidder has nobody to offer to', () => {
    expect(secondChance(G, ledger([['A', 50000], ['C', 5000]]), rules, 'A', 1500)).toBeNull();
    expect(secondChance(G, [], rules, 'A', 1500)).toBeNull();
  });
  it('an underbidder below the reserve is skipped', () => {
    const R = { ...G, reserveCents: 25000 };
    let state = openState(R);
    const rows: FoldRow[] = [];
    for (const [i, [who, max]] of ([['A', 50000], ['B', 20000]] as [string, number][]).entries()) {
      const r = applyBid(R, state, who, max, 1000 * (i + 1), rules);
      state = r.state;
      rows.push({ seq: i + 1, bidderId: who, maxCents: max, placedAtMs: 1000 * (i + 1), outcome: r.outcome });
    }
    expect(secondChance(R, rows, rules, 'A', 1500)).toBeNull();
  });
});
