// public: 404s unless DEMO_MODE, same-origin only (INV-27)
import { liveDemoOrgId } from '@/auction/demo-live';
import { demoEnabled, demoSignIn } from '@/core/auth/demo';
import { setSessionCookie } from '@/core/auth/session';
import { db } from '@/core/db';
import { isSameOrigin } from '@/core/http';

export async function POST(req: Request) {
  if (!demoEnabled()) return new Response(null, { status: 404 });
  if (!isSameOrigin(req.headers)) return new Response(null, { status: 403 });
  const id = (await req.formData()).get('userId');
  const token = typeof id === 'string' ? await demoSignIn(id) : null;
  if (!token) return new Response(null, { status: 404 });
  await setSessionCookie(token);
  // A demo visitor lands where the demo is: bidders on the catalog, staff on the auctions (D-64). With several orgs,
  // the one with the live sale (D-81); a visitor in none of them picks on Your orgs.
  const orgs = await db.membership.findMany({ where: { userId: id as string }, select: { orgId: true, role: true, org: { select: { slug: true } } } });
  const live = orgs.length > 1 ? await liveDemoOrgId() : null;
  const pick = orgs.length === 1 ? orgs[0] : orgs.find((m) => m.orgId === live);
  const to = pick ? `/o/${pick.org.slug}/${pick.role === 'member' ? 'catalog' : 'auctions'}` : '/onboarding';
  return Response.redirect(new URL(to, req.url), 303);
}
