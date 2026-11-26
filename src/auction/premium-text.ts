// R-18 (D-90): a sale's buyer's premium as staff type and read it: "15%" (flat) or "15% to $5,000; 10% above"
// (tiered, each rate on the slice of the hammer up to the next boundary). Text to integers by string arithmetic, as
// dollars.ts; checkPremiumBands is the validator. Format and parse round-trip, so the form shows what is stored.
import { formatCents } from '@/auction/engine/money';
import { RulesError, checkPremiumBands, type PremiumBand } from '@/auction/engine/rules';

export type PremiumTerms = { readonly buyerPremiumBps: number; readonly premiumBands: PremiumBand[] | null };

const pct = (bps: number) => `${formatCents(bps).slice(1).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
const usd = (cents: number) => formatCents(cents).replace(/\.00$/, '');

export function formatPremium(bps: number, bands: readonly PremiumBand[] | null | undefined): string {
  if (!bands) return pct(bps);
  return bands.map((b) => (b.hiCents === null ? `${pct(b.bps)} above` : `${pct(b.bps)} to ${usd(b.hiCents)}`)).join('; ');
}

/** The typed text as a sale's premium terms, or a message saying what to type. One rate is flat (no bands stored). */
export function parsePremium(text: string): PremiumTerms | { readonly error: string } {
  const say = { error: 'Buyer\'s premium: type a rate like 15%, or tiers like "15% to $5,000; 10% above".' };
  const parts = text.split(';').map((p) => p.trim().toLowerCase());
  const bands: { loCents: number; hiCents: number | null; bps: number }[] = [];
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const m = last ? /^(\d{1,3}(?:\.\d{1,2})?)\s*%(?:\s+above)?$/.exec(part) : /^(\d{1,3}(?:\.\d{1,2})?)\s*%\s+to\s+\$?([\d,]{1,9}(?:\.\d{1,2})?)$/.exec(part);
    if (!m) return say;
    const [whole, frac = ''] = m[1]!.split('.');
    const bps = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    let hiCents: number | null = null;
    if (!last) {
      const [d, c = ''] = m[2]!.replace(/,/g, '').split('.');
      hiCents = Number(d) * 100 + Number((c + '00').slice(0, 2));
    }
    bands.push({ loCents: bands.at(-1)?.hiCents ?? 0, hiCents, bps });
  }
  try {
    const checked = checkPremiumBands(bands);
    return { buyerPremiumBps: checked[0]!.bps, premiumBands: checked.length > 1 ? checked : null };
  } catch (e) {
    if (!(e instanceof RulesError)) throw e;
    return { error: 'Buyer\'s premium: each rate at most 100%, and each tier\'s top above the one before it.' };
  }
}
