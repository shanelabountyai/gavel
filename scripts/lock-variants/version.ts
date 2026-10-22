// `--lock version`: no lock taken up front. Read LotState, judge, then UPDATE … WHERE "bidCount" = <what was read>;
// zero rows means another writer committed first, so re-read and re-judge in the same READ COMMITTED transaction
// (each statement sees the latest commit). bidCount is the version, so no migration. The projection is written before
// the ledger row so a lost race has written nothing. Postgres still row-locks inside the guarded UPDATE: a loser
// waits there for the winner's COMMIT before it sees zero rows.
import { applyBid } from '../../src/auction/engine/engine';
import { BidError } from '../../src/auction/errors';
import { LOCK_TIMEOUT_MS, findPrior, insertBid, notifyOutbid, priorResponse, readState, response, toState, updateState } from '../../src/auction/place-bid';
import { MAX_ATTEMPTS, type Variant } from './variant';

const stats = { judgements: 0, conflicts: 0 };
export const variant: Variant = {
  stats,
  judge: async (tx, b, lot, rules, now) => {
    await tx.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      stats.judgements++;
      const state = toState(await readState(tx, b.lotId, false));
      const placedAt = now(); // after the read that the guard will confirm
      const prior = await findPrior(tx, b);
      if (prior) return priorResponse(prior, b.maxCents, state, lot, rules, b.bidderId);
      const r = applyBid(lot, state, b.bidderId, b.maxCents, placedAt.getTime(), rules);
      if (await updateState(tx, b.lotId, r.state, state.bidCount)) {
        await insertBid(tx, b, placedAt, r);
        await notifyOutbid(tx, b, r);
        return response(r.outcome, r.accepted, r.state.bidCount, false, r.state, lot, rules, b.bidderId);
      }
      stats.conflicts++;
    }
    throw new BidError('BID_TIMED_OUT', `version conflict ${MAX_ATTEMPTS} times; resend with the same key`, true);
  },
};
