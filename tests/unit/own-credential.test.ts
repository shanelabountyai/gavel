import { describe, expect, it } from 'vitest';
import { ownCredential } from '@/auction/demo-gate';

// The paths this clone's proxy leaves to their own credential (moved from tests/unit/demo-gate.test.ts at v1.6.5;
// the gate's own tests are now the template's, in that file).
describe('gavel: routes outside the demo password', () => {
  it('leaves open only the paths with a credential of their own', () => {
    for (const p of ['/api/cron']) expect(ownCredential(p)).toBe(true);
    for (const p of ['/', '/demo', '/login', '/o/acme/catalog', '/api/lots/x/bids', '/api/webhooks/stripe', '/api/health', '/api/cron/x', '/s/abc']) expect(ownCredential(p)).toBe(false);
  });
});
