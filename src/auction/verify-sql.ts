// auction:verify (brief §8, D-16, D-22, D-23): V1–V9 over one lot, shared by the CLI, the barrier test and the
// load script's epilogue. The ledger checks (V2–V7) are SQL; V1 and V8 re-run the pure engine over the ledger,
// because the fold *is* the engine and a second copy of it in SQL would be a second spec. Runs over the same Tx
// interface as placeBid, so a raw pg client and Prisma read through one implementation.
import { fold, resettle, settle, type CorrectedSettlement, type FoldRow, type Lot, type LotState, type Settlement } from '@/auction/engine/engine';
import { RULES_HASHES_D23, type BidOutcome, type Rules } from '@/auction/engine/rules';
import type { Tx } from '@/auction/place-bid';

export type LoadedLot = {
  readonly id: string;
  readonly orgId: string;
  readonly number: number;
  readonly lot: Lot;
  readonly state: LotState | null; // null: the lot has no LotState row (a V1 failure)
  readonly rows: FoldRow[];
  readonly settlement: (Settlement & { id: string; rulesHash: string; premiumBps: number }) | null; // the first row: settle(fold(ledger))
  readonly corrections: StoredCorrection[]; // the rows superseding it, in chain order (D-44)
  readonly strays: string[]; // ids of rows the chain from the first row never reaches; verify fails on any
};

export type StoredCorrection = CorrectedSettlement & { id: string; rulesHash: string; reason: string; correctedByUserId: string; consignorApprovalRef: string | null };

type LotRow = {
  id: string; orgId: string; number: number; startCents: number; reserveCents: number | null; scheduledEnd: Date;
  opensAt: Date; softCloseWindowSeconds: number; maxExtensionSeconds: number; buyerPremiumBps: number;
  priceCents: number | null; leaderBidderId: string | null; leaderMaxCents: number | null; leaderSeq: number | null;
  bidCount: number | null; acceptedCount: number | null; closesAt: Date | null; extensionCount: number | null;
  withdrawnAt: Date | null; // D-73: the LotWithdrawal row, if any
};
type SettlementRow = {
  id: string; supersedesId: string | null; reason: string | null; correctedByUserId: string | null; consignorApprovalRef: string | null; premiumBps: number;
  outcome: string; winnerBidderId: string | null; winningSeq: number | null; hammerCents: number; premiumCents: number; totalCents: number; closedAt: Date; rulesHash: string;
};

