import { inZone } from '@/auction/house-time';
import { closesIn } from '@/auction/time-left';
/** R21: relative on the page, the exact instant in the house's zone in the title (R-12), for the catalog and Your bids. Server-rendered: it is as fresh as the page load. */
export function ClosesAt({ at, nowMs, tz }: { at: Date; nowMs: number; tz: string }) {
  return <time dateTime={at.toISOString()} title={inZone(at, tz)}>{closesIn(Math.max(0, Math.ceil((at.getTime() - nowMs) / 1000)))}</time>;
}
