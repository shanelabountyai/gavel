// Task 2.1: invoicesForAuction over the database replay of every fixture equals, per winner, the sum of that
// winner's SOLD rows in fixtures/expected_lots.csv (summed here, not by the code under test).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { invoicesForAuction } from '@/auction/invoice';
import { prismaTx } from '@/auction/place-bid';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';
import { runDb } from '../../scripts/auction-eval';
import { resetAuthTables } from '../helpers/auth';

const q = prismaTx(db as unknown as Prisma.TransactionClient);
const data: { auctions: { auction_id: string; name: string }[]; bidders: { bidder_id: string; paddle: number }[] } = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8'));
const [head, ...rows] = readFileSync('fixtures/expected_lots.csv', 'utf8').trim().split('\n');
const cols = head!.split(',');
const lots = rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i]!, v])));

describe('invoicesForAuction (task 2.1)', () => {
  beforeAll(async () => {
    await resetAuthTables();
    expect((await runDb()).ok).toBe(true);
  }, 60_000);

  for (const a of data.auctions) {
    it(`${a.auction_id}: totals per winner equal expected_lots.csv`, async () => {
      const want: Record<string, [number, number, number]> = {};
      for (const r of lots) {
        if (r.auction_id !== a.auction_id || r.outcome !== 'SOLD') continue;
        const w = (want[r.winner!] ??= [0, 0, 0]);
        w[0] += Number(r.hammer_cents);
        w[1] += Number(r.premium_cents);
        w[2] += Number(r.total_cents);
      }
      const auction = await db.auction.findFirstOrThrow({ where: { name: a.name } });
      const paddle = new Map((await db.bidder.findMany({ where: { orgId: auction.orgId } })).map((b) => [b.id, b.paddle]));
      const fid = new Map(data.bidders.map((b) => [b.paddle, b.bidder_id]));
      const got = await invoicesForAuction(q, auction.orgId, auction.id);
      expect(Object.fromEntries(got.map((i) => [fid.get(paddle.get(i.bidderId)!)!, [i.hammerCents, i.premiumCents, i.totalCents]]))).toEqual(want);
    });
  }

  it('another org sees no invoices for the auction', async () => {
    const auction = await db.auction.findFirstOrThrow({ where: { name: data.auctions[0]!.name } });
    expect(await invoicesForAuction(q, '00000000-0000-0000-0000-000000000000', auction.id)).toEqual([]);
  });
});