/** The lot with its auction settings, its projection, its ledger (by seq) and its settlement, as the engine sees them. */
export async function loadLot(q: Tx, lotId: string): Promise<LoadedLot> {
  const [l] = await q.query<LotRow>(
    `SELECT l."id", l."orgId", l."number", l."startCents", l."reserveCents", l."scheduledEnd", a."opensAt", a."softCloseWindowSeconds",
            a."maxExtensionSeconds", a."buyerPremiumBps", s."priceCents", s."leaderBidderId", s."leaderMaxCents", s."leaderSeq",
            s."bidCount", s."acceptedCount", s."closesAt", s."extensionCount", w."withdrawnAt"
       FROM "Lot" l JOIN "Auction" a ON a."id" = l."auctionId" LEFT JOIN "LotState" s ON s."lotId" = l."id"
            LEFT JOIN "LotWithdrawal" w ON w."lotId" = l."id"
      WHERE l."id" = $1::uuid`,
    [lotId],
  );
  if (!l) throw new Error(`no lot ${lotId}`);
  const bids = await q.query<{ seq: number; bidderId: string; maxCents: number; placedAt: Date; outcome: string }>(
    `SELECT "seq", "bidderId", "maxCents", "placedAt", "outcome" FROM "Bid" WHERE "lotId" = $1::uuid ORDER BY "seq"`,
    [lotId],
  );
  const sts = await q.query<SettlementRow>(
    `SELECT "id"::text, "supersedesId"::text, "reason", "correctedByUserId"::text, "consignorApprovalRef", "premiumBps", "outcome", "winnerBidderId"::text, "winningSeq",
            "hammerCents", "premiumCents", "totalCents", "closedAt", "rulesHash"
       FROM "Settlement" WHERE "lotId" = $1::uuid`,
    [lotId],
  );
  const asSettlement = (r: SettlementRow) => ({
    outcome: r.outcome as CorrectedSettlement['outcome'], winner: r.winnerBidderId, winningSeq: r.winningSeq, hammerCents: r.hammerCents,
    premiumCents: r.premiumCents, totalCents: r.totalCents, closedAtMs: r.closedAt.getTime(), rulesHash: r.rulesHash, premiumBps: r.premiumBps,
  });
  const st = sts.find((r) => r.supersedesId === null);
  const next = new Map(sts.filter((r) => r.supersedesId !== null).map((r) => [r.supersedesId!, r]));
  const corrections: StoredCorrection[] = [];
  for (let r = st && next.get(st.id); r; r = next.get(r.id)) {
    corrections.push({ ...asSettlement(r), id: r.id, reason: r.reason!, correctedByUserId: r.correctedByUserId!, consignorApprovalRef: r.consignorApprovalRef });
  }
  return {
    id: l.id,
    orgId: l.orgId,
    number: l.number,
    lot: {
      startCents: l.startCents, reserveCents: l.reserveCents, opensAtMs: l.opensAt.getTime(), scheduledEndMs: l.scheduledEnd.getTime(),
      softCloseWindowMs: l.softCloseWindowSeconds * 1000, maxExtensionMs: l.maxExtensionSeconds * 1000, buyerPremiumBps: l.buyerPremiumBps,
      withdrawnAtMs: l.withdrawnAt?.getTime() ?? null,
    },
    state: l.closesAt === null ? null : {
      priceCents: l.priceCents!, leader: l.leaderBidderId, leaderMaxCents: l.leaderMaxCents!, leaderSeq: l.leaderSeq,
      bidCount: l.bidCount!, acceptedCount: l.acceptedCount!, closesAtMs: l.closesAt.getTime(), extensionCount: l.extensionCount!,
    },
    rows: bids.map((b) => ({ seq: b.seq, bidderId: b.bidderId, maxCents: b.maxCents, placedAtMs: b.placedAt.getTime(), outcome: b.outcome as BidOutcome })),
    settlement: st ? { ...asSettlement(st), id: st.id, outcome: st.outcome as Settlement['outcome'] } : null,
    corrections,
    strays: sts.filter((r) => r !== st && !corrections.some((c) => c.id === r.id)).map((r) => r.id),
  };
}

