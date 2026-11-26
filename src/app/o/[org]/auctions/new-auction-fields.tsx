'use client';
import { useId, useState } from 'react';
import { DateTimeField } from './datetime-field';

/** R-10 + R-12 (D-84): the zone is chosen first, and both date fields preview in it. Native select over the browser's zone list. */
export function NewAuctionFields({ serverNowMs, zones }: { serverNowMs: number; zones: readonly string[] }) {
  const [tz, setTz] = useState('UTC');
  const id = useId(); // htmlFor, not a wrapping label: a wrapped select's accessible name would swallow 400 zone names
  return (
    <>
      <div className="field"><label htmlFor={id}>Time zone</label> <select id={id} name="timeZone" value={tz} onChange={(e) => setTz(e.target.value)}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></div>
      <DateTimeField name="opensAt" label="Opens" tz={tz} serverNowMs={serverNowMs} required future="opens in" past="opened" />
      <DateTimeField name="firstCloseAt" label="First lot closes (optional)" tz={tz} serverNowMs={serverNowMs} future="closes in" past="closed" />
      <label>Stagger (seconds between lot closes) <input name="staggerSeconds" inputMode="numeric" defaultValue="0" required /></label>
      <p className="muted form-explain">With a first close and a stagger, a new lot closes at the first close plus (lot number − 1) × stagger unless its own close is given.</p>
    </>
  );
}
