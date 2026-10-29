// D-74 (AX-07, R-07): consignors, their per-sale contracts, and the consignor statement. The statement is derived on
// read from each consigned lot's current settlement and the pair's current contract (nothing stored, as invoices,
// D-42 Q1), so a settlement correction or a superseding contract moves it with no regeneration step. Nothing here is
// the bid path: no lock, no LotState, no ledger.
import { audit } from '@/core/audit';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import { Refused } from '@/core/errors';
import { type ConsignedLot, type ConsignorStatement, type Contract, consignorStatement } from '@/auction/engine/engine';
import type { Tx } from '@/auction/place-bid';

type Actor = { readonly orgId: string; readonly userId: string };
export type ContractInput = Contract & { readonly consignorId: string; readonly auctionId: string };

/** Staff add a consignor. `code` is the house's short reference, unique per house. */
export async function createConsignor(actor: Actor, input: { name: string; code: string }) {
  const name = input.name.trim();
  const code = input.code.trim();
  if (!name) throw new Refused('Give the consignor a name.');
  if (!code) throw new Refused('Give the consignor a code.');
  if (await db.consignor.findUnique({ where: { orgId_code: { orgId: actor.orgId, code } } })) throw new Refused(`Code ${code} is already in use.`);
  return db.$transaction(async (tx) => {
    const row = await tx.consignor.create({ data: { orgId: actor.orgId, name, code } });
    await audit(actor, 'consignor.created', { targetType: 'consignor', targetId: row.id, data: { code } }, tx);
    return row;
  });
}

/** The current contract for each (consignor, sale) pair of a sale: the row no other row supersedes. */
export const currentContracts = (orgId: string, auctionId: string) =>
  db.consignmentContract.findMany({ where: { orgId, auctionId, supersededBy: null }, include: { consignor: { select: { name: true, code: true } } }, orderBy: { consignor: { code: 'asc' } } });

/** Staff set or change a pair's terms: an insert-only row that supersedes the current one. The CHECKs are the guard. */
export async function setContract(actor: Actor, input: ContractInput) {
  if (!Number.isSafeInteger(input.commissionBps) || input.commissionBps < 0 || input.commissionBps > 10000) throw new Refused('Commission is whole basis points from 0 to 10000.');
  if (!Number.isSafeInteger(input.lotFeeCents) || input.lotFeeCents < 0 || !Number.isSafeInteger(input.unsoldFeeCents) || input.unsoldFeeCents < 0) throw new Refused('Fees are whole cents, zero or more.');
  const [consignor, auction] = await Promise.all([
    db.consignor.findFirst({ where: { id: input.consignorId, orgId: actor.orgId }, select: { id: true } }),
    db.auction.findFirst({ where: { id: input.auctionId, orgId: actor.orgId }, select: { id: true } }),
  ]);
  if (!consignor || !auction) throw new Refused('No such consignor or sale in this house.');
  return db.$transaction(async (tx) => {
    const tip = await tx.consignmentContract.findFirst({ where: { consignorId: input.consignorId, auctionId: input.auctionId, supersededBy: null }, select: { id: true } });
    // ponytail: two staff saving at once both name the same tip; the unique index on supersedesId refuses the loser with a plain error. Not the bid path, no retry.
    const row = await tx.consignmentContract.create({
      data: { orgId: actor.orgId, consignorId: input.consignorId, auctionId: input.auctionId, supersedesId: tip?.id ?? null, commissionBps: input.commissionBps, lotFeeCents: input.lotFeeCents, unsoldFeeCents: input.unsoldFeeCents, byUserId: actor.userId, createdAt: now() },
    });
    await audit(actor, 'consignor.contract_set', { targetType: 'auction', targetId: input.auctionId, data: { consignorId: input.consignorId, contractId: row.id, supersedes: tip?.id ?? null, commissionBps: input.commissionBps, lotFeeCents: input.lotFeeCents, unsoldFeeCents: input.unsoldFeeCents } }, tx);
    return row;
  });
}

export type ConsignorStatementView = {
  readonly consignorId: string;
  readonly name: string;
  readonly code: string;
  readonly contract: (Contract & { readonly id: string; readonly createdAt: Date }) | null;
  readonly statement: ConsignorStatement | null; // null without a contract: the lots are listed, the money is not
  readonly lots: readonly ConsignedLot[]; // the settled lots the statement is drawn from
  readonly unsettled: number; // consigned lots with no settlement yet; they join the statement when they settle
};

/** Staff: one statement per consignor with lots in a sale, from current settlements and current contracts. */
export async function statementsForAuction(q: Tx, orgId: string, auctionId: string): Promise<ConsignorStatementView[]> {
  const [settled, pending, contracts] = await Promise.all([
    q.query<ConsignedLot & { consignorId: string }>(
      `SELECT l."consignorId"::text AS "consignorId", l."id"::text AS "lotId", l."number" AS "lotNumber", s."outcome", s."hammerCents"
         FROM "Settlement" s JOIN "Lot" l ON l."id" = s."lotId"
        WHERE l."auctionId" = $1::uuid AND l."orgId" = $2::uuid AND l."consignorId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Settlement" n WHERE n."supersedesId" = s."id")`,
      [auctionId, orgId],
    ),
    db.lot.groupBy({ by: ['consignorId'], where: { auctionId, orgId, consignorId: { not: null }, settlements: { none: {} } }, _count: { _all: true } }),
    currentContracts(orgId, auctionId),
  ]);
  const ids = [...new Set([...settled.map((l) => l.consignorId), ...pending.map((p) => p.consignorId!), ...contracts.map((c) => c.consignorId)])];
  const consignors = await db.consignor.findMany({ where: { id: { in: ids }, orgId }, orderBy: { code: 'asc' } });
  const contract = new Map(contracts.map((c) => [c.consignorId, c]));
  const unsettled = new Map(pending.map((p) => [p.consignorId!, p._count._all]));
  return consignors.map((c) => {
    const k = contract.get(c.id);
    const lots = settled.filter((l) => l.consignorId === c.id).map((l): ConsignedLot => ({ lotId: l.lotId, lotNumber: l.lotNumber, outcome: l.outcome, hammerCents: l.hammerCents }));
    const terms = k ? { id: k.id, createdAt: k.createdAt, commissionBps: k.commissionBps, lotFeeCents: k.lotFeeCents, unsoldFeeCents: k.unsoldFeeCents } : null;
    return { consignorId: c.id, name: c.name, code: c.code, contract: terms, statement: terms ? consignorStatement(lots, terms) : null, lots, unsettled: unsettled.get(c.id) ?? 0 };
  });
}
