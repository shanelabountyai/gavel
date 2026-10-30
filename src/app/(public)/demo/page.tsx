// public: 404s unless DEMO_MODE (INV-27)
import { notFound } from 'next/navigation';
import { liveDemoOrgId } from '@/auction/demo-live';
import { demoEnabled } from '@/core/auth/demo';
import { db } from '@/core/db';

export const metadata = { title: 'Demo sign-in' };
export const dynamic = 'force-dynamic';

type DemoUser = { id: string; email: string; memberships: { role: string; orgId: string; org: { name: string } }[] };
const who = (email: string) => { const s = email.split('@')[0]!.replace(/^bidder-/, ''); return s[0]!.toUpperCase() + s.slice(1); };

// R10 (D-81): accounts grouped by journey, in the page (src/core/auth/demo is template-owned). "Bid" is whoever holds
// a paddle in the live house, "Run the sale" its staff, everyone else behind one <details>. The bidder accounts are
// shared by every visitor, and the page says so.
export default async function Demo() {
  if (!demoEnabled()) notFound();
  const [users, live] = await Promise.all([
    db.user.findMany({ where: { isDemo: true }, select: { id: true, email: true, memberships: { select: { role: true, orgId: true, org: { select: { name: true } } } } }, orderBy: { email: 'asc' } }),
    liveDemoOrgId(),
  ]);
  const paddles = new Set(live ? (await db.bidder.findMany({ where: { orgId: live, status: 'ACTIVE' }, select: { userId: true } })).map((b) => b.userId) : []);
  const bid = users.filter((u) => paddles.has(u.id));
  const staff = users.filter((u) => !paddles.has(u.id) && u.memberships.some((m) => m.orgId === live && m.role !== 'member'));
  const other = users.filter((u) => !bid.includes(u) && !staff.includes(u));
  const button = (u: DemoUser, label: string) => (
    <li key={u.id}>
      <form method="post" action="/demo/signin" data-email={u.email}>
        <input type="hidden" name="userId" value={u.id} />
        <button type="submit">{label}</button> <span className="muted">{u.email} · {u.memberships.map((m) => `${m.role} of ${m.org.name}`).join(', ')}</span>
      </form>
    </li>
  );
  return (
    <main>
      <h1>Demo sign-in</h1>
      <p>Seeded demo accounts. Pick one to sign in, no email needed.</p>
      {users.length === 0 && <p role="status">No demo users yet. Run <code>npm run seed:demo</code>.</p>}
      {bid.length > 0 && (
        <section>
          <h2>Bid</h2>
          <p className="muted">Shared with other visitors: another visitor may be bidding as {who(bid[0]!.email)} right now.</p>
          <ul>{bid.map((u) => button(u, `Bid as ${who(u.email)}`))}</ul>
        </section>
      )}
      {staff.length > 0 && (
        <section>
          <h2>Run the sale</h2>
          <ul>{staff.map((u) => button(u, `Run the sale as ${u.memberships.find((m) => m.orgId === live)!.role}`))}</ul>
        </section>
      )}
      {other.length > 0 && (
        <details open={bid.length + staff.length === 0}>
          <summary>Other seeded accounts</summary>
          <ul>{other.map((u) => button(u, u.email))}</ul>
        </details>
      )}
    </main>
  );
}
