// `--lock serializable`: SERIALIZABLE, no FOR UPDATE; a serialization failure (SQLSTATE 40001, raised at the
// UPDATE or COMMIT) rolls back and the whole transaction is retried on the same connection. So does a 23505 on
// Bid_lotId_seq_key: the first run (D-58 c) showed Postgres reports the seq race as a unique violation, not 40001,
// because the insert precedes the LotState update and nothing in the transaction read that (lotId, seq) key.
import type { Client as PgClient } from 'pg';
import { BidError, UNIQUE_VIOLATION, constraintName, sqlState } from '../../src/auction/errors';
import { LOCK_TIMEOUT_MS, type Runner, judgeRead, pgTx, readState } from '../../src/auction/place-bid';
import { MAX_ATTEMPTS, type Variant } from './variant';

const SERIALIZATION_FAILURE = '40001';
const stats = { judgements: 0, conflicts: 0, seqCollisions: 0 };
const run =
  (c: PgClient): Runner =>
  async (body) => {
    for (let attempt = 1; ; attempt++) {
      stats.judgements++;
      await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        const result = await body(pgTx(c));
        await c.query('COMMIT');
        return result;
      } catch (error) {
        await c.query('ROLLBACK');
        const seqCollision = sqlState(error) === UNIQUE_VIOLATION && constraintName(error) === 'Bid_lotId_seq_key';
        if (sqlState(error) !== SERIALIZATION_FAILURE && !seqCollision) throw error;
        if (seqCollision) stats.seqCollisions++;
        else stats.conflicts++;
        if (attempt === MAX_ATTEMPTS) throw new BidError('BID_TIMED_OUT', `40001 or seq collision ${MAX_ATTEMPTS} times; resend with the same key`, true, { cause: error });
      }
    }
  };
export const variant: Variant = {
  stats,
  run,
  judge: async (tx, b, lot, rules, now) => {
    await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    return judgeRead(tx, b, lot, rules, now, await readState(tx, b.lotId, false));
  },
};
