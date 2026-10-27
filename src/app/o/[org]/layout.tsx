import Link from 'next/link';
import { can } from '@/core/authz/permissions';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';

// Navigation only. Layouts do not re-run on every navigation, so each page calls requireOrg itself.
export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const base = `/o/${ctx.slug}`;
  const links = ([
    [base, 'Home'], [`${base}/catalog`, 'Catalog'], can(ctx.role, 'results.write') && [`${base}/auctions`, 'Auctions'],
    [`${base}/projects`, 'Projects'], [`${base}/settings/members`, 'Members'], can(ctx.role, 'org.delete') && [`${base}/settings/danger`, 'Delete org'],
    ['/onboarding', 'Your orgs'], ['/account/security', 'Account'],
  ] as const).filter((l): l is [string, string] => !!l).map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>);
  return (
    <>
      {/* DS-02: inline links on a wide screen; below 30rem one line with the links behind a native <details>. */}
      <nav>
        <strong>{org.name}</strong>
        <ul className="nav-links">{links}</ul>
        <details className="nav-menu"><summary>Menu</summary><ul>{links}</ul></details>
      </nav>
      {children}
    </>
  );
}
