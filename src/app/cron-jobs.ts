import { drainOutbox, sweepOutbox } from '@/modules/notifications/outbox'; // notifications
import { closeLots } from '@/auction/close';
import '@/auction/notices'; // registers the outbid and won templates before the drain renders them (task 3.6)
import { prismaTx } from '@/auction/place-bid';
import { now } from '@/core/clock';
import { db } from '@/core/db';
import type { Prisma } from '@/generated/prisma/client';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  // D-64: the deployed demo settles closed lots on the daily cron, the same call as `auction:close` (idempotent).
  // Settling first lets the drain below send the won notices in the same run.
  jobs.close = await closeLots(now(), prismaTx(db as unknown as Prisma.TransactionClient));
  jobs.outbox = { ...(await drainOutbox()), swept: await sweepOutbox() }; // notifications
  return jobs;
}
