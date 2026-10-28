import { BidError, type BidErrorCode } from '@/auction/errors';
import { placeBid } from '@/auction/place-bid';
import { requireUser } from '@/core/authz/guards';
import { db } from '@/core/db';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };
// O-8: BID_TIMED_OUT is a 503 with Retry-After, resend with the same key. Everything else is final.
const STATUS: Record<BidErrorCode, number> = { MISSING_KEY: 400, INVALID_AMOUNT: 400, LOT_NOT_FOUND: 404, BIDDER_NOT_ACTIVE: 403, TERMS_NOT_ACCEPTED: 403, IDEMPOTENCY_MISMATCH: 409, BID_TIMED_OUT: 503 };

// Task 3.7: the bid path over HTTP (the 3.5 form goes through the server action; this is what load:bids --http drives).
// Body { maxCents, idempotencyKey }; the key is the client's (D-17). placeBid does the boundary checks: a wrong type
// reaches it as NaN or '' and is refused with nothing written. The body is the bidder-safe BidResponse, minus seq.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser();
  const lotId = (await ctx.params).id;
  const body: unknown = await req.json().catch(() => null);
  const field = (k: string) => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[k] : undefined);
  const lot = UUID.test(lotId) ? await db.lot.findUnique({ where: { id: lotId }, select: { orgId: true } }) : null;
  const member = lot && (await db.membership.findUnique({ where: { orgId_userId: { orgId: lot.orgId, userId: s.userId } }, select: { userId: true } }));
  if (!lot || !member) return Response.json({ error: 'LOT_NOT_FOUND' }, { status: 404, headers: NO_STORE }); // INV-02: another house's lot is a 404
  const bidder = await db.bidder.findUnique({ where: { orgId_userId: { orgId: lot.orgId, userId: s.userId } }, select: { id: true } });
  if (!bidder) return Response.json({ error: 'BIDDER_NOT_ACTIVE', message: 'Register as a bidder first.' }, { status: 403, headers: NO_STORE });
  const maxCents = field('maxCents');
  const idempotencyKey = field('idempotencyKey');
  try {
    const r = await placeBid({ orgId: lot.orgId, lotId, bidderId: bidder.id, maxCents: typeof maxCents === 'number' ? maxCents : NaN, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : '' });
    return Response.json({ outcome: r.outcome, accepted: r.accepted, priceCents: r.priceCents, minNextCents: r.minNextCents, youLead: r.youLead, closesAt: r.closesAt.toISOString() }, { headers: NO_STORE });
  } catch (e) {
    if (!(e instanceof BidError)) throw e;
    const headers = e.code === 'BID_TIMED_OUT' ? { ...NO_STORE, 'Retry-After': '1' } : NO_STORE;
    return Response.json({ error: e.code, message: e.message, retryable: e.retryable }, { status: STATUS[e.code], headers });
  }
}