/** Each returns at most one row naming the first violation; no row means the check holds. $1 is the lot id. */
const SQL_CHECKS: Record<'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7', string[]> = {
  V2: [
    `SELECT format('count %s, min seq %s, max seq %s, distinct %s', count(*), min("seq"), max("seq"), count(DISTINCT "seq")) AS detail
       FROM "Bid" WHERE "lotId" = $1::uuid
     HAVING count(*) > 0 AND (min("seq") <> 1 OR max("seq") <> count(*) OR count(DISTINCT "seq") <> count(*))`,
  ],
  V3: [
    `SELECT format('leaderSeq %s, leaderBidderId %s', s."leaderSeq", s."leaderBidderId") AS detail FROM "LotState" s
      WHERE s."lotId" = $1::uuid
        AND ((s."leaderSeq" IS NULL) <> (s."leaderBidderId" IS NULL)
          OR (s."leaderSeq" IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM "Bid" b WHERE b."lotId" = s."lotId" AND b."seq" = s."leaderSeq" AND b."accepted" AND b."bidderId" = s."leaderBidderId")))`,
  ],
  V4: [
    `SELECT format('seq %s (%s): price %s -> %s, previous row ended at %s', "seq", "outcome", pb, pa, prev) AS detail FROM (
       SELECT "seq", "outcome", "accepted", "priceBeforeCents" AS pb, "priceAfterCents" AS pa, lag("priceAfterCents") OVER (ORDER BY "seq") AS prev
         FROM "Bid" WHERE "lotId" = $1::uuid) x
      WHERE pa < pb
         OR (prev IS NOT NULL AND pb <> prev)
         OR ((NOT "accepted" OR "outcome" = 'ACCEPTED_RAISE') AND pa <> pb)
         OR ("accepted" AND "outcome" <> 'ACCEPTED_RAISE' AND pa <= pb)
      ORDER BY "seq" LIMIT 1`,
  ],
  V5: [
    `SELECT format('seq %s: close %s -> %s, previous row ended at %s, hard close %s, extended %s', "seq", cb, ca, prev, hard, "extended") AS detail FROM (
       SELECT b."seq", b."extended", b."closesAtBefore" AS cb, b."closesAtAfter" AS ca, lag(b."closesAtAfter") OVER (ORDER BY b."seq") AS prev,
              l."scheduledEnd" + a."maxExtensionSeconds" * interval '1 second' AS hard
         FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" JOIN "Auction" a ON a."id" = l."auctionId" WHERE b."lotId" = $1::uuid) x
      WHERE ca < cb OR (prev IS NOT NULL AND cb <> prev) OR ca > hard OR "extended" <> (ca <> cb)
      ORDER BY "seq" LIMIT 1`,
    `SELECT format('extensionCount %s, extended rows %s', s."extensionCount", (SELECT count(*) FROM "Bid" b WHERE b."lotId" = s."lotId" AND b."extended")) AS detail
       FROM "LotState" s WHERE s."lotId" = $1::uuid
        AND s."extensionCount" <> (SELECT count(*) FROM "Bid" b WHERE b."lotId" = s."lotId" AND b."extended")`,
  ],
  V6: [
    // D-73: accepted rows precede the withdrawal; REJECTED_LOT_WITHDRAWN rows need one and are at or after it.
    `SELECT format('seq %s (%s): placedAt %s, previous %s, opensAt %s, closesAtBefore %s, withdrawnAt %s', "seq", "outcome", t, prev, opens, cb, wd) AS detail FROM (
       SELECT b."seq", b."outcome", b."accepted", b."placedAt" AS t, lag(b."placedAt") OVER (ORDER BY b."seq") AS prev, a."opensAt" AS opens, b."closesAtBefore" AS cb, w."withdrawnAt" AS wd
         FROM "Bid" b JOIN "Lot" l ON l."id" = b."lotId" JOIN "Auction" a ON a."id" = l."auctionId" LEFT JOIN "LotWithdrawal" w ON w."lotId" = b."lotId" WHERE b."lotId" = $1::uuid) x
      WHERE (prev IS NOT NULL AND t < prev)
         OR ("accepted" AND NOT (opens <= t AND t < cb))
         OR ("accepted" AND wd IS NOT NULL AND t >= wd)
         OR ("outcome" = 'REJECTED_LOT_CLOSED' AND t < cb)
         OR ("outcome" = 'REJECTED_LOT_WITHDRAWN' AND (wd IS NULL OR t < wd))
      ORDER BY "seq" LIMIT 1`,
  ],
  V7: [
    `SELECT format('bidder %s key %s: %s rows', "bidderId", "idempotencyKey", count(*)) AS detail
       FROM "Bid" WHERE "lotId" = $1::uuid GROUP BY "bidderId", "idempotencyKey" HAVING count(*) > 1 LIMIT 1`,
  ],
};

const STATE_COLS = ['priceCents', 'leader', 'leaderMaxCents', 'leaderSeq', 'bidCount', 'acceptedCount', 'closesAtMs', 'extensionCount'] as const;
const SETTLEMENT_COLS = ['outcome', 'winner', 'winningSeq', 'hammerCents', 'premiumCents', 'totalCents', 'closedAtMs'] as const;

export type Failure = { readonly lotId: string; readonly lotNumber: number; readonly check: string; readonly detail: string };

