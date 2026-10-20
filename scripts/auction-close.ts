// auction:close -- --as-of <iso>: settles every closed, unsettled lot as of that instant (D-22); idempotent.
import { closeLots } from '../src/auction/close';
import { prismaTx } from '../src/auction/place-bid';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';

const i = process.argv.indexOf('--as-of');
const asOf = new Date(i > 0 ? process.argv[i + 1] ?? '' : '');
if (Number.isNaN(asOf.getTime())) {
  console.error('usage: npm run auction:close -- --as-of <iso instant>');
  process.exit(2);
}
const { considered, settled } = await closeLots(asOf, prismaTx(db as unknown as Prisma.TransactionClient));
await db.$disconnect();
console.log(`auction:close as of ${asOf.toISOString()}: ${settled} settled, ${considered - settled} still open`);
