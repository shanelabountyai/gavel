import { z } from 'zod';

// D-52 d, D-75, D-79: staff and bidders type dollars and cents; the text becomes whole cents by string arithmetic, so no
// float touches money. `1e2`, `$100`, `100,000` and a third decimal are refused by the pattern, not rounded.
export const dollars = (label = 'Amount') =>
  z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/, `${label}: give dollars and cents, like 125 or 125.50.`).transform((v) => {
    const [whole, frac = ''] = v.split('.');
    return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  });