/** V1–V9 in order over one lot; the first failure, or null. */
export async function verifyLot(q: Tx, lotId: string, rules: Rules): Promise<Failure | null> {
  const l = await loadLot(q, lotId);
  const fail = (check: string, detail: string): Failure => ({ lotId, lotNumber: l.number, check, detail });
  const sql = async (check: keyof typeof SQL_CHECKS) => {
    for (const s of SQL_CHECKS[check]) {
      const [row] = await q.query<{ detail: string }>(s, [lotId]);
      if (row) return fail(check, row.detail);
    }
    return null;
  };

  // V2 before V1: a seq gap is what makes the fold refuse, and it should be named as the gap.
  const v2 = await sql('V2');
  if (v2) return v2;
  let folded: LotState;
  try {
    folded = fold(l.lot, l.rows, rules);
  } catch (e) {
    return fail('V1', `fold refused the ledger: ${(e as Error).message}`);
  }
  if (!l.state) return fail('V1', 'no LotState row');
  const col = STATE_COLS.find((c) => l.state![c] !== folded[c]);
  if (col) return fail('V1', `LotState.${col} is ${l.state[col]}, fold(ledger) says ${folded[col]}`);
  for (const check of ['V3', 'V4', 'V5', 'V6', 'V7'] as const) {
    const f = await sql(check);
    if (f) return f;
  }

  if (l.strays.length) return fail('V8', `Settlement ${l.strays[0]} is not on the chain from the lot's first settlement`);
  if (l.settlement) {
    // V8 (closedAt = closesAt is the closedAtMs field). A late REJECTED_LOT_CLOSED row after settlement is allowed (it moves no field); an accepted row after the
    // close is V6's, and any row that changes the outcome shows up here as a field that differs.
    const expected = settle(l.lot, folded, l.settlement.closedAtMs);
    if (!expected) return fail('V8', `a Settlement exists but the lot is not closed at its closedAt ${l.settlement.closedAtMs} (closesAt ${folded.closesAtMs})`);
    const c = SETTLEMENT_COLS.find((k) => l.settlement![k] !== expected[k]);
    if (c) return fail('V8', `Settlement.${c} is ${l.settlement[c]}, settle(fold(ledger)) says ${expected[c]}`);
    if (l.settlement.premiumBps !== l.lot.buyerPremiumBps) return fail('V8', `Settlement.premiumBps is ${l.settlement.premiumBps}, the auction says ${l.lot.buyerPremiumBps}`);
    // D-44: every correction is recomputable from the ledger and its own winner and rate. The schema already
    // refuses a fork (unique supersedesId), a predecessor in another lot (composite FK) and a missing reason (CHECK).
    for (const r of l.corrections) {
      const want = resettle(l.lot, l.rows, rules, { winner: r.winner, premiumBps: r.premiumBps, consignorApprovalRef: r.consignorApprovalRef });
      if ('refused' in want) return fail('V8', `correction ${r.id}: resettle refuses it (${want.refused})`);
      const k = ([...SETTLEMENT_COLS, 'premiumBps'] as const).find((x) => r[x] !== want[x]);
      if (k) return fail('V8', `correction ${r.id}: ${k} is ${r[k]}, resettle(ledger) says ${want[k]}`);
    }
    for (const r of [l.settlement, ...l.corrections]) {
      if (!(RULES_HASHES_D23 as readonly string[]).includes(r.rulesHash)) return fail('V9', `rulesHash ${r.rulesHash}, D-23 lists ${RULES_HASHES_D23.join(', ')}`);
    }
  }
  return null;
}

/** Every lot, ordered by id; stops at the first failure. */
export async function verifyAll(q: Tx, rules: Rules): Promise<{ lots: number; settled: number; failure: Failure | null }> {
  const lots = await q.query<{ id: string; settled: boolean }>(
    `SELECT l."id", EXISTS (SELECT 1 FROM "Settlement" s WHERE s."lotId" = l."id") AS settled FROM "Lot" l ORDER BY l."id"`,
  );
  for (const { id } of lots) {
    const failure = await verifyLot(q, id, rules);
    if (failure) return { lots: lots.length, settled: lots.filter((x) => x.settled).length, failure };
  }
  return { lots: lots.length, settled: lots.filter((x) => x.settled).length, failure: null };
}
