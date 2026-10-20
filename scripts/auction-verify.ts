// auction:verify: V1–V9 (brief §8) over every lot; exits 1 naming the first lot and check (CLAUDE.md rule 11).
import { loadRules } from '../src/auction/load-rules';
import { prismaTx } from '../src/auction/place-bid';
import { verifyAll } from '../src/auction/verify-sql';
import { db } from '../src/core/db';
import type { Prisma } from '../src/generated/prisma/client';

const { lots, settled, failure } = await verifyAll(prismaTx(db as unknown as Prisma.TransactionClient), loadRules().rules);
await db.$disconnect();
if (failure) {
  console.error(`auction:verify FAILED: lot ${failure.lotId} (#${failure.lotNumber}) ${failure.check}: ${failure.detail}`);
  process.exit(1);
}
console.log(`auction:verify: OK, ${lots} lots (${settled} settled), V1–V9`);
