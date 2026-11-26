// R-15 (D-86, AX-15): the sale recap and the ledger CSV, both derived on read. Nothing here is stored, so auction:verify
// gains no check: V8 already proves every settlement the recap sums, and the CSV is the Bid table in a different shape.
import { statementsForAuction } from '@/auction/consignor';
import { roundHalfUp } from '@/auction/engine/money';
import { currentSettlements } from '@/auction/invoice';
import { prismaTx } from '@/auction/place-bid';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

export type RecapLot = { readonly outcome: string | null; readonly hammerCents: number; readonly premiumCents: number; readonly totalCents: number; readonly extensionCount: number };
export type Recap = {
  readonly offered: number; // every lot in the sale, withdrawn ones included: they went in the catalogue
  readonly settled: number;
  readonly sold: number;
  readonly unsold: ReadonlyArray<readonly [outcome: string, count: number]>; // by outcome, outcome order
  readonly unsettled: number; // open, or closed and not yet settled
  readonly sellThroughBps: number; // sold / offered, in whole basis points, rounded half up (not money; the project's one rounding)
  readonly hammerCents: number;
  readonly premiumCents: number;
  readonly totalCents: number;
  readonly lotsExtended: number;
  readonly extensions: number;
};

/** Pure: the brief §10 numbers for any set of lots. Sums only; the one division is the sell-through. */
export function recap(lots: readonly RecapLot[]): Recap {
  const settledLots = lots.filter((l) => l.outcome !== null);
  const sold = settledLots.filter((l) => l.outcome === 'SOLD');
  const unsold = new Map<string, number>();
  for (const l of settledLots) if (l.outcome !== 'SOLD') unsold.set(l.outcome!, (unsold.get(l.outcome!) ?? 0) + 1);
  const sum = (k: 'hammerCents' | 'premiumCents' | 'totalCents') => sold.reduce((a, l) => a + l[k], 0);
  return {
    offered: lots.length,
    settled: settledLots.length,
    sold: sold.length,
    unsold: [...unsold].sort(([a], [b]) => a.localeCompare(b)),
    unsettled: lots.length - settledLots.length,
    sellThroughBps: lots.length === 0 ? 0 : roundHalfUp(BigInt(sold.length) * 10000n, BigInt(lots.length)),
    hammerCents: sum('hammerCents'),
    premiumCents: sum('premiumCents'),
    totalCents: sum('totalCents'),
    lotsExtended: lots.filter((l) => l.extensionCount > 0).length,
    extensions: lots.reduce((a, l) => a + l.extensionCount, 0),
  };
}

export type ConsignorTotal = { readonly code: string; readonly name: string; readonly lots: number; readonly hammerCents: number; readonly commissionCents: number; readonly feeCents: number; readonly netCents: number };

/** Staff: one sale's recap, its lots in number order with their current outcome, and per-consignor totals (D-74) where a contract exists. */
export async function recapForAuction(orgId: string, auctionId: string) {
  const [rows, tips, statements] = await Promise.all([
    db.lot.findMany({ where: { orgId, auctionId }, orderBy: { number: 'asc' }, select: { id: true, number: true, title: true, state: { select: { extensionCount: true, closesAt: true } } } }),
    currentSettlements(orgId, auctionId),
    statementsForAuction(prismaTx(db as unknown as Prisma.TransactionClient), orgId, auctionId),
  ]);
  const lots = rows.map((r) => {
    const s = tips.get(r.id);
    return { lotId: r.id, number: r.number, title: r.title, closesAt: r.state?.closesAt ?? null, outcome: s?.outcome ?? null, hammerCents: s?.hammerCents ?? 0, premiumCents: s?.premiumCents ?? 0, totalCents: s?.totalCents ?? 0, extensionCount: r.state?.extensionCount ?? 0 };
  });
  const consignors: ConsignorTotal[] = statements.flatMap((v) => v.statement ? [{ code: v.code, name: v.name, lots: v.statement.lines.length, hammerCents: v.statement.hammerCents, commissionCents: v.statement.commissionCents, feeCents: v.statement.feeCents, netCents: v.statement.netCents }] : []);
  return { recap: recap(lots), lots, consignors };
}

// The ledger CSV: the D-45 history columns, one row per Bid row, cents as integers and times as ISO UTC (the record, not
// a display). Paddles stand for bidders, as on the history page; no user id or email leaves the house in this file.
export const LEDGER_COLUMNS = ['lot_number', 'lot_title', 'seq', 'bidder_paddle', 'max_cents', 'outcome', 'accepted', 'price_before_cents', 'price_after_cents', 'leader_before_paddle', 'leader_after_paddle', 'closes_before', 'closes_after', 'extended', 'placed_at'] as const;
export type LedgerCsvRow = Record<(typeof LEDGER_COLUMNS)[number], string | number | boolean | null>;

const cell = (v: string | number | boolean | null) => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Pure: RFC 4180 lines, CRLF, header first. */
export const ledgerCsv = (rows: readonly LedgerCsvRow[]): string => [LEDGER_COLUMNS.join(','), ...rows.map((r) => LEDGER_COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';

/** Staff: every Bid row of a sale, or of one of its lots, in lot then seq order. Read-only, no lock. */
export async function ledgerRows(orgId: string, auctionId: string, lotId?: string): Promise<LedgerCsvRow[]> {
  const bids = await db.bid.findMany({ where: { orgId, lot: { auctionId, ...(lotId ? { id: lotId } : {}) } }, orderBy: [{ lot: { number: 'asc' } }, { seq: 'asc' }], include: { lot: { select: { number: true, title: true } } } });
  const ids = [...new Set(bids.flatMap((b) => [b.bidderId, b.leaderBeforeId, b.leaderAfterId]).filter((x): x is string => !!x))];
  const paddle = new Map((await db.bidder.findMany({ where: { id: { in: ids }, orgId }, select: { id: true, paddle: true } })).map((b) => [b.id, b.paddle]));
  const who = (id: string | null) => (id ? (paddle.get(id) ?? null) : null);
  return bids.map((b) => ({
    lot_number: b.lot.number, lot_title: b.lot.title, seq: b.seq, bidder_paddle: who(b.bidderId), max_cents: b.maxCents, outcome: b.outcome, accepted: b.accepted,
    price_before_cents: b.priceBeforeCents, price_after_cents: b.priceAfterCents, leader_before_paddle: who(b.leaderBeforeId), leader_after_paddle: who(b.leaderAfterId),
    closes_before: b.closesAtBefore.toISOString(), closes_after: b.closesAtAfter.toISOString(), extended: b.extended, placed_at: b.placedAt.toISOString(),
  }));
}
