/**
 * The contention suite (D-18). A race test SPECIFIES an interleaving, never
 * samples one: every ordering constraint is a database condition or an
 * explicit `await`, each test carries a hard timeout, and a hang fails.
 *
 * Task 1.3: the barrier mechanism itself, on a template table, with N raw
 * `pg` writers outside the Prisma pool. Task 1.10 adds the `LotState` tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { db } from '@/core/db';
import { makeOrg } from '../helpers/org';
import { RACE_TIMEOUT, behindRowLock } from './row-lock';

const N = Number(process.env.GAVEL_BARRIER_N ?? 10);
let orgId: string;

const connections = async () => {
  const c = new PgClient({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ n: string }>(
      'SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()',
    );
    return Number(rows[0]?.n ?? 0);
  } finally {
    await c.end();
  }
};

beforeAll(async () => {
  orgId = (await makeOrg(`barrier-${process.pid}`)).id;
});
afterAll(async () => {
  await db.org.delete({ where: { id: orgId } });
  await db.$disconnect();
});

describe('behindRowLock', () => {
  it(
    `queues N=${N} raw writers on one row; all read the same state before any wrote; no connection leaks`,
    async () => {
      const before = await connections();
      const reads: string[] = [];

      const writer = async (i: number) => {
        const c = new PgClient({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        try {
          await c.query('BEGIN');
          const { rows } = await c.query<{ name: string }>('SELECT name FROM "Org" WHERE id = $1', [orgId]);
          reads.push(rows[0]?.name ?? '(no row)'); // MVCC: never blocks, sees the pre-race state
          await c.query('UPDATE "Org" SET name = name || $2 WHERE id = $1', [orgId, `.${i}`]);
          await c.query('COMMIT');
        } finally {
          await c.end();
        }
      };

      await behindRowLock('Org', orgId, N, () => Promise.all(Array.from({ length: N }, (_, i) => writer(i))));

      expect(reads).toHaveLength(N);
      expect(new Set(reads).size).toBe(1);
      const after = await db.org.findUniqueOrThrow({ where: { id: orgId } });
      expect(after.name.split('.')).toHaveLength(N + 1); // every writer's suffix landed, in lock order
      expect(await connections()).toBe(before);
    },
    RACE_TIMEOUT,
  );
});
