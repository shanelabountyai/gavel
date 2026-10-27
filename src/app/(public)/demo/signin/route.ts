// public: 404s unless DEMO_MODE, same-origin only (INV-27)
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
  // A demo visitor in one org lands where the demo is: bidders on the catalog, staff on the auctions (D-64).
  const orgs = await db.membership.findMany({ where: { userId: id as string }, select: { role: true, org: { select: { slug: true } } }, take: 2 });
  const one = orgs.length === 1 ? orgs[0]! : null;
  const to = one ? `/o/${one.org.slug}/${one.role === 'member' ? 'catalog' : 'auctions'}` : '/onboarding';
  return Response.redirect(new URL(to, req.url), 303);
}
