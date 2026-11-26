import { redirect } from 'next/navigation';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';

// UX-11: org Home is where the work is, the same split as the demo sign-in (D-64): bidders the catalog, staff the auctions.
export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  redirect(`/o/${ctx.slug}/${can(ctx.role, 'results.write') ? 'auctions' : 'catalog'}`);
}
