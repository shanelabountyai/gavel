// R-15 (D-86): the fixtures' recap equals brief §10, and one lot's ledger CSV equals its expected_bids.csv rows.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/o/[org]/auctions/[id]/ledger.csv/route';
import { recap, recapForAuction } from '@/auction/recap';
import { db } from '@/core/db';
import { runDb } from '../../scripts/auction-eval';
import { resetAuthTables, signInAs } from '../helpers/auth';
import { addMember } from '../helpers/org';

const [head, ...lines] = readFileSync('fixtures/expected_bids.csv', 'utf8').trim().split('\n');
const cols = head!.split(',');
const want = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i]!, v]))).filter((r) => r.lot_id === 'L006' && r.row_written === 'true');
const data = JSON.parse(readFileSync('fixtures/auctions.json', 'utf8')) as { auctions: { name: string; lots: { lot_id: string; title: string }[] }[]; bidders: { bidder_id: string; paddle: number }[] };
const paddle = (fid: string) => String(data.bidders.find((b) => b.bidder_id === fid)!.paddle);

describe('sale recap and ledger CSV on the frozen fixtures (brief §10)', () => {
  beforeAll(async () => {
    await resetAuthTables();
    expect((await runDb()).ok).toBe(true);
  }, 120_000);

  it('the three sales sum to brief §10: 39 offered, 31 sold, 3 + 2 + 3 unsold, hammer 10,730,200, premium 1,248,403, 8 lots extended, 46 extensions', async () => {
    const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
    const sales = await db.auction.findMany({ where: { orgId: org.id }, orderBy: { opensAt: 'asc' } });
    expect(sales).toHaveLength(3);
    const per = await Promise.all(sales.map((a) => recapForAuction(org.id, a.id)));
    const all = recap(per.flatMap((p) => p.lots));
    expect(all).toEqual({ offered: 39, settled: 39, sold: 31, unsold: [['UNSOLD_NO_BIDS', 3], ['UNSOLD_RESERVE_NOT_MET', 2], ['UNSOLD_WITHDRAWN', 3]], unsettled: 0, sellThroughBps: 7949, hammerCents: 10_730_200, premiumCents: 1_248_403, totalCents: 11_978_603, lotsExtended: 8, extensions: 46 });
    for (const p of per) expect(p.recap.offered).toBe(13); // 12 kickoff lots + 1 withdrawn per sale (D-73)
    expect(per.map((p) => p.consignors)).toEqual([[], [], []]); // the fixtures carry no consignor contract
  });

  it("L006's CSV has its 7 rows with the D-45 columns, cents as integers, paddles for bidders, nothing a bidder could not see on the history page", async () => {
    const org = await db.org.findUniqueOrThrow({ where: { slug: 'gavel-fixtures' } });
    const lot = await db.lot.findFirstOrThrow({ where: { orgId: org.id, title: data.auctions.flatMap((a) => a.lots).find((l) => l.lot_id === 'L006')!.title }, include: { auction: true } });
    const staff = await addMember(org.id, 'admin', 'staff@example.test');
    await signInAs(staff.id, { mfa: true });
    const res = await GET(new Request(`http://x/o/gavel-fixtures/auctions/${lot.auctionId}/ledger.csv?lot=${lot.id}`), { params: Promise.resolve({ org: 'gavel-fixtures', id: lot.auctionId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const rows = (await res.text()).trim().split('\r\n');
    expect(rows[0]).toBe('lot_number,lot_title,seq,bidder_paddle,max_cents,outcome,accepted,price_before_cents,price_after_cents,leader_before_paddle,leader_after_paddle,closes_before,closes_after,extended,placed_at');
    expect(rows).toHaveLength(1 + want.length);
    expect(want).toHaveLength(7);
    const cells = (r: string) => r.split(',');
    for (const [i, w] of want.entries()) {
      const c = cells(rows[i + 1]!);
      expect([c[0], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[13], c[14]]).toEqual([String(lot.number), w.seq, paddle(w.bidder_id!), w.max_cents, w.outcome, w.accepted, w.price_before_cents, w.price_after_cents, w.extended, new Date(Number(w.placed_at_ms)).toISOString()]);
    }
    expect(rows.join('\n')).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/); // no email, no uuid
    // the whole sale: every lot's rows, lot order then seq; another sale's id is a 404
    const sale = await (await GET(new Request('http://x/'), { params: Promise.resolve({ org: 'gavel-fixtures', id: lot.auctionId }) })).text();
    expect(sale.trim().split('\r\n').length - 1).toBe(await db.bid.count({ where: { lot: { auctionId: lot.auctionId } } }));
  });
});
