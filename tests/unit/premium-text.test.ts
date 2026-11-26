// R-18 (D-90): the staff text for a sale's premium, both ways.
import { describe, expect, it } from 'vitest';
import { formatPremium, parsePremium } from '@/auction/premium-text';

describe('parsePremium / formatPremium', () => {
  it('a flat rate stores no bands', () => expect(parsePremium(' 15% ')).toEqual({ buyerPremiumBps: 1500, premiumBands: null }));
  it('two tiers', () => {
    expect(parsePremium('15% to $5,000; 10% above')).toEqual({ buyerPremiumBps: 1500, premiumBands: [{ loCents: 0, hiCents: 500_000, bps: 1500 }, { loCents: 500_000, hiCents: null, bps: 1000 }] });
  });
  it('three tiers, cents and fractional rates, no dollar sign', () => {
    expect(parsePremium('20% to 1000.50; 17.5% to $25,000; 12.25%')).toEqual({ buyerPremiumBps: 2000, premiumBands: [
      { loCents: 0, hiCents: 100_050, bps: 2000 }, { loCents: 100_050, hiCents: 2_500_000, bps: 1750 }, { loCents: 2_500_000, hiCents: null, bps: 1225 },
    ] });
  });
  it.each(['', 'fifteen', '15', '15%; 10%', '15% to $5,000', '101%', '15% to $5,000; 10% to $4,000; 5%', '15.555%', '15% to $0; 10%', '1e2%'])('refuses %j', (t) => {
    expect(parsePremium(t)).toHaveProperty('error');
  });
  it('formats what it parses', () => {
    for (const t of ['15%', '15% to $5,000; 10% above', '20% to $1,000.50; 17.5% to $25,000; 12.25% above']) {
      const p = parsePremium(t);
      if ('error' in p) throw new Error(p.error);
      expect(formatPremium(p.buyerPremiumBps, p.premiumBands)).toBe(t);
    }
  });
});
