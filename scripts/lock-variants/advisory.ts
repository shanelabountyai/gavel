// `--lock advisory`: a transaction-scoped advisory lock keyed on the lot (Bookable `lockProviderDay`), then a plain
// read of LotState; the rest is the product's. lock_timeout covers the advisory wait too.
import { LOCK_TIMEOUT_MS, judgeRead, readState } from '../../src/auction/place-bid';
import type { Variant } from './variant';

const stats = { judgements: 0, conflicts: 0 };
export const variant: Variant = {
  stats,
  judge: async (tx, b, lot, rules, now) => {
    stats.judgements++;
    await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [b.lotId]);
    return judgeRead(tx, b, lot, rules, now, await readState(tx, b.lotId, false));
  },
};
