import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatCents } from '@/auction/engine/money';
import { inZone } from '@/auction/house-time';
import { currentSettlements } from '@/auction/invoice';
import { outcomeLabel, paymentLabel, paymentTone } from '@/auction/outcome-labels';
import { offersForAuction, paidInvoices } from '@/auction/payment';
import { inOrg, requireOrg } from '@/core/authz/guards';
import { can } from '@/core/authz/permissions';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { answerOfferAction, approveBelowReserveAction, declareDefaultAction, recordPaymentAction } from './actions';

export const metadata = { title: 'Invoices' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Task 2.1 + D-75: staff only (owner/admin, the foundation's audit.read to read; results.write to record a payment, declare a
// default or answer an offer). Derived on read from each lot's current settlement (D-42 Q1) and the payment marks; nothing
// stored. A mark is staff writing down that money arrived (payments are a non-goal). An unsold lot appears nowhere.
export default async function Invoices({ params }: { params: Promise<{ org: string; id: string }> }) {
  const ctx = await requireOrg((await params).org, 'audit.read');
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const auction = await db.auction.findFirst({ where: { id, ...inOrg(ctx) }, select: { name: true, buyerPremiumBps: true, paymentDueAt: true, timeZone: true } });
  if (!auction) notFound();
  const utc = (d: Date) => inZone(d, auction.timeZone); // R-12: the sale's zone, named
  const [invoices, offers, settled] = await Promise.all([paidInvoices(ctx.orgId, { auctionId: id }), offersForAuction(ctx.orgId, id), currentSettlements(ctx.orgId, id)]);
  const unsold = [...settled.values()].filter((s) => s.outcome !== 'SOLD'); // UX-17: an unsold lot is an outcome, shown
  const ids = [...new Set([...invoices.map((i) => i.bidderId), ...offers.map((o) => o.bidderId), ...invoices.flatMap((i) => i.lots.map((l) => l.lotId)), ...unsold.map((s) => s.lotId)])];
  const [bidders, lots] = await Promise.all([
    db.bidder.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, paddle: true, user: { select: { name: true, email: true } } } }),
    db.lot.findMany({ where: { id: { in: ids }, ...inOrg(ctx) }, select: { id: true, number: true, title: true, reserveCents: true, state: { select: { priceCents: true, leaderBidderId: true } } } }),
  ]);
  const bidder = new Map(bidders.map((b) => [b.id, b]));
  const lot = new Map(lots.map((l) => [l.id, l]));
  const title = (lotId: string) => lot.get(lotId)?.title;
  unsold.sort((a, b) => (lot.get(a.lotId)?.number ?? 0) - (lot.get(b.lotId)?.number ?? 0));
  const canWrite = can(ctx.role, 'results.write');
  const pay = recordPaymentAction.bind(null, ctx.slug);
  const dflt = declareDefaultAction.bind(null, ctx.slug);
  const answer = answerOfferAction.bind(null, ctx.slug);
  const approve = approveBelowReserveAction.bind(null, ctx.slug);
  const highBidders = await db.bidder.findMany({ where: { id: { in: lots.flatMap((l) => l.state?.leaderBidderId ?? []) }, ...inOrg(ctx) }, select: { id: true, paddle: true } });
  const paddle = new Map(highBidders.map((b) => [b.id, b.paddle]));

  return (
    <main>
      <h1>Invoices: {auction.name}</h1>
      <p className="muted">
        Buyer&apos;s premium {formatCents(auction.buyerPremiumBps).slice(1)}% of hammer. {invoices.length} {invoices.length === 1 ? 'buyer' : 'buyers'}.{' '}
        Payment due {auction.paymentDueAt ? utc(auction.paymentDueAt) : 'not set (no invoice can go overdue or into default until it is)'}.{' '}
        A recorded payment is a mark, never a charge. <Link href={`/o/${ctx.slug}/auctions/${id}`}>Back to the sale</Link>.
      </p>
      {settled.size === 0 && <p data-testid="no-settlement">No lots settled yet. Lots settle after they close (daily at 06:00 UTC on the demo).</p>}
      {invoices.map((i) => {
        const b = bidder.get(i.bidderId);
        const { status } = i.balance;
        const open = status !== 'PAID' && status !== 'CREDIT';
        const canDefault = canWrite && !i.defaulted && open && i.dueAt !== null && (status === 'OVERDUE' || status === 'PARTIAL');
        return (
          <section key={i.bidderId} className="invoice" data-testid={`invoice-${b?.paddle}`}>
            <h2>Paddle {b?.paddle} · {b?.user.name ?? b?.user.email} <span className="badge" data-tone={paymentTone(status)}>{paymentLabel(status)}</span></h2>
            {i.defaulted && <p><strong>Declared in default</strong> {utc(i.defaulted.declaredAt)}: {i.defaulted.reason}. The bidder was suspended; any lot with an underbidder is offered below.</p>}
            {i.lots.length === 0 && <p className="muted">No lots are currently on this invoice; every line was moved by a correction after a payment was recorded.</p>}
            <table>
              <thead>
                <tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col" className="num">Hammer</th><th scope="col" className="num">Premium</th><th scope="col" className="num">Total</th></tr>
              </thead>
              <tbody>
                {i.lots.map((l) => (
                  <tr key={l.lotId}><td>{l.lotNumber}</td><td><Link href={`/o/${ctx.slug}/lots/${l.lotId}/history`}>{title(l.lotId)}</Link></td><td className="num">{formatCents(l.hammerCents)}</td><td className="num">{formatCents(l.premiumCents)}</td><td className="num">{formatCents(l.totalCents)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th scope="row" colSpan={2}>Lots</th><td className="num">{formatCents(i.hammerCents)}</td><td className="num">{formatCents(i.premiumCents)}</td><td className="num">{formatCents(i.hammerCents + i.premiumCents)}</td></tr>
                {(i.taxBps > 0 || i.exemptRef) && <tr data-testid="tax-row"><th scope="row" colSpan={4}>{i.exemptRef ? `Sales tax: exempt, certificate ${i.exemptRef}` : `Sales tax ${formatCents(i.taxBps).slice(1)}% of ${i.taxBase === 'HAMMER' ? 'hammer' : 'hammer + premium'}`}</th><td className="num">{formatCents(i.taxCents)}</td></tr>}
                <tr><th scope="row" colSpan={4}>Total due</th><td className="num" data-testid="total-due">{formatCents(i.totalCents)}</td></tr>
                <tr><th scope="row" colSpan={4}>Paid</th><td className="num">{formatCents(i.balance.paidCents)}</td></tr>
                <tr><th scope="row" colSpan={4}>{i.balance.balanceCents < 0 ? 'Credit due to buyer' : 'Balance'}</th><td className="num"><strong>{formatCents(Math.abs(i.balance.balanceCents))}</strong></td></tr>
              </tfoot>
            </table>
            {i.marks.length > 0 && (
              <ul className="muted">{i.marks.map((m) => <li key={m.id}>{formatCents(m.amountCents)} by {m.method}, {utc(m.markedAt)}</li>)}</ul>
            )}
            {canWrite && open && (
              <ActionForm action={pay}>
                <input type="hidden" name="auctionId" value={i.auctionId} />
                <input type="hidden" name="bidderId" value={i.bidderId} />
                <label>Amount received ($) <input name="amount" inputMode="decimal" required pattern="\d{1,7}(\.\d{1,2})?" placeholder={formatCents(Math.max(i.balance.balanceCents, 0)).slice(1)} /></label>{' '}
                <label>Method <input name="method" required maxLength={40} placeholder="wire, check, cash, card" /></label>{' '}
                <button type="submit">Record payment</button>
              </ActionForm>
            )}
            {canDefault && (
              <ActionForm action={dflt}>
                <input type="hidden" name="auctionId" value={i.auctionId} />
                <input type="hidden" name="bidderId" value={i.bidderId} />
                <label>Reason <input name="reason" required maxLength={500} /></label>{' '}
                <label>Days for the underbidder to reply <input name="replyDays" type="number" min={1} max={90} defaultValue={7} required /></label>{' '}
                <button type="submit" data-variant="danger">Declare default</button>
              </ActionForm>
            )}
          </section>
        );
      })}
      {unsold.length > 0 && (
        <section data-testid="not-sold">
          <h2>Not sold</h2>
          <p className="muted">A lot that closed below its reserve can still be sold to its high bidder at the high bid, if the consignor accepts it (D-87). Record their approval reference; the lot moves to that bidder&apos;s invoice.</p>
          <table>
            <thead><tr><th scope="col">Lot</th><th scope="col">Title</th><th scope="col">Outcome</th><th scope="col" className="num">High bid</th><th scope="col" className="num">Reserve</th>{canWrite && <th scope="col">Consignor approval</th>}</tr></thead>
            <tbody>
              {unsold.map((s) => {
                const l = lot.get(s.lotId);
                const below = s.outcome === 'UNSOLD_RESERVE_NOT_MET' && l?.state?.leaderBidderId;
                return (
                  <tr key={s.lotId} data-testid={`not-sold-${l?.number}`}>
                    <td>{l?.number}</td>
                    <td><Link href={`/o/${ctx.slug}/lots/${s.lotId}/history`}>{title(s.lotId)}</Link></td>
                    <td><span className="badge">{outcomeLabel(s.outcome)}</span></td>
                    <td className="num">{below ? `${formatCents(l.state!.priceCents)} · paddle ${paddle.get(l.state!.leaderBidderId!)}` : ''}</td>
                    <td className="num">{below && l.reserveCents !== null ? formatCents(l.reserveCents) : ''}</td>
                    {canWrite && (
                      <td>
                        {below && (
                          <ActionForm action={approve}>
                            <input type="hidden" name="lotId" value={s.lotId} />
                            <input type="hidden" name="settlementId" value={s.id} />
                            <label>Approval reference <input name="approvalRef" required maxLength={100} /></label>{' '}
                            <label>Reason <input name="reason" required maxLength={500} /></label>{' '}
                            <button type="submit">Sell at high bid</button>
                          </ActionForm>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {offers.length > 0 && (
        <section data-testid="offers">
          <h2>Second-chance offers</h2>
          <p className="muted">Each lot a defaulted buyer won is offered to its underbidder at the price their own last bid reached (D-44). Accepting records a settlement correction; the lot moves to the underbidder&apos;s invoice.</p>
          <table>
            <thead><tr><th scope="col">Lot</th><th scope="col">Offered to</th><th scope="col" className="num">Price</th><th scope="col">Reply by</th><th scope="col">State</th>{canWrite && <th scope="col">Answer</th>}</tr></thead>
            <tbody>
              {offers.map((o) => {
                const b = bidder.get(o.bidderId);
                return (
                  <tr key={o.id} data-testid={`offer-${o.lot.number}`}>
                    <td>{o.lot.number} <Link href={`/o/${ctx.slug}/lots/${o.lotId}/history`}>{o.lot.title}</Link></td>
                    <td>Paddle {b?.paddle} · {b?.user.name ?? b?.user.email}</td>
                    <td className="num">{formatCents(o.priceCents)}</td>
                    <td>{utc(o.expiresAt)}</td>
                    <td><span className="badge" data-tone={o.state === 'ACCEPTED' ? 'good' : o.state === 'OPEN' ? 'warn' : 'plain'}>{{ OPEN: 'Awaiting reply', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired' }[o.state]}</span>{o.response && <div className="muted">{utc(o.response.respondedAt)}</div>}</td>
                    {canWrite && (
                      <td>
                        {o.state === 'OPEN' && (
                          <ActionForm action={answer}>
                            <input type="hidden" name="offerId" value={o.id} />
                            <button type="submit" name="response" value="ACCEPTED">Accept</button>{' '}
                            <button type="submit" name="response" value="DECLINED" data-variant="danger">Decline</button>
                          </ActionForm>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
