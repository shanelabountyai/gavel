import { inOrg, requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { ActionForm } from '@/core/ui/action-form';
import { changeBidderStatus, setTaxExemptionAction } from './actions';

export const metadata = { title: 'Bidders' };

// D-70 (AX-05). Staff only (results.write). Status is Bidder.status, the projection of BidderStatusChange.
export default async function Bidders({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org, 'results.write');
  const [bidders, accepted, changes] = await Promise.all([
    db.bidder.findMany({ where: inOrg(ctx), orderBy: { paddle: 'asc' }, select: { id: true, paddle: true, status: true, taxExemptRef: true, user: { select: { name: true, email: true } } } }),
    db.bid.groupBy({ by: ['bidderId'], where: { ...inOrg(ctx), accepted: true }, _count: { _all: true } }),
    db.bidderStatusChange.findMany({ where: inOrg(ctx), orderBy: { changedAt: 'desc' }, distinct: ['bidderId'], select: { bidderId: true, reason: true, changedAt: true } }),
  ]);
  const count = new Map(accepted.map((a) => [a.bidderId, a._count._all]));
  const last = new Map(changes.map((c) => [c.bidderId, c]));
  const action = changeBidderStatus.bind(null, ctx.slug);
  const exempt = setTaxExemptionAction.bind(null, ctx.slug);
  return (
    <main>
      <h1>Bidders</h1>
      <p className="muted">
        Suspending a bidder refuses their new bids from that moment. Their standing maximums stay live: a lot they
        already lead can still be won by them. After the close, the remedy is a settlement correction. A bid that was
        already being judged when you suspended is judged normally.
      </p>
      <table>
        <thead><tr><th scope="col" className="num">Paddle</th><th scope="col">Bidder</th><th scope="col">Status</th><th scope="col" className="num">Accepted bids</th><th scope="col">Change</th><th scope="col">Sales tax</th></tr></thead>
        <tbody>
          {bidders.map((b) => {
            const suspend = b.status === 'ACTIVE';
            const c = last.get(b.id);
            return (
              <tr key={b.id} data-testid={`bidder-${b.paddle}`}>
                <td className="num">{b.paddle}</td>
                <td>{b.user.name ?? b.user.email}</td>
                <td>{suspend ? 'Active' : 'Suspended'}{c && <div className="muted">{c.reason} ({c.changedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)</div>}</td>
                <td className="num">{count.get(b.id) ?? 0}</td>
                <td>
                  <ActionForm action={action}>
                    <input type="hidden" name="bidderId" value={b.id} />
                    <input type="hidden" name="status" value={suspend ? 'SUSPENDED' : 'ACTIVE'} />
                    <label>Reason <input name="reason" required maxLength={500} /></label>
                    <button type="submit">{suspend ? 'Suspend' : 'Reinstate'}</button>
                  </ActionForm>
                </td>
                <td>
                  {/* D-78: a certificate on file makes every invoice of this bidder tax-free; it is printed on the invoice */}
                  <ActionForm action={exempt}>
                    <input type="hidden" name="bidderId" value={b.id} />
                    <label>{b.taxExemptRef ? 'Exempt, certificate' : 'Taxable. Exemption certificate'} <input name="certificateRef" maxLength={120} defaultValue={b.taxExemptRef ?? ''} placeholder="blank = taxable" /></label>
                    <button type="submit">Save</button>
                  </ActionForm>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {bidders.length === 0 && <p className="muted">No bidders have registered yet.</p>}
    </main>
  );
}
