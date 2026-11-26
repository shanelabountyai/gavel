// `--clock db` (task 4.4 a, the D-15 seam): the product's FOR UPDATE, then Postgres's clock_timestamp() read under
// the lock in place of now() from @/core/clock. One clock for every app process; everything else is the product's.
import { LOCK_TIMEOUT_MS, judgeRead, readState } from '../../src/auction/place-bid';
import type { Variant } from './variant';

const stats = { judgements: 0, conflicts: 0 };
export const variant: Variant = {
  stats,
  judge: async (tx, b, lot, rules) => {
    stats.judgements++;
    await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    const row = await readState(tx, b.lotId, true);
    const [{ t }] = (await tx.query<{ t: Date }>('SELECT clock_timestamp() AS t')) as [{ t: Date }];
    return judgeRead(tx, b, lot, rules, () => t, row);
  },
};
