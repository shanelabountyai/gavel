import { describe, expect, it } from 'vitest';
import { LOCK_NOT_AVAILABLE, RESTRICT_VIOLATION, UNIQUE_VIOLATION, constraintName, sqlState } from '@/auction/errors';

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

describe('the shapes task 1.8 met (D-37)', () => {
  it('reads a Prisma unique violation, which carries originalCode and the index name but no cause.code', () => {
    const e = { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation', constraint: { index: 'Bid_lotId_bidderId_idempotencyKey_key' } } } } };
    expect(sqlState(e)).toBe(UNIQUE_VIOLATION);
    expect(constraintName(e)).toBe('Bid_lotId_bidderId_idempotencyKey_key');
  });
  it('reads node-postgres `constraint`', () => {
    expect(constraintName({ code: '23505', constraint: 'Bid_lotId_seq_key' })).toBe('Bid_lotId_seq_key');
    expect(constraintName({ code: '55P03' })).toBeNull();
    expect(constraintName(null)).toBeNull();
  });
});
