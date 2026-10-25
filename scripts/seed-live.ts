// seed:live (D-64 b): a "Live demo sale" in Acme Studio whose lots close over the next 30 days, so the deployed demo
// always has a lot open to bid on. Writes what the create-auction and create-lot forms write (Auction, Lot, LotState
// from openState); no bids. Run after seed:demo; run again to add a fresh sale. Synthetic data only.
// ponytail: lots run out after 30 days; rerun the script then, or let the cron add a sale if the demo outlives that.
import { loadRules } from '../src/auction/load-rules';
import { openState } from '../src/auction/engine/engine';
import { now } from '../src/core/clock';
import { db } from '../src/core/db'; // refuses a cloud database unless ALLOW_CLOUD_DB=1 (INV-18)

const DAY = 86_400_000;
const LOTS: [title: string, startCents: number, reserveCents: number | null, closesInDays: number][] = [
  ['Brass ship\'s clock', 5_000, 12_000, 1],
  ['Walnut drop-leaf table', 15_000, 30_000, 2],
  ['Pair of cast-iron andirons', 4_000, null, 3],
  ['Quilt, nine-patch, hand-stitched', 8_000, 15_000, 5],
  ['Craftsman tool chest with drawers', 10_000, null, 8],
  ['Stoneware crock, 5 gallon', 3_000, 6_000, 13],
  ['Mahogany mantel clock', 10_000, 15_000, 21],
  ['John Deere pedal tractor', 12_000, 25_000, 30],
];

const org = await db.org.findUniqueOrThrow({ where: { slug: 'acme' } });
const d = loadRules().rules.defaults;
const t = now().getTime();
const opensAt = new Date(t - 3_600_000);
const auction = await db.auction.create({
  data: { orgId: org.id, name: `Live demo sale (${new Date(t).toISOString().slice(0, 10)})`, opensAt, softCloseWindowSeconds: d.softCloseWindowSeconds, maxExtensionSeconds: d.maxExtensionSeconds, buyerPremiumBps: d.buyerPremiumBps },
});
for (const [i, [title, startCents, reserveCents, days]] of LOTS.entries()) {
  const scheduledEnd = new Date(Math.floor((t + days * DAY) / 60_000) * 60_000); // whole minutes, like the form
  const s = openState({ startCents, reserveCents, opensAtMs: opensAt.getTime(), scheduledEndMs: scheduledEnd.getTime(), softCloseWindowMs: auction.softCloseWindowSeconds * 1000, maxExtensionMs: auction.maxExtensionSeconds * 1000, buyerPremiumBps: auction.buyerPremiumBps });
  await db.lot.create({
    data: {
      orgId: org.id, auctionId: auction.id, number: i + 1, title, consignor: 'Synthetic estate', startCents, reserveCents, scheduledEnd,
      state: { create: { orgId: org.id, priceCents: s.priceCents, leaderBidderId: s.leader, leaderMaxCents: s.leaderMaxCents, leaderSeq: s.leaderSeq, bidCount: s.bidCount, acceptedCount: s.acceptedCount, closesAt: new Date(s.closesAtMs), extensionCount: s.extensionCount } },
    },
  });
}
await db.$disconnect();
console.log(`seed:live: "${auction.name}" in acme, ${LOTS.length} lots closing over the next 30 days`);
