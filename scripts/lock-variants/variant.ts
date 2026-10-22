// Task 4.2 (D-58): what a lock variant hands load:bids. Each serializes the bid differently and reuses the product's
// pieces from src/auction/place-bid.ts (exported, not copied); the product path never imports this directory.
import type { Client as PgClient } from 'pg';
import type { Judge, Runner } from '../../src/auction/place-bid';

export const MAX_ATTEMPTS = 20; // D-58 b: judgements per bid before a conflict loop gives up as BID_TIMED_OUT
export type Stats = { judgements: number; conflicts: number };
export type Variant = { judge: Judge; run?: (c: PgClient) => Runner; stats: Stats };
