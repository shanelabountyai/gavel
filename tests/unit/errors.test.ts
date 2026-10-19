import { describe, expect, it } from 'vitest';
import { LOCK_NOT_AVAILABLE, RESTRICT_VIOLATION, sqlState } from '@/auction/errors';

describe('sqlState: both driver shapes from spike S-2/S-4 (D-30)', () => {
  it('reads node-postgres `code`', () => {
    expect(sqlState({ code: '55P03', message: 'canceling statement due to lock timeout' })).toBe(LOCK_NOT_AVAILABLE);
  });
  it('reads Prisma P2010 from meta.driverAdapterError.cause.code', () => {
    const e = { code: 'P2010', meta: { driverAdapterError: { cause: { code: '23001', originalMessage: 'x' } } } };
    expect(sqlState(e)).toBe(RESTRICT_VIOLATION);
  });
  it.each([null, 'boom', new Error('boom'), { code: 'P2028' }, { code: 'P2010', meta: {} }])(
    'is null for %s',
    (e) => expect(sqlState(e)).toBeNull(),
  );
});
