import { now } from '@/core/clock';
import { db } from '@/core/db';

// R10 (D-81): the org the demo is in, so /demo can group its accounts and land a multi-org staff account on that house's
// auctions. The house of the most recently opened auction that still has a lot open; with nothing open, of the most
// recently opened auction at all; with no lots, none. Read-only. On the deployed demo that is Acme's live sale (seed:live).
export async function liveDemoOrgId(): Promise<string | null> {
  const t = now();
  const orderBy = { auction: { opensAt: 'desc' } } as const;
  const open = await db.lot.findFirst({ where: { auction: { opensAt: { lte: t } }, state: { closesAt: { gt: t } }, withdrawal: null }, orderBy, select: { orgId: true } });
  return open?.orgId ?? (await db.lot.findFirst({ orderBy, select: { orgId: true } }))?.orgId ?? null;
}
